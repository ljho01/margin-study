import {
  PDFArray,
  PDFDict,
  PDFDocument,
  PDFName,
  PDFNumber,
  PDFRawStream,
  PDFRef,
  PDFStream,
  StandardFontEmbedder,
  StandardFonts,
  decodePDFRawStream,
  type PDFObject,
  type PDFPage,
} from "pdf-lib";
import type { Rect } from "./types";

/**
 * Erasable parts of a page: what its content stream paints (text runs,
 * images, forms, filled or stroked paths) and annotations other apps added.
 * Rectangles are normalized to the displayed page, top-left origin.
 */
export type PdfElement = {
  id: string;
  kind: "text" | "image" | "path" | "annotation";
  rect: Rect;
};

type Matrix = [number, number, number, number, number, number];
type Value = number | string | boolean | null | Value[] | { name: string };
type Op = {
  op: string;
  args: Value[];
  /** First operand to the end of the operator. */
  start: number;
  end: number;
  /** The operator token itself. */
  opStart: number;
};

const LOAD = { updateMetadata: false, parseSpeed: Infinity } as const;
const SAVE = { objectsPerTick: Infinity } as const;
const IDENTITY: Matrix = [1, 0, 0, 1, 0, 0];
const multiply = (m: Matrix, n: Matrix): Matrix => [
  m[0] * n[0] + m[1] * n[2],
  m[0] * n[1] + m[1] * n[3],
  m[2] * n[0] + m[3] * n[2],
  m[2] * n[1] + m[3] * n[3],
  m[4] * n[0] + m[5] * n[2] + n[4],
  m[4] * n[1] + m[5] * n[3] + n[5],
];
const apply = (m: Matrix, x: number, y: number) => ({
  x: m[0] * x + m[2] * y + m[4],
  y: m[1] * x + m[3] * y + m[5],
});
const invert = (m: Matrix): Matrix => {
  const det = m[0] * m[3] - m[1] * m[2];
  return [
    m[3] / det,
    -m[1] / det,
    -m[2] / det,
    m[0] / det,
    (m[2] * m[5] - m[3] * m[4]) / det,
    (m[1] * m[4] - m[0] * m[5]) / det,
  ];
};

// Content streams are binary; one char per byte keeps offsets and bytes exact.
const toLatin1 = (bytes: Uint8Array) => {
  let out = "";
  for (let i = 0; i < bytes.length; i += 0x8000)
    out += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return out;
};
const fromLatin1 = (text: string) => {
  const bytes = new Uint8Array(text.length);
  for (let i = 0; i < text.length; i++) bytes[i] = text.charCodeAt(i) & 0xff;
  return bytes;
};

const WHITE = new Set([0, 9, 10, 12, 13, 32]);
const DELIMITER = new Set([..."()<>[]{}/%"].map((c) => c.charCodeAt(0)));
const isWhite = (code: number) => WHITE.has(code);
const isRegular = (code: number) => !WHITE.has(code) && !DELIMITER.has(code);

/** Splits a content stream into operators with their operands and offsets. */
export function parseContent(text: string): Op[] {
  const ops: Op[] = [];
  let i = 0;
  let args: Value[] = [];
  let argsStart = -1;
  const skip = () => {
    while (i < text.length) {
      const c = text.charCodeAt(i);
      if (isWhite(c)) i++;
      else if (c === 37) while (i < text.length && text[i] !== "\n" && text[i] !== "\r") i++;
      else break;
    }
  };
  const literal = () => {
    let depth = 1;
    let out = "";
    i++;
    while (i < text.length && depth) {
      const ch = text[i++];
      if (ch === "\\") {
        const next = text[i++];
        if (next === undefined) break;
        const map: Record<string, string> = { n: "\n", r: "\r", t: "\t", b: "\b", f: "\f" };
        if (map[next]) out += map[next];
        else if (next >= "0" && next <= "7") {
          let oct = next;
          while (oct.length < 3 && text[i] >= "0" && text[i] <= "7") oct += text[i++];
          out += String.fromCharCode(parseInt(oct, 8) & 0xff);
        } else if (next === "\r") {
          if (text[i] === "\n") i++;
        } else if (next !== "\n") out += next;
      } else if (ch === "(") {
        depth++;
        out += ch;
      } else if (ch === ")") {
        if (--depth) out += ch;
      } else out += ch;
    }
    return out;
  };
  const value = (): Value | undefined => {
    skip();
    const c = text[i];
    if (c === undefined) return undefined;
    if (c === "(") return literal();
    if (c === "<" && text[i + 1] === "<") {
      // Dictionaries only appear as marked-content properties; skip them.
      let depth = 0;
      while (i < text.length) {
        if (text.startsWith("<<", i)) {
          depth++;
          i += 2;
        } else if (text.startsWith(">>", i)) {
          depth--;
          i += 2;
          if (!depth) break;
        } else if (text[i] === "(") literal();
        else i++;
      }
      return null;
    }
    if (c === "<") {
      const end = text.indexOf(">", i);
      const hex = text.slice(i + 1, end < 0 ? text.length : end).replace(/[^0-9a-fA-F]/g, "");
      i = end < 0 ? text.length : end + 1;
      let out = "";
      for (let k = 0; k < hex.length; k += 2)
        out += String.fromCharCode(parseInt((hex[k] + (hex[k + 1] ?? "0")), 16));
      return out;
    }
    if (c === "[") {
      i++;
      const items: Value[] = [];
      for (;;) {
        skip();
        if (i >= text.length) break;
        if (text[i] === "]") {
          i++;
          break;
        }
        const item = value();
        if (item === undefined) break;
        if (typeof item === "object" && item && "op" in (item as object)) break;
        items.push(item);
      }
      return items;
    }
    if (c === "]" || c === ">" || c === "{" || c === "}" || c === ")") {
      i++;
      return null;
    }
    if (c === "/") {
      let j = i + 1;
      while (j < text.length && isRegular(text.charCodeAt(j))) j++;
      const name = text.slice(i + 1, j).replace(/#([0-9a-fA-F]{2})/g, (_, h) => String.fromCharCode(parseInt(h, 16)));
      i = j;
      return { name };
    }
    let j = i;
    while (j < text.length && isRegular(text.charCodeAt(j))) j++;
    const word = text.slice(i, j);
    if (/^[+-]?(\d+\.?\d*|\.\d+)$/.test(word)) {
      i = j;
      return Number(word);
    }
    return { op: word } as unknown as Value;
  };
  for (;;) {
    skip();
    if (i >= text.length) break;
    const at = i;
    const item = value();
    if (item === undefined) break;
    if (item && typeof item === "object" && "op" in (item as object)) {
      const op = (item as unknown as { op: string }).op;
      if (!op) {
        i++;
        continue;
      }
      i = at + op.length;
      if (op === "true" || op === "false" || op === "null") {
        if (argsStart < 0) argsStart = at;
        args.push(op === "null" ? null : op === "true");
        continue;
      }
      let end = i;
      if (op === "BI") {
        // Inline image: key/value pairs, ID, raw data, EI.
        const data = text.indexOf("ID", i);
        let k = data < 0 ? text.length : data + 3;
        for (; k < text.length - 1; k++)
          if (
            text[k] === "E" &&
            text[k + 1] === "I" &&
            isWhite(text.charCodeAt(k - 1)) &&
            (k + 2 >= text.length || isWhite(text.charCodeAt(k + 2)))
          )
            break;
        end = Math.min(text.length, k + 2);
        i = end;
      }
      ops.push({ op, args, start: argsStart < 0 ? at : argsStart, end, opStart: at });
      args = [];
      argsStart = -1;
    } else {
      if (argsStart < 0) argsStart = at;
      args.push(item);
    }
  }
  return ops;
}

const pageSpace = (page: PDFPage) => {
  const { width: w, height: h, x: ox, y: oy } = page.getCropBox();
  const angle = ((page.getRotation().angle % 360) + 360) % 360;
  const sideways = angle === 90 || angle === 270;
  const base: Matrix =
    angle === 90
      ? [0, 1, -1, 0, w, 0]
      : angle === 180
        ? [-1, 0, 0, -1, w, h]
        : angle === 270
          ? [0, -1, 1, 0, 0, h]
          : [1, 0, 0, 1, 0, 0];
  const toUser: Matrix = [base[0], base[1], base[2], base[3], base[4] + ox, base[5] + oy];
  return { width: sideways ? h : w, height: sideways ? w : h, fromUser: invert(toUser) };
};

type Font = {
  twoByte: boolean;
  /** Advance of a code in thousandths of the font size. */
  width: (code: number) => number;
  ascent: number;
  descent: number;
};

const num = (pdf: PDFDocument, value: PDFObject | undefined, fallback = 0) => {
  const resolved = value instanceof PDFRef ? pdf.context.lookup(value) : value;
  return resolved instanceof PDFNumber ? resolved.asNumber() : fallback;
};
const arrayOf = (pdf: PDFDocument, value: PDFObject | undefined) => {
  const resolved = value instanceof PDFRef ? pdf.context.lookup(value) : value;
  return resolved instanceof PDFArray ? resolved : undefined;
};
const dictOf = (pdf: PDFDocument, value: PDFObject | undefined) => {
  const resolved = value instanceof PDFRef ? pdf.context.lookup(value) : value;
  return resolved instanceof PDFDict ? resolved : undefined;
};
const nameOf = (pdf: PDFDocument, value: PDFObject | undefined) => {
  const resolved = value instanceof PDFRef ? pdf.context.lookup(value) : value;
  return resolved instanceof PDFName ? resolved.asString().slice(1) : undefined;
};

const STANDARD = new Set<string>(Object.values(StandardFonts));
function readFont(pdf: PDFDocument, dict: PDFDict | undefined): Font {
  const fallback: Font = { twoByte: false, width: () => 500, ascent: 0.8, descent: -0.2 };
  if (!dict) return fallback;
  const get = (key: string) => dict.get(PDFName.of(key));
  const subtype = nameOf(pdf, get("Subtype"));
  let descriptor = dictOf(pdf, get("FontDescriptor"));
  if (subtype === "Type0") {
    const descendant = dictOf(pdf, arrayOf(pdf, get("DescendantFonts"))?.get(0));
    descriptor = dictOf(pdf, descendant?.get(PDFName.of("FontDescriptor")));
    const fallbackWidth = num(pdf, descendant?.get(PDFName.of("DW")), 1000);
    const widths = new Map<number, number>();
    const w = arrayOf(pdf, descendant?.get(PDFName.of("W")));
    for (let k = 0; w && k < w.size(); ) {
      const first = num(pdf, w.get(k));
      const next = w.get(k + 1);
      const list = arrayOf(pdf, next);
      if (list) {
        for (let n = 0; n < list.size(); n++) widths.set(first + n, num(pdf, list.get(n)));
        k += 2;
      } else {
        const last = num(pdf, next);
        const value = num(pdf, w.get(k + 2));
        for (let c = first; c <= last && c - first < 65536; c++) widths.set(c, value);
        k += 3;
      }
    }
    return {
      ...metrics(pdf, descriptor),
      twoByte: true,
      width: (code) => widths.get(code) ?? fallbackWidth,
    };
  }
  const first = num(pdf, get("FirstChar"));
  const widths = arrayOf(pdf, get("Widths"));
  const missing = num(pdf, descriptor?.get(PDFName.of("MissingWidth")));
  // Type 3 glyph widths are in glyph space, scaled by the font matrix.
  const matrix = arrayOf(pdf, get("FontMatrix"));
  const scale = subtype === "Type3" && matrix ? num(pdf, matrix.get(0), 0.001) * 1000 : 1;
  let standard: StandardFontEmbedder | undefined;
  const base = nameOf(pdf, get("BaseFont"))?.replace(/^[A-Z]{6}\+/, "");
  if (!widths && base && STANDARD.has(base))
    standard = StandardFontEmbedder.for(
      base as Parameters<typeof StandardFontEmbedder.for>[0],
    );
  return {
    ...metrics(pdf, descriptor),
    twoByte: false,
    width: (code) => {
      if (widths && code >= first && code - first < widths.size())
        return num(pdf, widths.get(code - first)) * scale;
      if (standard)
        try {
          return standard.widthOfTextAtSize(String.fromCharCode(code), 1000);
        } catch {
          return missing || 500;
        }
      return missing || (widths ? 0 : 500);
    },
  };
}
function metrics(pdf: PDFDocument, descriptor: PDFDict | undefined) {
  const ascent = num(pdf, descriptor?.get(PDFName.of("Ascent"))) / 1000;
  const descent = num(pdf, descriptor?.get(PDFName.of("Descent"))) / 1000;
  return { ascent: ascent > 0 ? ascent : 0.8, descent: descent < 0 ? descent : -0.2 };
}

function pageContent(pdf: PDFDocument, page: PDFPage) {
  const contents = page.node.Contents();
  const streams: PDFObject[] =
    contents instanceof PDFArray ? contents.asArray() : contents ? [contents] : [];
  return streams
    .map((item) => {
      const stream = item instanceof PDFRef ? pdf.context.lookup(item) : item;
      if (stream instanceof PDFRawStream) return toLatin1(decodePDFRawStream(stream).decode());
      if (stream instanceof PDFStream) return toLatin1(stream.getContents());
      return "";
    })
    .join("\n");
}

type Painted = { id: string; kind: PdfElement["kind"]; points: { x: number; y: number }[]; op: Op; edit: string };

/** Interprets a page's content stream to locate everything it paints. */
function interpret(pdf: PDFDocument, page: PDFPage, text: string) {
  const ops = parseContent(text);
  const resources = page.node.Resources();
  const fonts = dictOf(pdf, resources?.get(PDFName.of("Font")));
  const xobjects = dictOf(pdf, resources?.get(PDFName.of("XObject")));
  const fontCache = new Map<string, Font>();
  type State = {
    ctm: Matrix; font?: Font; size: number; tc: number; tw: number; th: number;
    tl: number; rise: number;
  };
  let state: State = { ctm: IDENTITY, size: 0, tc: 0, tw: 0, th: 1, tl: 0, rise: 0 };
  const stack: State[] = [];
  let tm: Matrix = IDENTITY;
  let tlm: Matrix = IDENTITY;
  let path: { x: number; y: number }[] = [];
  const painted: Painted[] = [];
  const n = (v: Value | undefined) => (typeof v === "number" ? v : 0);
  const user = (x: number, y: number) => apply(state.ctm, x, y);
  const move = (x: number, y: number) => {
    tlm = multiply([1, 0, 0, 1, x, y], tlm);
    tm = tlm;
  };
  /** Advances the text matrix over a string; returns the advance and its replacement. */
  const show = (items: Value[]) => {
    const font = state.font ?? readFont(pdf, undefined);
    let advance = 0;
    for (const item of items) {
      if (typeof item === "number") {
        advance -= (item / 1000) * state.size * state.th;
        continue;
      }
      if (typeof item !== "string") continue;
      for (let k = 0; k < item.length; ) {
        const code = font.twoByte
          ? (item.charCodeAt(k) << 8) | (item.charCodeAt(k + 1) || 0)
          : item.charCodeAt(k);
        k += font.twoByte ? 2 : 1;
        const space = !font.twoByte && code === 32 ? state.tw : 0;
        advance += ((font.width(code) / 1000) * state.size + state.tc + space) * state.th;
      }
    }
    return advance;
  };
  ops.forEach((op, index) => {
    const a = op.args;
    switch (op.op) {
      case "q": stack.push({ ...state }); break;
      case "Q": state = stack.pop() ?? state; break;
      case "cm": state = { ...state, ctm: multiply(a.map(n) as Matrix, state.ctm) }; break;
      case "BT": tm = tlm = IDENTITY; break;
      case "Tf": {
        const name = (a[0] as { name?: string } | null)?.name ?? "";
        if (!fontCache.has(name)) fontCache.set(name, readFont(pdf, dictOf(pdf, fonts?.get(PDFName.of(name)))));
        state = { ...state, font: fontCache.get(name), size: n(a[1]) };
        break;
      }
      case "Tc": state = { ...state, tc: n(a[0]) }; break;
      case "Tw": state = { ...state, tw: n(a[0]) }; break;
      case "Tz": state = { ...state, th: n(a[0]) / 100 }; break;
      case "TL": state = { ...state, tl: n(a[0]) }; break;
      case "Ts": state = { ...state, rise: n(a[0]) }; break;
      case "Td": move(n(a[0]), n(a[1])); break;
      case "TD": state = { ...state, tl: -n(a[1]) }; move(n(a[0]), n(a[1])); break;
      case "Tm": tm = tlm = a.map(n) as Matrix; break;
      case "T*": move(0, -state.tl); break;
      case "Tj": case "TJ": case "'": case '"': {
        if (op.op === '"') state = { ...state, tw: n(a[0]), tc: n(a[1]) };
        if (op.op === "'" || op.op === '"') move(0, -state.tl);
        const items = op.op === "TJ" ? (Array.isArray(a[0]) ? a[0] : []) : [a[a.length - 1]];
        const advance = show(items);
        const font = state.font ?? readFont(pdf, undefined);
        const m = multiply(tm, state.ctm);
        const low = state.rise + font.descent * state.size;
        const high = state.rise + font.ascent * state.size;
        const points = [apply(m, 0, low), apply(m, advance, low), apply(m, 0, high), apply(m, advance, high)];
        // Erased text keeps its advance so the rest of the line stays put.
        const scale = state.size * state.th;
        const skipText = scale ? `[${(-advance * 1000) / scale}] TJ` : "";
        const edit =
          op.op === "'" ? `T* ${skipText}` :
          op.op === '"' ? `${n(a[0])} Tw ${n(a[1])} Tc T* ${skipText}` : skipText;
        tm = multiply([1, 0, 0, 1, advance, 0], tm);
        const draws = items.some((item) => typeof item === "string" && item.length);
        if (draws && advance > 0 && state.size) painted.push({ id: `op:${index}`, kind: "text", points, op, edit });
        break;
      }
      case "m": case "l": path.push(user(n(a[0]), n(a[1]))); break;
      case "c": for (let k = 0; k < 6; k += 2) path.push(user(n(a[k]), n(a[k + 1]))); break;
      case "v": case "y": for (let k = 0; k < 4; k += 2) path.push(user(n(a[k]), n(a[k + 1]))); break;
      case "re": {
        const [x, y, w, h] = a.map(n);
        path.push(user(x, y), user(x + w, y), user(x, y + h), user(x + w, y + h));
        break;
      }
      case "S": case "s": case "f": case "F": case "f*": case "B": case "B*": case "b": case "b*":
        // Painting with n instead keeps a clip that the same path may set.
        if (path.length) painted.push({ id: `op:${index}`, kind: "path", points: path, op, edit: "n" });
        path = [];
        break;
      case "n": path = []; break;
      case "Do": {
        const name = (a[0] as { name?: string } | null)?.name ?? "";
        const xobject = (() => {
          const item = xobjects?.get(PDFName.of(name));
          const resolved = item instanceof PDFRef ? pdf.context.lookup(item) : item;
          return resolved instanceof PDFStream ? resolved.dict : undefined;
        })();
        if (!xobject) break;
        const subtype = nameOf(pdf, xobject.get(PDFName.of("Subtype")));
        let points = [user(0, 0), user(1, 0), user(0, 1), user(1, 1)];
        if (subtype === "Form") {
          const box = arrayOf(pdf, xobject.get(PDFName.of("BBox")));
          const matrix = arrayOf(pdf, xobject.get(PDFName.of("Matrix")));
          const fm = matrix ? (matrix.asArray().map((v) => num(pdf, v)) as Matrix) : IDENTITY;
          const m = multiply(fm, state.ctm);
          const [x0, y0, x1, y1] = box ? box.asArray().map((v) => num(pdf, v)) : [0, 0, 1, 1];
          points = [apply(m, x0, y0), apply(m, x1, y0), apply(m, x0, y1), apply(m, x1, y1)];
        }
        painted.push({ id: `op:${index}`, kind: subtype === "Image" ? "image" : "path", points, op, edit: "" });
        break;
      }
      case "BI":
        painted.push({ id: `op:${index}`, kind: "image", points: [user(0, 0), user(1, 0), user(0, 1), user(1, 1)], op, edit: "" });
        break;
    }
  });
  return painted;
}

const SKIPPED_ANNOTATIONS = new Set(["Link", "Popup"]);

function normalize(page: PDFPage, points: { x: number; y: number }[]): Rect | null {
  const space = pageSpace(page);
  const shown = points.map((p) => apply(space.fromUser, p.x, p.y));
  const xs = shown.map((p) => p.x / space.width);
  const ys = shown.map((p) => 1 - p.y / space.height);
  const x0 = Math.max(0, Math.min(...xs));
  const x1 = Math.min(1, Math.max(...xs));
  const y0 = Math.max(0, Math.min(...ys));
  const y1 = Math.min(1, Math.max(...ys));
  if (!(x1 >= x0 && y1 >= y0) || !Number.isFinite(x0 + x1 + y0 + y1)) return null;
  return { x: x0, y: y0, w: x1 - x0, h: y1 - y0 };
}

function annotations(pdf: PDFDocument, page: PDFPage) {
  const list = page.node.Annots();
  const found: { id: string; points: { x: number; y: number }[] }[] = [];
  for (let k = 0; list && k < list.size(); k++) {
    const dict = dictOf(pdf, list.get(k));
    if (!dict || SKIPPED_ANNOTATIONS.has(nameOf(pdf, dict.get(PDFName.of("Subtype"))) ?? "")) continue;
    if (num(pdf, dict.get(PDFName.of("F"))) & 2) continue; // hidden
    const rect = arrayOf(pdf, dict.get(PDFName.of("Rect")));
    if (!rect) continue;
    const [x0, y0, x1, y1] = rect.asArray().map((v) => num(pdf, v));
    found.push({ id: `annot:${k}`, points: [{ x: x0, y: y0 }, { x: x1, y: y1 }] });
  }
  return found;
}

const parsed = new WeakMap<ArrayBuffer, Promise<PDFDocument>>();
const listed = new WeakMap<ArrayBuffer, Map<number, Promise<PdfElement[]>>>();

/** Erasable elements of a page (1-based) of the editing source. */
export function pageElements(bytes: ArrayBuffer, pageNumber: number) {
  let pages = listed.get(bytes);
  if (!pages) listed.set(bytes, (pages = new Map()));
  let job = pages.get(pageNumber);
  if (!job) {
    let doc = parsed.get(bytes);
    if (!doc) parsed.set(bytes, (doc = PDFDocument.load(bytes.slice(0), LOAD)));
    job = doc.then((pdf) => {
      const page = pdf.getPage(pageNumber - 1);
      const elements: PdfElement[] = [];
      for (const item of interpret(pdf, page, pageContent(pdf, page))) {
        const rect = normalize(page, item.points);
        if (rect) elements.push({ id: item.id, kind: item.kind, rect });
      }
      for (const item of annotations(pdf, page)) {
        const rect = normalize(page, item.points);
        if (rect) elements.push({ id: item.id, kind: "annotation", rect });
      }
      return elements;
    });
    pages.set(pageNumber, job);
  }
  return job;
}

/**
 * The element under a point: annotations sit on top; otherwise the
 * smallest painted element wins, so text beats the box drawn behind it.
 * A path covering almost the whole page is a background and is skipped.
 */
export function elementAt(elements: PdfElement[], x: number, y: number, tolerance = 0) {
  const inside = (e: PdfElement) =>
    x >= e.rect.x - tolerance && x <= e.rect.x + e.rect.w + tolerance &&
    y >= e.rect.y - tolerance && y <= e.rect.y + e.rect.h + tolerance;
  const annotation = elements.filter((e) => e.kind === "annotation" && inside(e)).at(-1);
  if (annotation) return annotation;
  let best: PdfElement | undefined;
  for (const e of elements) {
    if (e.kind === "annotation" || !inside(e)) continue;
    if (e.kind === "path" && e.rect.w * e.rect.h > 0.9) continue;
    if (!best || e.rect.w * e.rect.h <= best.rect.w * best.rect.h) best = e;
  }
  return best;
}

/** Returns a copy of the editing source with the elements removed from a page. */
export async function eraseElements(bytes: ArrayBuffer, pageNumber: number, ids: string[]) {
  const pdf = await PDFDocument.load(bytes.slice(0), LOAD);
  const page = pdf.getPage(pageNumber - 1);
  const wanted = new Set(ids);
  const list = page.node.Annots();
  [...wanted]
    .filter((id) => id.startsWith("annot:"))
    .map((id) => Number(id.slice(6)))
    .sort((a, b) => b - a)
    .forEach((index) => list?.remove(index));
  const content = pageContent(pdf, page);
  const edits = interpret(pdf, page, content).filter((item) => wanted.has(item.id));
  if (edits.length) {
    let out = "";
    let at = 0;
    for (const { op, kind, edit } of edits.sort((a, b) => a.op.start - b.op.start)) {
      // Paths keep their construction (and any clip) and only stop painting.
      const from = kind === "path" && edit === "n" ? op.opStart : op.start;
      out += content.slice(at, from) + (edit ? ` ${edit} ` : " ");
      at = op.end;
    }
    out += content.slice(at);
    page.node.set(PDFName.of("Contents"), pdf.context.register(pdf.context.flateStream(fromLatin1(out))));
  }
  const saved = await pdf.save(SAVE);
  return saved.buffer.slice(saved.byteOffset, saved.byteOffset + saved.byteLength) as ArrayBuffer;
}

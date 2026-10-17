import type { PDFDocumentProxy } from "pdfjs-dist";
import {
  LineCapStyle,
  LineJoinStyle,
  PDFArray,
  PDFDict,
  PDFDocument,
  PDFHexString,
  PDFName,
  PDFRef,
  PDFStream,
  PDFString,
  beginText,
  endText,
  fill,
  lineTo,
  moveText,
  moveTo,
  popGraphicsState,
  pushGraphicsState,
  rectangle,
  setFillingRgbColor,
  setFontAndSize,
  setGraphicsState,
  setLineCap,
  setLineJoin,
  setLineWidth,
  setStrokingRgbColor,
  showText,
  stroke,
  type PDFFont,
  type PDFObject,
  type PDFOperator,
  type PDFPage,
} from "pdf-lib";
import fontkit from "@pdf-lib/fontkit";
import type { Annotation, StudyDocument } from "./types";

type Literal = Parameters<
  PDFDocument["context"]["formXObject"]
>[1] extends infer T
  ? T extends Record<string, infer V>
    ? V
    : never
  : never;

async function renderPage(
  pdf: PDFDocumentProxy,
  page: number,
  maxSide: number,
  maxScale: number,
) {
  const source = await pdf.getPage(page);
  const base = source.getViewport({ scale: 1 });
  const viewport = source.getViewport({
    scale: Math.min(maxScale, maxSide / Math.max(base.width, base.height)),
  });
  const canvas = document.createElement("canvas");
  canvas.width = Math.ceil(viewport.width);
  canvas.height = Math.ceil(viewport.height);
  // Print intent does not depend on requestAnimationFrame, which WKWebView
  // suspends when a different app is in front during a background batch.
  const render = source.render({
    canvas,
    canvasContext: canvas.getContext("2d")!,
    viewport,
    intent: "print",
  });
  const timeout = setTimeout(() => render.cancel(), 30000);
  try {
    await render.promise;
  } finally {
    clearTimeout(timeout);
  }
  return { source, canvas };
}

export async function pageContext(
  pdf: PDFDocumentProxy,
  page: number,
  fallbackText = "",
) {
  const { source, canvas } = await renderPage(pdf, page, 1600, 2);
  const content = await source.getTextContent();
  const text =
    content.items
      .map((item) =>
        "str" in item
          ? item.str + ("hasEOL" in item && item.hasEOL ? "\n" : " ")
          : "",
      )
      .join("")
      .trim() || fallbackText;
  const image = canvas.toDataURL("image/jpeg", 0.85);
  canvas.width = 0;
  canvas.height = 0;
  return { text, image };
}

export async function pageImage(pdf: PDFDocumentProxy, page: number) {
  const { canvas } = await renderPage(pdf, page, 2600, 3);
  const blob = await new Promise<Blob>((resolve, reject) =>
    canvas.toBlob(
      (value) =>
        value
          ? resolve(value)
          : reject(new Error("페이지 이미지를 만들지 못했습니다.")),
      "image/png",
    ),
  );
  canvas.width = 0;
  canvas.height = 0;
  return new Uint8Array(await blob.arrayBuffer());
}

const MARKER = PDFName.of("MarginStudy");
// Default parsing yields to setTimeout every few objects, which WebKit throttles.
const LOAD = { updateMetadata: false, parseSpeed: Infinity } as const;
const SAVE = { objectsPerTick: Infinity } as const;
const toBuffer = (bytes: Uint8Array) =>
  bytes.buffer.slice(
    bytes.byteOffset,
    bytes.byteOffset + bytes.byteLength,
  ) as ArrayBuffer;

export type ParsedPdf = {
  display: ArrayBuffer;
  annotations: Record<number, Annotation[]>;
  writable: boolean;
};

/**
 * Splits app-authored annotations from the file. Rendering uses the stripped
 * copy so the editable overlay is the only visible instance.
 */
export async function readPdf(bytes: ArrayBuffer): Promise<ParsedPdf> {
  let pdf: PDFDocument;
  try {
    pdf = await PDFDocument.load(bytes, LOAD);
  } catch {
    return { display: bytes, annotations: {}, writable: false };
  }
  const annotations: Record<number, Annotation[]> = {};
  let found = false;
  pdf.getPages().forEach((page, index) => {
    const list = page.node.Annots();
    if (!list) return;
    for (let i = list.size() - 1; i >= 0; i--) {
      const dict = page.node.context.lookup(list.get(i));
      if (!(dict instanceof PDFDict)) continue;
      const data = dict.get(MARKER);
      if (!(data instanceof PDFHexString || data instanceof PDFString))
        continue;
      try {
        (annotations[index + 1] ??= []).unshift(
          JSON.parse(data.decodeText()) as Annotation,
        );
      } catch {
        continue;
      }
      list.remove(i);
      found = true;
    }
  });
  if (!found) return { display: bytes, annotations, writable: true };
  collectGarbage(pdf);
  return {
    display: toBuffer(await pdf.save(SAVE)),
    annotations,
    writable: true,
  };
}

/** Drops objects no longer reachable after removing pages or annotations. */
function collectGarbage(pdf: PDFDocument) {
  const context = pdf.context;
  const seen = new Set<string>();
  const stack: (PDFObject | undefined)[] = [
    context.trailerInfo.Root,
    context.trailerInfo.Info,
    context.trailerInfo.Encrypt,
  ];
  while (stack.length) {
    const item = stack.pop();
    if (!item) continue;
    if (item instanceof PDFRef) {
      const key = item.toString();
      if (seen.has(key)) continue;
      seen.add(key);
      stack.push(context.lookup(item));
    } else if (item instanceof PDFDict) {
      for (const [, value] of item.entries()) stack.push(value);
    } else if (item instanceof PDFArray) {
      for (let i = 0; i < item.size(); i++) stack.push(item.get(i));
    } else if (item instanceof PDFStream) {
      stack.push(item.dict);
    }
  }
  for (const [ref] of context.enumerateIndirectObjects())
    if (!seen.has(ref.toString())) context.delete(ref);
}

const rgb = (hex: string): [number, number, number] => [
  parseInt(hex.slice(1, 3), 16) / 255,
  parseInt(hex.slice(3, 5), 16) / 255,
  parseInt(hex.slice(5, 7), 16) / 255,
];

type Matrix = [number, number, number, number, number, number];

/** Maps the rotated, displayed page into unrotated PDF user space. */
function pageSpace(page: PDFPage) {
  const { width: w, height: h, x: ox, y: oy } = page.getCropBox();
  const angle = ((page.getRotation().angle % 360) + 360) % 360;
  const sideways = angle === 90 || angle === 270;
  const width = sideways ? h : w;
  const height = sideways ? w : h;
  const base: Matrix =
    angle === 90
      ? [0, 1, -1, 0, w, 0]
      : angle === 180
        ? [-1, 0, 0, -1, w, h]
        : angle === 270
          ? [0, -1, 1, 0, 0, h]
          : [1, 0, 0, 1, 0, 0];
  const matrix: Matrix = [
    base[0],
    base[1],
    base[2],
    base[3],
    base[4] + ox,
    base[5] + oy,
  ];
  const toUser = (x: number, y: number) => ({
    x: matrix[0] * x + matrix[2] * y + matrix[4],
    y: matrix[1] * x + matrix[3] * y + matrix[5],
  });
  /** Normalized display coordinates (top-left origin) to display points (bottom-left origin). */
  const display = (x: number, y: number) => ({
    x: x * width,
    y: (1 - y) * height,
  });
  return { width, matrix, toUser, display };
}

function userRect(space: ReturnType<typeof pageSpace>, box: number[]) {
  const corners = [
    space.toUser(box[0], box[1]),
    space.toUser(box[2], box[1]),
    space.toUser(box[0], box[3]),
    space.toUser(box[2], box[3]),
  ];
  const xs = corners.map((p) => p.x);
  const ys = corners.map((p) => p.y);
  return [Math.min(...xs), Math.min(...ys), Math.max(...xs), Math.max(...ys)];
}

export function highlightRects(annotation: Annotation) {
  if (annotation.rects?.length) return annotation.rects;
  if (annotation.points.length < 2) return [];
  const [p, q] = annotation.points;
  return [
    {
      x: Math.min(p.x, q.x),
      y: Math.min(p.y, q.y),
      w: Math.abs(q.x - p.x),
      h: Math.abs(q.y - p.y),
    },
  ];
}

function addAnnotation(
  pdf: PDFDocument,
  page: PDFPage,
  annotation: Annotation,
  font?: PDFFont,
) {
  const context = pdf.context;
  const space = pageSpace(page);
  const [r, g, b] = rgb(annotation.color);
  const operators: PDFOperator[] = [];
  const resources: Record<string, Literal> = {};
  const entries: Record<string, Literal> = {};
  let box: number[];

  if (annotation.type === "highlight") {
    const rects = highlightRects(annotation);
    if (!rects.length) return;
    resources.ExtGState = {
      G0: context.obj({ Type: "ExtGState", BM: "Multiply", ca: 0.35 }),
    };
    operators.push(
      pushGraphicsState(),
      setGraphicsState("G0"),
      setFillingRgbColor(r, g, b),
    );
    const quads: number[] = [];
    const xs: number[] = [];
    const ys: number[] = [];
    for (const rect of rects) {
      const top = space.display(rect.x, rect.y);
      const bottom = space.display(rect.x + rect.w, rect.y + rect.h);
      operators.push(
        rectangle(top.x, bottom.y, bottom.x - top.x, top.y - bottom.y),
      );
      xs.push(top.x, bottom.x);
      ys.push(top.y, bottom.y);
      for (const p of [
        space.toUser(top.x, top.y),
        space.toUser(bottom.x, top.y),
        space.toUser(top.x, bottom.y),
        space.toUser(bottom.x, bottom.y),
      ])
        quads.push(p.x, p.y);
    }
    operators.push(fill(), popGraphicsState());
    box = [Math.min(...xs), Math.min(...ys), Math.max(...xs), Math.max(...ys)];
    entries.Subtype = "Highlight";
    entries.QuadPoints = quads;
    entries.CA = 0.35;
  } else if (annotation.type === "pen") {
    if (annotation.points.length < 2) return;
    const lineWidth = annotation.width * space.width;
    const points = annotation.points.map((p) => space.display(p.x, p.y));
    operators.push(
      setStrokingRgbColor(r, g, b),
      setLineWidth(lineWidth),
      setLineCap(LineCapStyle.Round),
      setLineJoin(LineJoinStyle.Round),
      moveTo(points[0].x, points[0].y),
      ...points.slice(1).map((p) => lineTo(p.x, p.y)),
      stroke(),
    );
    const pad = lineWidth / 2;
    box = [
      Math.min(...points.map((p) => p.x)) - pad,
      Math.min(...points.map((p) => p.y)) - pad,
      Math.max(...points.map((p) => p.x)) + pad,
      Math.max(...points.map((p) => p.y)) + pad,
    ];
    entries.Subtype = "Ink";
    entries.InkList = [
      points.flatMap((p) => {
        const user = space.toUser(p.x, p.y);
        return [user.x, user.y];
      }),
    ];
    entries.BS = { W: lineWidth };
  } else {
    if (!font || !annotation.text) return;
    const size = annotation.width * space.width;
    const lines = annotation.text.split("\n");
    const origin = space.display(
      annotation.points[0].x,
      annotation.points[0].y,
    );
    const ascent = font.heightAtSize(size, { descender: false });
    const leading = size * 1.5;
    resources.Font = { F0: font.ref };
    operators.push(
      beginText(),
      setFillingRgbColor(r, g, b),
      setFontAndSize("F0", size),
    );
    lines.forEach((line, index) =>
      operators.push(
        moveText(index ? 0 : origin.x, index ? -leading : origin.y - ascent),
        showText(font.encodeText(line)),
      ),
    );
    operators.push(endText());
    const width = Math.max(
      ...lines.map((line) => font.widthOfTextAtSize(line, size)),
      1,
    );
    box = [
      origin.x,
      origin.y - ascent - (lines.length - 1) * leading - size * 0.3,
      origin.x + width,
      origin.y,
    ];
    entries.Subtype = "FreeText";
    entries.DA = PDFString.of(
      "/F0 " + size.toFixed(2) + " Tf " + r + " " + g + " " + b + " rg",
    );
    entries.BS = { W: 0 };
  }

  const appearance = context.register(
    context.formXObject(operators, {
      BBox: box,
      Matrix: space.matrix,
      Resources: resources,
    }),
  );
  const annot = context.obj({
    Type: "Annot",
    ...entries,
    Rect: userRect(space, box),
    C: [r, g, b],
    F: 4,
    P: page.ref,
    NM: PDFString.of("margin:" + annotation.id),
    Contents: PDFHexString.fromText(annotation.text ?? ""),
    AP: { N: appearance },
  });
  annot.set(MARKER, PDFHexString.fromText(JSON.stringify(annotation)));
  page.node.addAnnot(context.register(annot));
}

let fontBytes: Promise<ArrayBuffer> | undefined;
const loadFont = () =>
  (fontBytes ??= fetch("/fonts/NanumGothic-Regular.ttf").then((r) => {
    if (!r.ok) throw new Error("필기 글꼴을 읽지 못했습니다.");
    return r.arrayBuffer();
  }));

/**
 * Writes the remaining pages with editable annotations. The input is the
 * stripped display copy returned by readPdf.
 */
export async function writePdf(
  display: ArrayBuffer,
  doc: StudyDocument,
): Promise<Uint8Array> {
  let pdf: PDFDocument;
  try {
    pdf = await PDFDocument.load(display, LOAD);
  } catch {
    throw new Error(
      "암호화된 PDF는 저장할 수 없습니다. 내보내기를 사용해 주세요.",
    );
  }
  pdf.registerFontkit(fontkit);
  const keep = new Set(doc.pages);
  // pdf-lib's page cache is not refreshed by removePage, so resolve pages first.
  const original = pdf.getPages();
  const total = original.length;
  for (let index = total - 1; index >= 0; index--)
    if (!keep.has(index + 1)) pdf.removePage(index);
  if (keep.size !== total) collectGarbage(pdf);
  const hasText = doc.pages.some((p) =>
    doc.annotations[p]?.some((a) => a.type === "text" && a.text),
  );
  // Subsetting drops Hangul glyphs from this font, so embed it whole.
  const font = hasText
    ? await pdf.embedFont(await loadFont(), { subset: false })
    : undefined;
  for (const pageNumber of doc.pages)
    for (const annotation of doc.annotations[pageNumber] ?? [])
      addAnnotation(pdf, original[pageNumber - 1], annotation, font);
  return pdf.save(SAVE);
}

import { describe, expect, test } from "bun:test";
import {
  PDFDocument,
  PDFName,
  PDFRawStream,
  StandardFonts,
  decodePDFRawStream,
  degrees,
  rgb,
} from "pdf-lib";
import { elementAt, eraseElements, pageElements, parseContent } from "./pdf-elements";

const toBuffer = (bytes: Uint8Array) =>
  bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;
// 1x1 red PNG.
const PNG = Uint8Array.from(atob(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8DwHwAFBQIAX8jx0gAAAABJRU5ErkJggg==",
), (c) => c.charCodeAt(0));

async function fixture(rotate = 0) {
  const pdf = await PDFDocument.create();
  const font = await pdf.embedFont(StandardFonts.Helvetica);
  const image = await pdf.embedPng(PNG);
  const page = pdf.addPage([600, 800]);
  page.drawText("Keep this title", { x: 50, y: 700, size: 24, font });
  page.drawText("Erase me", { x: 50, y: 600, size: 24, font });
  page.drawImage(image, { x: 300, y: 400, width: 200, height: 100 });
  page.drawRectangle({ x: 50, y: 200, width: 100, height: 50, color: rgb(0, 0, 1) });
  if (rotate) page.setRotation(degrees(rotate));
  // An annotation another app added (a sticky note).
  const note = pdf.context.obj({
    Type: "Annot", Subtype: "Text", Rect: [400, 700, 420, 720], Contents: pdf.context.obj("hi" as never),
  });
  page.node.set(PDFName.of("Annots"), pdf.context.obj([pdf.context.register(note)]));
  return toBuffer(await pdf.save());
}

async function contentOf(bytes: ArrayBuffer) {
  const pdf = await PDFDocument.load(bytes);
  const contents = pdf.getPage(0).node.Contents()!;
  const stream = pdf.context.lookup(contents instanceof PDFRawStream ? contents : (contents as never)) as PDFRawStream;
  return new TextDecoder("latin1").decode(decodePDFRawStream(stream).decode());
}

describe("PDF element eraser", () => {
  test("finds text runs, images, shapes and annotations where they are drawn", async () => {
    const elements = await pageElements(await fixture(), 1);
    const kinds = elements.map((e) => e.kind).sort();
    expect(kinds).toEqual(["annotation", "image", "path", "text", "text"]);
    // "Erase me" baseline at y=600 of 800 → about 0.25 from the top.
    const text = elementAt(elements, 0.15, 0.24)!;
    expect(text.kind).toBe("text");
    expect(text.rect.y).toBeGreaterThan(0.22);
    expect(text.rect.y + text.rect.h).toBeLessThan(0.27);
    expect(elementAt(elements, 400 / 600, 1 - 450 / 800)!.kind).toBe("image");
    expect(elementAt(elements, 100 / 600, 1 - 225 / 800)!.kind).toBe("path");
    expect(elementAt(elements, 410 / 600, 1 - 710 / 800)!.kind).toBe("annotation");
    expect(elementAt(elements, 0.9, 0.95)).toBeUndefined();
  });

  test("erasing removes only the chosen elements and keeps the rest in place", async () => {
    const bytes = await fixture();
    const elements = await pageElements(bytes, 1);
    const chosen = [
      elementAt(elements, 0.15, 0.24)!,
      elementAt(elements, 400 / 600, 1 - 450 / 800)!,
      elementAt(elements, 410 / 600, 1 - 710 / 800)!,
    ];
    const erased = await eraseElements(bytes, 1, chosen.map((e) => e.id));
    const left = await pageElements(erased, 1);
    expect(left.map((e) => e.kind).sort()).toEqual(["path", "text"]);
    const title = elements.find((e) => e.kind === "text" && e.rect.y < 0.2)!;
    expect(left.find((e) => e.kind === "text")!.rect).toEqual(title.rect);
    const content = await contentOf(erased);
    expect(content).toContain("Keep this title".split("").map((c) => c.charCodeAt(0).toString(16).padStart(2, "0")).join("").toUpperCase());
    expect(parseContent(content).filter((op) => op.op === "Do")).toHaveLength(0);
  });

  test("rotated pages map elements to the displayed orientation", async () => {
    const elements = await pageElements(await fixture(90), 1);
    const image = elements.find((e) => e.kind === "image")!;
    // Rotated 90° clockwise: the page displays 800 wide by 600 tall.
    expect(image.rect.w).toBeCloseTo(100 / 800, 3);
    expect(image.rect.h).toBeCloseTo(200 / 600, 3);
  });

  test("an erased fill keeps the clip built from the same path", () => {
    const ops = parseContent("q 0 0 100 100 re W f 1 0 0 1 0 0 cm (A) Tj Q");
    expect(ops.map((o) => o.op)).toEqual(["q", "re", "W", "f", "cm", "Tj", "Q"]);
    expect(ops[5].args).toEqual(["A"]);
  });

  test("parses strings with escapes, hex strings and inline images", () => {
    const ops = parseContent("BT (a\\) b \\(c\\)) Tj <48 69> Tj [(x) -250 (y)] TJ ET BI /W 1 /H 1 ID \x00\x01 EI Q");
    expect(ops.find((o) => o.op === "Tj")!.args).toEqual(["a) b (c)"]);
    expect(ops.filter((o) => o.op === "Tj")[1].args).toEqual(["Hi"]);
    expect(ops.find((o) => o.op === "TJ")!.args).toEqual([["x", -250, "y"]]);
    expect(ops.map((o) => o.op)).toEqual(["BT", "Tj", "Tj", "TJ", "ET", "BI", "Q"]);
  });
});

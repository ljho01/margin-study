import { describe, expect, test, beforeAll, afterAll } from "bun:test";
import {
  PDFArray,
  PDFDict,
  PDFDocument,
  PDFName,
  StandardFonts,
  degrees,
} from "pdf-lib";
import { readPdf, writePdf } from "./pdf";
import type { Annotation, StudyDocument } from "./types";

const fontFile = Bun.file(
  new URL("../../public/fonts/NanumGothic-Regular.ttf", import.meta.url),
);
const realFetch = globalThis.fetch;
beforeAll(() => {
  globalThis.fetch = (async () =>
    new Response(await fontFile.arrayBuffer())) as unknown as typeof fetch;
});
afterAll(() => {
  globalThis.fetch = realFetch;
});

const toBuffer = (bytes: Uint8Array) =>
  bytes.buffer.slice(
    bytes.byteOffset,
    bytes.byteOffset + bytes.byteLength,
  ) as ArrayBuffer;

async function source(rotate = 0) {
  const pdf = await PDFDocument.create();
  const font = await pdf.embedFont(StandardFonts.Helvetica);
  for (let i = 1; i <= 3; i++) {
    const page = pdf.addPage([600 + i * 10, 800]);
    page.drawText("Original page " + i, { x: 40, y: 700, font, size: 20 });
    if (rotate) page.setRotation(degrees(rotate));
  }
  return toBuffer(await pdf.save());
}

const highlight: Annotation = {
  id: "h1",
  type: "highlight",
  color: "#f4ca43",
  points: [{ x: 0.1, y: 0.2 }],
  rects: [
    { x: 0.1, y: 0.2, w: 0.4, h: 0.03 },
    { x: 0.1, y: 0.24, w: 0.2, h: 0.03 },
  ],
  text: "selected text",
  width: 0,
};
const note: Annotation = {
  id: "t1",
  type: "text",
  color: "#29344a",
  points: [{ x: 0.1, y: 0.1 }],
  width: 0.026,
  text: "중요한 개념\n두 번째 줄",
};
const pen: Annotation = {
  id: "p1",
  type: "pen",
  color: "#4d79d8",
  points: [
    { x: 0.2, y: 0.5 },
    { x: 0.3, y: 0.55 },
    { x: 0.4, y: 0.5 },
  ],
  width: 0.004,
};

function doc(
  pages: number[],
  annotations: StudyDocument["annotations"],
): StudyDocument {
  return {
    id: "fixture",
    name: "fixture.pdf",
    size: 1,
    totalPages: 3,
    pages,
    currentPage: pages[0],
    annotations,
    analyses: {},
    chats: {},
    updatedAt: "2026-10-16",
    createdAt: "2026-10-16",
  };
}

async function subtypes(bytes: Uint8Array) {
  const pdf = await PDFDocument.load(bytes);
  return pdf
    .getPages()
    .map((page) =>
      (page.node.Annots()?.asArray() ?? []).map((ref) =>
        (pdf.context.lookup(ref) as PDFDict)
          .get(PDFName.of("Subtype"))
          ?.toString(),
      ),
    );
}

describe("PDF save", () => {
  test("removes deleted pages and writes standard annotations", async () => {
    const saved = await writePdf(
      await source(),
      doc([1, 3], { 1: [note], 3: [highlight, pen] }),
    );
    const pdf = await PDFDocument.load(saved);
    expect(pdf.getPages().map((p) => p.getWidth())).toEqual([610, 630]);
    expect(await subtypes(saved)).toEqual([
      ["/FreeText"],
      ["/Highlight", "/Ink"],
    ]);
  });

  test("reopens annotations as editable data on the renumbered pages", async () => {
    const saved = await writePdf(
      await source(),
      doc([1, 3], { 1: [note], 3: [highlight, pen] }),
    );
    const opened = await readPdf(toBuffer(saved));
    expect(opened.writable).toBe(true);
    expect(opened.annotations).toEqual({ 1: [note], 2: [highlight, pen] });
    expect(await subtypes(new Uint8Array(opened.display))).toEqual([[], []]);
  });

  test("repeated saves do not accumulate fonts or appearances", async () => {
    let bytes = await writePdf(await source(), doc([1, 2, 3], { 1: [note] }));
    const first = bytes.byteLength;
    for (let i = 0; i < 3; i++) {
      const opened = await readPdf(toBuffer(bytes));
      bytes = await writePdf(
        opened.display,
        doc([1, 2, 3], opened.annotations),
      );
    }
    expect(bytes.byteLength).toBeLessThan(first * 1.05);
  });

  test("places rotated-page annotations inside the page", async () => {
    const saved = await writePdf(
      await source(90),
      doc([1], { 1: [highlight] }),
    );
    const pdf = await PDFDocument.load(saved);
    const page = pdf.getPage(0);
    const annot = pdf.context.lookup(page.node.Annots()!.get(0)) as PDFDict;
    const [x1, y1, x2, y2] = annot
      .lookup(PDFName.of("Rect"), PDFArray)
      .asArray()
      .map((n) => Number(n.toString()));
    expect(page.getRotation().angle).toBe(90);
    expect(x1).toBeGreaterThanOrEqual(0);
    expect(y1).toBeGreaterThanOrEqual(0);
    expect(x2).toBeLessThanOrEqual(page.getWidth());
    expect(y2).toBeLessThanOrEqual(page.getHeight());
  });
});

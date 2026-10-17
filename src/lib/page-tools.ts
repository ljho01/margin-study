import type { PDFDocumentProxy } from "pdfjs-dist";
import type { ToolHandler, ToolResult } from "./ai";
import { pageContext } from "./pdf";
import type { StudyDocument } from "./types";

const fail = (text: string): ToolResult => ({
  success: false,
  contentItems: [{ type: "inputText", text }],
});

/**
 * PDF tools for the chat. Page numbers follow the reader's order after
 * deletions; they are mapped to the original page before reading.
 * @param current Page number (1-based, reader order) the student is viewing.
 */
export function pageTools(
  doc: StudyDocument,
  pdf: PDFDocumentProxy,
  current: number,
): ToolHandler {
  const pages = doc.pages;
  const total = pages.length;
  const ocrText = (original: number) =>
    doc.ocr?.[original]?.map((line) => line.text).join("\n");
  const pageNumber = (value: unknown) => {
    const n = Number(value);
    return Number.isInteger(n) && n >= 1 && n <= total ? n : null;
  };
  const read = async (n: number): Promise<ToolResult> => {
    const original = pages[n - 1];
    const { text, image } = await pageContext(pdf, original, ocrText(original));
    return {
      success: true,
      contentItems: [
        {
          type: "inputText",
          text: `${n}쪽 (전체 ${total}쪽)\n<page_text>\n${text.slice(0, 30000) || "(추출된 텍스트 없음)"}\n</page_text>`,
        },
        { type: "inputImage", imageUrl: image },
      ],
    };
  };
  const excerpt = async (original: number) => {
    const content = await (await pdf.getPage(original)).getTextContent();
    const text = content.items
      .map((item) => ("str" in item ? item.str : ""))
      .join(" ")
      .replace(/\s+/g, " ")
      .trim();
    return (text || ocrText(original)?.replace(/\s+/g, " ") || "").slice(
      0,
      160,
    );
  };
  return async (tool, args) => {
    if (tool === "read_current_page") return read(current);
    if (tool === "read_page") {
      const n = pageNumber(args.page);
      return n ? read(n) : fail(`1~${total} 사이의 페이지 번호를 지정하세요.`);
    }
    if (tool === "list_pages") {
      const from = args.from === undefined ? 1 : pageNumber(args.from);
      const to = args.to === undefined ? total : pageNumber(args.to);
      if (!from || !to || from > to)
        return fail(`1~${total} 사이의 범위를 지정하세요.`);
      const end = Math.min(to, from + 199);
      const lines = [`현재 페이지: ${current}쪽 / 전체 ${total}쪽`];
      for (let n = from; n <= end; n++) {
        const original = pages[n - 1];
        const analysis = doc.analyses[original];
        lines.push(
          analysis
            ? `${n}쪽: ${analysis.title} — ${analysis.keyPoints.join("; ")}`
            : `${n}쪽 (요약 없음): ${await excerpt(original)}`,
        );
      }
      if (end < to)
        lines.push(`${end + 1}쪽부터는 from=${end + 1}로 다시 요청하세요.`);
      return {
        success: true,
        contentItems: [{ type: "inputText", text: lines.join("\n") }],
      };
    }
    return fail(`알 수 없는 도구: ${tool}`);
  };
}

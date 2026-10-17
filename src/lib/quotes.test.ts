import { describe, expect, test } from "bun:test";
import {
  quoteToken,
  quotesAsText,
  quotesForAI,
  quotesOf,
  splitQuotes,
  withoutQuotes,
} from "./quotes";

describe("quotes", () => {
  const token = quoteToken({ page: 12, text: "  Projected\n gradient | descent ⟧" });
  const message = `이 부분 ${token} 설명해줘`;

  test("a token keeps the page and one line of text", () => {
    expect(quotesOf(message)).toEqual([
      { page: 12, text: "Projected gradient | descent" },
    ]);
    expect(splitQuotes(message)).toEqual([
      "이 부분 ",
      { page: 12, text: "Projected gradient | descent" },
      " 설명해줘",
    ]);
  });

  test("the AI gets a quotation with the page number the student sees", () => {
    // Original page 12 is the 9th page after deletions.
    expect(quotesForAI(message, (p) => (p === 12 ? 9 : undefined))).toBe(
      "이 부분 “Projected gradient | descent”(9쪽에서 인용) 설명해줘",
    );
    expect(quotesForAI(message, () => undefined)).toContain("(원본 12쪽에서 인용)");
  });

  test("titles and the visible text drop the token syntax", () => {
    expect(withoutQuotes(message)).toBe("이 부분 설명해줘");
    expect(quotesAsText(message)).toBe(
      "이 부분 “Projected gradient | des…” 설명해줘",
    );
  });
});

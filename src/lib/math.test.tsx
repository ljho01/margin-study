import { describe, expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import ChatMarkdown from "@/components/ChatMarkdown";
import Markdown from "@/components/Markdown";
import { normalizeMath } from "./math";

// An answer as the model wrote it (the case that showed as plain text).
// Bun mangles non-ASCII text inside String.raw, so it is in English.
const answer = String.raw`The slide writes \[ \mathbb E[x^{(i)}] =\sum_{x^{(i)}=0}^{1}x^{(i)}\theta^{x^{(i)}}(1-\theta)^{1-x^{(i)}} \] and the \(x^{(i)}\) inside should be a **random variable**.

Strictly, with \(X^{(i)}\) and values \(a\in\{0,1\}\):
\[
\mathbb E[X^{(i)}] =\sum_{a\in\{0,1\}}a\,P(X^{(i)}=a) =\theta.
\]`;

describe("math delimiters", () => {
  test("\\( \\) and \\[ \\] become dollar math", () => {
    expect(normalizeMath(String.raw`v \( x_1 \) and \[ y \]`)).toBe(
      "v $x_1$ and $$y$$",
    );
  });

  test("code, dollar math and escaped backslashes are left alone", () => {
    const kept = String.raw`\`\(a\)\` $\begin{bmatrix}1 \\ (2)\end{bmatrix}$ a \\(b\\)`;
    expect(normalizeMath(kept)).toBe(kept);
  });

  test("an unfinished delimiter while streaming stays text", () => {
    expect(normalizeMath(String.raw`a \( x + `)).toBe(String.raw`a \( x + `);
  });

  // The chat and the bottom panel use different Markdown renderers.
  for (const [name, render] of [
    ["chat", () => renderToStaticMarkup(<ChatMarkdown>{answer}</ChatMarkdown>)],
    ["bottom panel", () => renderToStaticMarkup(<Markdown>{answer}</Markdown>)],
  ] as const)
    test(`the ${name} renders every formula with KaTeX`, () => {
      const html = render();
      // Five formulas, none left as raw TeX.
      expect(html.match(/class="katex"/g)?.length).toBe(5);
      // KaTeX keeps the source in a MathML annotation; outside it, no TeX.
      const shown = html.replace(/<annotation[\s\S]*?<\/annotation>/g, "");
      expect(shown).not.toContain("\\mathbb");
      expect(shown).not.toContain("\\sum");
    });
});

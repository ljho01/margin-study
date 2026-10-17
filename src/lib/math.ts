/**
 * Models often write math as \( … \) and \[ … \]. Markdown reads a backslash
 * before a bracket as an escape, so inside a paragraph those delimiters lost
 * their backslash (and \{ \, with them) and the formula showed as plain
 * text. They are rewritten to $ … $ and $$ … $$ before parsing. Code and
 * math already written with dollars are left as they are, and an opening
 * delimiter still waiting for its close (while streaming) stays text.
 */
const PROTECTED = /(```[\s\S]*?(?:```|$)|`[^`\n]*`|\$\$[\s\S]*?\$\$|\$[^$\n]+\$)/;

export function normalizeMath(text: string) {
  if (!text.includes("\\(") && !text.includes("\\[")) return text;
  return text
    .split(PROTECTED)
    .map((part, index) =>
      // split() puts the protected pieces at odd indexes.
      index % 2
        ? part
        : part
            .replace(/(?<!\\)\\\[([\s\S]+?)(?<!\\)\\\]/g, (_, body: string) =>
              body.includes("\n")
                ? `$$${body}$$`
                : `$$${body.trim()}$$`,
            )
            .replace(
              /(?<!\\)\\\(([\s\S]+?)(?<!\\)\\\)/g,
              (_, body: string) => `$${body.trim()}$`,
            ),
    )
    .join("");
}

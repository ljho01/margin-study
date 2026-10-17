/**
 * Passages attached to a chat message from the PDF. A message keeps them
 * inline as tokens, so the queue, editing and history all carry the chips;
 * they become quotations with page numbers when sent to the AI.
 */
export type Quote = {
  /** Original page number of the document. */
  page: number;
  text: string;
};

const TOKEN = /⟦(\d+)\|([^⟦⟧]*)⟧/g;
const LIMIT = 4000;

export function quoteToken(quote: Quote) {
  const text = quote.text
    .replace(/[⟦⟧]/g, "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, LIMIT);
  return `⟦${quote.page}|${text}⟧`;
}

/** Text and quotes in order; empty text pieces are dropped. */
export function splitQuotes(value: string): (string | Quote)[] {
  const parts: (string | Quote)[] = [];
  let last = 0;
  for (const match of value.matchAll(TOKEN)) {
    if (match.index > last) parts.push(value.slice(last, match.index));
    parts.push({ page: Number(match[1]), text: match[2] });
    last = match.index + match[0].length;
  }
  if (last < value.length) parts.push(value.slice(last));
  return parts;
}

export function quotesOf(value: string) {
  return splitQuotes(value).filter((x): x is Quote => typeof x !== "string");
}

/** The message without its quotes. */
export function withoutQuotes(value: string) {
  return value.replace(TOKEN, " ").replace(/[ \t]+/g, " ").trim();
}

/**
 * Writes quotes as quotations the model can read. label turns an original
 * page into the page number the student sees.
 */
export function quotesForAI(
  value: string,
  label: (page: number) => number | undefined,
) {
  return value.replace(TOKEN, (_, page: string, text: string) => {
    const shown = label(Number(page));
    return `“${text}”(${shown ? `${shown}쪽` : `원본 ${page}쪽`}에서 인용)`;
  });
}

/** One line for titles and the queue. */
export function quotesAsText(value: string) {
  return value
    .replace(TOKEN, (_, __, text: string) =>
      `“${text.length > 24 ? text.slice(0, 24) + "…" : text}”`,
    )
    .replace(/\s+/g, " ")
    .trim();
}

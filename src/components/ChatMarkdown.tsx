import katex from "katex";
import type { MarkdownExtension } from "@tanstack/markdown";
import { Markdown, type MarkdownComponents } from "@tanstack/markdown/react";
import { streamingMarkdownExtension } from "@tanstack/markdown/extensions/streaming";
import { normalizeMath } from "@/lib/math";

const tex = (value: string, displayMode: boolean) =>
  katex.renderToString(value, { displayMode, throwOnError: false });

const mathNode = (value: string, display: boolean) => ({
  name: "math",
  attributes: {},
  tagName: display ? "tm-math-block" : "tm-math",
  properties: { "data-tex": value },
  children: [],
});

/** $…$, \(…\), $$…$$ and \[…\]; unfinished expressions stay as text while streaming. */
const math: MarkdownExtension = {
  name: "math",
  inlineParser: {
    markers: "$\\",
    parse({ source, index }) {
      const pairs: [string, string, boolean][] = [
        ["$$", "$$", true],
        ["\\(", "\\)", false],
        ["\\[", "\\]", true],
        ["$", "$", false],
      ];
      const pair = pairs.find(([open]) => source.startsWith(open, index));
      if (!pair) return undefined;
      const [open, close, display] = pair;
      const end = source.indexOf(close, index + open.length);
      if (end < 0) return undefined;
      const value = source.slice(index + open.length, end);
      if (!value.trim()) return undefined;
      // Prices such as "$5 and $10" are not math.
      if (open === "$" && (/^\s/.test(value) || /\s$/.test(value)))
        return undefined;
      return {
        node: { type: "inlineComponent", ...mathNode(value, display) },
        length: end + close.length - index,
      };
    },
  },
  parseBlock(context) {
    const line = context.lines[context.index]?.trim() ?? "";
    const open = line.startsWith("$$")
      ? "$$"
      : line.startsWith("\\[")
        ? "\\["
        : "";
    if (!open) return undefined;
    const close = open === "$$" ? "$$" : "\\]";
    const first = line.slice(open.length);
    const body: string[] = [];
    let cursor = context.index;
    const at = first.indexOf(close);
    if (at >= 0) {
      if (first.slice(at + close.length).trim()) return undefined;
      body.push(first.slice(0, at));
      cursor++;
    } else {
      body.push(first);
      let closed = false;
      for (cursor++; cursor < context.lines.length; cursor++) {
        const next = context.lines[cursor] ?? "";
        const end = next.indexOf(close);
        if (end >= 0) {
          body.push(next.slice(0, end));
          closed = true;
          cursor++;
          break;
        }
        body.push(next);
      }
      if (!closed) return undefined;
    }
    context.consume(cursor - context.index);
    return { type: "component", ...mathNode(body.join("\n").trim(), true) };
  },
};

const components = {
  "tm-math": (props: { "data-tex": string }) => (
    <span dangerouslySetInnerHTML={{ __html: tex(props["data-tex"], false) }} />
  ),
  "tm-math-block": (props: { "data-tex": string }) => (
    <div
      className="overflow-x-auto overflow-y-hidden [scrollbar-width:thin]"
      dangerouslySetInnerHTML={{ __html: tex(props["data-tex"], true) }}
    />
  ),
  h1: (props) => (
    <h1
      className="mt-6 text-xl font-semibold tracking-tight first:mt-0"
      {...props}
    />
  ),
  h2: (props) => (
    <h2
      className="mt-6 text-lg font-semibold tracking-tight first:mt-0"
      {...props}
    />
  ),
  h3: (props) => <h3 className="mt-4 text-base font-semibold" {...props} />,
  p: (props) => <p className="leading-7" {...props} />,
  ul: (props) => <ul className="ml-6 list-disc space-y-2" {...props} />,
  ol: (props) => <ol className="ml-6 list-decimal space-y-2" {...props} />,
  blockquote: (props) => (
    <blockquote
      className="border-l-2 pl-4 italic text-muted-foreground"
      {...props}
    />
  ),
  pre: (props) => (
    <pre
      className="overflow-auto rounded-md bg-muted p-4 text-sm break-normal [scrollbar-width:thin]"
      {...props}
    />
  ),
  code: (props) => (
    <code
      className="rounded bg-muted px-1 py-0.5 font-mono text-sm"
      {...props}
    />
  ),
  table: (props) => (
    <div className="overflow-auto">
      <table className="w-full border-collapse" {...props} />
    </div>
  ),
  th: (props) => (
    <th className="border px-3 py-2 text-left font-semibold" {...props} />
  ),
  td: (props) => <td className="border px-3 py-2 align-top" {...props} />,
  a: ({ children }) => (
    <span className="underline underline-offset-4">{children}</span>
  ),
  img: () => null,
} satisfies MarkdownComponents;

const STATIC = [math];
const STREAMING = [math, streamingMarkdownExtension()];

export default function ChatMarkdown({
  children,
  streaming = false,
}: {
  children: string;
  streaming?: boolean;
}) {
  return (
    // Korean wraps between words; only a token longer than the line breaks.
    <div className="min-w-0 space-y-3 break-words break-keep text-sm leading-7">
      <Markdown
        components={components}
        extensions={streaming ? STREAMING : STATIC}
      >
        {normalizeMath(children)}
      </Markdown>
    </div>
  );
}

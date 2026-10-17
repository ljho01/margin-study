import ReactMarkdown from "react-markdown";
import remarkCjkFriendly from "remark-cjk-friendly";
import remarkGfm from "remark-gfm";
import remarkMath from "remark-math";
import rehypeKatex from "rehype-katex";
import { repairLatex } from "@/lib/latex";
import { normalizeMath } from "@/lib/math";
export default function Markdown({ children }: { children: string }) {
  return (
    <div className="min-w-0 space-y-3 break-words text-sm leading-7 [&_.katex-display]:overflow-x-auto [&_.katex-display]:overflow-y-hidden">
      <ReactMarkdown
        remarkPlugins={[remarkGfm, remarkCjkFriendly, remarkMath]}
        rehypePlugins={[rehypeKatex]}
        components={{
          h1: ({ children }) => (
            <h1 className="mt-6 text-xl font-semibold tracking-tight first:mt-0">
              {children}
            </h1>
          ),
          h2: ({ children }) => (
            <h2 className="mt-6 text-lg font-semibold tracking-tight first:mt-0">
              {children}
            </h2>
          ),
          h3: ({ children }) => (
            <h3 className="mt-4 text-base font-semibold">{children}</h3>
          ),
          p: ({ children }) => <p className="leading-7">{children}</p>,
          ul: ({ children }) => (
            <ul className="ml-6 list-disc space-y-2">{children}</ul>
          ),
          ol: ({ children }) => (
            <ol className="ml-6 list-decimal space-y-2">{children}</ol>
          ),
          blockquote: ({ children }) => (
            <blockquote className="border-l-2 pl-4 italic text-muted-foreground">
              {children}
            </blockquote>
          ),
          pre: ({ children }) => (
            <pre className="overflow-auto rounded-md bg-muted p-4 text-sm">
              {children}
            </pre>
          ),
          code: ({ children }) => (
            <code className="rounded bg-muted px-1 py-0.5 font-mono text-sm">
              {children}
            </code>
          ),
          table: ({ children }) => (
            <div className="overflow-auto">
              <table className="w-full border-collapse">{children}</table>
            </div>
          ),
          th: ({ children }) => (
            <th className="border px-3 py-2 text-left font-semibold">
              {children}
            </th>
          ),
          td: ({ children }) => (
            <td className="border px-3 py-2 align-top">{children}</td>
          ),
          a: ({ children }) => (
            <span className="underline underline-offset-4">{children}</span>
          ),
          img: () => null,
        }}
      >
        {normalizeMath(repairLatex(children))}
      </ReactMarkdown>
    </div>
  );
}

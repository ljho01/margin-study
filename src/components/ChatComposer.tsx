import {
  createContext,
  useContext,
  useEffect,
  useImperativeHandle,
  useRef,
  type Ref,
} from "react";
import {
  EditorContent,
  Extension,
  Node,
  NodeViewWrapper,
  ReactNodeViewRenderer,
  mergeAttributes,
  useEditor,
  type Editor,
  type JSONContent,
  type NodeViewProps,
} from "@tiptap/react";
import StarterKit from "@tiptap/starter-kit";
import { Placeholder } from "@tiptap/extensions";
import { X } from "@/components/icons";
import { cn } from "@/lib/utils";
import { quoteToken, splitQuotes, type Quote } from "@/lib/quotes";

export type ComposerHandle = { focus: () => void };

/** Shows an original page number as the student sees it. */
const PageLabel = createContext<(page: number) => string>((page) =>
  String(page),
);

function QuoteChip({ node, deleteNode, selected }: NodeViewProps) {
  const label = useContext(PageLabel);
  const { page, text } = node.attrs as Quote;
  return (
    <NodeViewWrapper
      as="span"
      contentEditable={false}
      data-quote-chip
      className={cn(
        "mx-0.5 inline-flex max-w-full items-center gap-1 rounded-md border bg-muted py-px pr-0.5 pl-1.5 align-[-0.2em] text-xs leading-5 select-none",
        selected && "ring-2 ring-ring/50",
      )}
      title={text}
    >
      <span className="shrink-0 font-medium tabular-nums">
        {label(page)}쪽
      </span>
      <span className="max-w-40 truncate text-muted-foreground">{text}</span>
      <button
        type="button"
        aria-label="인용 빼기"
        className="grid size-4 shrink-0 place-items-center rounded-sm text-muted-foreground hover:bg-accent hover:text-foreground"
        onMouseDown={(e) => e.preventDefault()}
        onClick={() => deleteNode()}
      >
        <X className="size-3" />
      </button>
    </NodeViewWrapper>
  );
}

const QuoteNode = Node.create({
  name: "quote",
  group: "inline",
  inline: true,
  atom: true,
  selectable: true,
  draggable: false,
  addAttributes() {
    return {
      page: { default: 1 },
      text: { default: "" },
    };
  },
  parseHTML() {
    return [{ tag: "span[data-quote]" }];
  },
  renderHTML({ HTMLAttributes }) {
    return ["span", mergeAttributes({ "data-quote": "" }, HTMLAttributes)];
  },
  renderText({ node }) {
    return quoteToken(node.attrs as Quote);
  },
  addNodeView() {
    return ReactNodeViewRenderer(QuoteChip);
  },
});

const serialize = (editor: Editor) =>
  editor.getText({ blockSeparator: "\n" });

const toContent = (value: string): JSONContent => ({
  type: "doc",
  content: value.split("\n").map((line) => {
    const content = splitQuotes(line).map((part) =>
      typeof part === "string"
        ? { type: "text", text: part }
        : { type: "quote", attrs: part },
    );
    return content.length
      ? { type: "paragraph", content }
      : { type: "paragraph" };
  }),
});

/**
 * The chat input: plain text plus passages attached from the PDF, shown as
 * chips. Its value is the message string with quote tokens.
 */
export default function ChatComposer({
  ref,
  value,
  onChange,
  onSubmit,
  pageLabel,
  label,
  placeholder,
  className,
}: {
  ref?: Ref<ComposerHandle>;
  value: string;
  onChange: (value: string) => void;
  /** Enter without Shift; Shift+Enter starts a new line. */
  onSubmit: () => void;
  pageLabel: (page: number) => string;
  label: string;
  placeholder: string;
  className?: string;
}) {
  const latest = useRef({ onChange, onSubmit });
  latest.current = { onChange, onSubmit };
  const editor = useEditor({
    extensions: [
      StarterKit.configure({
        blockquote: false,
        bold: false,
        bulletList: false,
        code: false,
        codeBlock: false,
        heading: false,
        horizontalRule: false,
        italic: false,
        link: false,
        listItem: false,
        listKeymap: false,
        orderedList: false,
        strike: false,
        underline: false,
        trailingNode: false,
      }),
      Placeholder.configure({ placeholder }),
      QuoteNode,
      Extension.create({
        name: "submitOnEnter",
        addKeyboardShortcuts() {
          return {
            Enter: ({ editor }) => {
              // Enter that confirms Hangul composition is not a send.
              if (editor.view.composing) return false;
              latest.current.onSubmit();
              return true;
            },
          };
        },
      }),
    ],
    content: toContent(value),
    editorProps: {
      attributes: {
        "aria-label": label,
        "aria-multiline": "true",
        role: "textbox",
        class: "min-h-full outline-none",
      },
    },
    onUpdate: ({ editor }) => latest.current.onChange(serialize(editor)),
  });
  // Follow changes made outside the editor: clearing after a send, editing
  // a queued question, attaching a passage.
  useEffect(() => {
    if (!editor || serialize(editor) === value) return;
    // After React's commit: chip node views render synchronously.
    queueMicrotask(() => {
      if (editor.isDestroyed || serialize(editor) === value) return;
      const focused = editor.isFocused;
      editor.commands.setContent(toContent(value), { emitUpdate: false });
      if (focused || value) editor.commands.focus("end");
    });
  }, [editor, value]);
  useImperativeHandle(
    ref,
    () => ({ focus: () => editor?.commands.focus("end") }),
    [editor],
  );
  return (
    <PageLabel.Provider value={pageLabel}>
      <EditorContent
        editor={editor}
        className={cn(
          "chat-composer max-h-64 min-h-24 w-full cursor-text overflow-y-auto rounded-md border border-input bg-transparent px-3 py-2 text-sm leading-6 shadow-xs transition-[color,box-shadow] focus-within:border-ring focus-within:ring-[3px] focus-within:ring-ring/50 dark:bg-input/30",
          className,
        )}
        onClick={() => editor?.commands.focus()}
      />
    </PageLabel.Provider>
  );
}

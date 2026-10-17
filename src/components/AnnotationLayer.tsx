import { useLayoutEffect, useRef, useState, type PointerEvent } from "react";
import type { Annotation, Point, Tool } from "@/lib/types";
import { highlightRects } from "@/lib/pdf";

type Box = { x: number; y: number; width: number; height: number };
type Editor = { point: Point; id?: string; initial?: string };

/** Selection and text-box outline, like Figma's. */
const OUTLINE = "#3b82f6";
/** Font size of new text, in pixels at the current page width. */
const NEW_TEXT_SIZE = 16;

const translate = (a: Annotation, d: Point): Annotation => ({
  ...a,
  points: a.points.map((p) => ({ x: p.x + d.x, y: p.y + d.y })),
  rects: a.rects?.map((r) => ({ ...r, x: r.x + d.x, y: r.y + d.y })),
});

export default function AnnotationLayer({
  annotations,
  onChange,
  tool,
  color,
  width,
  height,
  selected,
  onSelect,
  onTextDone,
}: {
  annotations: Annotation[];
  onChange: (items: Annotation[]) => void;
  tool: Tool;
  color: string;
  width: number;
  height: number;
  selected: string | null;
  onSelect: (id: string | null) => void;
  /** A text box was written; the caller switches to the select tool. */
  onTextDone?: (id: string) => void;
}) {
  const svgRef = useRef<SVGSVGElement>(null);
  const nodes = useRef(new Map<string, SVGGraphicsElement>());
  const [draft, setDraft] = useState<Annotation | null>(null);
  const draftRef = useRef<Annotation | null>(null);
  const [editor, setEditor] = useState<Editor | null>(null);
  // Mirrors `editor` so blur and click handlers commit only once.
  const editorOpen = useRef<Editor | null>(null);
  const editorNode = useRef<HTMLDivElement>(null);
  // Text boxes open on pointer up: opening on pointer down let the click's
  // own focus change blur the new box at once, so nothing could be typed.
  const pendingText = useRef<Editor | null>(null);
  const [offset, setOffset] = useState<Point | null>(null);
  const dragRef = useRef<{
    id: string;
    start: Point;
    bounds: Box | null;
    offset: Point | null;
  } | null>(null);
  const [box, setBox] = useState<Box | null>(null);
  const texts = useRef(new Map<string, SVGTextElement>());
  const [textBoxes, setTextBoxes] = useState<Record<string, Box>>({});

  useLayoutEffect(() => {
    const node = editorNode.current;
    if (!editor || !node) return;
    node.textContent = editor.initial ?? "";
    node.focus();
    const range = document.createRange();
    range.selectNodeContents(node);
    range.collapse(false);
    const selection = window.getSelection();
    selection?.removeAllRanges();
    selection?.addRange(range);
  }, [editor]);
  useLayoutEffect(() => {
    const node = selected ? nodes.current.get(selected) : undefined;
    const b = node?.getBBox();
    setBox(b ? { x: b.x, y: b.y, width: b.width, height: b.height } : null);
  }, [selected, annotations, width, height, editor]);
  useLayoutEffect(() => {
    const next: Record<string, Box> = {};
    for (const [id, node] of texts.current) {
      const b = node.getBBox();
      next[id] = { x: b.x, y: b.y, width: b.width, height: b.height };
    }
    setTextBoxes((prev) =>
      JSON.stringify(prev) === JSON.stringify(next) ? prev : next,
    );
  }, [annotations, width, height, editor]);

  const raw = (event: { clientX: number; clientY: number }): Point => {
    const r = svgRef.current!.getBoundingClientRect();
    return {
      x: (event.clientX - r.left) / r.width,
      y: (event.clientY - r.top) / r.height,
    };
  };
  const point = (event: PointerEvent<SVGSVGElement>): Point => {
    const p = raw(event);
    return {
      x: Math.max(0, Math.min(1, p.x)),
      y: Math.max(0, Math.min(1, p.y)),
    };
  };
  const openEditor = (next: Editor) => {
    editorOpen.current = next;
    setEditor(next);
  };
  const commitText = () => {
    const current = editorOpen.current;
    if (!current) return;
    editorOpen.current = null;
    const original = annotations.find((a) => a.id === current.id);
    const value = (editorNode.current?.innerText ?? "")
      .replace(/\u00a0/g, " ")
      .replace(/^\n+|\s+$/g, "");
    setEditor(null);
    if (value) {
      const a: Annotation = original
        ? { ...original, text: value }
        : {
            id: crypto.randomUUID(),
            type: "text",
            points: [current.point],
            color,
            width: NEW_TEXT_SIZE / width,
            text: value,
          };
      onChange([...annotations.filter((x) => x.id !== a.id), a]);
      onTextDone?.(a.id);
    } else if (original) {
      onChange(annotations.filter((x) => x.id !== original.id));
      onSelect(null);
    }
  };
  const down = (e: PointerEvent<SVGSVGElement>) => {
    if (tool === "select") return;
    e.preventDefault();
    const p = point(e);
    if (tool === "text") {
      // A click outside the box being typed finishes it, as in Figma. The
      // page's own pointer-down handler would clear the selection that the
      // finished text gets, so the click stops here.
      if (editorOpen.current) {
        e.stopPropagation();
        commitText();
      } else pendingText.current = { point: p };
      return;
    }
    if (tool === "eraser") return;
    e.currentTarget.setPointerCapture(e.pointerId);
    const a: Annotation = {
      id: crypto.randomUUID(),
      type: tool === "highlight" ? "highlight" : "pen",
      points: tool === "highlight" ? [p, p] : [p],
      color,
      width: 2.2 / width,
    };
    draftRef.current = a;
    setDraft(a);
  };
  const move = (e: PointerEvent<SVGSVGElement>) => {
    const a = draftRef.current;
    if (!a) return;
    const p = point(e);
    const next = {
      ...a,
      points: a.type === "highlight" ? [a.points[0], p] : [...a.points, p],
    };
    draftRef.current = next;
    setDraft(next);
  };
  const up = () => {
    const text = pendingText.current;
    pendingText.current = null;
    if (text) {
      openEditor(text);
      return;
    }
    const a = draftRef.current;
    if (
      a &&
      (a.type === "pen"
        ? a.points.length > 1
        : Math.abs(a.points[1].x - a.points[0].x) > 0.005 &&
          Math.abs(a.points[1].y - a.points[0].y) > 0.003)
    )
      onChange([...annotations, a]);
    draftRef.current = null;
    setDraft(null);
  };

  const grab = (a: Annotation, event: PointerEvent<SVGElement>) => {
    event.stopPropagation();
    if (tool === "text" && a.type === "text") {
      // With the text tool, clicking existing text edits it.
      event.preventDefault();
      if (editorOpen.current) commitText();
      else
        pendingText.current = { point: a.points[0], id: a.id, initial: a.text };
      return;
    }
    if (tool === "eraser") {
      onChange(annotations.filter((x) => x.id !== a.id));
      return;
    }
    if (tool !== "select" || event.button !== 0) return;
    event.preventDefault();
    window.getSelection()?.removeAllRanges();
    onSelect(a.id);
    const b = nodes.current.get(a.id)?.getBBox();
    dragRef.current = {
      id: a.id,
      start: raw(event),
      bounds: b
        ? {
            x: b.x / width,
            y: b.y / height,
            width: b.width / width,
            height: b.height / height,
          }
        : null,
      offset: null,
    };
    event.currentTarget.setPointerCapture(event.pointerId);
  };
  const drag = (event: PointerEvent<SVGElement>) => {
    const d = dragRef.current;
    if (!d) return;
    const p = raw(event);
    let dx = p.x - d.start.x;
    let dy = p.y - d.start.y;
    if (d.bounds) {
      dx = Math.max(-d.bounds.x, Math.min(1 - d.bounds.x - d.bounds.width, dx));
      dy = Math.max(
        -d.bounds.y,
        Math.min(1 - d.bounds.y - d.bounds.height, dy),
      );
    }
    if (!d.offset && Math.hypot(dx * width, dy * height) < 3) return;
    d.offset = { x: dx, y: dy };
    setOffset(d.offset);
  };
  const drop = () => {
    const d = dragRef.current;
    dragRef.current = null;
    setOffset(null);
    if (d?.offset)
      onChange(
        annotations.map((a) => (a.id === d.id ? translate(a, d.offset!) : a)),
      );
  };

  const interactive = tool === "select" || tool === "eraser";
  const render = (a: Annotation) => {
    if (editor?.id === a.id) return null;
    const moving = offset && dragRef.current?.id === a.id;
    const hittable = interactive || (tool === "text" && a.type === "text");
    const common = {
      ref: (node: SVGGraphicsElement | null) => {
        if (node) nodes.current.set(a.id, node);
        else nodes.current.delete(a.id);
      },
      transform: moving
        ? `translate(${offset.x * width} ${offset.y * height})`
        : undefined,
      onPointerDown: (event: PointerEvent<SVGElement>) => grab(a, event),
      onPointerMove: drag,
      onPointerUp: drop,
      onPointerCancel: drop,
      style: {
        pointerEvents: hittable
          ? ("visiblePainted" as const)
          : ("none" as const),
        cursor:
          tool === "eraser"
            ? "crosshair"
            : tool === "select"
              ? "move"
              : hittable
                ? "text"
                : undefined,
      },
    };
    if (a.type === "highlight")
      return (
        <g
          key={a.id}
          {...common}
          fill={a.color}
          opacity={0.35}
          style={{ ...common.style, mixBlendMode: "multiply" }}
        >
          {highlightRects(a).map((r, i) => (
            <rect
              key={i}
              x={r.x * width}
              y={r.y * height}
              width={r.w * width}
              height={r.h * height}
            />
          ))}
        </g>
      );
    if (a.type === "pen") {
      const points = a.points
        .map((p) => `${p.x * width},${p.y * height}`)
        .join(" ");
      return (
        <g key={a.id} {...common}>
          <polyline
            points={points}
            stroke={a.color}
            strokeWidth={a.width * width}
            fill="none"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
          <polyline
            points={points}
            stroke="transparent"
            strokeWidth={Math.max(12, a.width * width)}
            fill="none"
            strokeLinecap="round"
            strokeLinejoin="round"
            style={{ pointerEvents: interactive ? "stroke" : "none" }}
          />
        </g>
      );
    }
    const hit = textBoxes[a.id];
    return (
      <g
        key={a.id}
        {...common}
        onDoubleClick={() => {
          if (tool !== "select") return;
          openEditor({ point: a.points[0], id: a.id, initial: a.text });
        }}
      >
        {hit && (
          <rect
            x={hit.x - 2}
            y={hit.y - 2}
            width={hit.width + 4}
            height={hit.height + 4}
            fill="transparent"
            style={{ pointerEvents: hittable ? "all" : "none" }}
          />
        )}
        <text
          ref={(node) => {
            if (node) texts.current.set(a.id, node);
            else texts.current.delete(a.id);
          }}
          x={a.points[0].x * width}
          y={a.points[0].y * height}
          fill={a.color}
          fontSize={a.width * width}
          dominantBaseline="text-before-edge"
        >
          {a.text?.split("\n").map((line, i) => (
            // WebKit does not inherit dominant-baseline into tspans; without
            // it here the text sat a line too high (its baseline on the point)
            // in the app, while the editor and PDF export use the top.
            <tspan
              key={i}
              x={a.points[0].x * width}
              dy={i ? "1.5em" : 0}
              dominantBaseline="text-before-edge"
            >
              {line}
            </tspan>
          ))}
        </text>
      </g>
    );
  };
  const editing = annotations.find((a) => a.id === editor?.id);
  const editorSize = editing ? editing.width * width : NEW_TEXT_SIZE;
  return (
    <>
      <svg
        ref={svgRef}
        aria-label="PDF 필기 영역"
        className={`absolute inset-0 z-10 touch-none ${tool === "text" ? "cursor-text" : tool !== "select" ? "cursor-crosshair" : ""}`}
        style={{ pointerEvents: tool === "select" ? "none" : "auto" }}
        width={width}
        height={height}
        viewBox={`0 0 ${width} ${height}`}
        onPointerDown={down}
        onPointerMove={move}
        onPointerUp={up}
        onPointerCancel={() => {
          draftRef.current = null;
          pendingText.current = null;
          setDraft(null);
        }}
      >
        {annotations.map(render)}
        {draft && render(draft)}
        {tool === "select" && box && !editor && (
          <rect
            fill="none"
            stroke={OUTLINE}
            x={box.x - 2}
            y={box.y - 2}
            width={box.width + 4}
            height={box.height + 4}
            strokeWidth={1}
            transform={
              offset
                ? `translate(${offset.x * width} ${offset.y * height})`
                : undefined
            }
            style={{ pointerEvents: "none" }}
          />
        )}
      </svg>
      {editor && (
        // A bare box that hugs the text, drawn where the text will stay. The
        // negative margin lines its glyphs up with the SVG text, which hangs
        // from the point (measured in WebKit and Chromium).
        <div
          ref={editorNode}
          role="textbox"
          aria-multiline
          aria-label="PDF에 쓸 글씨"
          contentEditable="plaintext-only"
          suppressContentEditableWarning
          spellCheck={false}
          className="absolute z-20 cursor-text whitespace-pre"
          style={{
            left: `${editor.point.x * 100}%`,
            top: `${editor.point.y * 100}%`,
            marginTop: -0.1 * editorSize,
            minWidth: 2,
            color: editing?.color ?? color,
            fontSize: editorSize,
            lineHeight: 1.5,
            outline: `1px solid ${OUTLINE}`,
          }}
          onBlur={commitText}
          onPointerDown={(e) => e.stopPropagation()}
          onKeyDown={(e) => {
            if (e.key === "Escape") {
              // Cancel: leave the box without writing anything; edited text
              // keeps its previous content.
              e.preventDefault();
              e.stopPropagation();
              editorOpen.current = null;
              setEditor(null);
            } else if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
              e.preventDefault();
              e.stopPropagation();
              commitText();
            }
          }}
        />
      )}
    </>
  );
}

import {
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type PointerEvent,
} from "react";
import type { Annotation, Point, Tool } from "@/lib/types";
import { highlightRects, inPaintOrder } from "@/lib/pdf";

type Box = { x: number; y: number; width: number; height: number };
type Editor = { point: Point; id?: string; initial?: string };

/** Selection and text-box outline, like Figma's. */
const OUTLINE = "#3b82f6";
/** Font size of new text, in pixels at the current page width. */
const NEW_TEXT_SIZE = 16;

/**
 * The box a text mark is typed in and shown in. The negative margin lines
 * its glyphs up with the PDF export, which hangs the text from the point.
 */
const textBox = (point: Point, size: number, color: string) => ({
  left: `${point.x * 100}%`,
  top: `${point.y * 100}%`,
  marginTop: -0.1 * size,
  fontSize: size,
  lineHeight: 1.5,
  color,
});

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
  const nodes = useRef(new Map<string, Element>());
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
  /** Where a mark is drawn, in page pixels. */
  const boundsOf = (id: string): Box | null => {
    const node = nodes.current.get(id);
    if (!node) return null;
    if (node instanceof SVGGraphicsElement) {
      const b = node.getBBox();
      return { x: b.x, y: b.y, width: b.width, height: b.height };
    }
    const svg = svgRef.current;
    if (!svg) return null;
    const page = svg.getBoundingClientRect();
    const r = node.getBoundingClientRect();
    const k = width / page.width;
    return {
      x: (r.left - page.left) * k,
      y: (r.top - page.top) * k,
      width: r.width * k,
      height: r.height * k,
    };
  };
  // Text draws its own outline (the same box it is typed in); other marks
  // get one in the SVG.
  useLayoutEffect(() => {
    const mark = annotations.find((a) => a.id === selected);
    setBox(mark && mark.type !== "text" ? boundsOf(mark.id) : null);
    // boundsOf reads the nodes rendered for these values.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selected, annotations, width, height, editor]);

  // A click (no text selected) on a highlight selects it with the select
  // tool, since highlights do not take the pointer there.
  const pick = useRef<(event: MouseEvent) => void>(() => {});
  pick.current = (event) => {
    const svg = svgRef.current;
    if (tool !== "select" || !svg) return;
    if (svg.contains(event.target as Node)) return;
    if ((event.target as Element | null)?.closest?.("[data-text-mark]")) return;
    if (!window.getSelection()?.isCollapsed) return;
    const r = svg.getBoundingClientRect();
    const x = (event.clientX - r.left) / r.width;
    const y = (event.clientY - r.top) / r.height;
    if (x < 0 || x > 1 || y < 0 || y > 1) return;
    const hit = [...annotations]
      .reverse()
      .find(
        (a) =>
          a.type === "highlight" &&
          highlightRects(a).some(
            (q) => x >= q.x && x <= q.x + q.w && y >= q.y && y <= q.y + q.h,
          ),
      );
    if (hit) onSelect(hit.id);
  };
  useEffect(() => {
    const click = (event: MouseEvent) => pick.current(event);
    document.addEventListener("click", click);
    return () => document.removeEventListener("click", click);
  }, []);
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

  const grab = (a: Annotation, event: PointerEvent<Element>) => {
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
    const b = boundsOf(a.id);
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
  const drag = (event: PointerEvent<Element>) => {
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
    // With the select tool a highlight lets the pointer through, so the text
    // under it can still be selected (and highlighted or sent to the chat);
    // a plain click on it selects it, below.
    const hittable =
      (interactive && !(tool === "select" && a.type === "highlight")) ||
      (tool === "text" && a.type === "text");
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
      // Only the hit area lives here; the visible tint is drawn by the
      // blended layer below.
      return (
        <g key={a.id} {...common} fill="transparent">
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
    // Text is drawn as HTML next to the SVG, below.
    return null;
  };
  /**
   * Text marks share the editor's box exactly, so a new text keeps the size
   * it was typed in, and double-clicking edits it in place without the
   * letters moving.
   */
  const renderText = (a: Annotation) => {
    if (editor?.id === a.id) return null;
    const moving = offset && dragRef.current?.id === a.id;
    const hittable = interactive || tool === "text";
    const chosen = tool === "select" && selected === a.id && !editor;
    return (
      <div
        key={a.id}
        ref={(node) => {
          if (node) nodes.current.set(a.id, node);
          else nodes.current.delete(a.id);
        }}
        data-text-mark
        data-selected={chosen || undefined}
        className="absolute z-10 whitespace-pre select-none"
        style={{
          ...textBox(a.points[0], a.width * width, a.color),
          outline: chosen ? `1px solid ${OUTLINE}` : undefined,
          transform: moving
            ? `translate(${offset.x * width}px, ${offset.y * height}px)`
            : undefined,
          pointerEvents: hittable ? "auto" : "none",
          cursor:
            tool === "eraser"
              ? "crosshair"
              : tool === "select"
                ? "move"
                : "text",
        }}
        onPointerDown={(event) => grab(a, event)}
        onPointerMove={drag}
        // With the text tool the editor opens on release, as on empty page.
        onPointerUp={() => (pendingText.current ? up() : drop())}
        onPointerCancel={drop}
        onDoubleClick={() => {
          if (tool !== "select") return;
          openEditor({ point: a.points[0], id: a.id, initial: a.text });
        }}
      >
        {a.text}
      </div>
    );
  };
  const all = draft ? [...annotations, draft] : annotations;
  const editing = annotations.find((a) => a.id === editor?.id);
  const editorSize = editing ? editing.width * width : NEW_TEXT_SIZE;
  return (
    <>
      {/* Highlights are a layer of their own, multiplied with the page as a
          whole so the letters show through as on paper. Blending inside the
          ink layer only mixed with that layer: where WebKit draws the PDF
          canvas on its own GPU layer, the tint then covered the text. */}
      <svg
        aria-hidden
        className="pointer-events-none absolute inset-0 z-10"
        style={{ mixBlendMode: "multiply" }}
        width={width}
        height={height}
        viewBox={`0 0 ${width} ${height}`}
      >
        {all.map(
          (a) =>
            a.type === "highlight" && (
              <g
                key={a.id}
                fill={a.color}
                opacity={0.35}
                transform={
                  offset && dragRef.current?.id === a.id
                    ? `translate(${offset.x * width} ${offset.y * height})`
                    : undefined
                }
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
            ),
        )}
      </svg>
      <svg
        ref={svgRef}
        aria-label="PDF 필기 영역"
        className={`absolute inset-0 z-10 touch-none ${tool === "text" ? "cursor-text" : tool !== "select" ? "cursor-crosshair" : ""}`}
        // With the eraser, empty page passes the pointer to the PDF eraser
        // below; marks keep their own hit areas and are erased first.
        style={{ pointerEvents: tool === "select" || tool === "eraser" ? "none" : "auto" }}
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
        {/* A highlight being drawn already sits under the pen and text. */}
        {inPaintOrder(all).map(render)}
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
      {all.filter((a) => a.type === "text").map(renderText)}
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
            ...textBox(editor.point, editorSize, editing?.color ?? color),
            minWidth: 2,
            // Thicker while typing than the selection outline. An outline
            // takes no layout space, so the letters stay where they were.
            outline: `2px solid ${OUTLINE}`,
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

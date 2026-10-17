import { useMemo } from "react";
import type { OcrLine } from "@/lib/types";

let measure: CanvasRenderingContext2D | null = null;

/** Invisible, selectable text positioned over recognized lines of a scanned page. */
export default function OcrLayer({
  lines,
  width,
  height,
}: {
  lines: OcrLine[];
  width: number;
  height: number;
}) {
  const items = useMemo(() => {
    measure ??= document.createElement("canvas").getContext("2d");
    const family = getComputedStyle(document.body).fontFamily;
    return lines.map((line) => {
      const size = line.h * height * 0.88;
      if (measure) measure.font = size + "px " + family;
      const natural = measure?.measureText(line.text).width || 1;
      return { ...line, size, scale: (line.w * width) / natural };
    });
  }, [lines, width, height]);
  return (
    <div className="absolute inset-0 overflow-hidden leading-none text-transparent selection:bg-primary/25">
      {items.map((line, index) => (
        <span
          key={index}
          className="absolute origin-top-left whitespace-pre"
          style={{
            left: line.x * width,
            top: line.y * height,
            fontSize: line.size,
            transform: "scaleX(" + line.scale + ")",
          }}
        >
          {line.text}
          {"\n"}
        </span>
      ))}
    </div>
  );
}

/** Collects line rectangles of the current text selection, relative to the page surface. */
export function selectionRects(surface: HTMLElement) {
  const selection = window.getSelection();
  if (!selection || selection.isCollapsed || !selection.rangeCount) return null;
  const range = selection.getRangeAt(0);
  if (!surface.contains(range.commonAncestorContainer)) return null;
  const box = surface.getBoundingClientRect();
  const raw: DOMRect[] = [];
  const walker = document.createTreeWalker(
    range.commonAncestorContainer,
    NodeFilter.SHOW_TEXT,
  );
  let node: Node | null =
    range.commonAncestorContainer.nodeType === Node.TEXT_NODE
      ? range.commonAncestorContainer
      : walker.nextNode();
  while (node) {
    if (node.textContent?.trim() && range.intersectsNode(node)) {
      const part = document.createRange();
      part.selectNodeContents(node);
      if (node === range.startContainer) part.setStart(node, range.startOffset);
      if (node === range.endContainer) part.setEnd(node, range.endOffset);
      raw.push(...Array.from(part.getClientRects()));
    }
    node =
      range.commonAncestorContainer.nodeType === Node.TEXT_NODE
        ? null
        : walker.nextNode();
  }
  const rects = raw
    .filter((r) => r.width > 0.5 && r.height > 0.5)
    .map((r) => ({
      x: (r.left - box.left) / box.width,
      y: (r.top - box.top) / box.height,
      w: r.width / box.width,
      h: r.height / box.height,
    }))
    .filter((r) => r.x < 1 && r.y < 1 && r.x + r.w > 0 && r.y + r.h > 0)
    .sort((a, b) => a.y + a.h / 2 - (b.y + b.h / 2) || a.x - b.x);
  // One rectangle per visual line.
  const merged: typeof rects = [];
  for (const rect of rects) {
    const line = merged.find(
      (m) =>
        Math.abs(m.y + m.h / 2 - (rect.y + rect.h / 2)) <
        Math.min(m.h, rect.h) / 2,
    );
    if (!line) {
      merged.push({ ...rect });
      continue;
    }
    const right = Math.max(line.x + line.w, rect.x + rect.w);
    const bottom = Math.max(line.y + line.h, rect.y + rect.h);
    line.x = Math.min(line.x, rect.x);
    line.y = Math.min(line.y, rect.y);
    line.w = right - line.x;
    line.h = bottom - line.y;
  }
  if (!merged.length) return null;
  return { rects: merged, text: selection.toString() };
}

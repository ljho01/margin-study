import { useEffect, useRef, useState, type PointerEvent } from "react";
import { elementAt, pageElements, type PdfElement } from "@/lib/pdf-elements";

const OUTLINE = "#ef4444";

/**
 * Eraser for the PDF's own content. Hover outlines the text run, image,
 * shape or annotation under the pointer; a click erases it and dragging
 * erases everything the pointer passes over, in one undo step.
 * App-made marks sit above this layer and are erased first.
 */
export default function PdfEraserLayer({
  bytes,
  page,
  width,
  height,
  busy,
  onErase,
}: {
  bytes: ArrayBuffer;
  /** Page of the editing source (1-based). */
  page: number;
  width: number;
  height: number;
  busy: boolean;
  onErase: (ids: string[]) => void;
}) {
  const [elements, setElements] = useState<PdfElement[]>([]);
  const [hover, setHover] = useState<PdfElement | null>(null);
  const [marked, setMarked] = useState<PdfElement[]>([]);
  const markedRef = useRef<PdfElement[]>([]);
  const dragging = useRef(false);
  useEffect(() => {
    let live = true;
    setHover(null);
    void pageElements(bytes, page).then(
      (list) => live && setElements(list),
      () => live && setElements([]),
    );
    return () => {
      live = false;
    };
  }, [bytes, page]);
  const at = (event: PointerEvent<HTMLDivElement>) => {
    const r = event.currentTarget.getBoundingClientRect();
    return elementAt(
      elements,
      (event.clientX - r.left) / r.width,
      (event.clientY - r.top) / r.height,
      3 / width,
    );
  };
  const mark = (element: PdfElement | undefined) => {
    if (!element || markedRef.current.some((e) => e.id === element.id)) return;
    markedRef.current = [...markedRef.current, element];
    setMarked(markedRef.current);
  };
  const clear = () => {
    dragging.current = false;
    markedRef.current = [];
    setMarked([]);
  };
  const finish = () => {
    if (!dragging.current) return;
    const ids = markedRef.current.map((e) => e.id);
    clear();
    if (ids.length) onErase(ids);
  };
  const box = (element: PdfElement, fill: boolean) => (
    <div
      key={element.id}
      className="pointer-events-none absolute rounded-[2px]"
      style={{
        left: element.rect.x * width - 2,
        top: element.rect.y * height - 2,
        width: element.rect.w * width + 4,
        height: element.rect.h * height + 4,
        outline: `1.5px solid ${OUTLINE}`,
        background: fill ? "rgb(239 68 68 / 0.18)" : undefined,
      }}
    />
  );
  return (
    <div
      aria-label="PDF 요소 지우기"
      className="absolute inset-0 z-[5] touch-none"
      style={{ cursor: busy ? "progress" : "crosshair" }}
      onPointerDown={(event) => {
        if (busy || event.button !== 0) return;
        event.preventDefault();
        event.currentTarget.setPointerCapture(event.pointerId);
        dragging.current = true;
        mark(at(event));
      }}
      onPointerMove={(event) => {
        const element = at(event) ?? null;
        setHover(element);
        if (dragging.current) mark(element ?? undefined);
      }}
      onPointerUp={finish}
      onPointerCancel={clear}
      onPointerLeave={() => setHover(null)}
    >
      {marked.map((element) => box(element, true))}
      {hover && !marked.some((e) => e.id === hover.id) && box(hover, false)}
    </div>
  );
}

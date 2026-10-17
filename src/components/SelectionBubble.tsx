import { useEffect, useRef, useState, type RefObject } from "react";
import { createPortal } from "react-dom";
import { Button } from "@/components/ui/button";
import { MessageSquare } from "@/components/icons";
import { cn } from "@/lib/utils";

type Place = { left: number; top: number; below: boolean };

/**
 * A small bar over text selected on the page, as in Notion or Preview:
 * highlight it in one of the colors, or attach it to the chat.
 */
export default function SelectionBubble({
  surface,
  region,
  colors,
  current,
  onHighlight,
  onAttach,
}: {
  /** The page; only selections inside it get the bar. */
  surface: RefObject<HTMLElement | null>;
  /** The scrolling reader, to follow the selection while it scrolls. */
  region: RefObject<HTMLElement | null>;
  colors: string[];
  /** The highlighter's current color, marked in the swatches. */
  current: string;
  onHighlight: (color: string) => void;
  onAttach: () => void;
}) {
  const bar = useRef<HTMLDivElement>(null);
  const [place, setPlace] = useState<Place | null>(null);
  useEffect(() => {
    let dragging = false;
    const update = () => {
      const selection = window.getSelection();
      const page = surface.current;
      if (
        !page ||
        !selection ||
        selection.isCollapsed ||
        !selection.rangeCount ||
        !selection.toString().trim()
      )
        return setPlace(null);
      const range = selection.getRangeAt(0);
      if (!page.contains(range.commonAncestorContainer)) return setPlace(null);
      const rect = range.getBoundingClientRect();
      if (!rect.width && !rect.height) return setPlace(null);
      const view = region.current?.getBoundingClientRect();
      // Hidden once the selection has scrolled out of the reader.
      if (view && (rect.bottom < view.top || rect.top > view.bottom))
        return setPlace(null);
      const width = bar.current?.offsetWidth ?? 240;
      const below = rect.top - 52 < (view?.top ?? 0);
      setPlace({
        left: Math.min(
          Math.max(rect.left + rect.width / 2, width / 2 + 8),
          window.innerWidth - width / 2 - 8,
        ),
        top: below ? rect.bottom + 8 : rect.top - 8,
        below,
      });
    };
    // While dragging out a selection the bar waits for the release.
    const down = (event: PointerEvent) => {
      if (bar.current?.contains(event.target as Node)) return;
      dragging = true;
      setPlace(null);
    };
    const up = () => {
      if (!dragging) return;
      dragging = false;
      requestAnimationFrame(update);
    };
    const change = () => {
      if (!dragging) update();
    };
    const scroller = region.current;
    document.addEventListener("pointerdown", down, true);
    document.addEventListener("pointerup", up, true);
    document.addEventListener("selectionchange", change);
    scroller?.addEventListener("scroll", change, { passive: true });
    window.addEventListener("resize", change);
    return () => {
      document.removeEventListener("pointerdown", down, true);
      document.removeEventListener("pointerup", up, true);
      document.removeEventListener("selectionchange", change);
      scroller?.removeEventListener("scroll", change);
      window.removeEventListener("resize", change);
    };
  }, [surface, region]);
  if (!place) return null;
  return createPortal(
    <div
      ref={bar}
      role="toolbar"
      aria-label="선택한 글"
      className={cn(
        "fixed z-50 flex -translate-x-1/2 items-center gap-1 rounded-lg border bg-popover p-1 text-popover-foreground shadow-md",
        !place.below && "-translate-y-full",
      )}
      style={{ left: place.left, top: place.top }}
      // Keep the page selection while using the bar.
      onMouseDown={(e) => e.preventDefault()}
    >
      <div className="flex items-center gap-0.5 px-1" aria-label="하이라이트">
        {colors.map((color) => (
          <button
            key={color}
            type="button"
            aria-label={"하이라이트 " + color}
            aria-pressed={color.toLowerCase() === current.toLowerCase()}
            className="grid size-7 place-items-center rounded-md hover:bg-accent"
            onClick={() => onHighlight(color)}
          >
            <span
              className={cn(
                "size-4 rounded-full border border-black/10",
                color.toLowerCase() === current.toLowerCase() &&
                  "ring-2 ring-ring/60 ring-offset-1 ring-offset-popover",
              )}
              style={{ backgroundColor: color }}
            />
          </button>
        ))}
      </div>
      <div className="h-5 w-px bg-border" />
      <Button size="sm" variant="ghost" className="h-7 px-2" onClick={onAttach}>
        <MessageSquare />
        AI에 첨부
      </Button>
    </div>,
    document.body,
  );
}

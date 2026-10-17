import { useEffect, useRef, useState, type MouseEvent } from "react";
import { useVirtualizer } from "@tanstack/react-virtual";
import type { PDFDocumentProxy } from "pdfjs-dist";
import PdfThumbnail, {
  THUMB_CHROME,
  THUMB_WIDTH,
} from "@/components/PdfThumbnail";
import { ScrollArea } from "@/components/ui/scroll-area";

const GAP = 8;

/**
 * Where each document's list was left. Radix Tabs unmounts the page tab, so
 * switching to the file tab and back would otherwise reset the scroll.
 */
const memory = new Map<
  string,
  { offset: number; ratio: number; current: number }
>();

export default function PageThumbnailList({
  memoryKey,
  pdf,
  pages,
  order,
  current,
  selected,
  onPick,
}: {
  /** Identifies the document whose scroll position is kept. */
  memoryKey: string;
  pdf: PDFDocumentProxy;
  /** Pages to show, as original page numbers. */
  pages: number[];
  /** Reader order of all remaining pages. */
  order: number[];
  current: number;
  /** Pages picked with Cmd/Shift-click; empty when only the current page is. */
  selected: number[];
  onPick: (page: number, event: MouseEvent) => void;
}) {
  const root = useRef<HTMLDivElement>(null);
  const remembered = useRef(memory.get(memoryKey)).current;
  // The remembered ratio gives the restored offset the same row height.
  const [ratio, setRatio] = useState(remembered?.ratio ?? 4 / 3);
  useEffect(() => {
    let live = true;
    void pdf.getPage(pages[0] ?? 1).then(
      (page) => {
        const { width, height } = page.getViewport({ scale: 1 });
        if (live) setRatio(height / width);
      },
      () => {},
    );
    return () => {
      live = false;
    };
  }, [pdf, pages[0]]);
  // Every row has the same fixed height. Measuring rendered rows instead made
  // the list shift (and the scroll position jump) whenever a thumbnail
  // finished rendering a pixel taller or shorter than estimated.
  const thumb = Math.round(THUMB_WIDTH * ratio);
  const row = thumb + THUMB_CHROME + GAP;
  const virtualizer = useVirtualizer({
    count: pages.length,
    getScrollElement: () =>
      root.current?.querySelector<HTMLElement>(
        "[data-slot=scroll-area-viewport]",
      ) ?? null,
    estimateSize: () => row,
    getItemKey: (index) => pages[index],
    overscan: 4,
    paddingStart: GAP,
    paddingEnd: GAP,
    initialOffset: remembered?.offset ?? 0,
    onChange: (instance) => {
      const saved = memory.get(memoryKey);
      memory.set(memoryKey, {
        offset: instance.scrollOffset ?? 0,
        ratio,
        current: saved?.current ?? current,
      });
    },
  });
  useEffect(() => virtualizer.measure(), [row, virtualizer]);
  // Keep the page being read in view when it changes from the keyboard or
  // reader, and again once the real page ratio has set the row height. A
  // restored list keeps its position unless the page changed meanwhile.
  const active = pages.indexOf(current);
  // A restored list stays where it was left while the page and row height
  // are what they were then; after either changes it follows the page again.
  // (Checked against the snapshot, not the last run, so StrictMode's double
  // effect run behaves the same.)
  const restoredFrom = useRef(
    remembered ? { current: remembered.current, row } : null,
  );
  useEffect(() => {
    const from = restoredFrom.current;
    const keep = !!from && from.current === current && from.row === row;
    if (!keep) restoredFrom.current = null;
    const saved = memory.get(memoryKey);
    memory.set(memoryKey, {
      offset: saved?.offset ?? 0,
      ratio,
      current,
    });
    if (!keep && active >= 0)
      virtualizer.scrollToIndex(active, { align: "auto" });
  }, [active, row, virtualizer]);
  return (
    <ScrollArea
      ref={root}
      className="min-h-0 flex-1 [&_[data-slot=scroll-area-viewport]>div]:!block"
    >
      <div
        className="relative w-full"
        style={{ height: virtualizer.getTotalSize() }}
      >
        {virtualizer.getVirtualItems().map((item) => {
          const page = pages[item.index];
          return (
            <div
              key={item.key}
              className="absolute inset-x-0 top-0 px-2"
              style={{
                height: row,
                transform: `translateY(${item.start}px)`,
                paddingBottom: GAP,
              }}
            >
              <PdfThumbnail
                pdf={pdf}
                page={page}
                index={order.indexOf(page)}
                height={thumb}
                active={page === current}
                selected={
                  selected.length ? selected.includes(page) : page === current
                }
                onClick={(event) => onPick(page, event)}
              />
            </div>
          );
        })}
      </div>
    </ScrollArea>
  );
}

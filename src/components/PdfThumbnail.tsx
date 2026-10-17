import {
  useLayoutEffect,
  useRef,
  useState,
  type MouseEvent,
} from "react";
import type { PDFDocumentProxy } from "pdfjs-dist";
import { Button } from "@/components/ui/button";
import { highlightRects } from "@/lib/pdf";
import { cachedThumbnail, renderThumbnail } from "@/lib/thumbnails";
import type { Annotation } from "@/lib/types";
import { cn } from "@/lib/utils";

export const THUMB_WIDTH = 126;
/** Space around the page image: padding, border, gap and the label line. */
export const THUMB_CHROME = 42;

/** The reader's marks, drawn small and read-only over a thumbnail. */
function Marks({
  annotations,
  width,
  height,
}: {
  annotations: Annotation[];
  width: number;
  height: number;
}) {
  const highlights = annotations.filter((a) => a.type === "highlight");
  const ink = annotations.filter((a) => a.type !== "highlight");
  // size-full also keeps Button's default icon size (size-4) off them.
  const layer = "pointer-events-none absolute inset-0 size-full";
  return (
    <>
      {/* Multiplied with the page as a whole, like the reader's layer. */}
      <svg
        aria-hidden
        className={layer}
        style={{ mixBlendMode: "multiply" }}
        viewBox={`0 0 ${width} ${height}`}
      >
        {highlights.map((a) => (
          <g key={a.id} fill={a.color} opacity={0.35}>
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
        ))}
      </svg>
      <svg aria-hidden className={layer} viewBox={`0 0 ${width} ${height}`}>
        {ink.map((a) => {
          if (a.type === "pen")
            return (
              <polyline
                key={a.id}
                points={a.points
                  .map((p) => `${p.x * width},${p.y * height}`)
                  .join(" ")}
                stroke={a.color}
                strokeWidth={Math.max(0.5, a.width * width)}
                fill="none"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            );
          const [p] = a.points;
          return (
            <text
              key={a.id}
              x={p.x * width}
              y={p.y * height}
              fill={a.color}
              fontSize={a.width * width}
              dominantBaseline="text-before-edge"
            >
              {a.text?.split("\n").map((line, i) => (
                <tspan
                  key={i}
                  x={p.x * width}
                  dy={i ? "1.5em" : 0}
                  dominantBaseline="text-before-edge"
                >
                  {line}
                </tspan>
              ))}
            </text>
          );
        })}
      </svg>
    </>
  );
}

export default function PdfThumbnail({
  pdf,
  page,
  index,
  height,
  annotations,
  active,
  selected,
  onClick,
}: {
  pdf: PDFDocumentProxy;
  page: number;
  index: number;
  /** Fixed image height, so rendering a page never changes the row size. */
  height: number;
  annotations?: Annotation[];
  active: boolean;
  selected: boolean;
  onClick: (event: MouseEvent) => void;
}) {
  const canvas = useRef<HTMLCanvasElement>(null);
  // Height of the drawn page; null until the first image is on screen.
  const [drawn, setDrawn] = useState<number | null>(null);
  // Before paint, so a cached page appears in the row's first frame. A new
  // document (a saved file re-read) keeps the previous image on screen until
  // its own has rendered.
  useLayoutEffect(() => {
    let live = true;
    const show = (source: HTMLCanvasElement) => {
      const node = canvas.current;
      if (!live || !node) return;
      node.width = source.width;
      node.height = source.height;
      node.getContext("2d")?.drawImage(source, 0, 0);
      setDrawn(Math.round((THUMB_WIDTH * source.height) / source.width));
    };
    const hit = cachedThumbnail(pdf, page, THUMB_WIDTH);
    if (hit) show(hit);
    else void renderThumbnail(pdf, page, THUMB_WIDTH).then(show, () => {});
    return () => {
      live = false;
    };
  }, [pdf, page]);
  return (
    <Button
      variant="ghost"
      onClick={onClick}
      className={cn(
        // No transition: after a delete, the next page must turn blue at
        // once instead of fading in from a blank (white-on-white) row.
        "h-full w-full flex-col justify-start gap-2 rounded-lg p-2 font-normal text-muted-foreground transition-none hover:bg-accent hover:text-foreground",
        selected &&
          "bg-blue-500 text-white hover:bg-blue-500 hover:text-white dark:bg-blue-600 dark:hover:bg-blue-600",
      )}
      aria-label={`${index + 1}페이지 보기${page !== index + 1 ? ` (원본 ${page})` : ""}`}
      aria-current={active ? "page" : undefined}
      aria-pressed={selected}
    >
      <div
        className="grid flex-none place-items-center overflow-hidden rounded-sm border bg-background"
        style={{ width: THUMB_WIDTH + 2, height: height + 2 }}
      >
        <div
          className="relative"
          style={{ width: THUMB_WIDTH, height: drawn ?? height }}
        >
          <canvas
            ref={canvas}
            width={0}
            height={0}
            className="block size-full"
          />
          {drawn !== null && !!annotations?.length && (
            <Marks
              annotations={annotations}
              width={THUMB_WIDTH}
              height={drawn}
            />
          )}
        </div>
      </div>
      <span className="text-xs leading-4 tabular-nums">
        {index + 1}
        {page !== index + 1 && (
          <span
            className={cn(
              "ml-2",
              selected ? "text-white/75" : "text-muted-foreground",
            )}
          >
            원본 {page}
          </span>
        )}
      </span>
    </Button>
  );
}

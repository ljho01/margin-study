import type { MouseEvent } from "react";
import { Page } from "react-pdf";
import type { PDFDocumentProxy } from "pdfjs-dist";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

export const THUMB_WIDTH = 126;
/** Space around the page image: padding, border, gap and the label line. */
export const THUMB_CHROME = 42;

export default function PdfThumbnail({
  pdf,
  page,
  index,
  height,
  active,
  selected,
  onClick,
}: {
  pdf: PDFDocumentProxy;
  page: number;
  index: number;
  /** Fixed image height, so rendering a page never changes the row size. */
  height: number;
  active: boolean;
  selected: boolean;
  onClick: (event: MouseEvent) => void;
}) {
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
        <Page
          pdf={pdf}
          suspense={false}
          pageNumber={page}
          width={THUMB_WIDTH}
          renderTextLayer={false}
          renderAnnotationLayer={false}
          loading={
            <div className="bg-muted" style={{ width: THUMB_WIDTH, height }} />
          }
        />
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

import {
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type ComponentProps,
  type CSSProperties,
  type ReactNode,
} from "react";
import { Page } from "react-pdf";
import type { PDFDocumentProxy } from "pdfjs-dist";

type Shown = { pdf: PDFDocumentProxy; page: number; width: number };
type Overlay = { node: ReactNode; width: number; height: number };

const documentIds = new WeakMap<PDFDocumentProxy, number>();
let nextDocumentId = 0;
const documentId = (pdf: PDFDocumentProxy) => {
  let id = documentIds.get(pdf);
  if (id === undefined) documentIds.set(pdf, (id = nextDocumentId++));
  return id;
};
const keyOf = (shown: Shown) =>
  `${documentId(shown.pdf)}:${shown.page}@${shown.width}`;

/**
 * Keeps the last drawn canvas on screen while the next one renders.
 *
 * Opening another document or page renders immediately in a hidden layer.
 * Size changes scale the existing canvas with CSS right away and re-render
 * once the size has settled, so the reader never flashes blank.
 * The overlay (ink, OCR text) switches together with the canvas, so marks
 * of the next page never appear over the previous one.
 * The parent sets the box size; canvases are layered absolutely inside it.
 */
export default function StablePage({
  pdf,
  page,
  width,
  height,
  overlay,
  onDisplayed,
  ...props
}: Omit<ComponentProps<typeof Page>, "pdf" | "pageNumber" | "width"> & {
  pdf: PDFDocumentProxy;
  page: number;
  width: number;
  height: number;
  overlay?: ReactNode;
  /** Runs after the replacement canvas and overlay have committed together. */
  onDisplayed?: (pdf: PDFDocumentProxy) => void;
}) {
  const [settled, setSettled] = useState(width);
  useEffect(() => {
    const timer = setTimeout(() => setSettled(width), 150);
    return () => clearTimeout(timer);
  }, [width]);
  const [shown, setShown] = useState<Shown | null>(null);
  const moved = !!shown && (shown.pdf !== pdf || shown.page !== page);
  const lastOverlay = useRef<Overlay | null>(null);
  useLayoutEffect(() => {
    // Ink can change many times without the PDF canvas rendering again. Keep
    // the latest committed overlay, not the one from onRenderSuccess. Once a
    // replacement starts, freeze it until that canvas is actually ready.
    if (!moved) lastOverlay.current = { node: overlay, width, height };
  }, [moved, overlay, width, height]);
  useEffect(() => {
    if (shown) onDisplayed?.(shown.pdf);
  }, [shown, onDisplayed]);
  const target: Shown = { pdf, page, width: moved ? width : settled };
  const pending = !!shown && keyOf(shown) !== keyOf(target);
  const done = () => setShown(target);
  const layer = (drawn: number): CSSProperties => ({
    position: "absolute",
    top: 0,
    left: 0,
    transformOrigin: "0 0",
    transform: drawn === width ? undefined : `scale(${width / drawn})`,
  });
  const stale = moved ? lastOverlay.current : null;
  return (
    <div className="absolute inset-0">
      {pending && (
        // The previous document stays mounted with its own proxy, so its
        // drawn canvas is kept until the new one is ready.
        <div key={keyOf(shown)} style={layer(shown.width)}>
          <Page
            pdf={shown.pdf}
            pageNumber={shown.page}
            width={shown.width}
            renderAnnotationLayer={false}
            renderTextLayer={false}
            suspense={false}
          />
        </div>
      )}
      <div
        key={keyOf(target)}
        style={{
          ...layer(target.width),
          visibility: pending ? "hidden" : undefined,
        }}
      >
        <Page
          {...props}
          pdf={pdf}
          pageNumber={page}
          width={target.width}
          onRenderSuccess={(result) => {
            done();
            props.onRenderSuccess?.(result);
          }}
          onRenderError={(error) => {
            // A failed render is not a replacement for the last good frame.
            props.onRenderError?.(error);
          }}
        />
      </div>
      <div
        inert={!!stale}
        style={
          stale
            ? {
                ...layer(stale.width),
                width: stale.width,
                height: stale.height,
                pointerEvents: "none",
                // The transform isolates this layer; keep the highlights
                // multiplied with the page while the previous page shows.
                mixBlendMode: "multiply",
              }
            : { display: "contents" }
        }
      >
        {stale ? stale.node : overlay}
      </div>
    </div>
  );
}

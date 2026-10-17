import {
  useEffect,
  useLayoutEffect,
  useRef,
  type Dispatch,
  type RefObject,
  type SetStateAction,
} from "react";

export const MIN_ZOOM = 0.5;
export const MAX_ZOOM = 4;
const clamp = (value: number) => Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, value));

/** WebKit's trackpad pinch events (not in the DOM typings). */
type GestureEvent = UIEvent & {
  scale: number;
  clientX: number;
  clientY: number;
};

/**
 * Trackpad pinch zoom for the reader. The page point under the fingers stays
 * in place; two-finger scrolling keeps panning through the scroll region.
 * Handles WebKit gesture events and ctrl+wheel pinch events.
 */
export function usePinchZoom({
  region,
  surface,
  zoom,
  setZoom,
}: {
  region: RefObject<HTMLDivElement | null>;
  surface: RefObject<HTMLDivElement | null>;
  zoom: number;
  setZoom: Dispatch<SetStateAction<number>>;
}) {
  const current = useRef(zoom);
  current.current = zoom;
  const start = useRef(zoom);
  const anchor = useRef<{
    fx: number;
    fy: number;
    x: number;
    y: number;
  } | null>(null);
  const attached = useRef<{
    element: HTMLElement | null;
    detach?: () => void;
  }>({ element: null });

  // The scroll region remounts with documents and panel changes, so listeners
  // are re-attached whenever the element differs.
  useLayoutEffect(() => {
    const element = region.current;
    if (element === attached.current.element) return;
    attached.current.detach?.();
    attached.current = { element };
    if (!element) return;
    const zoomAt = (next: number, x: number, y: number) => {
      const page = surface.current?.getBoundingClientRect();
      const value = clamp(next);
      if (!page || value === current.current) return;
      anchor.current = {
        fx: (x - page.left) / page.width,
        fy: (y - page.top) / page.height,
        x,
        y,
      };
      current.current = value;
      setZoom(value);
    };
    const wheel = (event: WheelEvent) => {
      if (!event.ctrlKey) return;
      event.preventDefault();
      zoomAt(
        current.current * Math.exp(-event.deltaY * 0.01),
        event.clientX,
        event.clientY,
      );
    };
    const gestureStart = (event: Event) => {
      event.preventDefault();
      start.current = current.current;
    };
    const gestureChange = (event: Event) => {
      event.preventDefault();
      const gesture = event as GestureEvent;
      zoomAt(start.current * gesture.scale, gesture.clientX, gesture.clientY);
    };
    const stop = (event: Event) => event.preventDefault();
    element.addEventListener("wheel", wheel, { passive: false });
    element.addEventListener("gesturestart", gestureStart);
    element.addEventListener("gesturechange", gestureChange);
    element.addEventListener("gestureend", stop);
    attached.current.detach = () => {
      element.removeEventListener("wheel", wheel);
      element.removeEventListener("gesturestart", gestureStart);
      element.removeEventListener("gesturechange", gestureChange);
      element.removeEventListener("gestureend", stop);
    };
  });
  useEffect(() => () => attached.current.detach?.(), []);

  // Pinching elsewhere must not magnify the whole interface.
  useEffect(() => {
    const stop = (event: Event) => event.preventDefault();
    const wheel = (event: WheelEvent) => {
      if (event.ctrlKey) event.preventDefault();
    };
    document.addEventListener("gesturestart", stop);
    document.addEventListener("gesturechange", stop);
    document.addEventListener("wheel", wheel, { passive: false });
    return () => {
      document.removeEventListener("gesturestart", stop);
      document.removeEventListener("gesturechange", stop);
      document.removeEventListener("wheel", wheel);
    };
  }, []);

  // After the page is laid out at the new size, scroll so the anchored point
  // is back under the fingers.
  useLayoutEffect(() => {
    const point = anchor.current;
    const element = region.current;
    const page = surface.current?.getBoundingClientRect();
    anchor.current = null;
    if (!point || !element || !page) return;
    element.scrollLeft += page.left + point.fx * page.width - point.x;
    element.scrollTop += page.top + point.fy * page.height - point.y;
  }, [zoom, region, surface]);
}

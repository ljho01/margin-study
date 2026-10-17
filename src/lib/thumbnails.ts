import type { PDFDocumentProxy } from "pdfjs-dist";

/**
 * Rendered page thumbnails, shared by every list that shows a document.
 *
 * A thumbnail is drawn from this cache in the same frame its row mounts, so
 * switching tabs or reloading a saved file never shows a blank row. The
 * cache is small (least recently used first out): only rows near the
 * viewport need to be in it.
 */
const LIMIT = 80;
const cache = new Map<string, HTMLCanvasElement>();
const pending = new Map<string, Promise<HTMLCanvasElement>>();
const ids = new WeakMap<PDFDocumentProxy, number>();
let nextId = 0;

const idOf = (pdf: PDFDocumentProxy) => {
  let id = ids.get(pdf);
  if (id === undefined) ids.set(pdf, (id = nextId++));
  return id;
};
const keyOf = (pdf: PDFDocumentProxy, page: number, width: number) =>
  `${idOf(pdf)}:${page}@${width}`;

const remember = (key: string, canvas: HTMLCanvasElement) => {
  cache.delete(key);
  cache.set(key, canvas);
  while (cache.size > LIMIT) cache.delete(cache.keys().next().value!);
};

export function cachedThumbnail(
  pdf: PDFDocumentProxy,
  page: number,
  width: number,
) {
  const key = keyOf(pdf, page, width);
  const hit = cache.get(key);
  if (hit) remember(key, hit);
  return hit;
}

/** Renders a page at `width` CSS pixels, sharp on Retina screens. */
export function renderThumbnail(
  pdf: PDFDocumentProxy,
  page: number,
  width: number,
) {
  const key = keyOf(pdf, page, width);
  const hit = cache.get(key);
  if (hit) return Promise.resolve(hit);
  let job = pending.get(key);
  if (!job) {
    job = (async () => {
      const proxy = await pdf.getPage(page);
      const base = proxy.getViewport({ scale: 1 });
      const scale = (width * Math.max(2, devicePixelRatio)) / base.width;
      const viewport = proxy.getViewport({ scale });
      const canvas = document.createElement("canvas");
      canvas.width = Math.round(viewport.width);
      canvas.height = Math.round(viewport.height);
      await proxy.render({ canvas, viewport }).promise;
      remember(key, canvas);
      return canvas;
    })().finally(() => pending.delete(key));
    pending.set(key, job);
  }
  return job;
}

/**
 * Reuses thumbnails drawn from `from` for `to`, a re-read copy with the
 * same pages (the file just saved). `pages` maps each page of `to` to
 * its page in `from`.
 */
export function carryThumbnails(
  from: PDFDocumentProxy,
  to: PDFDocumentProxy,
  pages: Map<number, number>,
) {
  const prefix = `${idOf(from)}:`;
  const back = new Map<number, number[]>();
  for (const [next, previous] of pages)
    back.set(previous, [...(back.get(previous) ?? []), next]);
  for (const [key, canvas] of [...cache]) {
    if (!key.startsWith(prefix)) continue;
    const [page, width] = key.slice(prefix.length).split("@").map(Number);
    for (const next of back.get(page) ?? [])
      remember(keyOf(to, next, width), canvas);
  }
}

/** PDF.js uses stream async iteration, which older WKWebViews do not provide. */
export async function* streamValues<T>(
  this: ReadableStream<T>,
  options: { preventCancel?: boolean } = {},
): AsyncGenerator<T, void, unknown> {
  const reader = this.getReader();
  let done = false;
  try {
    while (true) {
      const next = await reader.read();
      if (next.done) {
        done = true;
        return;
      }
      yield next.value;
    }
  } finally {
    try {
      if (!done && !options.preventCancel) await reader.cancel();
    } finally {
      reader.releaseLock();
    }
  }
}
if (
  typeof ReadableStream !== "undefined" &&
  !ReadableStream.prototype[Symbol.asyncIterator]
) {
  Object.defineProperty(ReadableStream.prototype, Symbol.asyncIterator, {
    value: streamValues,
    configurable: true,
    writable: true,
  });
}

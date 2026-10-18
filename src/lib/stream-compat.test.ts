import { expect, test } from "bun:test";
import { streamValues } from "./stream-compat";

test("WebKit fallback reads all PDF stream chunks and releases the reader", async () => {
  const stream = new ReadableStream<string>({
    start(c) {
      c.enqueue("page");
      c.enqueue(" text");
      c.close();
    },
  });
  const values = [];
  for await (const value of streamValues.call(stream)) values.push(value);
  expect(values.join("")).toBe("page text");
  expect(stream.locked).toBe(false);
});
test("early exit cancels the stream unless preventCancel is requested", async () => {
  for (const preventCancel of [false, true]) {
    let cancelled = false;
    const stream = new ReadableStream({
      start(c) {
        c.enqueue(1);
      },
      cancel() {
        cancelled = true;
      },
    });
    for await (const _ of streamValues.call(stream, { preventCancel })) break;
    expect(cancelled).toBe(!preventCancel);
    expect(stream.locked).toBe(false);
  }
});

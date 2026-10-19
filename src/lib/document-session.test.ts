import { expect, test } from "bun:test";
import { DocumentSession } from "./document-session";
import type { PageAnalysis, StudyDocument } from "./types";

const result = (title: string): PageAnalysis => ({
  title, explanation: title, translation: "", translationRequested: false,
  keyPoints: [], model: "test", createdAt: "test",
});
const document = (): StudyDocument => ({
  id: "disk-v1", name: "test.pdf", size: 1, totalPages: 3,
  pages: [1, 2, 3], currentPage: 3, annotations: {}, analyses: {},
  chats: {}, createdAt: "test", updatedAt: "test",
  sessions: [{ id: "chat", title: "chat", updatedAt: "test", messages: [
    { id: "q", role: "user", text: "question", page: 3 },
    { id: "a", role: "assistant", text: "streaming", page: 3 },
  ] }],
});

test("late AI results follow page identities across delete, save, undo and redo", () => {
  const original = document();
  const run = new DocumentSession(original);
  const saved = { ...original, id: "disk-v2", totalPages: 2, pages: [1, 2], currentPage: 2 };
  run.ids = [2, 3];
  // Page 1 was removed from the source while its request was in flight.
  run.analyses.set(1, result("deleted page 1"));
  run.analyses.set(3, result("original page 3"));
  const compact = run.project(saved);
  expect(compact.analyses[1]).toBeUndefined();
  expect(compact.analyses[2].title).toBe("original page 3");
  expect(compact.sessions?.[0].messages[1].page).toBe(2);
  const restored = run.project({ ...compact, totalPages: 3, pages: [1, 2, 3], analyses: {} }, [1, 2, 3]);
  expect(restored.analyses[1].title).toBe("deleted page 1");
  expect(restored.analyses[3].title).toBe("original page 3");
  expect(restored.sessions?.[0].messages[1].page).toBe(3);
  expect(restored.sessions?.[0].messages[1].text).toBe("streaming");
  expect(restored.id).toBe("disk-v2");
});

test("deleted chat references do not silently point at the next page and recover on undo", () => {
  const doc = document();
  const run = new DocumentSession(doc);
  const missing = run.project(doc, [1, 2]);
  expect(missing.sessions?.[0].messages[0].page).toBeUndefined();
  const restored = run.project(missing, [1, 2, 3]);
  expect(restored.sessions?.[0].messages[0].page).toBe(3);
});

test("metadata captured at the save commit includes work completed during file IO", () => {
  const doc = document();
  const run = new DocumentSession(doc);
  const latest = { ...doc, analyses: { 3: result("finished during save") }, sessions: doc.sessions!.map(s => ({ ...s, messages: s.messages.map(m => m.id === "a" ? { ...m, text: "latest streamed answer" } : m) })) };
  run.capture(latest);
  const saved = run.project({ ...latest, analyses: {}, id: "new-hash" }, [2, 3]);
  expect(saved.analyses[2].title).toBe("finished during save");
  expect(saved.sessions?.[0].messages[1].text).toBe("latest streamed answer");
  expect(saved.sessions?.[0].messages[1].page).toBe(2);
});

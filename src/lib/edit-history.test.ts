import { describe, expect, test } from "bun:test";
import { pageMap, restoreEdit, type EditSnapshot } from "./edit-history";
import type { PageAnalysis, StudyDocument } from "./types";

const analysis = (title: string): PageAnalysis => ({
  title, explanation: title, translation: "", translationRequested: false,
  keyPoints: [], model: "test", createdAt: "test",
});
const original = (): StudyDocument => ({
  id: "original", name: "test.pdf", size: 1, totalPages: 3,
  pages: [1, 2, 3], currentPage: 3, annotations: {},
  analyses: { 1: analysis("deleted page"), 3: analysis("old") },
  chats: {}, createdAt: "test", updatedAt: "test",
});

describe("edits across saves", () => {
  test("restores deleted pages and annotations without rolling back the saved file identity or new AI work", () => {
    const old = original();
    old.annotations[3] = [{ id: "note", type: "text", text: "original page 3", color: "#000000", width: .03, points: [{ x: .1, y: .1 }] }];
    const saved: EditSnapshot = { document: old, bytes: new ArrayBuffer(1), pageIds: [1, 2, 3] };
    const current: StudyDocument = {
      ...old, id: "saved-hash", source: { kind: "path", path: "/test.pdf" },
      totalPages: 2, pages: [1, 2], currentPage: 2, annotations: {},
      analyses: { 2: analysis("new result on original page 3") },
      ocr: { 2: [{ x: 0, y: 0, w: 1, h: 1, text: "latest OCR" }] },
      sessions: [{ id: "new-chat", title: "new", updatedAt: "test", messages: [{ id: "q", role: "user", text: "new question", page: 2 }] }],
    };
    const restored = restoreEdit(current, [2, 3], saved);
    expect(restored.pages).toEqual([1, 2, 3]);
    expect(restored.totalPages).toBe(3);
    expect(restored.annotations[3][0].text).toBe("original page 3");
    expect(restored.id).toBe(current.id);
    expect(restored.source).toEqual(current.source);
    expect(restored.analyses[1].title).toBe("deleted page");
    expect(restored.analyses[3].title).toBe("new result on original page 3");
    expect(restored.ocr?.[3][0].text).toBe("latest OCR");
    expect(restored.sessions?.[0].messages[0].page).toBe(3);
    expect(restored.dirty).toBe(true);
  });

  test("maps page identities across repeated deletion, save, undo and redo", () => {
    expect([...pageMap([3], [1, 2, 3])]).toEqual([[1, 3]]);
    expect([...pageMap([1, 2, 3], [3])]).toEqual([[3, 1]]);
    const full = original();
    const reduced = { ...full, totalPages: 1, pages: [1], currentPage: 1, analyses: { 1: analysis("latest") } };
    const restored = restoreEdit(reduced, [3], { document: full, bytes: new ArrayBuffer(1), pageIds: [1, 2, 3] });
    const redone = restoreEdit(restored, [1, 2, 3], { document: reduced, bytes: new ArrayBuffer(1), pageIds: [3] });
    expect(redone.pages).toEqual([1]);
    expect(redone.analyses[1].title).toBe("latest");
  });
});

import { openDB } from "idb";
import type { StudyDocument, LibraryItem } from "./types";
const db = openDB("margin-study", 1, {
  upgrade(db) {
    db.createObjectStore("documents", { keyPath: "id" });
    db.createObjectStore("pdfs");
  },
});
export async function saveDocument(doc: StudyDocument) {
  await (await db).put("documents", doc);
}
export async function storePDF(id: string, bytes: ArrayBuffer) {
  await (await db).put("pdfs", bytes, id);
}
export async function loadDocument(
  id: string,
): Promise<StudyDocument | undefined> {
  return (await db).get("documents", id);
}
export async function loadPDF(id: string): Promise<ArrayBuffer | undefined> {
  return (await db).get("pdfs", id);
}
export async function listDocuments(): Promise<LibraryItem[]> {
  const docs: StudyDocument[] = await (await db).getAll("documents");
  return docs
    .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
    .map((d) => ({
      ...d,
      remainingPages: d.pages.length,
      analyzedPages: d.pages.filter((p) => d.analyses[p]).length,
    }));
}
export async function deleteDocument(id: string) {
  const tx = (await db).transaction(["documents", "pdfs"], "readwrite");
  await tx.objectStore("documents").delete(id);
  await tx.objectStore("pdfs").delete(id);
  await tx.done;
}
export async function fingerprint(bytes: ArrayBuffer) {
  return [...new Uint8Array(await crypto.subtle.digest("SHA-256", bytes))]
    .map((v) => v.toString(16).padStart(2, "0"))
    .join("");
}
export function createDocument(
  id: string,
  name: string,
  size: number,
  totalPages: number,
): StudyDocument {
  const now = new Date().toISOString();
  return {
    id,
    name,
    size,
    totalPages,
    pages: Array.from({ length: totalPages }, (_, i) => i + 1),
    currentPage: 1,
    annotations: {},
    analyses: {},
    chats: {},
    updatedAt: now,
    createdAt: now,
  };
}

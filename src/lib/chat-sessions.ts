import type { ChatSession, StudyDocument } from "./types";

export const NEW_CHAT_TITLE = "새 대화";

export const createSession = (): ChatSession => ({
  id: crypto.randomUUID(),
  title: NEW_CHAT_TITLE,
  messages: [],
  updatedAt: new Date().toISOString(),
});

/** Moves per-page chats from older records into sessions and keeps one tab open. */
export function withSessions(doc: StudyDocument): StudyDocument {
  let sessions = doc.sessions;
  let chats = doc.chats;
  if (!sessions) {
    sessions = Object.entries(doc.chats ?? {})
      .filter(([, messages]) => messages.length)
      .map(([page, messages]) => ({
        id: crypto.randomUUID(),
        title: `${page}쪽 대화`,
        messages: messages.map((m) => ({ ...m, page: Number(page) })),
        updatedAt: doc.updatedAt,
      }));
    chats = {};
  }
  const ids = new Set(sessions.map((s) => s.id));
  let open = (doc.openChats ?? []).filter((id) => ids.has(id));
  let active = doc.activeChat;
  if (!open.length) {
    const fresh = createSession();
    sessions = [...sessions, fresh];
    open = [fresh.id];
  }
  if (!active || !open.includes(active)) active = open[0];
  return { ...doc, chats, sessions, openChats: open, activeChat: active };
}

export function newChat(doc: StudyDocument): StudyDocument {
  const sessions = doc.sessions ?? [];
  const open = doc.openChats ?? [];
  // Reuse an open, unused session instead of stacking empty tabs.
  const empty = open.find(
    (id) => !sessions.find((s) => s.id === id)?.messages.length,
  );
  if (empty) return { ...doc, activeChat: empty };
  const fresh = createSession();
  return {
    ...doc,
    sessions: [...sessions, fresh],
    openChats: [...open, fresh.id],
    activeChat: fresh.id,
  };
}

export function openChat(doc: StudyDocument, id: string): StudyDocument {
  const open = doc.openChats ?? [];
  return {
    ...doc,
    openChats: open.includes(id) ? open : [...open, id],
    activeChat: id,
  };
}

/** Closes a tab; unused sessions are discarded instead of kept in history. */
export function closeChat(doc: StudyDocument, id: string): StudyDocument {
  const open = doc.openChats ?? [];
  const index = open.indexOf(id);
  if (index < 0) return doc;
  const rest = open.filter((x) => x !== id);
  const unused = !doc.sessions?.find((s) => s.id === id)?.messages.length;
  const next: StudyDocument = {
    ...doc,
    sessions: unused ? doc.sessions?.filter((s) => s.id !== id) : doc.sessions,
    openChats: rest,
    activeChat:
      doc.activeChat === id ? rest[Math.max(0, index - 1)] : doc.activeChat,
  };
  return withSessions(next);
}

export function moveChat(
  doc: StudyDocument,
  id: string,
  to: number,
): StudyDocument {
  const open = (doc.openChats ?? []).filter((x) => x !== id);
  open.splice(Math.max(0, Math.min(to, open.length)), 0, id);
  return { ...doc, openChats: open };
}

export const chatHistory = (doc: StudyDocument) =>
  (doc.sessions ?? [])
    .filter((s) => s.messages.length)
    .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));

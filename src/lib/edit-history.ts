import type { StudyDocument } from "./types";

/** Snapshots share their immutable PDF buffer until a save changes the source. */
export type EditSnapshot = {
  document: StudyDocument;
  bytes: ArrayBuffer;
  /** Stable identities of the source PDF's pages, including hidden pages. */
  pageIds: number[];
};

export function pageMap(from: number[], to: number[]) {
  const positions = new Map(to.map((id, index) => [id, index + 1]));
  return new Map(
    from.flatMap((id, index) => {
      const page = positions.get(id);
      return page === undefined ? [] : [[index + 1, page] as const];
    }),
  );
}

export function mapPages<T>(
  record: Record<number, T> | undefined,
  map: Map<number, number>,
) {
  return Object.fromEntries(
    Object.entries(record ?? {}).flatMap(([page, value]) =>
      map.has(Number(page)) ? [[map.get(Number(page))!, value]] : [],
    ),
  ) as Record<number, T>;
}

/** Restore edits, retaining the current file identity, chats and AI results. */
export function restoreEdit(
  current: StudyDocument,
  ids: number[],
  saved: EditSnapshot,
): StudyDocument {
  const previous = saved.document;
  const map = pageMap(ids, saved.pageIds);
  return {
    ...current,
    totalPages: previous.totalPages,
    pages: previous.pages,
    currentPage: previous.currentPage,
    annotations: previous.annotations,
    analyses: { ...previous.analyses, ...mapPages(current.analyses, map) },
    ocr: { ...previous.ocr, ...mapPages(current.ocr, map) },
    sessions: current.sessions?.map((session) => ({
      ...session,
      messages: session.messages.map((message) =>
        message.page
          ? { ...message, page: map.get(message.page) ?? message.page }
          : message,
      ),
    })),
    dirty: true,
    updatedAt: new Date().toISOString(),
  };
}

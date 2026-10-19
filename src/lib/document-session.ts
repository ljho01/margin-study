import type { OcrLine, PageAnalysis, StudyDocument } from "./types";

/** Page identities survive saved PDFs being compacted and undo restoring them. */
export class DocumentSession {
  readonly key = crypto.randomUUID();
  ids: number[];
  readonly analyses = new Map<number, PageAnalysis>();
  readonly ocr = new Map<number, OcrLine[]>();
  readonly messagePages = new Map<string, number>();

  constructor(doc?: StudyDocument) {
    this.ids = Array.from({ length: doc?.totalPages ?? 0 }, (_, i) => i + 1);
    if (doc) this.capture(doc);
  }

  page(id: number) {
    const index = this.ids.indexOf(id);
    return index < 0 ? undefined : index + 1;
  }

  visiblePage(id: number, doc: StudyDocument) {
    const page = this.page(id);
    return page !== undefined && doc.pages.includes(page) ? page : undefined;
  }

  /** Remember metadata even for pages omitted from the next saved file. */
  capture(doc: StudyDocument) {
    for (const [page, value] of Object.entries(doc.analyses)) {
      const id = this.ids[Number(page) - 1];
      if (id !== undefined) this.analyses.set(id, value);
    }
    for (const [page, value] of Object.entries(doc.ocr ?? {})) {
      const id = this.ids[Number(page) - 1];
      if (id !== undefined) this.ocr.set(id, value);
    }
    for (const session of doc.sessions ?? []) {
      for (const message of session.messages) {
        if (!message.page || this.messagePages.has(message.id)) continue;
        const id = this.ids[message.page - 1];
        if (id !== undefined) this.messagePages.set(message.id, id);
      }
    }
  }

  /** Project the latest metadata onto a new or restored editing source. */
  project(doc: StudyDocument, ids = this.ids): StudyDocument {
    const positions = new Map(ids.map((id, index) => [id, index + 1]));
    const project = <T>(values: Map<number, T>) => Object.fromEntries(
      [...values].flatMap(([id, value]) => {
        const page = positions.get(id);
        return page === undefined ? [] : [[page, value]];
      }),
    );
    return {
      ...doc,
      analyses: { ...doc.analyses, ...project(this.analyses) },
      ocr: { ...doc.ocr, ...project(this.ocr) },
      sessions: doc.sessions?.map((session) => ({
        ...session,
        messages: session.messages.map((message) => {
          const id = this.messagePages.get(message.id);
          return id === undefined ? message : { ...message, page: positions.get(id) };
        }),
      })),
    };
  }
}

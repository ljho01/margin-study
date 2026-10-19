import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
} from "react";
import { pdfjs } from "react-pdf";
import type { PDFDocumentProxy, PDFDocumentLoadingTask } from "pdfjs-dist";
import { toast } from "sonner";
import * as storage from "@/lib/storage";
import * as ai from "@/lib/ai";
import * as folders from "@/lib/workspace";
import type { Workspace, WorkspaceEntry } from "@/lib/workspace";
import { pageTools } from "@/lib/page-tools";
import { pageContext, pageImage, readPdf, writePdf } from "@/lib/pdf";
import * as files from "@/lib/files";
import { selectionRects } from "@/components/OcrLayer";
import { DEFAULT_COLORS, type InkTool } from "@/lib/viewer";
import * as chats from "@/lib/chat-sessions";
import { NEW_CHAT_TITLE } from "@/lib/chat-sessions";
import { carryThumbnails } from "@/lib/thumbnails";
import { repairLatex } from "@/lib/latex";
import { quoteToken, quotesAsText, quotesForAI } from "@/lib/quotes";
import { createChatDraftStore } from "@/lib/chat-draft";
import {
  mapPages,
  pageMap,
  restoreEdit,
  type EditSnapshot,
} from "@/lib/edit-history";
import type {
  Account,
  Annotation,
  ChatMessage,
  ChatSession,
  DocumentSource,
  LibraryItem,
  Model,
  PageAnalysis,
  StudyDocument,
  Tool,
} from "@/lib/types";
pdfjs.GlobalWorkerOptions.workerSrc = new URL(
  "pdfjs-dist/build/pdf.worker.min.mjs",
  import.meta.url,
).toString();
const PDF_OPTIONS = {
  cMapUrl: "/cmaps/",
  standardFontDataUrl: "/standard_fonts/",
  wasmUrl: "/wasm/",
};
const toBuffer = (bytes: Uint8Array) =>
  bytes.buffer.slice(
    bytes.byteOffset,
    bytes.byteOffset + bytes.byteLength,
  ) as ArrayBuffer;
const remap = <T>(
  record: Record<number, T> | undefined,
  map: Map<number, number>,
) =>
  Object.fromEntries(
    Object.entries(record ?? {}).flatMap(([page, value]) =>
      map.has(Number(page)) ? [[map.get(Number(page))!, value]] : [],
    ),
  ) as Record<number, T>;
const err = (error: unknown) =>
  error instanceof Error ? error.message : String(error);

export function useStudy() {
  const [doc, setDoc] = useState<StudyDocument | null>(null);
  const docRef = useRef(doc);
  docRef.current = doc;
  const [bytes, setBytes] = useState<ArrayBuffer | null>(null);
  const [pdf, setPdf] = useState<PDFDocumentProxy | null>(null);
  const [library, setLibrary] = useState<LibraryItem[]>([]);
  const [libraryOpen, setLibraryOpen] = useState(false);
  const [workspace, setWorkspace] = useState<Workspace | null>(null);
  const [workspaces, setWorkspaces] = useState<Workspace[]>([]);
  const [pendingFolder, setPendingFolder] = useState<string | null>(null);
  const [activePath, setActivePath] = useState<string | null>(null);
  const [sidebarTab, setSidebarTab] = useState("files");
  const workspaceReading = useRef(false);
  const restoredWorkspace = useRef(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [account, setAccount] = useState<Account>(null);
  const [claudeAccount, setClaudeAccount] = useState<Account>(null);
  const [modelList, setModelList] = useState<Model[]>([]);
  const [model, setModel] = useState(
    () => localStorage.getItem("margin-model") ?? "",
  );
  const accountForModel = model.startsWith("claude-") ? claudeAccount : account;
  const authAttempt = useRef<{ provider: ai.Provider; id: string } | null>(
    null,
  );
  const [authBusy, setAuthBusy] = useState(false);
  const [authError, setAuthError] = useState("");
  const [loginId, setLoginId] = useState<string | null>(null);
  const [importing, setImporting] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [tool, setTool] = useState<Tool>("select");
  const [colors, setColors] = useState<Record<InkTool, string>>(() => {
    try {
      return {
        ...DEFAULT_COLORS,
        ...JSON.parse(localStorage.getItem("margin-colors") ?? "{}"),
      };
    } catch {
      return DEFAULT_COLORS;
    }
  });
  const setToolColor = (target: InkTool, value: string) =>
    setColors((current) => {
      const next = { ...current, [target]: value };
      localStorage.setItem("margin-colors", JSON.stringify(next));
      return next;
    });
  const [zoom, setZoom] = useState(1);
  const [region, setRegion] = useState({ width: 872, height: 0 });
  const [aspect, setAspect] = useState(0.707);
  const [leftOpen, setLeftOpen] = useState(true);
  const [rightOpen, setRightOpen] = useState(true);
  const [selection, setSelection] = useState(false);
  const [selected, setSelected] = useState<number[]>([]);
  const [bottomOpen, setBottomOpen] = useState(true);
  const [saving, setSaving] = useState(false);
  const [history, setHistory] = useState<EditSnapshot[]>([]);
  const [future, setFuture] = useState<EditSnapshot[]>([]);
  const [restoring, setRestoring] = useState(false);
  const editLock = useRef(false);
  const pageIds = useRef<number[]>([]);
  const [tab, setTab] = useState("explanation");
  const [translate, setTranslate] = useState(
    () => localStorage.getItem("margin-translate") !== "false",
  );
  const [processing, setProcessing] = useState<{
    done: number;
    total: number;
    page: number;
  } | null>(null);
  const [processingErrors, setProcessingErrors] = useState<{
    docId: string;
    pages: Record<number, string>;
  } | null>(null);
  const processingError =
    doc && processingErrors?.docId === doc.id
      ? (processingErrors.pages[doc.currentPage] ?? "")
      : "";
  /** Chats answering right now: session id → id of the answer being written. */
  const [running, setRunning] = useState<Record<string, string>>({});
  /** Questions sent while their chat is answering, in send order. */
  const [queue, setQueue] = useState<
    { id: string; text: string; docId: string; sessionId: string }[]
  >([]);
  /** Chats whose waiting questions are held after a stop. */
  const [paused, setPaused] = useState<string[]>([]);
  const [chatDraft] = useState(createChatDraftStore);
  const { setQuestion } = chatDraft.getState();
  const [search, setSearch] = useState("");
  const [searchResults, setSearchResults] = useState<number[] | null>(null);
  const [searchBusy, setSearchBusy] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const canvasRegion = useRef<HTMLDivElement>(null);
  const chatEnd = useRef<HTMLDivElement>(null);
  const saveChain = useRef(Promise.resolve());
  const processStop = useRef(false);
  const processRequest = useRef<string | null>(null);
  /** Chats that started answering, updated at once (state lags a render). */
  const answering = useRef(new Set<string>());
  /** Backend request of each running answer; each run gets a new one. */
  const chatCalls = useRef(new Map<string, string>());
  /** Chats whose answer was stopped by the student. */
  const chatStopped = useRef(new Set<string>());
  const opening = useRef(false);
  const loadingTask = useRef<PDFDocumentLoadingTask | null>(null);
  const retiredTasks = useRef(new Set<PDFDocumentLoadingTask>());
  const pageDisplayed = useCallback((visible: PDFDocumentProxy) => {
    for (const task of retiredTasks.current) {
      if (task === visible.loadingTask || task === loadingTask.current) continue;
      retiredTasks.current.delete(task);
      void task.destroy().catch(() => {});
    }
  }, []);
  // Saving re-reads the file under a new id; views of the document (the page
  // list) keep the key they were opened with so they are not rebuilt.
  const viewKeys = useRef(new Map<string, string>());
  /**
   * A saved file continues the document it was saved from (new id -> old id)
   * when its pages kept their numbers, so answers and page processing that
   * were running keep writing into it.
   */
  const continued = useRef(new Map<string, string>());
  const sameDoc = (d: StudyDocument, id: string) => {
    for (let at: string | undefined = d.id; at; at = continued.current.get(at))
      if (at === id) return true;
    return false;
  };
  const pageSurface = useRef<HTMLDivElement>(null);
  const ocrRunning = useRef(new Set<string>());
  const notify = useCallback((text: string, error = false) => {
    if (error) toast.error(text);
  }, []);
  const refreshLibrary = useCallback(
    () =>
      storage
        .listDocuments()
        .then(setLibrary)
        .catch((e) => notify(`문서 목록을 읽지 못했습니다: ${err(e)}`, true)),
    [notify],
  );
  const accountRefresh = useRef(0);
  const refreshAccount = useCallback(async () => {
    if (!ai.desktop) return;
    const revision = ++accountRefresh.current;
    const providers = ["chatgpt", "claude"] as const;
    const results = await Promise.allSettled(
      providers.map(async (provider) => {
        const account = await ai.accountStatus(provider);
        if (revision === accountRefresh.current)
          (provider === "claude" ? setClaudeAccount : setAccount)(account);
        return account ? ai.models(provider) : [];
      }),
    );
    if (revision !== accountRefresh.current) return;
    const list = results.flatMap((result) =>
      result.status === "fulfilled" ? result.value : [],
    );
    setModelList(list);
    setModel((current) =>
      list.some((m) => m.model === current)
        ? current
        : ((list.find((m) => m.isDefault) ?? list[0])?.model ?? ""),
    );
    const errors = results.flatMap((result, i) =>
      result.status === "rejected"
        ? [
            `${providers[i] === "claude" ? "Claude" : "ChatGPT"}: ${err(result.reason)}`,
          ]
        : [],
    );
    if (errors.length) setAuthError(errors.join("\n"));
  }, []);
  useEffect(() => {
    void refreshLibrary();
    void refreshAccount();
    let dispose: (() => void) | undefined;
    let closed = false;
    void ai
      .onAccountChange((error, provider) => {
        // A background ChatGPT refresh must not end a pending Claude login.
        if (!authAttempt.current || authAttempt.current.provider === provider) {
          authAttempt.current = null;
          setAuthBusy(false);
          setLoginId(null);
          setAuthError(error ?? "");
        }
        void refreshAccount();
      })
      .then((unlisten) => {
        if (closed) unlisten();
        else dispose = unlisten;
      });
    return () => {
      closed = true;
      dispose?.();
    };
  }, [refreshAccount, refreshLibrary]);
  useEffect(() => {
    if (!doc) return;
    const snapshot = doc;
    saveChain.current = saveChain.current
      .catch(() => {})
      .then(async () => {
        await storage.saveDocument(snapshot);
      })
      .catch((e) => notify(`저장 실패: ${err(e)}`, true));
  }, [doc, notify]);
  useEffect(() => {
    localStorage.setItem("margin-model", model);
  }, [model]);
  useEffect(() => {
    localStorage.setItem("margin-translate", String(translate));
  }, [translate]);
  // The reader region remounts when panels change, so re-attach the observer
  // whenever the element differs and track both dimensions.
  const regionObserver = useRef<{
    element: HTMLElement | null;
    observer?: ResizeObserver;
  }>({ element: null });
  useLayoutEffect(() => {
    const element = canvasRegion.current;
    const current = regionObserver.current;
    if (element === current.element) return;
    current.observer?.disconnect();
    regionObserver.current = { element };
    if (!element) return;
    const observer = new ResizeObserver(([entry]) =>
      setRegion({
        width: entry.contentRect.width,
        height: entry.contentRect.height,
      }),
    );
    observer.observe(element);
    regionObserver.current.observer = observer;
  });
  useEffect(() => () => regionObserver.current.observer?.disconnect(), []);
  useEffect(() => {
    if (!pdf || !doc) return;
    let live = true;
    void pdf.getPage(doc.currentPage).then((p) => {
      const v = p.getViewport({ scale: 1 });
      if (live) setAspect(v.width / v.height);
    });
    return () => {
      live = false;
    };
  }, [pdf, doc?.currentPage]);
  const chatSession = doc?.sessions?.find((x) => x.id === doc.activeChat);
  const messages = chatSession?.messages ?? [];
  const shownChat = useRef("");
  useEffect(() => {
    // Scroll only the chat viewport; jump when another document or chat opens.
    const end = chatEnd.current;
    const viewport = end?.closest<HTMLElement>(
      "[data-slot=scroll-area-viewport]",
    );
    if (!viewport) return;
    const key = `${doc?.id}:${doc?.activeChat}`;
    const switched = shownChat.current !== key;
    shownChat.current = key;
    viewport.scrollTo({
      top: viewport.scrollHeight,
      behavior: switched ? "instant" : "smooth",
    });
  }, [chatSession?.messages.length, running, doc?.id, doc?.activeChat]);
  const update = useCallback(
    (fn: (d: StudyDocument) => StudyDocument) =>
      setDoc((current) =>
        current
          ? { ...fn(current), updatedAt: new Date().toISOString() }
          : current,
      ),
    [],
  );
  const goTo = useCallback(
    (page: number) => {
      update((d) => (d.pages.includes(page) ? { ...d, currentPage: page } : d));
    },
    [update],
  );
  const pageIndex = doc ? doc.pages.indexOf(doc.currentPage) : -1;
  const analysis = doc?.analyses[doc.currentPage];
  const annotations = doc?.annotations[doc.currentPage] ?? [];

  const doneCount = doc
    ? doc.pages.filter(
        (p) =>
          doc.analyses[p] &&
          (!translate || doc.analyses[p].translationRequested),
      ).length
    : 0;
  // 100% fits the whole page inside the reader, inset by its 16px padding.
  const fitWidth = Math.max(
    240,
    Math.min(
      region.width - 32,
      region.height > 0 ? (region.height - 32) * aspect : Infinity,
    ),
  );
  const pageWidth = Math.floor(fitWidth * zoom);
  const pageHeight = Math.floor(pageWidth / aspect);
  // Opening or saving another file waits for every running request; page
  // processing and chats run alongside each other, and each chat answers one
  // question at a time.
  const busy = !!processing || Object.keys(running).length > 0;
  const chatBusy = !!doc?.activeChat && !!running[doc.activeChat];
  const queuePaused = !!doc?.activeChat && paused.includes(doc.activeChat);
  const loadDisplay = async (display: ArrayBuffer) => {
    const task = pdfjs.getDocument({
      ...PDF_OPTIONS,
      data: new Uint8Array(display.slice(0)),
    });
    try {
      return { task, parsed: await task.promise };
    } catch (error) {
      await task.destroy();
      if (err(error).toLowerCase().includes("password"))
        throw new Error(
          "암호가 걸린 PDF입니다. 암호를 해제한 파일을 열어 주세요.",
        );
      throw new Error(
        "PDF를 읽지 못했습니다. 파일이 손상되지 않았는지 확인해 주세요.",
      );
    }
  };
  const showDocument = (
    next: StudyDocument,
    display: ArrayBuffer,
    task: PDFDocumentLoadingTask,
    parsed: PDFDocumentProxy,
    pageAspect: number,
    /** A save of the same document: waiting questions stay. */
    keepChats = false,
  ) => {
    // StablePage still uses this document until the replacement has rendered.
    // Its committed-frame callback releases it; a timer could retire it early
    // on a large/slow PDF and discard the frame we are keeping on screen.
    const previous = loadingTask.current;
    loadingTask.current = task;
    if (previous && previous !== task) retiredTasks.current.add(previous);
    setPdf(parsed);
    setBytes(display);
    // Known before the switch so the page box is sized once for the new file.
    setAspect(pageAspect);
    setDoc(chats.withSessions(next));
    if (!keepChats) {
      pageIds.current = Array.from({ length: next.totalPages }, (_, i) => i + 1);
      setHistory([]);
      setFuture([]);
      setQueue([]);
      setPaused([]);
    }
  };
  const aspectOf = async (parsed: PDFDocumentProxy, page: number) => {
    try {
      const viewport = (await parsed.getPage(page)).getViewport({ scale: 1 });
      return viewport.width / viewport.height;
    } catch {
      return aspect;
    }
  };
  const newChat = () => update(chats.newChat);
  const openChat = (id: string) => update((d) => chats.openChat(d, id));
  const closeChat = (id: string) => {
    setQueue((items) => items.filter((q) => q.sessionId !== id));
    update((d) => chats.closeChat(d, id));
  };
  const moveChat = (id: string, to: number) =>
    update((d) => chats.moveChat(d, id, to));
  const chatHistory = doc ? chats.chatHistory(doc) : [];
  // Session whose answer is currently streaming.
  const streamingChats = Object.keys(running);
  const openBytes = async (
    buffer: ArrayBuffer,
    name: string,
    source?: DocumentSource,
    storedId?: string,
  ) => {
    if (opening.current || busy || editLock.current) return false;
    setQuestion("");
    opening.current = true;
    setImporting(true);
    try {
      if (buffer.byteLength > 180 * 1024 * 1024)
        throw new Error("180 MB 이하의 PDF를 열어 주세요.");
      const id = storedId ?? (await storage.fingerprint(buffer));
      await saveChain.current;
      const stored = await storage.loadDocument(id);
      // Undo can restore pages that no longer exist in the saved file. Its
      // dirty draft keeps the complete editing source until the next save.
      const editingBytes = stored?.dirty
        ? (await storage.loadPDF(id)) ?? buffer
        : buffer;
      const file = await readPdf(editingBytes);
      const { task, parsed } = await loadDisplay(file.display);
      await storage.storePDF(id, editingBytes);
      // Records from before file saving existed keep their edits as unsaved changes.
      const legacyEdits =
        stored?.dirty === undefined &&
        !!stored &&
        (stored.pages.length !== stored.totalPages ||
          Object.values(stored.annotations).some((items) => items.length));
      const dirty = !!stored?.dirty || legacyEdits;
      const next: StudyDocument = stored
        ? {
            ...stored,
            name,
            source: source ?? stored.source,
            annotations: dirty ? stored.annotations : file.annotations,
            dirty,
          }
        : {
            ...storage.createDocument(
              id,
              name,
              buffer.byteLength,
              parsed.numPages,
            ),
            annotations: file.annotations,
            dirty: false,
            source,
          };
      showDocument(
        next,
        file.display,
        task,
        parsed,
        await aspectOf(parsed, next.currentPage),
      );
      setZoom(1);
      setSelected([]);
      setSelection(false);
      setSearch("");
      setSearchResults(null);
      setProcessingErrors(null);
      setLibraryOpen(false);
      void refreshLibrary();
      return true;
    } catch (error) {
      notify(err(error), true);
      return false;
    } finally {
      opening.current = false;
      setImporting(false);
    }
  };
  const importFile = async () => {
    if (ai.desktop) {
      try {
        const { open } = await import("@tauri-apps/plugin-dialog");
        const path = await open({
          multiple: false,
          filters: [{ name: "PDF 문서", extensions: ["pdf"] }],
        });
        if (typeof path === "string") {
          const { readFile } = await import("@tauri-apps/plugin-fs");
          const data = await readFile(path);
          await openBytes(
            new Uint8Array(data).buffer,
            path.split(/[\\/]/).pop() ?? "문서.pdf",
            {
              kind: "path",
              path,
            },
          );
        }
      } catch (e) {
        notify(err(e), true);
      }
    } else inputRef.current?.click();
  };
  const openStored = async (id: string) => {
    try {
      await saveChain.current;
      const [data, state] = await Promise.all([
        storage.loadPDF(id),
        storage.loadDocument(id),
      ]);
      if (!data || !state)
        throw new Error("저장된 PDF를 찾지 못했습니다. 다시 가져와 주세요.");
      await openBytes(data, state.name, state.source, id);
    } catch (e) {
      notify(err(e), true);
    }
  };
  const snapshot = (document: StudyDocument): EditSnapshot => ({
    document,
    bytes: bytes!,
    pageIds: pageIds.current,
  });
  const rememberEdit = () => {
    if (!doc || !bytes || editLock.current) return false;
    const before = snapshot(doc);
    setHistory((prev) => [...prev.slice(-99), before]);
    setFuture([]);
    return true;
  };
  const changeAnnotations = (items: Annotation[]) => {
    if (!rememberEdit()) return;
    update((d) => ({
      ...d,
      dirty: true,
      annotations: { ...d.annotations, [d.currentPage]: items },
    }));
  };
  const travelHistory = async (redo = false) => {
    const last = (redo ? future : history).at(-1);
    const current = docRef.current;
    if (!last || !current || !bytes || editLock.current || busy || opening.current)
      return;
    editLock.current = true;
    setRestoring(true);
    let replacement: Awaited<ReturnType<typeof loadDisplay>> | undefined;
    try {
      if (last.bytes !== bytes) replacement = await loadDisplay(last.bytes);
      await saveChain.current;
      // The id still fingerprints the file on disk for conflict detection;
      // only the local editing source changes when crossing a save boundary.
      if (replacement) await storage.storePDF(current.id, last.bytes);
      const latest = docRef.current!;
      const before = snapshot(latest);
      const next = restoreEdit(latest, pageIds.current, last);
      const map = pageMap(pageIds.current, last.pageIds);
      if (replacement) {
        if (pdf)
          carryThumbnails(pdf, replacement.parsed,
            new Map([...map].map(([from, to]) => [to, from])));
        const pageAspect = await aspectOf(replacement.parsed, next.currentPage);
        showDocument(
          next, last.bytes, replacement.task, replacement.parsed, pageAspect, true,
        );
      } else setDoc(next);
      pageIds.current = last.pageIds;
      setProcessingErrors((errors) =>
        errors?.docId === current.id
          ? { ...errors, pages: mapPages(errors.pages, map) }
          : errors,
      );
      (redo ? setFuture : setHistory)((items) => items.slice(0, -1));
      (redo ? setHistory : setFuture)((items) => [...items.slice(-99), before]);
      setSelected([]);
      setSelection(false);
      setSearchResults(null);
    } catch (error) {
      if (replacement) await replacement.task.destroy().catch(() => {});
      notify(`되돌리기 실패: ${err(error)}`, true);
    } finally {
      editLock.current = false;
      setRestoring(false);
    }
  };
  const undo = () => void travelHistory();
  const redo = () => void travelHistory(true);
  const navigate = useCallback(
    (delta: number) => {
      const d = docRef.current;
      if (!d) return;
      const index = d.pages.indexOf(d.currentPage);
      if (d.pages[index + delta]) goTo(d.pages[index + delta]);
    },
    [goTo],
  );
  /** Highlights the text selected on the page, in the highlighter's color. */
  const highlightSelection = (color = colors.highlight) => {
    const surface = pageSurface.current;
    if (!surface || !doc) return false;
    const picked = selectionRects(surface);
    if (!picked) return false;
    changeAnnotations([
      ...annotations,
      {
        id: crypto.randomUUID(),
        type: "highlight",
        color,
        points: [{ x: picked.rects[0].x, y: picked.rects[0].y }],
        rects: picked.rects,
        text: picked.text,
        width: 0,
      },
    ]);
    window.getSelection()?.removeAllRanges();
    return true;
  };
  /** Adds the text selected on the page to the chat input as a chip. */
  const attachSelection = () => {
    const surface = pageSurface.current;
    if (!surface || !doc) return false;
    const picked = selectionRects(surface);
    const text = (picked?.text || window.getSelection()?.toString() || "")
      .replace(/\s+/g, " ")
      .trim();
    if (!text) return false;
    const token = quoteToken({ page: doc.currentPage, text });
    setQuestion((current) =>
      !current || /\s$/.test(current)
        ? current + token + " "
        : current + " " + token + " ",
    );
    window.getSelection()?.removeAllRanges();
    return true;
  };
  const ensureOcr = async (page: number) => {
    const current = docRef.current;
    const key = current?.id + ":" + page;
    if (
      !ai.desktop ||
      !current ||
      !pdf ||
      current.ocr?.[page] ||
      ocrRunning.current.has(key)
    )
      return;
    ocrRunning.current.add(key);
    try {
      const lines = await files.recognizeText(await pageImage(pdf, page));
      setDoc((d) =>
        d && d.id === current.id
          ? { ...d, ocr: { ...d.ocr, [page]: lines } }
          : d,
      );
    } catch (error) {
      notify(err(error), true);
    } finally {
      ocrRunning.current.delete(key);
    }
  };
  const requireAI = () => {
    if (editLock.current) return false;
    if (!accountForModel || !model) {
      setSettingsOpen(true);
      return false;
    }
    return true;
  };
  const runAnalysis = async (
    all: boolean,
    force = false,
    withTranslation = translate,
  ) => {
    if (!doc || !pdf || processing || !requireAI()) return;
    const snapshot = doc,
      proxy = pdf;
    const pages = all
      ? snapshot.pages.filter(
          (p) =>
            !snapshot.analyses[p] ||
            (withTranslation && !snapshot.analyses[p].translationRequested),
        )
      : [snapshot.currentPage];
    if (!pages.length) {
      return;
    }
    if (!force && !all && snapshot.analyses[snapshot.currentPage]) {
      setTab("explanation");
      return;
    }
    processStop.current = false;
    setProcessing({ done: 0, total: pages.length, page: pages[0] });
    let processingPage = pages[0];
    try {
      for (let index = 0; index < pages.length; index++) {
        if (processStop.current) break;
        const page = pages[index];
        processingPage = page;
        // Retrying one page must not erase errors belonging to other pages.
        setProcessingErrors((current) => {
          if (current?.docId !== snapshot.id || !current.pages[page])
            return current;
          const next = { ...current.pages };
          delete next[page];
          return { docId: snapshot.id, pages: next };
        });
        setProcessing({ done: index, total: pages.length, page });
        const context = await pageContext(
          proxy,
          page,
          snapshot.ocr?.[page]?.map((line) => line.text).join("\n"),
        );
        if (processStop.current) break;
        const id = crypto.randomUUID();
        processRequest.current = id;
        const raw = await ai.askAI({
          id,
          ...context,
          prompt: ai.analysisPrompt(
            snapshot.name,
            page,
            context.text,
            withTranslation,
          ),
          model,
          schema: ai.analysisSchema,
        });
        const result = JSON.parse(
          raw.replace(/^```(?:json)?\s*/, "").replace(/\s*```$/, ""),
        );
        if (
          typeof result.explanation !== "string" ||
          typeof result.title !== "string" ||
          typeof result.translation !== "string" ||
          !Array.isArray(result.keyPoints) ||
          !result.keyPoints.every((p: unknown) => typeof p === "string")
        )
          throw new Error(
            "해설 응답 형식이 올바르지 않습니다. 다시 처리해 주세요.",
          );
        const value: PageAnalysis = {
          ...result,
          title: repairLatex(result.title),
          explanation: repairLatex(result.explanation),
          translation: repairLatex(result.translation),
          keyPoints: result.keyPoints.map(repairLatex),
          translationRequested: withTranslation,
          model,
          createdAt: new Date().toISOString(),
        };
        update((d) =>
          sameDoc(d, snapshot.id)
            ? { ...d, analyses: { ...d.analyses, [page]: value } }
            : d,
        );
        setProcessing({ done: index + 1, total: pages.length, page });
      }
    } catch (error) {
      if (!processStop.current) {
        const message = err(error);
        setProcessingErrors((current) => ({
          docId: snapshot.id,
          pages: {
            ...(current?.docId === snapshot.id ? current.pages : {}),
            [processingPage]: message,
          },
        }));
        notify(
          `${snapshot.pages.indexOf(processingPage) + 1}쪽 처리 실패: ${message}`,
          true,
        );
      }
    } finally {
      setProcessing(null);
      processRequest.current = null;
      void refreshLibrary();
    }
  };
  const stopProcessing = async () => {
    processStop.current = true;
    if (processRequest.current)
      try {
        await ai.cancelAI(processRequest.current);
      } catch (e) {
        notify(err(e), true);
      }
  };
  /**
   * Streams an answer into a session. With `resume`, the stopped answer is
   * continued in place instead of starting a new question.
   */
  const runChat = async (
    sessionId: string,
    text: string,
    resume?: ChatMessage,
  ) => {
    if (!doc || !pdf || answering.current.has(sessionId) || !requireAI())
      return;
    const snapshot = doc;
    const session = doc.sessions?.find((x) => x.id === sessionId);
    if (!session) return;
    const page =
      resume?.page && snapshot.pages.includes(resume.page)
        ? resume.page
        : doc.currentPage;
    const id = resume?.id ?? crypto.randomUUID();
    const base = resume?.text ?? "";
    // Without any written text there is nothing to continue: ask the
    // original question again with the history before it.
    const at = resume ? session.messages.findIndex((m) => m.id === id) : -1;
    const asked =
      resume && !base.trim() && session.messages[at - 1]?.role === "user"
        ? session.messages[at - 1]
        : undefined;
    const history = asked
      ? session.messages.slice(0, at - 1)
      : session.messages;
    const editSession = (
      d: StudyDocument,
      fn: (x: ChatSession) => ChatSession,
    ): StudyDocument =>
      sameDoc(d, snapshot.id)
        ? {
            ...d,
            sessions: d.sessions?.map((x) => (x.id === sessionId ? fn(x) : x)),
          }
        : d;
    answering.current.add(sessionId);
    setRunning((r) => ({ ...r, [sessionId]: id }));
    const call = crypto.randomUUID();
    chatCalls.current.set(sessionId, call);
    chatStopped.current.delete(sessionId);
    const patch = (value: string, extra: Partial<ChatMessage> = {}) =>
      update((d) =>
        editSession(d, (x) => ({
          ...x,
          messages: x.messages.map((m) =>
            m.id === id
              ? { ...m, text: value, error: false, stopped: false, ...extra }
              : m,
          ),
          updatedAt: new Date().toISOString(),
        })),
      );
    if (resume) patch(base);
    else
      update((d) =>
        editSession(d, (x) => ({
          ...x,
          title:
            x.title === NEW_CHAT_TITLE && !x.messages.length
              ? quotesAsText(text).slice(0, 40)
              : x.title,
          messages: [
            ...x.messages,
            { id: crypto.randomUUID(), role: "user", text, page },
            { id, role: "assistant", text: "", page },
          ],
          updatedAt: new Date().toISOString(),
        })),
      );
    let latest = base;
    try {
      const current = snapshot.pages.indexOf(page) + 1;
      // Attached passages go to the model as quotations with the page
      // number the student sees.
      const quoted = (value: string) =>
        quotesForAI(value, (p) => snapshot.pages.indexOf(p) + 1 || undefined);
      const answer = await ai.askAI({
        id: call,
        model,
        prompt: ai.chatPrompt(
          snapshot.name,
          current,
          snapshot.pages.length,
          history.map((m) => ({
            ...m,
            text: quoted(m.text),
            page: m.page
              ? snapshot.pages.indexOf(m.page) + 1 || undefined
              : undefined,
          })),
          quoted(asked ? asked.text : resume ? ai.RESUME_PROMPT : text),
        ),
        onDelta: (value) => {
          latest = base + value;
          patch(latest);
        },
        onTool: pageTools(snapshot, pdf, current),
      });
      patch(base + answer);
    } catch (e) {
      const stopped = chatStopped.current.has(sessionId);
      if (stopped || resume) {
        // Keep what was written so far; it can be continued later.
        if (!stopped) notify(err(e), true);
        patch(latest, { stopped: true });
      } else patch(err(e), { error: true });
    } finally {
      answering.current.delete(sessionId);
      chatCalls.current.delete(sessionId);
      setRunning((r) => {
        const next = { ...r };
        delete next[sessionId];
        return next;
      });
    }
  };
  /** Sends now, or queues the question while another answer is running. */
  const sendChat = (suggestion?: string) => {
    const text = (suggestion ?? chatDraft.getState().question).trim();
    if (!doc || !pdf || !text || !doc.activeChat) return;
    // Keep the typed question when the account still needs to be connected.
    if (!requireAI()) return;
    setQuestion("");
    // Waits only for this chat's own answer; other chats and page
    // processing run alongside.
    if (answering.current.has(doc.activeChat)) {
      setQueue((items) => [
        ...items,
        {
          id: crypto.randomUUID(),
          text,
          docId: doc.id,
          sessionId: doc.activeChat!,
        },
      ]);
      return;
    }
    void runChat(doc.activeChat, text);
  };
  /** Stops a chat's answer; its queued questions wait until resumed. */
  const stopChat = (sessionId = doc?.activeChat, pauseQueue = true) => {
    const call = sessionId && chatCalls.current.get(sessionId);
    if (!sessionId || !call) return;
    chatStopped.current.add(sessionId);
    if (pauseQueue)
      setPaused((ids) => (ids.includes(sessionId) ? ids : [...ids, sessionId]));
    void ai.cancelAI(call).catch((e) => notify(err(e), true));
  };
  /** Lets the active chat's held questions go on. */
  const resumeQueue = () => {
    const id = doc?.activeChat;
    if (id) setPaused((ids) => ids.filter((x) => x !== id));
  };
  const resumeChat = (message: ChatMessage) => {
    if (!doc?.activeChat) return;
    // Resuming undoes the stop: the held questions follow this answer.
    resumeQueue();
    void runChat(doc.activeChat, "", message);
  };
  const removeQueued = (id: string) =>
    setQueue((items) => items.filter((q) => q.id !== id));
  /** Moves a queued question to the front and sends it right away. */
  const sendQueuedNow = (id: string) => {
    const item = queue.find((q) => q.id === id);
    if (!item) return;
    setQueue((items) => [item, ...items.filter((q) => q.id !== id)]);
    setPaused((ids) => ids.filter((x) => x !== item.sessionId));
    stopChat(item.sessionId, false);
  };
  const editQueued = (id: string) => {
    const item = queue.find((q) => q.id === id);
    if (!item) return;
    removeQueued(id);
    setQuestion((current) =>
      current.trim() ? `${item.text}\n${current}` : item.text,
    );
  };
  // A pause only holds questions that were already waiting.
  useEffect(() => {
    const waiting = paused.filter((id) =>
      queue.some((q) => q.sessionId === id),
    );
    if (waiting.length !== paused.length) setPaused(waiting);
  }, [queue, paused]);
  // Each chat sends its next question once its own answer is done.
  useEffect(() => {
    if (!doc || !pdf || !accountForModel || !model) return;
    const seen = new Set<string>();
    const next: typeof queue = [];
    for (const q of queue) {
      if (q.docId !== doc.id || seen.has(q.sessionId)) continue;
      seen.add(q.sessionId);
      if (!answering.current.has(q.sessionId) && !paused.includes(q.sessionId))
        next.push(q);
    }
    if (!next.length) return;
    const ids = new Set(next.map((q) => q.id));
    setQueue((items) => items.filter((q) => !ids.has(q.id)));
    for (const q of next) void runChat(q.sessionId, q.text);
    // runChat reads the latest document from this render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [queue, paused, running, doc?.id, pdf, accountForModel, model]);
  const askPath = async (name: string) => {
    const { save } = await import("@tauri-apps/plugin-dialog");
    return save({
      defaultPath: name,
      filters: [{ name: "PDF", extensions: ["pdf"] }],
    });
  };
  const download = (data: Uint8Array, name: string) => {
    const url = URL.createObjectURL(
      new Blob([new Uint8Array(data)], { type: "application/pdf" }),
    );
    const a = document.createElement("a");
    a.href = url;
    a.download = name;
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 30000);
  };
  const adoptSaved = async (
    current: StudyDocument,
    data: Uint8Array,
    source: DocumentSource,
  ) => {
    const buffer = toBuffer(data);
    const id = await storage.fingerprint(buffer);
    const map = new Map(current.pages.map((page, index) => [page, index + 1]));
    const next: StudyDocument = {
      ...current,
      id,
      size: buffer.byteLength,
      totalPages: current.pages.length,
      pages: current.pages.map((_, index) => index + 1),
      currentPage: map.get(current.currentPage) ?? 1,
      annotations: remap(current.annotations, map),
      analyses: remap(current.analyses, map),
      sessions: current.sessions?.map((x) => ({
        ...x,
        messages: x.messages.map((m) =>
          m.page ? { ...m, page: map.get(m.page) ?? m.page } : m,
        ),
      })),
      ocr: remap(current.ocr, map),
      dirty: false,
      source,
      updatedAt: new Date().toISOString(),
    };
    const file = await readPdf(buffer);
    const { task, parsed } = await loadDisplay(file.display);
    // The saved file shows the same pages, so their thumbnails carry over and
    // the page list switches files without redrawing.
    if (pdf)
      carryThumbnails(
        pdf,
        parsed,
        new Map(current.pages.map((page, index) => [index + 1, page])),
      );
    viewKeys.current.set(id, viewKeys.current.get(current.id) ?? current.id);
    if (
      id !== current.id &&
      !sameDoc(current, id) &&
      current.pages.every((page, i) => page === i + 1)
    )
      continued.current.set(id, current.id);
    setQueue((items) =>
      items.map((q) => (q.docId === current.id ? { ...q, docId: id } : q)),
    );
    await saveChain.current;
    await storage.saveDocument(next);
    await storage.storePDF(id, buffer);
    if (id !== current.id) await storage.deleteDocument(current.id);
    showDocument(
      next,
      file.display,
      task,
      parsed,
      await aspectOf(parsed, next.currentPage),
      true,
    );
    pageIds.current = current.pages.map((page) => pageIds.current[page - 1]);
    setProcessingErrors((errors) =>
      errors?.docId === current.id
        ? { docId: id, pages: remap(errors.pages, map) }
        : errors,
    );
    setSelected([]);
    setSelection(false);
    setSearchResults(null);
    void refreshLibrary();
  };
  const saveDocument = async () => {
    const current = docRef.current;
    if (
      !current ||
      !bytes ||
      saving ||
      editLock.current ||
      busy ||
      (!current.dirty && current.source)
    )
      return;
    setSaving(true);
    editLock.current = true;
    try {
      const data = await writePdf(bytes, current);
      let target = current.source;
      let expected: string | undefined = current.id;
      if (!target) {
        if (!ai.desktop) {
          download(data, current.name);
          return;
        }
        const path = await askPath(current.name);
        if (!path) return;
        target = { kind: "path", path };
        expected = undefined;
        setActivePath(null);
      }
      await files.savePdf(target, data, expected);
      await adoptSaved(current, data, target);
    } catch (error) {
      notify(err(error), true);
    } finally {
      editLock.current = false;
      setSaving(false);
    }
  };
  const exportFile = async () => {
    if (!doc || !bytes || exporting) return;
    setExporting(true);
    try {
      const data = await writePdf(bytes, doc);
      const name = doc.name.replace(/\.pdf$/i, "") + " 사본.pdf";
      if (!ai.desktop) download(data, name);
      else {
        const path = await askPath(name);
        if (path) await files.savePdf({ kind: "path", path }, data);
      }
    } catch (error) {
      notify(err(error), true);
    } finally {
      setExporting(false);
    }
  };
  const deletePages = () => {
    if (!doc) return;
    const targets = selected.length ? selected : [doc.currentPage];
    const remaining = doc.pages.filter((page) => !targets.includes(page));
    if (!remaining.length) return;
    if (!rememberEdit()) return;
    const index = doc.pages.indexOf(doc.currentPage);
    update((d) => ({
      ...d,
      dirty: true,
      pages: remaining,
      currentPage: remaining.includes(d.currentPage)
        ? d.currentPage
        : remaining[Math.min(index, remaining.length - 1)],
    }));
    setSelected([]);
    setSelection(false);
  };
  const runSearch = async () => {
    if (!pdf || !doc || !search.trim()) {
      setSearchResults(null);
      return;
    }
    setSearchBusy(true);
    try {
      const found: number[] = [];
      for (const n of doc.pages) {
        const p = await pdf.getPage(n);
        const content = await p.getTextContent();
        const text = content.items
          .map((i) => ("str" in i ? i.str : ""))
          .join(" ");
        if (text.toLocaleLowerCase().includes(search.toLocaleLowerCase()))
          found.push(n);
      }
      setSearchResults(found);
    } catch (e) {
      notify(err(e), true);
    } finally {
      setSearchBusy(false);
    }
  };
  const cancelAuth = () => {
    authAttempt.current = null;
    setLoginId(null);
    setAuthBusy(false);
    if (loginId)
      void ai.cancelLogin(loginId).catch((e) => setAuthError(err(e)));
  };
  const authAction = async (
    action: "login" | "existing" | "logout",
    provider: ai.Provider = "chatgpt",
  ) => {
    setAuthBusy(true);
    setAuthError("");
    const attempt = { provider, id: crypto.randomUUID() };
    authAttempt.current = attempt;
    try {
      if (action === "login") {
        const result = await ai.login(provider);
        if (authAttempt.current === attempt) setLoginId(result.loginId);
        else await ai.cancelLogin(result.loginId);
        return;
      }
      if (action === "existing") {
        const a = await ai.connectExisting();
        setAccount(a);
        if (!a)
          throw new Error(
            "기존 로그인을 연결하지 못했습니다. ChatGPT로 로그인해 주세요.",
          );
      } else {
        await ai.logout(provider);
        (provider === "claude" ? setClaudeAccount : setAccount)(null);
      }
      await refreshAccount();
    } catch (e) {
      setAuthError(err(e));
    }
    if (authAttempt.current === attempt) authAttempt.current = null;
    setAuthBusy(false);
  };

  const openWorkspaceFile = async (entry: WorkspaceEntry, root = workspace) => {
    if (!root || busy || opening.current || workspaceReading.current) return;
    workspaceReading.current = true;
    setImporting(true);
    try {
      const buffer = await folders.readWorkspacePDF(root.id, entry.path);
      const opened = await openBytes(buffer, entry.name, {
        kind: "workspace",
        workspaceId: root.id,
        path: entry.path,
      });
      if (opened) {
        setActivePath(entry.path);
        localStorage.setItem(`margin-workspace-file:${root.id}`, entry.path);
      }
    } catch (error) {
      notify(err(error), true);
    } finally {
      workspaceReading.current = false;
      setImporting(false);
    }
  };
  /**
   * A workspace file or folder was renamed, moved (`to`) or trashed (`null`)
   * from the file tree. The open document follows it so that saving still
   * writes the right file; a trashed file is no longer a save target.
   */
  const relocateWorkspaceEntry = (from: string, to: string | null) => {
    if (!workspace) return;
    const follow = (path: string) =>
      path === from || path.startsWith(from + "/")
        ? to === null
          ? null
          : to + path.slice(from.length)
        : undefined;
    setActivePath((current) => {
      const next = current === null ? undefined : follow(current);
      return next === undefined ? current : next;
    });
    const key = `margin-workspace-file:${workspace.id}`;
    const last = localStorage.getItem(key);
    const next = last ? follow(last) : undefined;
    if (next === null) localStorage.removeItem(key);
    else if (next) localStorage.setItem(key, next);
    setDoc((current) => {
      const source = current?.source;
      if (
        !current ||
        source?.kind !== "workspace" ||
        source.workspaceId !== workspace.id
      )
        return current;
      const path = follow(source.path);
      if (path === undefined) return current;
      return {
        ...current,
        source: path === null ? undefined : { ...source, path },
      };
    });
  };
  const activateWorkspace = async (root: Workspace) => {
    if (busy || editLock.current) return;
    await saveChain.current;
    setDoc(null);
    setBytes(null);
    setPdf(null);
    setWorkspace(root);
    setActivePath(null);
    setSidebarTab("files");
    setLeftOpen(true);
    localStorage.setItem("margin-workspace", root.id);
    const last = localStorage.getItem(`margin-workspace-file:${root.id}`);
    if (last)
      await openWorkspaceFile(
        { name: last.split("/").pop() ?? last, path: last, isDirectory: false },
        root,
      );
  };
  const chooseFolder = async () => {
    if (!ai.desktop || busy) return;
    try {
      const path = await folders.chooseWorkspace();
      if (!path) return;
      const roots = await folders.listWorkspaces();
      setWorkspaces(roots);
      const existing = roots.find((root) => root.path === path);
      if (existing) await activateWorkspace(existing);
      else setPendingFolder(path);
    } catch (error) {
      notify(err(error), true);
    }
  };
  const confirmFolder = async () => {
    if (!pendingFolder) return;
    try {
      const root = await folders.trustWorkspace(pendingFolder);
      setPendingFolder(null);
      setWorkspaces(await folders.listWorkspaces());
      await activateWorkspace(root);
    } catch (error) {
      notify(err(error), true);
    }
  };
  const closeFolder = () => {
    setWorkspace(null);
    setActivePath(null);
    localStorage.removeItem("margin-workspace");
  };
  useEffect(() => {
    canvasRegion.current?.scrollTo({ top: 0, left: 0 });
  }, [doc?.id, doc?.currentPage]);
  const workspaceError = useCallback(
    (error: unknown) => notify(err(error), true),
    [notify],
  );
  useEffect(() => {
    if (restoredWorkspace.current) return;
    restoredWorkspace.current = true;
    void folders
      .listWorkspaces()
      .then(async (roots) => {
        setWorkspaces(roots);
        const root = roots.find(
          (w) => w.id === localStorage.getItem("margin-workspace"),
        );
        if (root) await activateWorkspace(root);
      })
      .catch(workspaceError);
  }, []);

  return {
    doc,
    viewKey: doc ? (viewKeys.current.get(doc.id) ?? doc.id) : null,
    bytes,
    pdf,
    pageDisplayed,
    setPdf,
    library,
    libraryOpen,
    setLibraryOpen,
    settingsOpen,
    setSettingsOpen,
    account,
    claudeAccount,
    modelList,
    model,
    setModel,
    authBusy,
    authError,
    cancelAuth,
    loginId,
    setLoginId,
    setAuthBusy,
    importing,
    exporting,
    tool,
    setTool,
    colors,
    setToolColor,
    zoom,
    setZoom,
    leftOpen,
    setLeftOpen,
    rightOpen,
    setRightOpen,
    selection,
    setSelection,
    selected,
    setSelected,
    tab,
    setTab,
    translate,
    setTranslate,
    processing,
    processingError,
    chatBusy,
    queue: queue.filter(
      (q) => q.docId === doc?.id && q.sessionId === doc?.activeChat,
    ),
    queuePaused,
    resumeQueue,
    stopChat,
    resumeChat,
    removeQueued,
    sendQueuedNow,
    editQueued,
    chatDraft,
    search,
    setSearch,
    searchResults,
    setSearchResults,
    searchBusy,
    inputRef,
    canvasRegion,
    chatEnd,
    /** The answer being written in the active chat. */
    liveAnswer: doc?.activeChat ? running[doc.activeChat] : undefined,
    refreshLibrary,
    notify,
    update,
    goTo,
    pageIndex,
    analysis,
    annotations,
    messages,
    chatSession,
    chatHistory,
    streamingChats,
    newChat,
    openChat,
    closeChat,
    moveChat,
    doneCount,
    pageWidth,
    pageHeight,
    busy,
    openBytes,
    importFile,
    openStored,
    changeAnnotations,
    navigate,
    runAnalysis,
    stopProcessing,
    sendChat,
    exportFile,
    deletePages,
    runSearch,
    authAction,
    workspace,
    workspaces,
    pendingFolder,
    setPendingFolder,
    activePath,
    setActivePath,
    sidebarTab,
    setSidebarTab,
    openWorkspaceFile,
    relocateWorkspaceEntry,
    activateWorkspace,
    chooseFolder,
    confirmFolder,
    closeFolder,
    workspaceError,
    bottomOpen,
    setBottomOpen,
    saving,
    restoring,
    history,
    undo,
    redo,
    saveDocument,
    pageSurface,
    highlightSelection,
    attachSelection,
    ensureOcr,
  };
}

export type Tool = "select" | "highlight" | "pen" | "text" | "eraser";
export type Point = { x: number; y: number };
export type Rect = { x: number; y: number; w: number; h: number };
export type Annotation = {
  id: string;
  type: "highlight" | "pen" | "text";
  color: string;
  points: Point[];
  /** Text-selection highlights keep one rectangle per line. */
  rects?: Rect[];
  text?: string;
  width: number;
  height?: number;
};
export type OcrLine = Rect & { text: string };
export type DocumentSource =
  | { kind: "workspace"; workspaceId: string; path: string }
  | { kind: "path"; path: string };
export type PageAnalysis = {
  title: string;
  explanation: string;
  translation: string;
  translationRequested: boolean;
  keyPoints: string[];
  model: string;
  createdAt: string;
};
export type ChatMessage = {
  id: string;
  role: "user" | "assistant";
  text: string;
  error?: boolean;
  /** The answer was stopped before it finished and can be continued. */
  stopped?: boolean;
  /** Original page the question was asked on. */
  page?: number;
};
export type ChatSession = {
  id: string;
  title: string;
  messages: ChatMessage[];
  updatedAt: string;
};
export type StudyDocument = {
  id: string;
  name: string;
  size: number;
  totalPages: number;
  pages: number[];
  currentPage: number;
  annotations: Record<number, Annotation[]>;
  analyses: Record<number, PageAnalysis>;
  /** Legacy per-page chats; migrated into sessions on open. */
  chats: Record<number, ChatMessage[]>;
  sessions?: ChatSession[];
  openChats?: string[];
  activeChat?: string;
  ocr?: Record<number, OcrLine[]>;
  /** Unsaved page or annotation edits relative to the file on disk. */
  dirty?: boolean;
  source?: DocumentSource;
  updatedAt: string;
  createdAt: string;
};
export type LibraryItem = Pick<
  StudyDocument,
  "id" | "name" | "size" | "totalPages" | "updatedAt"
> & { remainingPages: number; analyzedPages: number };
export type Model = {
  id: string;
  model: string;
  displayName: string;
  isDefault: boolean;
  inputModalities?: string[];
};
export type Account = {
  type: "chatgpt";
  email: string;
  planType: string;
} | null;

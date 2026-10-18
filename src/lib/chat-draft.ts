import { createStore } from "zustand/vanilla";

type ChatDraft = {
  question: string;
  setQuestion: (value: string | ((current: string) => string)) => void;
};

// One store per study workspace. The composer subscribes; sending, quotations
// and queue editing read/write it without rerendering the PDF or transcript.
export const createChatDraftStore = () =>
  createStore<ChatDraft>()((set) => ({
    question: "",
    setQuestion: (value) =>
      set((state) => ({
        question: typeof value === "function" ? value(state.question) : value,
      })),
  }));

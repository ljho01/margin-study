import { invoke } from "@tauri-apps/api/core";
import type { DocumentSource, OcrLine } from "./types";

/** Writes atomically. With an expected hash, refuses to overwrite a file changed elsewhere. */
export function savePdf(
  target: DocumentSource,
  data: Uint8Array,
  expected?: string,
) {
  return invoke<string>("save_pdf", data, {
    headers: {
      "x-target": encodeURIComponent(JSON.stringify(target)),
      "x-expected": expected ?? "",
    },
  });
}

export function recognizeText(png: Uint8Array) {
  return invoke<OcrLine[]>("ocr_page", png);
}

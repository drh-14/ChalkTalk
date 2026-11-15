// Loads course PDFs with pdf.js. Only the viewer and anchored-post crops
// import this module, both lazily, so other pages never download pdf.js.
import {
  GlobalWorkerOptions,
  TextLayer,
  getDocument,
  type PDFDocumentProxy,
} from "pdfjs-dist";
import workerUrl from "pdfjs-dist/build/pdf.worker.min.mjs?url";
import { ApiError } from "../auth/client.js";

GlobalWorkerOptions.workerSrc = workerUrl;

export { TextLayer };
export type { PDFDocumentProxy, PDFPageProxy } from "pdfjs-dist";

type SharedDocument = {
  controller: AbortController;
  users: number;
  progress: Set<(share: number) => void>;
  promise: Promise<PDFDocumentProxy>;
};
const documents = new Map<string, SharedDocument>();

export async function loadPdf(
  courseId: string,
  fileId: string,
  signal: AbortSignal,
  onProgress?: (share: number) => void,
): Promise<PDFDocumentProxy> {
  signal.throwIfAborted();
  const key = JSON.stringify([courseId, fileId]);
  let entry = documents.get(key);
  if (!entry) {
    const controller = new AbortController();
    const progress = new Set<(share: number) => void>();
    const promise = download(courseId, fileId, controller.signal, (share) => {
      for (const notify of progress) notify(share);
    }).then((data) => parsePdf(data, controller.signal));
    entry = { controller, progress, users: 0, promise };
    documents.set(key, entry);
  }
  const owned = entry;
  owned.users++;
  if (onProgress) owned.progress.add(onProgress);
  return new Promise((resolve, reject) => {
    const release = () => {
      signal.removeEventListener("abort", abort);
      if (onProgress) owned.progress.delete(onProgress);
      owned.users--;
      if (!owned.users) {
        if (documents.get(key) === owned) documents.delete(key);
        owned.controller.abort();
      }
    };
    const abort = () => {
      release();
      reject(signal.reason);
    };
    signal.addEventListener("abort", abort, { once: true });
    owned.promise.then(
      (document) => {
        if (!signal.aborted) resolve(document);
      },
      (error: unknown) => {
        if (documents.get(key) === owned) documents.delete(key);
        if (!signal.aborted) {
          release();
          reject(error);
        }
      },
    );
  });
}

function parsePdf(
  data: Uint8Array,
  signal: AbortSignal,
): Promise<PDFDocumentProxy> {
  signal.throwIfAborted();
  const task = getDocument({ data });
  return new Promise((resolve, reject) => {
    let destroyed = false;
    const destroy = () => {
      if (destroyed) return;
      destroyed = true;
      signal.removeEventListener("abort", abort);
      void task.destroy().catch(() => {});
    };
    const abort = () => {
      destroy();
      reject(signal.reason);
    };
    signal.addEventListener("abort", abort, { once: true });
    task.promise.then(
      (document) => {
        if (!signal.aborted) resolve(document);
      },
      (error: unknown) => {
        destroy();
        reject(error);
      },
    );
  });
}

async function download(
  courseId: string,
  fileId: string,
  signal: AbortSignal,
  onProgress?: (share: number) => void,
): Promise<Uint8Array> {
  const response = await fetch(
    `/api/v1/courses/${encodeURIComponent(courseId)}/files/${encodeURIComponent(fileId)}/download`,
    { credentials: "include", signal },
  );
  if (!response.ok)
    throw new ApiError(
      response.status,
      response.status === 404 ? "not_found" : "request_failed",
      response.status === 404
        ? "These slides are no longer available."
        : "The slides could not be loaded.",
    );
  const total = Number(response.headers.get("Content-Length"));
  if (!response.body || !onProgress || !total)
    return new Uint8Array(await response.arrayBuffer());
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let received = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    chunks.push(value);
    received += value.length;
    onProgress(Math.min(received / total, 1));
  }
  const bytes = new Uint8Array(received);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.length;
  }
  return bytes;
}

/** Viewer-owned derivative: never cached across generation/replacement changes. */
export async function loadPdfUrl(
  url: string,
  signal: AbortSignal,
): Promise<PDFDocumentProxy> {
  const response = await fetch(url, { credentials: "include", signal });
  if (!response.ok) throw new Error("The searchable copy couldn’t load.");
  const data = new Uint8Array(await response.arrayBuffer());
  signal.throwIfAborted();
  return parsePdf(data, signal);
}

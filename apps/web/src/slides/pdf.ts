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

const documents = new Map<string, Promise<PDFDocumentProxy>>();

/**
 * The PDF for a course file, fetched once per session from the same-origin
 * download route. `onProgress` receives the share downloaded, from 0 to 1,
 * when the server reports the size.
 */
export function loadPdf(
  courseId: string,
  fileId: string,
  onProgress?: (share: number) => void,
): Promise<PDFDocumentProxy> {
  const cached = documents.get(fileId);
  if (cached) return cached;
  const loading = download(courseId, fileId, onProgress).then(
    (data) => getDocument({ data }).promise,
  );
  documents.set(fileId, loading);
  // A failed load is retried on the next request instead of being cached.
  loading.catch(() => documents.delete(fileId));
  return loading;
}

async function download(
  courseId: string,
  fileId: string,
  onProgress?: (share: number) => void,
): Promise<Uint8Array> {
  const response = await fetch(
    `/api/v1/courses/${encodeURIComponent(courseId)}/files/${encodeURIComponent(fileId)}/download`,
    { credentials: "include" },
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
export async function loadPdfUrl(url: string, signal: AbortSignal): Promise<PDFDocumentProxy> {
  const response = await fetch(url, {credentials: "include", signal});
  if (!response.ok) throw new Error("The searchable copy couldn’t load.");
  const data = new Uint8Array(await response.arrayBuffer());
  signal.throwIfAborted();
  const document = await getDocument({data}).promise;
  if (signal.aborted) {await document.destroy(); signal.throwIfAborted();}
  return document;
}

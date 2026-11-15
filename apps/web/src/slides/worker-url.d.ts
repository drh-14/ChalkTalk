// Vite serves the pdf.js worker as a same-origin asset and imports its URL.
declare module "pdfjs-dist/build/pdf.worker.min.mjs?url" {
  const url: string;
  export default url;
}

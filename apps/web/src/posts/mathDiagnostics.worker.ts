import { getMathAnalysis } from "./mathDiagnostics.js";

self.onmessage = (event: MessageEvent<{ version: number; source: string }>) => {
  const { version, source } = event.data;
  try {
    self.postMessage({ version, ...getMathAnalysis(source) });
  } catch {
    self.postMessage({ version, error: "LaTeX checking is unavailable." });
  }
};

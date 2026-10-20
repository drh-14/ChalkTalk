// Imported before Excalidraw so its fonts load from ChalkTalk, not esm.sh.
// Keep in step with EXCALIDRAW_ASSET_PATH in vite.config.ts.
declare global {
  interface Window {
    EXCALIDRAW_ASSET_PATH?: string | string[];
  }
}

window.EXCALIDRAW_ASSET_PATH = "/excalidraw-assets/";

export {};

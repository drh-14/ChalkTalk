import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import react from "@vitejs/plugin-react";
import { defineConfig, loadEnv, type UserConfig } from "vite";

// The package's browser export uses document at import time, which is unavailable
// in the Markdown validation worker. Its default export is DOM-free.
const characterDecoder = createRequire(import.meta.url).resolve(
  "decode-named-character-reference",
);

export function createViteConfig(
  environment: Record<string, string | undefined>,
): UserConfig {
  const key = environment.VITE_TLS_KEY_PATH;
  const cert = environment.VITE_TLS_CERT_PATH;
  return {
    plugins: [react()],
    resolve: {
      alias: [
        {
          find: "decode-named-character-reference",
          replacement: characterDecoder,
        },
      ],
    },
    server: {
      https:
        key && cert
          ? { key: readFileSync(key), cert: readFileSync(cert) }
          : undefined,
      proxy: {
        "/api/health": {
          target: environment.VITE_API_PROXY_TARGET ?? "http://localhost:3000",
          changeOrigin: true,
          rewrite: () => "/health",
        },
        "/api": {
          target: environment.VITE_API_PROXY_TARGET ?? "http://localhost:3000",
          changeOrigin: true,
        },
      },
      watch:
        environment.VITE_USE_POLLING === "true"
          ? { usePolling: true }
          : undefined,
    },
  };
}

export default defineConfig(({ mode }) =>
  createViteConfig(loadEnv(mode, process.cwd(), "")),
);

import { readFileSync } from "node:fs";
import react from "@vitejs/plugin-react";
import { defineConfig, loadEnv } from "vite";

export default defineConfig(({ mode }) => {
  const environment = loadEnv(mode, process.cwd(), "");
  const key = environment.VITE_TLS_KEY_PATH;
  const cert = environment.VITE_TLS_CERT_PATH;
  return {
    plugins: [react()],
    server: {
      https:
        key && cert
          ? { key: readFileSync(key), cert: readFileSync(cert) }
          : undefined,
      proxy: {
        "/api": {
          target: "http://localhost:3000",
          changeOrigin: true,
        },
      },
    },
  };
});

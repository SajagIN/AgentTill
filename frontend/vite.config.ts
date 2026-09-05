import path from "node:path";
import { fileURLToPath } from "node:url";

import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

const ROOT = path.dirname(fileURLToPath(import.meta.url));

// Everything the browser needs from the backend. In production the Express
// server serves the built SPA and these same routes from one origin, so the
// application code can always use relative paths.
const API_PROXY = {
  target: "http://localhost:3000",
  changeOrigin: true,
};

export default defineConfig({
  plugins: [react(), tailwindcss()],
  resolve: {
    alias: { "@": path.resolve(ROOT, "src") },
  },
  server: {
    host: true,
    port: 5173,
    allowedHosts: true,
    proxy: {
      "/api": API_PROXY,
      "/pay": API_PROXY,
      "/webhooks": API_PROXY,
      "/mcp": API_PROXY,
      "/health": API_PROXY,
    },
  },
  build: {
    outDir: "dist",
    emptyOutDir: true,
  },
});

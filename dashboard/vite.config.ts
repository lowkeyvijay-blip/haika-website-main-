import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

const dashboardDir = dirname(fileURLToPath(import.meta.url));
const projectRoot = resolve(dashboardDir, "..");
const apiPort = process.env["HAIKA_API_PORT"] ?? "3001";

export default defineConfig({
  root: dashboardDir,
  plugins: [react()],
  server: {
    port: 5173,
    strictPort: true,
    fs: {
      allow: [projectRoot],
    },
    proxy: {
      "/api": {
        target: `http://127.0.0.1:${apiPort}`,
        changeOrigin: true,
      },
    },
  },
  build: {
    outDir: "dist",
    emptyOutDir: true,
  },
});

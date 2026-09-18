import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// The build output is copied into the Go binary's embed directory, so the
// daemon serves the UI from its own process (ADR-0013).
export default defineConfig({
  plugins: [react()],
  build: {
    outDir: "../internal/web/static",
    emptyOutDir: true,
    // One bundle keeps the embed simple and the daemon dependency-free.
    assetsInlineLimit: 0,
    chunkSizeWarningLimit: 2000,
  },
});

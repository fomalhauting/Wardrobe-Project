import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  // transformers.js ships its own WASM binaries; pre-bundling mangles them.
  optimizeDeps: { exclude: ["@huggingface/transformers"] },
  server: {
    host: true, // open the dev server from your phone on the same wifi
    port: 5173,
  },
  build: {
    outDir: "dist",
    rollupOptions: {
      output: {
        // Keep the ML runtime in its own chunk so the app shell stays small.
        manualChunks: { transformers: ["@huggingface/transformers"] },
      },
    },
  },
});

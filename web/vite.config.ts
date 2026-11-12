import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

// The add-on loads the page with plain <script>/<link> tags from
// /_addons/<addon>/web/, so build one IIFE bundle with fixed file names
// straight into the add-on's src/web/ folder.
export default defineConfig({
  plugins: [react()],
  base: "./",
  build: {
    outDir: "../src/web",
    emptyOutDir: true,
    cssCodeSplit: false,
    target: "chrome118",
    rollupOptions: {
      input: "src/main.tsx",
      output: {
        format: "iife",
        entryFileNames: "skim.js",
        assetFileNames: "skim[extname]",
      },
    },
  },
});

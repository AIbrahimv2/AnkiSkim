import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

// Skim's Settings, for the add-on kit's window (src/settings-main.tsx): a
// second IIFE bundle beside the window's skim.js, built after it (so the
// folder isn't emptied again). The kit inlines both files in its window.
export default defineConfig({
  plugins: [react()],
  base: "./",
  publicDir: false,
  build: {
    outDir: "../src/web",
    emptyOutDir: false,
    cssCodeSplit: false,
    target: "chrome118",
    rollupOptions: {
      input: "src/settings-main.tsx",
      output: {
        format: "iife",
        entryFileNames: "settings.js",
        assetFileNames: "settings[extname]",
      },
    },
  },
});

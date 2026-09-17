import path from "node:path";
import { svelte } from "@sveltejs/vite-plugin-svelte";
import { defineConfig } from "vite";

export default defineConfig({
  plugins: [svelte({ emitCss: false })],
  resolve: {
    // import.meta.dirname, not __dirname: this file uses ESM syntax while
    // package.json declares no "type", so Node reads it as CommonJS and Vite
    // papers over the mismatch by bundling the config before loading it. That
    // stops when configLoader: "native" becomes the default and the config is
    // imported directly -- at which point __dirname, a CJS-only global, is a
    // ReferenceError. Note the warning Vite prints names the *syntax* and
    // suggests .mts or "type": "module"; either of those alone moves this file
    // into ESM scope, where __dirname is exactly what breaks.
    alias: { src: path.resolve(import.meta.dirname, "src") },
  },
  build: {
    lib: {
      entry: "src/main.ts",
      formats: ["cjs"],
      fileName: () => "main.js",
    },
    outDir: ".",
    emptyOutDir: false,
    sourcemap: process.env.NODE_ENV === "DEV" ? "inline" : false,
    rollupOptions: {
      external: ["obsidian", "electron", "fs", "os", "path"],
      output: { exports: "default" },
    },
  },
});

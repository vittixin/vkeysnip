import { resolve } from "node:path";
import { defineConfig } from "vite";

const fixtureRoot = resolve(__dirname, "fixtures");

export default defineConfig({
  root: fixtureRoot,
  build: {
    outDir: resolve(__dirname, "dist"),
    emptyOutDir: true,
    rollupOptions: {
      input: {
        plain: resolve(fixtureRoot, "plain-input.html"),
        textarea: resolve(fixtureRoot, "textarea.html"),
        react: resolve(fixtureRoot, "react-input.html"),
        frame: resolve(fixtureRoot, "iframe-input.html"),
        innerFrame: resolve(fixtureRoot, "inner-frame.html"),
        plainContenteditable: resolve(
          fixtureRoot,
          "plain-contenteditable.html",
        ),
        nestedContenteditable: resolve(
          fixtureRoot,
          "nested-contenteditable.html",
        ),
        plaintextOnly: resolve(fixtureRoot, "plaintext-only.html"),
        shadowContenteditable: resolve(
          fixtureRoot,
          "shadow-contenteditable.html",
        ),
        iframeContenteditable: resolve(
          fixtureRoot,
          "iframe-contenteditable.html",
        ),
        innerContenteditable: resolve(
          fixtureRoot,
          "inner-contenteditable.html",
        ),
        prosemirrorContenteditable: resolve(
          fixtureRoot,
          "prosemirror-contenteditable.html",
        ),
      },
    },
  },
  server: { host: "127.0.0.1", port: 4173, strictPort: true },
  preview: { host: "127.0.0.1", port: 4173, strictPort: true },
});

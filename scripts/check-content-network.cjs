const fs = require("node:fs");
const path = require("node:path");
const zlib = require("node:zlib");

const root = path.resolve(__dirname, "../dist");
const manifestPath = path.join(root, "manifest.json");
if (!fs.existsSync(manifestPath)) {
  throw new Error("Build output is missing dist/manifest.json");
}

const manifest = JSON.parse(fs.readFileSync(manifestPath, "utf8"));
const contentFiles = [
  ...(manifest.content_scripts ?? []).flatMap((script) => script.js ?? []),
  ...(manifest.web_accessible_resources ?? []).flatMap(
    (entry) => entry.resources ?? [],
  ),
].filter((file) => file.endsWith(".js"));
if (contentFiles.length === 0) {
  throw new Error("Manifest has no content script JavaScript bundles");
}

const forbidden = /\b(?:fetch|XMLHttpRequest|WebSocket)\b/;
let totalGzipBytes = 0;
for (const file of contentFiles) {
  const absolutePath = path.resolve(root, file);
  if (!absolutePath.startsWith(`${root}${path.sep}`)) {
    throw new Error(`Content script path escapes build directory: ${file}`);
  }
  const source = fs.readFileSync(absolutePath, "utf8");
  const match = forbidden.exec(source);
  if (match) {
    throw new Error(
      `Forbidden network API token "${match[0]}" found in ${file}`,
    );
  }
  totalGzipBytes += zlib.gzipSync(source).byteLength;
}

const budget = 50 * 1024;
if (totalGzipBytes >= budget) {
  throw new Error(
    `Content script is ${totalGzipBytes} gzip bytes; budget is under ${budget}`,
  );
}
console.log(
  `Content scripts: ${totalGzipBytes} gzip bytes; no network APIs found.`,
);

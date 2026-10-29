import { defineManifest } from "@crxjs/vite-plugin";

export default defineManifest({
  manifest_version: 3,
  name: "VKeysnip",
  version: "1.0.0",
  description: "A private, local-first text expander.",
  icons: {
    128: "assets/vkeysnip-icon-128.png",
  },
  permissions: ["storage", "clipboardRead", "clipboardWrite"],
  background: {
    service_worker: "src/background/index.ts",
    type: "module",
  },
  action: {
    default_popup: "src/popup/index.html",
    default_icon: {
      128: "assets/vkeysnip-icon-128.png",
    },
  },
  options_page: "src/dashboard/index.html",
  content_scripts: [
    {
      matches: ["<all_urls>"],
      js: ["src/content/index.ts"],
      all_frames: true,
      match_about_blank: true,
      run_at: "document_start",
    },
  ],
});

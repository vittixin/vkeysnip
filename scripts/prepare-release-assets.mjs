import { chromium } from "@playwright/test";
import { copyFile, mkdtemp, mkdir, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";

const root = process.cwd();
const output = resolve(root, "docs/release/assets");
await mkdir(output, { recursive: true });

const browser = await chromium.launch({ headless: true });
try {
  const graphicPage = await browser.newPage({ deviceScaleFactor: 1 });
  const icon = await readFile(
    resolve(root, "public/assets/vkeysnip-icon.svg"),
    "utf8",
  );
  await graphicPage.setContent(
    `<body style="margin:0;width:128px;height:128px">${icon}</body>`,
  );
  const iconPath = resolve(root, "public/assets/vkeysnip-icon-128.png");
  await graphicPage.locator("svg").screenshot({ path: iconPath });
  await copyFile(iconPath, resolve(output, "vkeysnip-icon-128.png"));
  await graphicPage.setViewportSize({ width: 440, height: 280 });
  await graphicPage.goto(
    pathToFileURL(resolve(root, "docs/release/promo-tile.html")).href,
  );
  await graphicPage.screenshot({
    path: resolve(output, "promo-tile-440x280.png"),
  });
} finally {
  await browser.close();
}

const extensionPath = resolve(root, "dist");
const profile = await mkdtemp(join(tmpdir(), "vkeysnip-release-"));
let context;
try {
  context = await chromium.launchPersistentContext(profile, {
    headless: false,
    channel: "chromium",
    viewport: { width: 1280, height: 800 },
    args: [
      `--disable-extensions-except=${extensionPath}`,
      `--load-extension=${extensionPath}`,
    ],
  });
  const worker =
    context.serviceWorkers()[0] ??
    (await context.waitForEvent("serviceworker", { timeout: 10_000 }));
  await worker.evaluate(async () => {
    for (let attempt = 0; attempt < 30; attempt += 1) {
      const { schemaVersion } = await chrome.storage.local.get("schemaVersion");
      if (schemaVersion === 1) return;
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
    throw new Error("VKeysnip storage did not initialize.");
  });
  const extensionId = new URL(worker.url()).hostname;
  await worker.evaluate(async () => {
    const now = Date.now();
    await chrome.storage.local.set({
      schemaVersion: 1,
      snippets: {
        signature: {
          id: "signature",
          trigger: ";sig",
          label: "Email signature",
          body: "Best regards,\nJordan Lee",
          format: "text",
          createdAt: now,
          updatedAt: now,
        },
        followup: {
          id: "followup",
          trigger: ";follow",
          label: "Follow up",
          body: "Thanks for the conversation. I’ll follow up with next steps.",
          format: "text",
          createdAt: now,
          updatedAt: now,
        },
        meeting: {
          id: "meeting",
          trigger: ";meet",
          label: "Meeting notes",
          body: "Agenda:\n\nDecisions:\n\nNext steps:",
          format: "text",
          createdAt: now,
          updatedAt: now,
        },
      },
      folders: {},
      settings: {
        triggerPrefix: ";",
        mode: "delimiter",
        caseSensitive: false,
        theme: "system",
      },
      exclusions: [],
    });
  });
  const page = await context.newPage();
  await page.goto(`chrome-extension://${extensionId}/src/dashboard/index.html`);
  await page.getByRole("heading", { name: "Your library" }).waitFor();
  await page.screenshot({ path: resolve(output, "dashboard-1280x800.png") });
} finally {
  await context?.close();
  await rm(profile, { recursive: true, force: true });
}

console.log(`Release assets written to ${output}`);

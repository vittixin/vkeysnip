import {
  test,
  expect,
  chromium,
  type BrowserContext,
  type Locator,
  type Page,
} from "@playwright/test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

const fixtureBase = "http://127.0.0.1:4173";
const extensionPath = resolve(process.cwd(), "dist");

async function launchExtensionContext(): Promise<{
  context: BrowserContext;
  profile: string;
}> {
  const profile = await mkdtemp(join(tmpdir(), "vkeysnip-ce-e2e-"));
  const context = await chromium.launchPersistentContext(profile, {
    headless: false,
    channel: "chromium",
    args: [
      `--disable-extensions-except=${extensionPath}`,
      `--load-extension=${extensionPath}`,
    ],
  });
  const worker =
    context.serviceWorkers()[0] ??
    (await context.waitForEvent("serviceworker", { timeout: 10_000 }));
  await expect
    .poll(() =>
      worker.evaluate(async () => {
        const { schemaVersion } =
          await chrome.storage.local.get("schemaVersion");
        return schemaVersion;
      }),
    )
    .toBe(1);
  await worker.evaluate(async () => {
    await chrome.storage.local.set({
      schemaVersion: 1,
      snippets: {
        signature: {
          id: "signature",
          trigger: ";sig",
          label: "Signature",
          body: "Regards",
          format: "text",
          createdAt: 0,
          updatedAt: 0,
        },
        multiline: {
          id: "multiline",
          trigger: ";multi",
          label: "Multiline",
          body: "Line 1\nLine 2\nLine 3",
          format: "text",
          createdAt: 0,
          updatedAt: 0,
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
  return { context, profile };
}

async function installTimingProbe(target: Locator): Promise<void> {
  await target.evaluate((element) => {
    const field = element as HTMLElement;
    const view = field.ownerDocument.defaultView!;
    const metrics = view as typeof window & {
      __expansionStarted?: number;
      __expansionMs?: number;
    };
    view.addEventListener(
      "beforeinput",
      (event) => {
        if ((event as InputEvent).data === " ") {
          metrics.__expansionStarted = performance.now();
        }
      },
      true,
    );
    view.addEventListener(
      "input",
      (event) => {
        const current = event.composedPath()[0] as HTMLElement;
        if (
          current.textContent?.includes("Regards") &&
          metrics.__expansionStarted !== undefined
        ) {
          metrics.__expansionMs =
            performance.now() - metrics.__expansionStarted;
        }
      },
      true,
    );
  });
}

async function setCaretForSignature(target: Locator): Promise<void> {
  await target.evaluate((element) => {
    const root = element as HTMLElement;
    const doc = root.ownerDocument;
    root.focus();
    const treeRoot = root.getRootNode() as ShadowRoot & {
      getSelection?: () => Selection | null;
    };
    const selection = treeRoot.getSelection?.() ?? doc.getSelection();
    const range = doc.createRange();
    const triggerEnd = root.querySelector("#trigger-end")?.firstChild;
    if (triggerEnd) {
      range.setStart(triggerEnd, triggerEnd.textContent?.length ?? 0);
    } else {
      range.selectNodeContents(root);
      range.collapse(false);
    }
    range.collapse(true);
    selection?.removeAllRanges();
    selection?.addRange(range);
  });
}

async function textAndCaret(target: Locator): Promise<{
  text: string;
  beforeCaret: string;
  isCollapsed: boolean;
}> {
  return target.evaluate((element) => {
    const root = element as HTMLElement;
    const treeRoot = root.getRootNode() as ShadowRoot & {
      getSelection?: () => Selection | null;
    };
    const selection =
      treeRoot.getSelection?.() ?? root.ownerDocument.getSelection();
    const beforeCaret = root.ownerDocument.createRange();
    beforeCaret.selectNodeContents(root);
    if (selection?.anchorNode) {
      beforeCaret.setEnd(selection.anchorNode, selection.anchorOffset);
    }
    return {
      text: (root.innerText ?? root.textContent ?? "").replace(/\u00a0/g, " "),
      beforeCaret: beforeCaret.toString().replace(/\u00a0/g, " "),
      isCollapsed: Boolean(selection?.isCollapsed),
    };
  });
}

async function exerciseEditor(
  target: Locator,
  options: { preloadedTrigger?: boolean; preservesMarkup?: boolean } = {},
): Promise<void> {
  await target.page().waitForTimeout(150);
  await setCaretForSignature(target);
  await installTimingProbe(target);
  if (options.preloadedTrigger) {
    await target.press("Space");
  } else {
    await target.pressSequentially(";sig");
    await target.press("Space");
  }

  await expect
    .poll(async () => (await textAndCaret(target)).text)
    .toContain("Regards ");
  const expanded = await textAndCaret(target);
  expect(expanded.isCollapsed).toBe(true);
  expect(expanded.beforeCaret.endsWith("Regards ")).toBe(true);
  if (options.preservesMarkup) {
    expect(await target.locator("#prefix").textContent()).toMatch(/^Before/);
    expect(
      (await target.locator("#suffix").textContent())?.replace(/\u00a0/g, " "),
    ).toBe(" after");
    expect(await target.locator("strong").count()).toBe(1);
  }

  const elapsed = await target.evaluate((element) => {
    const view = (element as HTMLElement).ownerDocument
      .defaultView as typeof window & { __expansionMs?: number };
    return view.__expansionMs;
  });
  expect(elapsed).toBeDefined();
  expect(elapsed).toBeLessThan(100);

  await target.press("Backspace");
  await expect
    .poll(async () => (await textAndCaret(target)).text)
    .toContain(";sig ");

  await target.pressSequentially(";multi");
  await target.press("Space");
  await expect
    .poll(async () => (await textAndCaret(target)).text)
    .toMatch(/Line 1[\r\n]+Line 2[\r\n]+Line 3 /);
  const multiline = await textAndCaret(target);
  expect(multiline.isCollapsed).toBe(true);
  expect(multiline.beforeCaret.endsWith("Line 3 ")).toBe(true);
}

async function withExtension(
  run: (context: BrowserContext, page: Page) => Promise<void>,
): Promise<void> {
  const { context, profile } = await launchExtensionContext();
  try {
    await run(context, await context.newPage());
  } finally {
    await context.close();
    await rm(profile, { recursive: true, force: true });
  }
}

test("plain contenteditable supports expansion, undo, and multiline text", async () => {
  await withExtension(async (_context, page) => {
    await page.goto(`${fixtureBase}/plain-contenteditable.html`);
    await exerciseEditor(page.locator("#target"));
  });
});

test("nested inline markup around the caret is preserved", async () => {
  await withExtension(async (_context, page) => {
    await page.goto(`${fixtureBase}/nested-contenteditable.html`);
    await exerciseEditor(page.locator("#target"), {
      preloadedTrigger: true,
      preservesMarkup: true,
    });
  });
});

test("plaintext-only contenteditable supports expansion and undo", async () => {
  await withExtension(async (_context, page) => {
    await page.goto(`${fixtureBase}/plaintext-only.html`);
    await exerciseEditor(page.locator("#target"));
  });
});

test("open Shadow DOM contenteditable supports expansion and undo", async () => {
  await withExtension(async (_context, page) => {
    await page.goto(`${fixtureBase}/shadow-contenteditable.html`);
    const target = page.locator("v-editor").locator("#target");
    await target.waitFor();
    await exerciseEditor(target);
  });
});

test("same-origin iframe contenteditable supports expansion and undo", async () => {
  await withExtension(async (_context, page) => {
    await page.goto(`${fixtureBase}/iframe-contenteditable.html`);
    const target = page.frameLocator("#target-frame").locator("#target");
    await exerciseEditor(target);
  });
});

test("ProseMirror editor supports expansion, undo, and multiline text", async () => {
  await withExtension(async (_context, page) => {
    await page.goto(`${fixtureBase}/prosemirror-contenteditable.html`);
    const target = page.locator(".ProseMirror");
    await target.waitFor();
    await exerciseEditor(target);
  });
});

test("rich snippets paste formatted content and sanitized links", async () => {
  await withExtension(async (context, page) => {
    await context.serviceWorkers()[0].evaluate(async () => {
      const stored = (await chrome.storage.local.get("snippets")).snippets as
        Record<string, unknown> | undefined;
      await chrome.storage.local.set({
        snippets: {
          ...stored,
          rich: {
            id: "rich",
            trigger: ";rich",
            label: "Rich signature",
            body: '<p>Welcome {cursor}<strong>friend</strong>. Visit <a href="https://example.com" target="_blank" onclick="alert(1)">our site</a>.</p><script>alert(2)</script>',
            format: "html",
            createdAt: 0,
            updatedAt: 0,
          },
        },
      });
    });
    await page.goto(`${fixtureBase}/plain-contenteditable.html`);
    const target = page.locator("#target");
    await target.fill(";rich");
    await target.press("Space");

    await expect(target).toContainText("Welcome friend. Visit our site. ");
    await expect(target.locator("strong")).toHaveText("friend");
    await expect(target.locator("a")).toHaveAttribute(
      "href",
      "https://example.com/",
    );
    await expect(target.locator("a")).not.toHaveAttribute("target");
    await expect(target.locator("script")).toHaveCount(0);
    const textBeforeCaret = await target.evaluate((element) => {
      const selection = element.ownerDocument.getSelection()!;
      const before = element.ownerDocument.createRange();
      before.selectNodeContents(element);
      before.setEnd(selection.anchorNode!, selection.anchorOffset);
      return before.toString();
    });
    expect(textBeforeCaret).toBe("Welcome ");
  });
});

test("rich snippet paste is accepted by a ProseMirror editor", async () => {
  await withExtension(async (context, page) => {
    await context.serviceWorkers()[0].evaluate(async () => {
      const stored = (await chrome.storage.local.get("snippets")).snippets as
        Record<string, unknown> | undefined;
      await chrome.storage.local.set({
        snippets: {
          ...stored,
          rich: {
            id: "rich",
            trigger: ";rich",
            label: "Rich greeting",
            body: "<p>Welcome <strong>friend</strong>.</p>",
            format: "html",
            createdAt: 0,
            updatedAt: 0,
          },
        },
      });
    });
    await page.goto(`${fixtureBase}/prosemirror-contenteditable.html`);
    const target = page.locator(".ProseMirror");
    await target.fill(";rich");
    await target.press("Space");

    await expect(target).toContainText("Welcome friend. ");
    await expect(target.locator("strong")).toHaveText("friend");
  });
});

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
  const profile = await mkdtemp(join(tmpdir(), "vkeysnip-e2e-"));
  const context = await chromium.launchPersistentContext(profile, {
    headless: false,
    channel: "chromium",
    args: [
      `--disable-extensions-except=${extensionPath}`,
      `--load-extension=${extensionPath}`,
    ],
  });
  const serviceWorker =
    context.serviceWorkers()[0] ??
    (await context.waitForEvent("serviceworker", { timeout: 10_000 }));
  await expect
    .poll(() =>
      serviceWorker.evaluate(async () => {
        const { schemaVersion } =
          await chrome.storage.local.get("schemaVersion");
        return schemaVersion;
      }),
    )
    .toBe(1);
  await serviceWorker.evaluate(async () => {
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

async function openDashboard(context: BrowserContext): Promise<Page> {
  const worker = context.serviceWorkers()[0];
  const extensionId = new URL(worker.url()).hostname;
  const dashboard = await context.newPage();
  await dashboard.goto(
    `chrome-extension://${extensionId}/src/dashboard/index.html`,
  );
  return dashboard;
}

async function openPopup(context: BrowserContext): Promise<Page> {
  const worker = context.serviceWorkers()[0];
  const extensionId = new URL(worker.url()).hostname;
  const popup = await context.newPage();
  await popup.goto(`chrome-extension://${extensionId}/src/popup/index.html`);
  return popup;
}

async function addTestSnippet(
  context: BrowserContext,
  snippet: {
    id: string;
    trigger: string;
    label: string;
    body: string;
    format: "text";
    createdAt: number;
    updatedAt: number;
  },
): Promise<void> {
  await context.serviceWorkers()[0].evaluate(async (item) => {
    const snippets = (await chrome.storage.local.get("snippets")).snippets as
      Record<string, typeof item> | undefined;
    await chrome.storage.local.set({
      snippets: Object.assign({}, snippets, { [item.id]: item }),
    });
  }, snippet);
}

async function expandInPage(target: Locator) {
  await target.page().waitForTimeout(50);
  await target.evaluate((element) => {
    const frameWindow = (element as HTMLInputElement | HTMLTextAreaElement)
      .ownerDocument.defaultView!;
    const observed = frameWindow as typeof window & {
      __expansionStarted?: number;
      __expansionMs?: number;
    };
    frameWindow.addEventListener(
      "beforeinput",
      (event) => {
        if ((event as InputEvent).data === " ") {
          observed.__expansionStarted = performance.now();
        }
      },
      true,
    );
    frameWindow.addEventListener(
      "input",
      (event) => {
        const field = event.target as HTMLInputElement | HTMLTextAreaElement;
        if (
          field.value === "Regards " &&
          observed.__expansionStarted !== undefined
        ) {
          observed.__expansionMs =
            performance.now() - observed.__expansionStarted;
        }
      },
      true,
    );
  });
  await target.fill(";sig");
  await target.press("Space");
  await expect(target).toHaveValue("Regards ");
  const caret = await target.evaluate((element) => {
    const field = element as HTMLInputElement | HTMLTextAreaElement;
    return field.selectionStart;
  });
  expect(caret).toBe("Regards ".length);
  const elapsed = await target.evaluate((element) => {
    const frameWindow = (element as HTMLInputElement | HTMLTextAreaElement)
      .ownerDocument.defaultView!;
    return (frameWindow as typeof window & { __expansionMs?: number })
      .__expansionMs;
  });
  expect(elapsed).toBeDefined();
  expect(elapsed).toBeLessThan(100);
}

async function withExtension(
  run: (context: BrowserContext, page: Page) => Promise<void>,
): Promise<void> {
  const { context, profile } = await launchExtensionContext();
  try {
    const page = await context.newPage();
    await run(context, page);
  } finally {
    await context.close();
    await rm(profile, { recursive: true, force: true });
  }
}

test("expands a plain input under 100 ms", async () => {
  await withExtension(async (_context, page) => {
    await page.goto(`${fixtureBase}/plain-input.html`);
    await expandInPage(page.locator("#target"));
  });
});

test("expands a textarea under 100 ms", async () => {
  await withExtension(async (_context, page) => {
    await page.goto(`${fixtureBase}/textarea.html`);
    await expandInPage(page.locator("#target"));
  });
});

test("expands a React controlled input under 100 ms", async () => {
  await withExtension(async (_context, page) => {
    await page.goto(`${fixtureBase}/react-input.html`);
    await page.locator("#target").waitFor();
    await expandInPage(page.locator("#target"));
  });
});

test("expands an input inside an iframe under 100 ms", async () => {
  await withExtension(async (_context, page) => {
    await page.goto(`${fixtureBase}/iframe-input.html`);
    const frame = page.frameLocator("#target-frame");
    await expandInPage(frame.locator("#target"));
  });
});

test("keeps expansion within performance budgets with 10,000 snippets", async () => {
  await withExtension(async (context, page) => {
    const snippets = Object.fromEntries(
      Array.from({ length: 10_000 }, (_, i) => {
        const id = `perf-${i}`;
        return [
          id,
          {
            id,
            trigger: `;trigger-${i}`,
            label: id,
            body: "Expanded",
            format: "text" as const,
            createdAt: 0,
            updatedAt: 0,
          },
        ];
      }),
    );
    await context.serviceWorkers()[0].evaluate(async (library) => {
      await chrome.storage.local.set({ snippets: library });
    }, snippets);
    await page.goto(`${fixtureBase}/plain-input.html`);
    const target = page.locator("#target");
    await target.evaluate((element) => {
      const frameWindow = (element as HTMLInputElement).ownerDocument
        .defaultView! as typeof window & {
        __expansionStart?: number;
        __expansionMs?: number;
      };
      frameWindow.addEventListener(
        "beforeinput",
        (event) => {
          if ((event as InputEvent).data === " ") {
            frameWindow.__expansionStart = performance.now();
          }
        },
        true,
      );
      frameWindow.addEventListener(
        "input",
        (event) => {
          const field = event.target as HTMLInputElement;
          if (
            field.value === "Expanded " &&
            frameWindow.__expansionStart !== undefined
          ) {
            frameWindow.__expansionMs =
              performance.now() - frameWindow.__expansionStart;
          }
        },
        true,
      );
    });
    await target.fill(";trigger-9876");
    await target.press("Space");
    await expect(target).toHaveValue("Expanded ");
    const caret = await target.evaluate(
      (element) => (element as HTMLInputElement).selectionStart,
    );
    expect(caret).toBe("Expanded ".length);
    const expansionMs = await page.evaluate(
      () =>
        (window as typeof window & { __expansionMs?: number }).__expansionMs,
    );
    expect(expansionMs).toBeDefined();
    expect(expansionMs).toBeLessThan(100);
    console.info(
      `10,000-snippet end-to-end expansion: ${expansionMs?.toFixed(3)} ms`,
    );
  });
});

test("keeps the content script idle heap under 20 MB with 1,000 snippets", async () => {
  await withExtension(async (context, page) => {
    const snippets = Object.fromEntries(
      Array.from({ length: 1_000 }, (_, i) => {
        const id = `memory-${i}`;
        return [
          id,
          {
            id,
            trigger: `;memory-${i}`,
            label: id,
            body: "A short local snippet used for memory measurement.",
            format: "text" as const,
            createdAt: 0,
            updatedAt: 0,
          },
        ];
      }),
    );
    await context.serviceWorkers()[0].evaluate(async (library) => {
      await chrome.storage.local.set({ snippets: library });
    }, snippets);
    await page.goto(`${fixtureBase}/plain-input.html`);
    await page.waitForTimeout(100);

    const session = await context.newCDPSession(page);
    await session.send("Performance.enable");
    const { metrics } = await session.send("Performance.getMetrics");
    const heapBytes = metrics.find(
      (metric: { name: string }) => metric.name === "JSHeapUsedSize",
    )?.value as number | undefined;
    expect(heapBytes).toBeDefined();
    expect(heapBytes).toBeLessThan(20 * 1024 * 1024);
    console.info(
      `1,000-snippet idle JS heap: ${(heapBytes! / 1024 / 1024).toFixed(2)} MB`,
    );
    await session.detach();
  });
});

test("dashboard trigger settings change the suggested prefix and live expansion mode", async () => {
  await withExtension(async (context, page) => {
    const dashboard = await openDashboard(context);
    await dashboard.locator('[name="triggerPrefix"]').fill("!");
    await dashboard.locator('[name="mode"]').selectOption("immediate");
    await dashboard.getByRole("button", { name: "Save settings" }).click();
    await expect(dashboard.getByRole("status")).toContainText("settings saved");

    await dashboard.getByRole("button", { name: /New snippet/ }).click();
    await expect(dashboard.locator('[name="trigger"]')).toHaveValue("!");
    await dashboard.getByRole("button", { name: "Cancel" }).click();

    const worker = context.serviceWorkers()[0];
    await worker.evaluate(async () => {
      const snippets = (await chrome.storage.local.get("snippets")).snippets as
        Record<string, { trigger: string; [key: string]: unknown }> | undefined;
      await chrome.storage.local.set({
        snippets: {
          ...snippets,
          signature: { ...snippets?.signature, trigger: "!sig" },
        },
      });
    });
    await page.goto(`${fixtureBase}/plain-input.html`);
    const target = page.locator("#target");
    await target.waitFor();
    await target.pressSequentially("!sig");
    await expect(target).toHaveValue("Regards");
  });
});

test("first-run onboarding adds three usable sample snippets", async () => {
  await withExtension(async (context, page) => {
    const worker = context.serviceWorkers()[0];
    await worker.evaluate(async () =>
      chrome.storage.local.set({ snippets: {} }),
    );
    const dashboard = await openDashboard(context);
    await expect(
      dashboard.getByRole("heading", { name: "Welcome to VKeysnip" }),
    ).toBeVisible();
    await dashboard
      .getByRole("button", { name: "Add 3 sample snippets" })
      .click();
    await expect(dashboard.locator(".snippet-card")).toHaveCount(3);

    await page.goto(`${fixtureBase}/textarea.html`);
    const target = page.locator("#target");
    await target.fill(";sig");
    await target.press("Space");
    await expect(target).toHaveValue("Best,\nYour Name ");
  });
});

test("canceling a user prompt leaves the typed trigger and delimiter intact", async () => {
  await withExtension(async (context, page) => {
    await addTestSnippet(context, {
      id: "prompt",
      trigger: ";ask",
      label: "Prompt",
      body: "Hello {name}",
      format: "text",
      createdAt: 0,
      updatedAt: 0,
    });
    await page.goto(`${fixtureBase}/textarea.html`);
    const target = page.locator("#target");
    await target.fill(";ask");
    await target.press("Space");
    await expect(page.locator('[data-vkeysnip-prompt="true"]')).toHaveCount(1);
    await page.keyboard.press("Tab");
    await page.keyboard.press("Enter");
    await expect(page.locator('[data-vkeysnip-prompt="true"]')).toHaveCount(0);
    await expect(target).toHaveValue(";ask ");
    await expect
      .poll(() =>
        target.evaluate(
          (element) => (element as HTMLTextAreaElement).selectionStart,
        ),
      )
      .toBe(5);
  });
});

test("user prompts preserve multiline values and place the caret marker", async () => {
  await withExtension(async (context, page) => {
    await addTestSnippet(context, {
      id: "prompt",
      trigger: ";ask",
      label: "Prompt",
      body: "Hello {name}{cursor}!\nRegards",
      format: "text",
      createdAt: 0,
      updatedAt: 0,
    });
    await page.goto(`${fixtureBase}/textarea.html`);
    const target = page.locator("#target");
    await target.fill(";ask");
    await target.press("Space");
    await expect(page.locator('[data-vkeysnip-prompt="true"]')).toHaveCount(1);
    await page.keyboard.insertText("Ada\nLovelace");
    await page.keyboard.press("Tab");
    await page.keyboard.press("Tab");
    await page.keyboard.press("Enter");
    await expect(page.locator('[data-vkeysnip-prompt="true"]')).toHaveCount(0);
    const expected = "Hello Ada\nLovelace!\nRegards ";
    await expect(target).toHaveValue(expected);
    await expect
      .poll(() =>
        target.evaluate(
          (element) => (element as HTMLTextAreaElement).selectionStart,
        ),
      )
      .toBe("Hello Ada\nLovelace".length);
  });
});

test("dynamic forms expand dropdown, checkbox, conditional, and date-math fields", async () => {
  await withExtension(async (context, page) => {
    await addTestSnippet(context, {
      id: "dynamic-form",
      trigger: ";form",
      label: "Dynamic form",
      body: "{dropdown:status|New|Done} {checkbox:approved}{if:approved} yes{/if} {date+1d}",
      format: "text",
      createdAt: 0,
      updatedAt: 0,
    });
    await page.goto(`${fixtureBase}/textarea.html`);
    const target = page.locator("#target");
    await target.fill(";form");
    await target.press("Space");
    await expect(page.locator('[data-vkeysnip-prompt="true"]')).toHaveCount(1);
    await page.keyboard.press("ArrowDown");
    await page.keyboard.press("Tab");
    await page.keyboard.press("Space");
    await page.keyboard.press("Tab");
    await page.keyboard.press("Tab");
    await page.keyboard.press("Enter");
    const expectedDate = await page.evaluate(() => {
      const date = new Date();
      date.setDate(date.getDate() + 1);
      return [
        date.getFullYear(),
        `${date.getMonth() + 1}`.padStart(2, "0"),
        `${date.getDate()}`.padStart(2, "0"),
      ].join("-");
    });
    await expect(target).toHaveValue(`Done Yes yes ${expectedDate} `);
  });
});

test("dashboard reports invalid dynamic field syntax before saving", async () => {
  await withExtension(async (context) => {
    const dashboard = await openDashboard(context);
    await dashboard.getByRole("button", { name: /New snippet/ }).click();
    await dashboard.getByLabel("Trigger", { exact: true }).fill(";bad");
    await dashboard
      .getByLabel("Label", { exact: true })
      .fill("Invalid template");
    const body = dashboard.getByLabel("Snippet text");
    await body.fill("{if:approved}missing close");
    await expect(dashboard.getByRole("alert")).toContainText(
      "missing a closing",
    );
    await dashboard.getByRole("button", { name: "Save snippet" }).click();
    await expect(dashboard.getByRole("dialog")).toBeVisible();
    await body.fill("{dropdown:status|New|Done}");
    await expect(dashboard.getByRole("alert")).toHaveCount(0);
    await dashboard.getByRole("button", { name: "Save snippet" }).click();
    await expect(dashboard.getByRole("dialog")).toHaveCount(0);
  });
});

test("clipboard placeholder reads only after explicit insert confirmation", async () => {
  await withExtension(async (context, page) => {
    await context.grantPermissions(["clipboard-read", "clipboard-write"], {
      origin: fixtureBase,
    });
    await addTestSnippet(context, {
      id: "clipboard",
      trigger: ";clip",
      label: "Clipboard",
      body: "Before\n{clipboard}{cursor}After",
      format: "text",
      createdAt: 0,
      updatedAt: 0,
    });
    await page.goto(`${fixtureBase}/textarea.html`);
    const target = page.locator("#target");
    await target.fill(";clip");
    await target.press("Space");
    await expect(page.locator('[data-vkeysnip-prompt="true"]')).toHaveCount(1);
    await page.evaluate(() =>
      navigator.clipboard.writeText("line one\nline two"),
    );
    await expect
      .poll(() =>
        page.evaluate(async () =>
          (await navigator.clipboard.readText()).replace(/\r\n?/g, "\n"),
        ),
      )
      .toBe("line one\nline two");
    await page.keyboard.press("Enter");
    await expect(page.locator('[data-vkeysnip-prompt="true"]')).toHaveCount(0);
    const expected = "Before\nline one\nline twoAfter ";
    await expect(target).toHaveValue(expected);
    await expect
      .poll(() =>
        target.evaluate(
          (element) => (element as HTMLTextAreaElement).selectionStart,
        ),
      )
      .toBe("Before\nline one\nline two".length);
  });
});

test("quick-insert message replaces the current selection at the caret", async () => {
  await withExtension(async (context, page) => {
    await page.goto(`${fixtureBase}/plain-input.html`);
    const target = page.locator("#target");
    await target.fill("before after");
    await target.evaluate((element) =>
      (element as HTMLInputElement).setSelectionRange(6, 6),
    );
    const response = await context.serviceWorkers()[0].evaluate(async () => {
      const [tab] = await chrome.tabs.query({
        active: true,
        currentWindow: true,
      });
      if (tab?.id === undefined) return undefined;
      return chrome.tabs.sendMessage(tab.id, {
        type: "vkeysnip:insert-snippet",
        snippetId: "signature",
      });
    });
    expect(response).toMatchObject({ ok: true });
    await expect(target).toHaveValue("beforeRegards after");
  });
});

test("popup quick search filters snippets by label and trigger", async () => {
  await withExtension(async (context) => {
    await addTestSnippet(context, {
      id: "meeting-notes",
      trigger: ";meet",
      label: "Meeting notes",
      body: "Follow up on action items",
      format: "text",
      createdAt: 1,
      updatedAt: 1,
    });
    const popup = await openPopup(context);
    const search = popup.getByRole("textbox", { name: "Search snippets" });
    await expect(popup.getByRole("button", { name: /Signature/ })).toHaveCount(
      1,
    );
    await search.fill("meeting");
    await expect(
      popup.getByRole("button", { name: /Meeting notes/ }),
    ).toHaveCount(1);
    await expect(popup.getByRole("button", { name: /Signature/ })).toHaveCount(
      0,
    );
    await search.fill(";sig");
    await expect(popup.getByRole("button", { name: /Signature/ })).toHaveCount(
      1,
    );
    await popup.close();
  });
});

test("dashboard rich editor saves formatted and sanitized HTML", async () => {
  await withExtension(async (context) => {
    const dashboard = await openDashboard(context);
    await dashboard.getByRole("button", { name: /New snippet/ }).click();
    await dashboard.getByLabel("Label", { exact: true }).fill("Rich greeting");
    await dashboard.getByLabel("Trigger", { exact: true }).fill(";rich");
    await dashboard.getByLabel("Snippet format").selectOption("html");

    const editor = dashboard.getByRole("textbox", {
      name: "Rich text snippet",
    });
    await editor.fill("Hello friend");
    await expect(editor).toHaveText("Hello friend");
    const selectedText = await editor.evaluate((element) => {
      element.focus();
      const selection = element.ownerDocument.getSelection()!;
      const range = element.ownerDocument.createRange();
      range.selectNodeContents(element);
      selection.removeAllRanges();
      selection.addRange(range);
      element.dispatchEvent(new MouseEvent("mouseup", { bubbles: true }));
      return selection.toString();
    });
    expect(selectedText).toBe("Hello friend");
    await dashboard.getByRole("button", { name: "Bold" }).click();
    await expect(editor.locator("strong")).toHaveText("Hello friend");
    await dashboard.getByLabel("Link URL").fill("https://example.com");
    await dashboard.getByRole("button", { name: "Add link" }).click();
    await expect(editor.locator("a")).toHaveAttribute(
      "href",
      "https://example.com/",
    );
    await editor.evaluate((element) => {
      element.insertAdjacentHTML(
        "beforeend",
        '<script>alert(1)</script><img src="x" onerror="alert(2)">',
      );
    });
    await dashboard.getByRole("button", { name: "Save snippet" }).click();
    await expect(dashboard.getByRole("status")).toContainText("Snippet saved");

    const savedBody = await context.serviceWorkers()[0].evaluate(async () => {
      const snippets = (await chrome.storage.local.get("snippets"))
        .snippets as Record<string, { body: string; format: string }>;
      const rich = Object.values(snippets).find(
        (item) => item.format === "html",
      );
      return rich?.body;
    });
    expect(savedBody).toContain("<strong>");
    expect(savedBody).toContain('<a href="https://example.com/"');
    expect(savedBody).not.toMatch(/script|onerror|<img/i);
  });
});

import { describe, expect, it } from "vitest";
import {
  buildTriggerIndex,
  findLongestTriggerSuffix,
} from "../../src/shared/trigger-index";
import { findExpansionMatch } from "../../src/content/matcher";
import type { Snippet } from "../../src/shared/schema";

const snippet = (id: string, trigger: string): Snippet => ({
  id,
  trigger,
  label: id,
  body: id,
  format: "text",
  createdAt: 0,
  updatedAt: 0,
});

describe("trigger index", () => {
  it("matches the longest trigger suffix", () => {
    const short = snippet("short", ";a");
    const long = snippet("long", ";abc");
    const index = buildTriggerIndex({ short, long }, true);
    expect(findLongestTriggerSuffix("hello;abc", index, true)).toBe(long);
  });

  it("matches case-insensitively when configured", () => {
    const entry = snippet("sig", ";Sig");
    const index = buildTriggerIndex({ entry }, false);
    expect(findLongestTriggerSuffix(";SIG", index, false)).toBe(entry);
  });

  it("does not match text that does not end in a trigger", () => {
    const index = buildTriggerIndex({ item: snippet("item", ";x") }, true);
    expect(findLongestTriggerSuffix(";x ", index, true)).toBeUndefined();
  });

  it("finds a match in a 10,000-trigger library", () => {
    const snippets = Object.fromEntries(
      Array.from({ length: 10_000 }, (_, i) => {
        const item = snippet(`item-${i}`, `;trigger-${i}`);
        return [item.id, item];
      }),
    );
    const index = buildTriggerIndex(snippets, false);

    expect(findLongestTriggerSuffix("hello;TRIGGER-9876", index, false)).toBe(
      snippets["item-9876"],
    );
  });

  it("matches a trigger in under 2 ms with a 10,000-snippet library", () => {
    const snippets = Object.fromEntries(
      Array.from({ length: 10_000 }, (_, i) => {
        const item = snippet(`item-${i}`, `;trigger-${i}`);
        return [item.id, item];
      }),
    );
    const index = buildTriggerIndex(snippets, false);
    const input = {
      value: ";trigger-9876",
      selectionStart: 13,
      selectionEnd: 13,
      inputType: "insertText",
      data: " ",
      phase: "beforeinput" as const,
      settings: { mode: "delimiter" as const, caseSensitive: false },
      index,
    };
    for (let i = 0; i < 20; i += 1) findExpansionMatch(input);

    const start = performance.now();
    for (let i = 0; i < 1_000; i += 1) findExpansionMatch(input);
    const averageMilliseconds = (performance.now() - start) / 1_000;

    expect(findExpansionMatch(input)?.snippet).toBe(snippets["item-9876"]);
    expect(averageMilliseconds).toBeLessThan(2);
  });
});

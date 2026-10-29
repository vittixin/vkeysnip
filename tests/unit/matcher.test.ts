import { describe, expect, it } from "vitest";
import { findExpansionMatch } from "../../src/content/matcher";
import { buildTriggerIndex } from "../../src/shared/trigger-index";
import type { Settings, Snippet } from "../../src/shared/schema";

const short: Snippet = {
  id: "short",
  trigger: ";sig",
  label: "Signature",
  body: "Regards",
  format: "text",
  createdAt: 0,
  updatedAt: 0,
};
const settings: Settings = {
  triggerPrefix: ";",
  mode: "delimiter",
  caseSensitive: false,
  theme: "system",
};
const index = buildTriggerIndex({ [short.id]: short }, false);

describe("findExpansionMatch", () => {
  it("matches the suffix before a delimiter in beforeinput", () => {
    expect(
      findExpansionMatch({
        value: "hello ;sig",
        selectionStart: 10,
        selectionEnd: 10,
        inputType: "insertText",
        data: " ",
        phase: "beforeinput",
        settings,
        index,
      }),
    ).toMatchObject({
      start: 6,
      end: 10,
      typedTrigger: ";sig",
      delimiter: " ",
      delimiterInValue: false,
    });
  });

  it("matches an already inserted delimiter in input and preserves it", () => {
    expect(
      findExpansionMatch({
        value: "hello ;sig ",
        selectionStart: 11,
        selectionEnd: 11,
        inputType: "insertText",
        data: " ",
        phase: "input",
        settings,
        index,
      }),
    ).toMatchObject({
      start: 6,
      end: 10,
      delimiter: " ",
      delimiterInValue: true,
    });
  });

  it("matches immediately as the final trigger character is typed", () => {
    const immediate = { ...settings, mode: "immediate" as const };
    expect(
      findExpansionMatch({
        value: "hello ;si",
        selectionStart: 9,
        selectionEnd: 9,
        inputType: "insertText",
        data: "g",
        phase: "beforeinput",
        settings: immediate,
        index,
      }),
    ).toMatchObject({ start: 6, end: 10, typedTrigger: ";sig", delimiter: "" });
  });

  it("matches the longest suffix after input and ignores selections", () => {
    const long: Snippet = { ...short, id: "long", trigger: "x;sig" };
    const triggerIndex = buildTriggerIndex({ short, long }, false);
    const input = {
      value: "x;sig",
      selectionStart: 5,
      selectionEnd: 5,
      inputType: "insertText",
      data: "g",
      phase: "input" as const,
      settings: { ...settings, mode: "immediate" as const },
      index: triggerIndex,
    };
    expect(findExpansionMatch(input)?.snippet.id).toBe("long");
    expect(findExpansionMatch({ ...input, selectionStart: 4 })).toBeUndefined();
  });

  it("rejects a trigger embedded in a word", () => {
    const immediate = { ...settings, mode: "immediate" as const };
    expect(
      findExpansionMatch({
        value: "word;sig",
        selectionStart: 8,
        selectionEnd: 8,
        inputType: "insertText",
        data: "g",
        phase: "input",
        settings: immediate,
        index,
      }),
    ).toBeUndefined();
  });
});

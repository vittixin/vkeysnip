// @vitest-environment jsdom
import { describe, expect, it } from "vitest";
import {
  rangeForSuffix,
  readTextBeforeCaret,
} from "../../src/content/editable-dom";
import { findContentEditableMatch } from "../../src/content/matcher";
import { buildTriggerIndex } from "../../src/shared/trigger-index";
import type { Settings, Snippet } from "../../src/shared/schema";

const snippet: Snippet = {
  id: "signature",
  trigger: ";sig",
  label: "Signature",
  body: "Regards",
  format: "text",
  createdAt: 0,
  updatedAt: 0,
};
const settings: Settings = {
  triggerPrefix: ";",
  mode: "immediate",
  caseSensitive: false,
  theme: "system",
};
const index = buildTriggerIndex({ [snippet.id]: snippet }, false);

function setCaret(node: Node, offset: number): void {
  const selection = document.getSelection();
  const range = document.createRange();
  range.setStart(node, offset);
  range.collapse(true);
  selection?.removeAllRanges();
  selection?.addRange(range);
}

describe("contenteditable caret text reader", () => {
  it("reads and selects a trigger across nested inline elements", () => {
    const root = document.createElement("div");
    root.setAttribute("contenteditable", "true");
    root.innerHTML =
      "<span>Before </span><b><span>;si</span><span>g</span></b>";
    document.body.append(root);
    const finalText = root.querySelectorAll("span")[2].firstChild!;
    setCaret(finalText, 1);

    const reading = readTextBeforeCaret(root);
    expect(reading?.text).toBe("Before ;sig");
    const triggerRange = reading && rangeForSuffix(reading, 4);
    expect(triggerRange?.toString()).toBe(";sig");
  });

  it("treats br as a line break before the caret", () => {
    const root = document.createElement("div");
    root.setAttribute("contenteditable", "true");
    root.innerHTML = "first<br>;sig";
    document.body.append(root);
    const finalText = root.lastChild!;
    setCaret(finalText, 4);

    const reading = readTextBeforeCaret(root);
    expect(reading?.text).toBe("first\n;sig");
    expect(reading && rangeForSuffix(reading, 4)?.toString()).toBe(";sig");
  });

  it("limits reading to the caret's current block", () => {
    const root = document.createElement("div");
    root.setAttribute("contenteditable", "true");
    root.innerHTML = "<p>earlier block</p><p>;sig</p>";
    document.body.append(root);
    const finalText = root.querySelectorAll("p")[1].firstChild!;
    setCaret(finalText, 4);

    expect(readTextBeforeCaret(root)?.text).toBe(";sig");
  });

  it("enforces a word boundary before the trigger", () => {
    const root = document.createElement("div");
    root.setAttribute("contenteditable", "true");
    root.textContent = "word;sig";
    document.body.append(root);
    setCaret(root.firstChild!, 8);
    const reading = readTextBeforeCaret(root)!;

    expect(
      findContentEditableMatch(reading, {
        inputType: "insertText",
        data: "g",
        phase: "input",
        settings,
        index,
      }),
    ).toBeUndefined();

    root.textContent = "(;sig";
    setCaret(root.firstChild!, 5);
    const punctuationReading = readTextBeforeCaret(root)!;
    const match = findContentEditableMatch(punctuationReading, {
      inputType: "insertText",
      data: "g",
      phase: "input",
      settings,
      index,
    });
    expect(match?.range.toString()).toBe(";sig");
  });
});

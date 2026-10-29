import {
  DEFAULT_EXCLUSIONS,
  DEFAULT_SETTINGS,
  type Settings,
  type Snippet,
} from "../shared/schema";
import {
  expandTemplate,
  getTemplateFields,
  getTemplateSyntaxErrors,
  type ExpandedTemplate,
} from "../shared/expand-template";
import { isSiteExcluded } from "../shared/exclusions";
import { buildTriggerIndex, type TriggerIndex } from "../shared/trigger-index";
import {
  getEditableSelection,
  getCaretSignature,
  getEditableSnapshot,
  hasSensitiveEditableAncestor,
  readTextBeforeCaret,
  resolveContentEditableRoot,
  type EditableRoot,
} from "./editable-dom";
import { shouldIgnoreField } from "./guards";
import {
  findContentEditableMatch,
  findExpansionMatch,
  type ContentEditableMatch,
  type ExpansionMatch,
} from "./matcher";
import { ExpansionUndoState } from "./undo-state";
import { requestFillInValues } from "./fill-in-prompt";
import {
  htmlToPlainText,
  plainTextToHtml,
  sanitizeHtml,
} from "../shared/sanitize-html";

type TextField = HTMLInputElement | HTMLTextAreaElement;
type ActiveEditable =
  | { kind: "field"; element: TextField }
  | { kind: "contenteditable"; element: EditableRoot };
type ResolvedSnippet = ExpandedTemplate & {
  html?: string;
  hasCursor?: boolean;
};

let triggerIndex: TriggerIndex = new Map();
let settings: Settings = DEFAULT_SETTINGS;
let exclusions = DEFAULT_EXCLUSIONS;
let snippetsById: Record<string, Snippet> = {};
let ready = false;
let internalMutation = false;
const undoState = new ExpansionUndoState();

async function loadIndex(): Promise<void> {
  const values = await chrome.storage.local.get([
    "snippets",
    "settings",
    "exclusions",
  ]);
  const snippets = (values.snippets ?? {}) as Record<string, Snippet>;
  snippetsById = snippets;
  settings = {
    ...DEFAULT_SETTINGS,
    ...(values.settings as Partial<Settings> | undefined),
  };
  exclusions =
    (values.exclusions as string[] | undefined) ?? DEFAULT_EXCLUSIONS;
  triggerIndex = buildTriggerIndex(snippets, settings.caseSensitive);
  ready = true;
}

void loadIndex();

chrome.storage.onChanged.addListener((changes, areaName) => {
  if (
    areaName !== "local" ||
    (!changes.snippets && !changes.settings && !changes.exclusions)
  ) {
    return;
  }
  if (changes.exclusions && !changes.snippets && !changes.settings) {
    exclusions = (changes.exclusions.newValue as string[] | undefined) ?? [];
    return;
  }
  ready = false;
  void loadIndex();
});

function resolveActiveEditable(event: Event): ActiveEditable | null {
  const path =
    typeof event.composedPath === "function" ? event.composedPath() : [];
  for (const node of path.length > 0 ? path : [event.target as EventTarget]) {
    if (
      node instanceof HTMLInputElement ||
      node instanceof HTMLTextAreaElement
    ) {
      return { kind: "field", element: node };
    }
  }
  const contenteditable = resolveContentEditableRoot(event);
  return contenteditable
    ? { kind: "contenteditable", element: contenteditable }
    : null;
}

function findEditableFromElement(
  element: Element | null,
): ActiveEditable | null {
  if (!element) return null;
  if (
    element instanceof HTMLInputElement ||
    element instanceof HTMLTextAreaElement
  ) {
    return { kind: "field", element };
  }
  if (element instanceof HTMLIFrameElement) {
    try {
      const nested = element.contentDocument?.activeElement ?? null;
      const found = findEditableFromElement(nested);
      if (found) return found;
    } catch {
      // The content script running inside a cross-origin frame resolves its own focus.
    }
  }
  if (element instanceof HTMLElement && element.shadowRoot?.activeElement) {
    const found = findEditableFromElement(element.shadowRoot.activeElement);
    if (found) return found;
  }

  let current: Element | null = element;
  while (current) {
    if (current.hasAttribute("contenteditable")) {
      const value = current
        .getAttribute("contenteditable")
        ?.trim()
        .toLowerCase();
      if (value === "false") return null;
      if (value === "" || value === "true" || value === "plaintext-only") {
        return { kind: "contenteditable", element: current as EditableRoot };
      }
    }
    const parent: Element | null = current.parentElement;
    if (parent) current = parent;
    else {
      const treeRoot = current.getRootNode();
      current = treeRoot instanceof ShadowRoot ? treeRoot.host : null;
    }
  }
  return null;
}

function getFocusedEditable(): ActiveEditable | null {
  return findEditableFromElement(document.activeElement);
}

function activeState(active: ActiveEditable): {
  value: string;
  caret: number | string | undefined;
} {
  if (active.kind === "field") {
    const selection = getFieldSelection(active.element);
    return {
      value: active.element.value,
      caret:
        selection && selection.start === selection.end
          ? selection.start
          : undefined,
    };
  }
  return {
    value: getEditableSnapshot(active.element),
    caret: getCaretSignature(active.element),
  };
}

function onBeforeInput(event: Event): void {
  if (internalMutation) return;
  const inputEvent = event as InputEvent;
  const active = resolveActiveEditable(event);
  if (active) {
    const isUndoInput =
      inputEvent.inputType === "deleteContentBackward" ||
      inputEvent.inputType === "historyUndo";
    let undo;
    if (isUndoInput) {
      const state = activeState(active);
      undo = undoState.takeIfMatches(
        active.element,
        inputEvent.inputType,
        state.value,
        state.caret,
      );
    } else {
      undoState.clear();
    }
    if (undo && event.cancelable) {
      event.preventDefault();
      undo.restore();
      return;
    }
  } else {
    undoState.clear();
  }

  if (
    !ready ||
    inputEvent.isComposing ||
    !active ||
    !isSafeEditable(active, event)
  ) {
    return;
  }

  const match =
    active.kind === "field"
      ? findFieldMatch(active.element, inputEvent, "beforeinput")
      : findContentEditableMatchForEvent(
          active.element,
          inputEvent,
          "beforeinput",
        );
  if (match && event.cancelable) {
    event.preventDefault();
    if (active.kind === "field") {
      const fieldMatch = match as ExpansionMatch;
      void expandField(active.element, fieldMatch, () =>
        restoreCanceledFieldInput(
          active.element,
          fieldMatch.delimiter || inputEvent.data || "",
        ),
      );
    } else {
      const editableMatch = match as ContentEditableMatch;
      void expandContentEditable(active.element, editableMatch, () =>
        restoreCanceledEditableInput(
          active.element,
          editableMatch,
          editableMatch.delimiter || inputEvent.data || "",
        ),
      );
    }
  }
}

function onInput(event: Event): void {
  if (internalMutation) return;
  undoState.clear();
  const inputEvent = event as InputEvent;
  const active = resolveActiveEditable(event);
  if (
    !ready ||
    inputEvent.isComposing ||
    !active ||
    !isSafeEditable(active, event)
  ) {
    return;
  }

  if (active.kind === "field") {
    const match = findFieldMatch(active.element, inputEvent, "input");
    if (match) void expandField(active.element, match);
  } else {
    const match = findContentEditableMatchForEvent(
      active.element,
      inputEvent,
      "input",
    );
    if (match) void expandContentEditable(active.element, match);
  }
}

function isSafeEditable(active: ActiveEditable, event: Event): boolean {
  if (isSiteExcluded(location.hostname, exclusions)) return false;
  return active.kind === "field"
    ? !shouldIgnoreField(active.element)
    : !hasSensitiveEditableAncestor(event, active.element);
}

function isSafeEditableTarget(active: ActiveEditable): boolean {
  if (isSiteExcluded(location.hostname, exclusions)) return false;
  if (active.kind === "field") return !shouldIgnoreField(active.element);
  let current: Node | null = active.element;
  while (current) {
    if (current instanceof Element) {
      const autocomplete = current.getAttribute("autocomplete") ?? "";
      if (
        autocomplete
          .toLowerCase()
          .split(/\s+/)
          .some((token) => token.startsWith("cc-")) ||
        current.getAttribute("aria-readonly")?.toLowerCase() === "true" ||
        current.hasAttribute("readonly") ||
        current.hasAttribute("disabled")
      ) {
        return false;
      }
    }
    if (current === active.element) {
      current = current.parentNode;
    } else if (current.parentNode) {
      current = current.parentNode;
    } else {
      const treeRoot = current.getRootNode();
      current = treeRoot instanceof ShadowRoot ? treeRoot.host : null;
    }
  }
  return true;
}

function findFieldMatch(
  field: TextField,
  inputEvent: InputEvent,
  phase: "beforeinput" | "input",
): ExpansionMatch | undefined {
  const selection = getFieldSelection(field);
  if (!selection) return undefined;
  return findExpansionMatch({
    value: field.value,
    selectionStart: selection.start,
    selectionEnd: selection.end,
    inputType: inputEvent.inputType,
    data: inputEvent.data,
    phase,
    settings,
    index: triggerIndex,
  });
}

function findContentEditableMatchForEvent(
  root: EditableRoot,
  inputEvent: InputEvent,
  phase: "beforeinput" | "input",
): ContentEditableMatch | undefined {
  const reading = readTextBeforeCaret(root);
  if (!reading) return undefined;
  return findContentEditableMatch(reading, {
    inputType: inputEvent.inputType,
    data: inputEvent.data,
    phase,
    settings,
    index: triggerIndex,
  });
}

async function expandField(
  field: TextField,
  match: ExpansionMatch,
  onCancel?: () => void,
): Promise<void> {
  const expanded = await resolveSnippet(match.snippet, field.ownerDocument);
  if (!expanded) {
    onCancel?.();
    return;
  }
  field.focus({ preventScroll: true });
  const oldValue = field.value;
  const delimiterToInsert = match.delimiterInValue ? "" : match.delimiter;
  const replacementText = `${expanded.text}${delimiterToInsert}`;
  const nextValue =
    oldValue.slice(0, match.start) +
    replacementText +
    oldValue.slice(match.end);
  const cursor =
    match.start +
    (expanded.cursorOffset ?? expanded.text.length + match.delimiter.length);
  if (
    !replaceFieldRange(field, match.start, match.end, replacementText, cursor)
  ) {
    void copyToClipboard(expanded.text).then((copied) =>
      showToast(
        copied
          ? "Snippet copied. Paste with Ctrl+V."
          : "Could not insert or copy the snippet. Open VKeysnip to copy it.",
      ),
    );
    return;
  }
  field.setSelectionRange(cursor, cursor);

  const originalText = `${match.typedTrigger}${match.delimiter}`;
  const replacedEnd =
    match.end + (match.delimiterInValue ? match.delimiter.length : 0);
  const restoredValue =
    oldValue.slice(0, match.start) + originalText + oldValue.slice(replacedEnd);
  setUndoRecord(field, nextValue, cursor, () =>
    setFieldValue(field, restoredValue, match.start + originalText.length),
  );
}

function replaceFieldRange(
  field: TextField,
  start: number,
  end: number,
  text: string,
  caret: number,
): boolean {
  const oldValue = field.value;
  const expectedValue = oldValue.slice(0, start) + text + oldValue.slice(end);
  internalMutation = true;
  try {
    field.focus({ preventScroll: true });
    field.setSelectionRange(start, end);
    let inserted = false;
    try {
      inserted = field.ownerDocument.execCommand("insertText", false, text);
    } catch {
      inserted = false;
    }

    if (!inserted || field.value !== expectedValue) {
      const prototype =
        field instanceof HTMLTextAreaElement
          ? HTMLTextAreaElement.prototype
          : HTMLInputElement.prototype;
      const setter = Object.getOwnPropertyDescriptor(prototype, "value")?.set;
      if (!setter) return false;
      setter.call(field, expectedValue);
      field.dispatchEvent(new Event("input", { bubbles: true }));
    }

    if (field.value !== expectedValue) return false;
    field.setSelectionRange(caret, caret);
    return true;
  } catch {
    return false;
  } finally {
    internalMutation = false;
  }
}

async function expandContentEditable(
  root: EditableRoot,
  match: ContentEditableMatch,
  onCancel?: () => void,
): Promise<void> {
  const expanded = await resolveSnippet(match.snippet, root.ownerDocument);
  if (!expanded) {
    onCancel?.();
    return;
  }
  root.focus({ preventScroll: true });
  const normalized = normalizeLineEndings(expanded.text, expanded.cursorOffset);
  const delimiterToInsert = match.delimiterInValue ? "" : match.delimiter;
  const insertionText = `${normalized.text}${delimiterToInsert}`;
  const cursorOffset =
    normalized.cursorOffset ?? normalized.text.length + match.delimiter.length;
  const originalText = `${match.typedTrigger}${match.delimiter}`;
  const before = getEditableSnapshot(root);
  const start = insertionStart(root, match.range);
  const htmlToInsert = expanded.html
    ? `${expanded.html}${plainTextToHtml(delimiterToInsert, root.ownerDocument)}`
    : undefined;
  const insertion = htmlToInsert
    ? pasteRichHtml(root, match.range, htmlToInsert, insertionText, start)
    : insertPlainText(root, match.range, insertionText, cursorOffset);

  let finalInsertion = insertion;
  if (!finalInsertion) {
    const afterCommands = getEditableSnapshot(root);
    const partialRange = rangeFromStartToSelection(root, start);
    const pasteRange =
      afterCommands === before ? match.range : (partialRange ?? match.range);
    const plainInsertion = insertPlainText(
      root,
      pasteRange,
      insertionText,
      cursorOffset,
    );
    const pastedRange =
      plainInsertion?.insertedRange ??
      pastePlainText(root, pasteRange, insertionText, start);
    if (!pastedRange) {
      if (afterCommands !== before && partialRange) {
        restoreRangeWithPlainText(root, partialRange, originalText);
      }
      void copyToClipboard(expanded.text).then((copied) =>
        showToast(
          copied
            ? "Snippet copied. Paste with Ctrl+V."
            : "Could not insert or copy the snippet. Open VKeysnip to copy it.",
        ),
      );
      return;
    }
    finalInsertion = plainInsertion ?? { insertedRange: pastedRange };
  }

  if (
    match.delimiterInValue &&
    normalized.cursorOffset === undefined &&
    !expanded.hasCursor
  ) {
    moveCaretForward(root, match.delimiter.length);
  }

  const expectedValue = getEditableSnapshot(root);
  const caret = getCaretSignature(root);
  const insertedRange = finalInsertion.insertedRange;
  if (!caret || !insertedRange) {
    return;
  }
  const rangeForUndo = insertedRange;
  const undoText = match.delimiterInValue ? match.typedTrigger : originalText;
  const restore = () =>
    restoreContentEditableRange(root, rangeForUndo, undoText);
  setUndoRecord(root, expectedValue, caret, restore);
}

function restoreCanceledEditableInput(
  root: EditableRoot,
  match: ContentEditableMatch,
  text: string,
): void {
  if (!text) return;
  root.focus({ preventScroll: true });
  const range = match.range.cloneRange();
  range.collapse(false);
  const inserted = insertPlainText(root, range, text, text.length);
  if (!inserted) restoreRangeWithPlainText(root, range, text);
}

async function insertSnippetAtCaret(
  active: ActiveEditable,
  snippet: Snippet,
): Promise<boolean> {
  if (!isSafeEditableTarget(active)) return false;
  const expanded = await resolveSnippet(snippet, active.element.ownerDocument);
  if (!expanded || !isSafeEditableTarget(active)) return false;

  if (active.kind === "field") {
    const field = active.element;
    field.focus({ preventScroll: true });
    const selection = getFieldSelection(field);
    if (!selection) return false;
    const oldValue = field.value;
    const nextValue =
      oldValue.slice(0, selection.start) +
      expanded.text +
      oldValue.slice(selection.end);
    const caret =
      selection.start + (expanded.cursorOffset ?? expanded.text.length);
    if (
      !replaceFieldRange(
        field,
        selection.start,
        selection.end,
        expanded.text,
        caret,
      )
    ) {
      const copied = await copyToClipboard(expanded.text);
      showToast(
        copied
          ? "Snippet copied. Paste with Ctrl+V."
          : "Could not insert or copy the snippet. Open VKeysnip to copy it.",
      );
      return false;
    }
    setUndoRecord(field, nextValue, caret, () =>
      setFieldValue(field, oldValue, selection.end),
    );
    showToast("Snippet inserted.");
    return true;
  }

  const root = active.element;
  root.focus({ preventScroll: true });
  const selection = getEditableSelection(root);
  if (!selection || selection.rangeCount === 0) return false;
  const replacementRange = selection.getRangeAt(0).cloneRange();
  const anchor = replacementRange.startContainer;
  if (anchor !== root && !root.contains(anchor)) return false;
  const before = getEditableSnapshot(root);
  const previousText = replacementRange.toString();
  const start = insertionStart(root, replacementRange);
  const normalized = normalizeLineEndings(expanded.text, expanded.cursorOffset);
  const insertionStartRange = insertionStart(root, replacementRange);
  const insertion = expanded.html
    ? pasteRichHtml(
        root,
        replacementRange,
        expanded.html,
        normalized.text,
        insertionStartRange,
      )
    : insertPlainText(
        root,
        replacementRange,
        normalized.text,
        normalized.cursorOffset ?? normalized.text.length,
      );
  let insertedRange = insertion?.insertedRange;
  if (!insertedRange) {
    const afterCommands = getEditableSnapshot(root);
    const partialRange = rangeFromStartToSelection(root, start);
    const pasteRange =
      afterCommands === before
        ? replacementRange
        : (partialRange ?? replacementRange);
    insertedRange = pastePlainText(root, pasteRange, normalized.text, start);
    if (!insertedRange) {
      const copied = await copyToClipboard(expanded.text);
      showToast(
        copied
          ? "Snippet copied. Paste with Ctrl+V."
          : "Could not insert or copy the snippet. Open VKeysnip to copy it.",
      );
      return false;
    }
  }
  const expectedValue = getEditableSnapshot(root);
  const caret = getCaretSignature(root);
  if (caret) {
    setUndoRecord(root, expectedValue, caret, () =>
      restoreContentEditableRange(root, insertedRange!, previousText),
    );
  }
  showToast("Snippet inserted.");
  return true;
}

function insertPlainText(
  root: EditableRoot,
  replacementRange: Range,
  text: string,
  cursorOffset: number,
): { insertedRange: Range } | undefined {
  const document = root.ownerDocument;
  const selection = getEditableSelection(root);
  if (!selection) return undefined;
  const before = getEditableSnapshot(root);
  const start = document.createRange();
  start.setStart(replacementRange.startContainer, replacementRange.startOffset);
  start.collapse(true);
  internalMutation = true;
  try {
    selection.removeAllRanges();
    selection.addRange(replacementRange);
    let position = 0;
    let cursorRange: Range | undefined;
    if (cursorOffset === 0) cursorRange = start.cloneRange();
    while (position < text.length) {
      const nextNewline = text.indexOf("\n", position);
      const nextCursor = cursorOffset > position ? cursorOffset : -1;
      const segmentEnd = Math.min(
        nextNewline < 0 ? text.length : nextNewline,
        nextCursor < 0 ? text.length : nextCursor,
      );
      if (segmentEnd > position) {
        const segment = text.slice(position, segmentEnd);
        const before = root.innerHTML;
        let ok = false;
        try {
          ok = document.execCommand("insertText", false, segment);
        } catch {
          ok = false;
        }
        if (!ok && root.innerHTML === before) return undefined;
        position = segmentEnd;
        if (position === cursorOffset) {
          cursorRange = getCurrentSelectionRange(root);
        }
      }

      if (position < text.length && text[position] === "\n") {
        const before = root.innerHTML;
        let ok = false;
        try {
          ok = document.execCommand("insertParagraph", false);
        } catch {
          ok = false;
        }
        if (!ok && root.innerHTML === before) {
          try {
            ok = document.execCommand("insertLineBreak", false);
          } catch {
            ok = false;
          }
        }
        if (!ok && root.innerHTML === before) return undefined;
        position += 1;
        if (position === cursorOffset) {
          cursorRange = getCurrentSelectionRange(root);
        }
      } else if (segmentEnd === text.length) {
        break;
      }
    }

    if (text.length === 0) {
      try {
        document.execCommand("delete", false);
      } catch {
        return undefined;
      }
    }
    const endRange = getCurrentSelectionRange(root);
    const insertedRange = rangeFromStartAndEnd(start, endRange);
    if (!insertedRange) return undefined;
    if (getEditableSnapshot(root) === before) return undefined;
    if (cursorRange) setSelectionRange(selection, cursorRange);
    return { insertedRange };
  } finally {
    internalMutation = false;
  }
}

function pastePlainText(
  root: EditableRoot,
  range: Range,
  text: string,
  start: Range,
): Range | undefined {
  const transfer = new DataTransfer();
  transfer.setData("text/plain", text);
  const before = getEditableSnapshot(root);
  const selection = getEditableSelection(root);
  if (!selection) return undefined;
  internalMutation = true;
  try {
    selection.removeAllRanges();
    selection.addRange(range);
    const event = new ClipboardEvent("paste", {
      bubbles: true,
      cancelable: true,
      composed: true,
      clipboardData: transfer,
    });
    root.dispatchEvent(event);
    if (getEditableSnapshot(root) === before) return undefined;
    return rangeFromStartAndEnd(start, getCurrentSelectionRange(root));
  } catch {
    return undefined;
  } finally {
    internalMutation = false;
  }
}

function pasteRichHtml(
  root: EditableRoot,
  range: Range,
  html: string,
  plainText: string,
  start: Range,
): { insertedRange: Range } | undefined {
  const selection = getEditableSelection(root);
  if (!selection) return undefined;
  const before = getEditableSnapshot(root);
  internalMutation = true;
  try {
    selection.removeAllRanges();
    selection.addRange(range);
    try {
      const transfer = new DataTransfer();
      transfer.setData("text/html", html);
      transfer.setData("text/plain", plainText);
      root.dispatchEvent(
        new ClipboardEvent("paste", {
          bubbles: true,
          cancelable: true,
          composed: true,
          clipboardData: transfer,
        }),
      );
    } catch {
      // Some editors do not expose ClipboardEvent construction; use insertHTML below.
    }
    if (getEditableSnapshot(root) === before) {
      try {
        root.ownerDocument.execCommand("insertHTML", false, html);
      } catch {
        return undefined;
      }
    }
    if (getEditableSnapshot(root) === before) return undefined;

    const insertedRange = rangeFromStartAndEnd(
      start,
      getCurrentSelectionRange(root),
    );
    const marker = root.querySelector('[data-vkeysnip-cursor="true"]');
    if (marker) {
      const caret = root.ownerDocument.createRange();
      caret.setStartBefore(marker);
      caret.collapse(true);
      selection.removeAllRanges();
      selection.addRange(caret);
      marker.remove();
    }
    return insertedRange ? { insertedRange } : undefined;
  } finally {
    internalMutation = false;
  }
}

function restoreContentEditableRange(
  root: EditableRoot,
  range: Range,
  text: string,
): void {
  const selection = getEditableSelection(root);
  if (!selection) return;
  internalMutation = true;
  try {
    selection.removeAllRanges();
    selection.addRange(range);
    const before = getEditableSnapshot(root);
    let ok = false;
    try {
      ok = root.ownerDocument.execCommand("insertText", false, text);
    } catch {
      ok = false;
    }
    if (!ok && getEditableSnapshot(root) === before) {
      restoreRangeWithPlainText(root, range, text);
    }
  } finally {
    internalMutation = false;
  }
}

function restoreRangeWithPlainText(
  root: EditableRoot,
  range: Range,
  text: string,
): void {
  const replacement = range.cloneRange();
  replacement.deleteContents();
  const textNode = root.ownerDocument.createTextNode(text);
  replacement.insertNode(textNode);
  replacement.setStartAfter(textNode);
  replacement.collapse(true);
  const selection = getEditableSelection(root);
  selection?.removeAllRanges();
  selection?.addRange(replacement);
  root.dispatchEvent(new Event("input", { bubbles: true }));
}

function rangeFromStartToSelection(
  root: EditableRoot,
  start: Range,
): Range | undefined {
  return rangeFromStartAndEnd(start, getCurrentSelectionRange(root));
}

function rangeFromStartAndEnd(
  start: Range,
  end: Range | undefined,
): Range | undefined {
  if (!end) return undefined;
  try {
    const result = start.cloneRange();
    result.setEnd(end.endContainer, end.endOffset);
    return result;
  } catch {
    return undefined;
  }
}

function getCurrentSelectionRange(root: EditableRoot): Range | undefined {
  const selection = getEditableSelection(root);
  return selection && selection.rangeCount > 0
    ? selection.getRangeAt(0).cloneRange()
    : undefined;
}

function setSelectionRange(selection: Selection, range: Range): void {
  selection.removeAllRanges();
  selection.addRange(range);
}

function insertionStart(root: EditableRoot, range: Range): Range {
  const start = root.ownerDocument.createRange();
  start.setStart(range.startContainer, range.startOffset);
  start.collapse(true);
  return start;
}

function moveCaretForward(root: EditableRoot, count: number): void {
  const selection = getEditableSelection(root);
  if (!selection || count <= 0) return;
  const movable = selection as Selection & {
    modify?: (alter: string, direction: string, granularity: string) => void;
  };
  if (typeof movable.modify !== "function") return;
  for (let index = 0; index < count; index += 1) {
    movable.modify("move", "forward", "character");
  }
}

function normalizeLineEndings(
  text: string,
  cursorOffset: number | undefined,
): { text: string; cursorOffset: number | undefined } {
  const prefix =
    cursorOffset === undefined ? undefined : text.slice(0, cursorOffset);
  const normalized = text.replace(/\r\n?/g, "\n");
  return {
    text: normalized,
    cursorOffset:
      prefix === undefined ? undefined : prefix.replace(/\r\n?/g, "\n").length,
  };
}

function setUndoRecord(
  target: HTMLElement,
  expectedValue: string,
  caret: number | string,
  restore: () => void,
): void {
  undoState.set({
    target,
    expectedValue,
    caret,
    restore,
    inputType: "deleteContentBackward",
  });
}

async function resolveTemplate(
  template: string,
  ownerDocument: Document,
): Promise<ExpandedTemplate | null> {
  const syntaxErrors = getTemplateSyntaxErrors(template);
  if (syntaxErrors.length) {
    showToast(`Snippet template error: ${syntaxErrors[0]}`);
    return null;
  }
  const needsClipboard = template.includes("{clipboard}");
  const fields = getTemplateFields(template);
  let values: Record<string, string> = {};
  if (fields.length || needsClipboard) {
    const prompted = await requestFillInValues(
      ownerDocument,
      fields,
      needsClipboard ? () => navigator.clipboard.readText() : undefined,
    );
    if (!prompted) return null;
    values = prompted.values;
    if (needsClipboard) {
      values.clipboard = (prompted.clipboardText ?? "").replace(/\r\n?/g, "\n");
    }
  }
  return expandTemplate(template, new Date(), values);
}

async function resolveSnippet(
  snippet: Snippet,
  ownerDocument: Document,
): Promise<ResolvedSnippet | null> {
  if (snippet.format === "text") {
    return resolveTemplate(snippet.body, ownerDocument);
  }
  return resolveRichTemplate(snippet.body, ownerDocument);
}

async function resolveRichTemplate(
  html: string,
  ownerDocument: Document,
): Promise<ResolvedSnippet | null> {
  const template = ownerDocument.createElement("template");
  template.innerHTML = sanitizeHtml(html, ownerDocument);
  const walker = ownerDocument.createTreeWalker(
    template.content,
    ownerDocument.defaultView?.NodeFilter.SHOW_TEXT ?? 4,
  );
  const textNodes: Text[] = [];
  let node = walker.nextNode();
  while (node) {
    textNodes.push(node as Text);
    node = walker.nextNode();
  }
  if (textNodes.length === 0) {
    const safeHtml = template.innerHTML;
    return {
      text: htmlToPlainText(safeHtml, ownerDocument),
      cursorOffset: undefined,
      html: safeHtml,
      hasCursor: false,
    };
  }

  let separator = `\uE000VKEYSNIP_${crypto.randomUUID()}_NODE\uE001`;
  while (textNodes.some((textNode) => textNode.data.includes(separator))) {
    separator += "_";
  }
  const expanded = await resolveTemplate(
    textNodes.map((textNode) => textNode.data).join(separator),
    ownerDocument,
  );
  if (!expanded) return null;
  const parts = expanded.text.split(separator);
  if (parts.length !== textNodes.length) return null;

  let cursorRemaining = expanded.cursorOffset;
  for (const [index, textNode] of textNodes.entries()) {
    const text = parts[index];
    let cursor: number | undefined;
    if (cursorRemaining !== undefined) {
      if (cursorRemaining <= text.length) {
        cursor = cursorRemaining;
        cursorRemaining = undefined;
      } else {
        cursorRemaining -= text.length + separator.length;
      }
    }
    replaceRichTextNode(textNode, text, cursor, ownerDocument);
  }

  const safeHtml = template.innerHTML;
  return {
    text: htmlToPlainText(safeHtml, ownerDocument),
    cursorOffset: undefined,
    html: safeHtml,
    hasCursor: expanded.cursorOffset !== undefined,
  };
}

function replaceRichTextNode(
  original: Text,
  text: string,
  cursor: number | undefined,
  ownerDocument: Document,
): void {
  const fragment = ownerDocument.createDocumentFragment();
  const appendText = (value: string): void => {
    value
      .replace(/\r\n?/g, "\n")
      .split("\n")
      .forEach((line, index) => {
        if (index > 0) fragment.appendChild(ownerDocument.createElement("br"));
        if (line) fragment.appendChild(ownerDocument.createTextNode(line));
      });
  };
  if (cursor === undefined) {
    appendText(text);
  } else {
    appendText(text.slice(0, cursor));
    const marker = ownerDocument.createElement("span");
    marker.setAttribute("data-vkeysnip-cursor", "true");
    fragment.appendChild(marker);
    appendText(text.slice(cursor));
  }
  original.replaceWith(fragment);
}

function restoreCanceledFieldInput(field: TextField, text: string): void {
  if (!text) return;
  field.focus({ preventScroll: true });
  const selection = getFieldSelection(field);
  if (!selection) return;
  replaceFieldRange(
    field,
    selection.start,
    selection.end,
    text,
    selection.start + text.length,
  );
}

function getFieldSelection(field: TextField):
  | {
      start: number;
      end: number;
    }
  | undefined {
  try {
    if (field.selectionStart === null || field.selectionEnd === null) {
      return undefined;
    }
    return { start: field.selectionStart, end: field.selectionEnd };
  } catch {
    return undefined;
  }
}

function setFieldValue(field: TextField, value: string, caret: number): void {
  internalMutation = true;
  try {
    const prototype =
      field instanceof HTMLTextAreaElement
        ? HTMLTextAreaElement.prototype
        : HTMLInputElement.prototype;
    Object.getOwnPropertyDescriptor(prototype, "value")?.set?.call(
      field,
      value,
    );
    field.setSelectionRange(caret, caret);
    field.dispatchEvent(new Event("input", { bubbles: true }));
  } finally {
    internalMutation = false;
  }
}

async function copyToClipboard(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    return false;
  }
}

function showToast(messageText: string): void {
  const host = document.createElement("div");
  host.style.cssText =
    "all: initial !important; position: fixed !important; inset: auto 16px 16px auto !important; z-index: 2147483647 !important;";
  const shadow = host.attachShadow({ mode: "closed" });
  const style = document.createElement("style");
  style.textContent =
    ":host{all:initial} div{font:13px/1.4 system-ui,sans-serif;color:#fff;background:#222;padding:9px 12px;border-radius:7px;box-shadow:0 2px 10px #0004}";
  const message = document.createElement("div");
  message.setAttribute("role", "status");
  message.textContent = messageText;
  shadow.append(style, message);
  document.documentElement.append(host);
  window.setTimeout(() => host.remove(), 2200);
}

document.addEventListener("beforeinput", onBeforeInput, true);
document.addEventListener("input", onInput, true);
chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (
    message?.type === "vkeysnip:get-current-hostname" &&
    window.top === window
  ) {
    sendResponse({ hostname: location.hostname });
    return;
  }
  if (
    (message?.type === "vkeysnip:can-insert-snippet" ||
      message?.type === "vkeysnip:insert-snippet") &&
    typeof message.snippetId === "string"
  ) {
    const active = getFocusedEditable();
    if (!active) return;
    const snippet = snippetsById[message.snippetId];
    const canInsert = Boolean(ready && snippet && isSafeEditableTarget(active));
    if (message.type === "vkeysnip:can-insert-snippet") {
      sendResponse({
        ok: canInsert,
        message: canInsert ? undefined : "This field cannot accept a snippet.",
      });
      return;
    }
    if (!canInsert || !snippet) {
      sendResponse({
        ok: false,
        message: "This field cannot accept a snippet.",
      });
      return;
    }
    void insertSnippetAtCaret(active, snippet).then(
      (ok) =>
        sendResponse({
          ok,
          message: ok
            ? undefined
            : "Insertion was cancelled or could not be completed.",
        }),
      () =>
        sendResponse({ ok: false, message: "Could not expand this snippet." }),
    );
    return true;
  }
});

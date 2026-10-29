export type EditableRoot = HTMLElement;

export type TextUnit = {
  character: string;
  startNode: Node;
  startOffset: number;
  endNode: Node;
  endOffset: number;
};

export type CaretText = {
  block: HTMLElement;
  text: string;
  units: TextUnit[];
  precedingCharacter: string | undefined;
  caretNode: Node;
  caretOffset: number;
};

export function getEditableSelection(root: EditableRoot): Selection | null {
  const treeRoot = root.getRootNode() as ShadowRoot & {
    getSelection?: () => Selection | null;
  };
  return treeRoot.getSelection?.() ?? root.ownerDocument.getSelection();
}

const BLOCK_TAGS = new Set([
  "ADDRESS",
  "ARTICLE",
  "BLOCKQUOTE",
  "DD",
  "DIV",
  "DT",
  "LI",
  "P",
  "PRE",
  "TD",
  "TH",
]);

export function resolveContentEditableRoot(event: Event): EditableRoot | null {
  for (const node of eventPath(event)) {
    if (!(node instanceof Element)) continue;
    if (!node.hasAttribute("contenteditable")) continue;

    const value = node.getAttribute("contenteditable")?.trim().toLowerCase();
    if (value === "false") return null;
    if (value === "" || value === "true" || value === "plaintext-only") {
      return node as HTMLElement;
    }
  }
  return null;
}

export function hasSensitiveEditableAncestor(
  event: Event,
  root: EditableRoot,
): boolean {
  for (const node of eventPath(event)) {
    if (!(node instanceof Element)) continue;
    const autocomplete = node.getAttribute("autocomplete") ?? "";
    if (
      autocomplete
        .toLowerCase()
        .split(/\s+/)
        .some((item) => item.startsWith("cc-"))
    ) {
      return true;
    }
    if (
      node.getAttribute("aria-readonly")?.toLowerCase() === "true" ||
      node.hasAttribute("readonly") ||
      node.hasAttribute("disabled")
    ) {
      return true;
    }
    if (node === root) break;
  }
  return false;
}

export function readTextBeforeCaret(
  root: EditableRoot,
  selection = getEditableSelection(root),
): CaretText | undefined {
  if (!selection || selection.rangeCount === 0 || !selection.isCollapsed) {
    return undefined;
  }
  const caret = selection.getRangeAt(0);
  const caretNode = caret.startContainer;
  if (caretNode !== root && !root.contains(caretNode)) return undefined;

  const block = findCurrentBlock(root, caretNode);
  const caretPoint = root.ownerDocument.createRange();
  caretPoint.setStart(caret.startContainer, caret.startOffset);
  caretPoint.collapse(true);

  const units: TextUnit[] = [];
  const walker = root.ownerDocument.createTreeWalker(
    block,
    NodeFilter.SHOW_ELEMENT | NodeFilter.SHOW_TEXT,
  );
  let node = walker.nextNode();
  let finished = false;
  while (node && !finished) {
    if (node.nodeType === Node.TEXT_NODE) {
      const textNode = node as Text;
      const length = textNode.data.length;
      let limit = 0;
      if (node === caretNode) {
        limit = Math.min(caret.startOffset, length);
        finished = true;
      } else {
        const startOrder = comparePoint(
          root.ownerDocument,
          node,
          0,
          caretPoint.startContainer,
          caretPoint.startOffset,
        );
        if (startOrder >= 0) {
          finished = true;
        } else {
          const endOrder = comparePoint(
            root.ownerDocument,
            node,
            length,
            caretPoint.startContainer,
            caretPoint.startOffset,
          );
          if (endOrder <= 0) limit = length;
          else finished = true;
        }
      }
      appendTextUnits(units, textNode, limit);
    } else if ((node as Element).tagName === "BR") {
      const element = node as Element;
      const parent = element.parentNode;
      if (!parent) {
        finished = true;
      } else {
        const childIndex = Array.prototype.indexOf.call(
          parent.childNodes,
          element,
        ) as number;
        const beforeOrder = comparePoint(
          root.ownerDocument,
          parent,
          childIndex,
          caretPoint.startContainer,
          caretPoint.startOffset,
        );
        if (beforeOrder >= 0) {
          finished = true;
        } else {
          const afterOrder = comparePoint(
            root.ownerDocument,
            parent,
            childIndex + 1,
            caretPoint.startContainer,
            caretPoint.startOffset,
          );
          if (afterOrder <= 0) {
            units.push({
              character: "\n",
              startNode: parent,
              startOffset: childIndex,
              endNode: parent,
              endOffset: childIndex + 1,
            });
            trimUnits(units);
          } else {
            finished = true;
          }
        }
      }
    }
    node = finished ? null : walker.nextNode();
  }

  return {
    block,
    text: units
      .slice(-64)
      .map((unit) => unit.character)
      .join(""),
    units,
    precedingCharacter:
      units.length > 64 ? units.at(-65)?.character : undefined,
    caretNode: caret.startContainer,
    caretOffset: caret.startOffset,
  };
}

export function rangeForSuffix(
  reading: CaretText,
  length: number,
  skipFromEnd = 0,
): Range | undefined {
  if (length === 0 && skipFromEnd === 0) {
    const caret = reading.block.ownerDocument.createRange();
    caret.setStart(reading.caretNode, reading.caretOffset);
    caret.collapse(true);
    return caret;
  }
  if (length < 0 || length + skipFromEnd > reading.units.length) {
    return undefined;
  }
  const end = reading.units.length - skipFromEnd;
  const units = reading.units.slice(end - length, end);
  const range = units[0].startNode.ownerDocument!.createRange();
  range.setStart(units[0].startNode, units[0].startOffset);
  range.setEnd(
    units[units.length - 1].endNode,
    units[units.length - 1].endOffset,
  );
  return range;
}

export function getEditableSnapshot(root: EditableRoot): string {
  return root.innerHTML;
}

export function getCaretSignature(root: EditableRoot): string | undefined {
  const selection = getEditableSelection(root);
  if (!selection || selection.rangeCount === 0 || !selection.isCollapsed) {
    return undefined;
  }
  const node = selection.anchorNode;
  if (!node || (node !== root && !root.contains(node))) return undefined;

  const path: number[] = [];
  let current: Node | null = node;
  while (current && current !== root) {
    const parent: Node | null = current.parentNode;
    if (!parent) return undefined;
    path.unshift(
      Array.prototype.indexOf.call(parent.childNodes, current) as number,
    );
    current = parent;
  }
  if (current !== root) return undefined;
  return `${path.join(".")}:${selection.anchorOffset}`;
}

function eventPath(event: Event): EventTarget[] {
  if (typeof event.composedPath === "function") {
    const path = event.composedPath();
    if (path.length > 0) return path;
  }
  const path: EventTarget[] = [];
  let node = event.target as Node | null;
  while (node) {
    path.push(node);
    node = node.parentNode ?? (node instanceof ShadowRoot ? node.host : null);
  }
  return path;
}

function findCurrentBlock(root: HTMLElement, node: Node): HTMLElement {
  let current =
    node.nodeType === Node.ELEMENT_NODE
      ? (node as Element)
      : node.parentElement;
  while (current && current !== root) {
    if (BLOCK_TAGS.has(current.tagName)) return current as HTMLElement;
    current = current.parentElement;
  }
  return root;
}

function appendTextUnits(units: TextUnit[], node: Text, limit: number): void {
  const countToAdd = Math.min(limit, 65 - units.length);
  const first = limit - countToAdd;
  for (let offset = first; offset < limit; offset += 1) {
    units.push({
      character: node.data.slice(offset, offset + 1),
      startNode: node,
      startOffset: offset,
      endNode: node,
      endOffset: offset + 1,
    });
  }
  trimUnits(units);
}

function trimUnits(units: TextUnit[]): void {
  if (units.length > 65) units.splice(0, units.length - 65);
}

function comparePoint(
  document: Document,
  aNode: Node,
  aOffset: number,
  bNode: Node,
  bOffset: number,
): number {
  const a = document.createRange();
  a.setStart(aNode, aOffset);
  a.collapse(true);
  const b = document.createRange();
  b.setStart(bNode, bOffset);
  b.collapse(true);
  return a.compareBoundaryPoints(Range.START_TO_START, b);
}

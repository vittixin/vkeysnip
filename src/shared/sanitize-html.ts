const ALLOWED_TAGS = new Set([
  "A",
  "B",
  "BLOCKQUOTE",
  "BR",
  "CODE",
  "EM",
  "I",
  "LI",
  "OL",
  "P",
  "PRE",
  "S",
  "STRONG",
  "U",
  "UL",
]);

const DROP_CONTENT_TAGS = new Set([
  "IFRAME",
  "OBJECT",
  "EMBED",
  "SCRIPT",
  "STYLE",
  "SVG",
  "MATH",
  "TEMPLATE",
]);

const BLOCK_TAGS = new Set(["BLOCKQUOTE", "LI", "OL", "P", "PRE", "UL"]);

const LINK_PROTOCOLS = new Set(["http:", "https:", "mailto:", "tel:"]);

export function sanitizeLinkUrl(value: string): string | undefined {
  try {
    const url = new URL(value.trim());
    return LINK_PROTOCOLS.has(url.protocol) ? url.href : undefined;
  } catch {
    return undefined;
  }
}

export function sanitizeHtml(html: string, document: Document): string {
  const source = document.createElement("template");
  source.innerHTML = html;
  const output = document.createElement("template");
  for (const node of Array.from(source.content.childNodes)) {
    appendSanitized(node, output.content, document);
  }
  return output.innerHTML;
}

export function plainTextToHtml(text: string, document: Document): string {
  const container = document.createElement("div");
  const lines = text.replace(/\r\n?/g, "\n").split("\n");
  lines.forEach((line, index) => {
    if (index > 0) container.appendChild(document.createElement("br"));
    container.appendChild(document.createTextNode(line));
  });
  return container.innerHTML;
}

export function htmlToPlainText(html: string, document: Document): string {
  const template = document.createElement("template");
  template.innerHTML = sanitizeHtml(html, document);
  let result = "";

  const visit = (node: Node): void => {
    if (node.nodeType === 3) {
      result += node.textContent ?? "";
      return;
    }
    if (node.nodeType !== 1) return;
    const element = node as Element;
    if (element.tagName === "BR") {
      result += "\n";
      return;
    }
    const block = BLOCK_TAGS.has(element.tagName);
    if (block && result && !result.endsWith("\n")) result += "\n";
    for (const child of Array.from(node.childNodes)) visit(child);
    if (block && result && !result.endsWith("\n")) result += "\n";
  };

  for (const node of Array.from(template.content.childNodes)) visit(node);
  return result.replace(/^\n+|\n+$/g, "");
}

function appendSanitized(node: Node, parent: Node, document: Document): void {
  if (node.nodeType === 3) {
    parent.appendChild(document.createTextNode(node.textContent ?? ""));
    return;
  }
  if (node.nodeType !== 1) return;
  const element = node as Element;
  if (DROP_CONTENT_TAGS.has(element.tagName)) return;

  if (!ALLOWED_TAGS.has(element.tagName)) {
    for (const child of Array.from(element.childNodes)) {
      appendSanitized(child, parent, document);
    }
    return;
  }

  const safe = document.createElement(element.tagName.toLowerCase());
  if (element.tagName === "A") {
    const href = sanitizeLinkUrl(element.getAttribute("href") ?? "");
    if (href) {
      safe.setAttribute("href", href);
      safe.setAttribute("rel", "noopener noreferrer");
    }
  }
  parent.appendChild(safe);
  for (const child of Array.from(element.childNodes)) {
    appendSanitized(child, safe, document);
  }
}

import { SCHEMA_VERSION, type Library } from "./schema";
import { htmlToPlainText, sanitizeHtml } from "./sanitize-html";

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function fail(message: string): never {
  throw new Error(`Invalid VKeysnip backup: ${message}`);
}

export function parseLibraryBackup(
  text: string,
  documentContext?: Document,
): Library {
  let value: unknown;
  try {
    value = JSON.parse(text);
  } catch {
    return fail("file is not valid JSON.");
  }
  if (!isRecord(value)) return fail("expected a library object.");
  if (value.schemaVersion !== SCHEMA_VERSION)
    return fail(`unsupported schema version ${String(value.schemaVersion)}.`);
  if (!isRecord(value.snippets) || !isRecord(value.folders))
    return fail("snippets and folders must be objects.");
  if (!isRecord(value.settings) || !Array.isArray(value.exclusions))
    return fail("settings and exclusions are missing or invalid.");

  for (const [id, item] of Object.entries(value.folders)) {
    if (
      !isRecord(item) ||
      item.id !== id ||
      typeof item.name !== "string" ||
      !item.name.trim() ||
      typeof item.order !== "number" ||
      !Number.isFinite(item.order)
    )
      return fail(`folder ${id} is invalid.`);
  }
  const triggers = new Set<string>();
  for (const [id, item] of Object.entries(value.snippets)) {
    if (
      !isRecord(item) ||
      item.id !== id ||
      typeof item.trigger !== "string" ||
      !item.trigger.trim() ||
      typeof item.label !== "string" ||
      !item.label.trim() ||
      typeof item.body !== "string" ||
      !item.body.trim() ||
      (item.format !== "text" && item.format !== "html") ||
      typeof item.createdAt !== "number" ||
      !Number.isFinite(item.createdAt) ||
      typeof item.updatedAt !== "number" ||
      !Number.isFinite(item.updatedAt) ||
      (item.folderId !== undefined &&
        (typeof item.folderId !== "string" ||
          !Object.hasOwn(value.folders, item.folderId)))
    ) {
      return fail(`snippet ${id} is invalid.`);
    }
    const trigger = value.settings.caseSensitive
      ? item.trigger
      : item.trigger.toLocaleLowerCase();
    if (triggers.has(trigger))
      return fail(`duplicate trigger ${item.trigger}.`);
    triggers.add(trigger);
  }
  const settings = value.settings;
  if (
    typeof settings.triggerPrefix !== "string" ||
    !settings.triggerPrefix ||
    (settings.mode !== "delimiter" && settings.mode !== "immediate") ||
    typeof settings.caseSensitive !== "boolean" ||
    (settings.theme !== "system" &&
      settings.theme !== "light" &&
      settings.theme !== "dark")
  ) {
    return fail("settings are invalid.");
  }
  if (!value.exclusions.every((item) => typeof item === "string"))
    return fail("exclusions must contain only text patterns.");

  const snippets = Object.fromEntries(
    Object.entries(value.snippets).map(([id, item]) => {
      if (!isRecord(item) || item.format !== "html") return [id, item];
      if (!documentContext) {
        return fail("HTML snippets require a document for safe import.");
      }
      const body = sanitizeHtml(item.body as string, documentContext);
      if (!htmlToPlainText(body, documentContext).trim()) {
        return fail(`snippet ${id} has no text after sanitization.`);
      }
      return [id, { ...item, body }];
    }),
  );
  return { ...value, snippets } as unknown as Library;
}

export function serializeLibraryBackup(
  library: Library,
  documentContext?: Document,
): string {
  return `${JSON.stringify(sanitizeLibraryHtml(library, documentContext), null, 2)}\n`;
}

const CSV_COLUMNS = [
  "type",
  "schemaVersion",
  "id",
  "trigger",
  "label",
  "body",
  "format",
  "folderId",
  "createdAt",
  "updatedAt",
  "name",
  "order",
  "settings",
  "exclusions",
];

function csvCell(value: unknown): string {
  const text = String(value ?? "");
  return /[",\r\n]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text;
}

function parseCsvRows(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = "";
  let quoted = false;
  for (let index = 0; index < text.length; index += 1) {
    const char = text[index];
    if (quoted) {
      if (char === '"' && text[index + 1] === '"') {
        cell += '"';
        index += 1;
      } else if (char === '"') quoted = false;
      else cell += char;
    } else if (char === '"') {
      if (cell) fail("CSV contains an unexpected quote.");
      quoted = true;
    } else if (char === ",") {
      row.push(cell);
      cell = "";
    } else if (char === "\n" || char === "\r") {
      if (char === "\r" && text[index + 1] === "\n") index += 1;
      row.push(cell);
      if (row.some((item) => item.length)) rows.push(row);
      row = [];
      cell = "";
    } else {
      cell += char;
    }
  }
  if (quoted) fail("CSV has an unterminated quoted field.");
  row.push(cell);
  if (row.some((item) => item.length)) rows.push(row);
  return rows;
}

export function serializeLibraryCsv(
  library: Library,
  documentContext?: Document,
): string {
  library = sanitizeLibraryHtml(library, documentContext);
  const rows: unknown[][] = [
    CSV_COLUMNS,
    [
      "metadata",
      library.schemaVersion,
      "",
      "",
      "",
      "",
      "",
      "",
      "",
      "",
      "",
      "",
      JSON.stringify(library.settings),
      JSON.stringify(library.exclusions),
    ],
    ...Object.values(library.folders).map((folder) => [
      "folder",
      "",
      folder.id,
      "",
      "",
      "",
      "",
      "",
      "",
      "",
      folder.name,
      folder.order,
      "",
      "",
    ]),
    ...Object.values(library.snippets).map((snippet) => [
      "snippet",
      "",
      snippet.id,
      snippet.trigger,
      snippet.label,
      snippet.body,
      snippet.format,
      snippet.folderId ?? "",
      snippet.createdAt,
      snippet.updatedAt,
      "",
      "",
      "",
      "",
    ]),
  ];
  return `${rows.map((row) => row.map(csvCell).join(",")).join("\r\n")}\r\n`;
}

export function parseLibraryCsv(
  text: string,
  documentContext?: Document,
): Library {
  const rows = parseCsvRows(text);
  if (!rows.length || rows[0].join(",") !== CSV_COLUMNS.join(","))
    return fail("CSV header is missing or invalid.");
  const index = Object.fromEntries(CSV_COLUMNS.map((column, i) => [column, i]));
  const snippets: Library["snippets"] = Object.create(
    null,
  ) as Library["snippets"];
  const folders: Library["folders"] = Object.create(null) as Library["folders"];
  let metadata:
    | { schemaVersion: number; settings: unknown; exclusions: unknown }
    | undefined;
  for (const row of rows.slice(1)) {
    if (row.length !== CSV_COLUMNS.length)
      return fail("CSV row has the wrong number of columns.");
    const field = (name: string) => row[index[name]];
    if (field("type") === "metadata") {
      if (metadata) return fail("CSV contains duplicate metadata.");
      try {
        metadata = {
          schemaVersion: Number(field("schemaVersion")),
          settings: JSON.parse(field("settings")),
          exclusions: JSON.parse(field("exclusions")),
        };
      } catch {
        return fail("CSV metadata is invalid.");
      }
    } else if (field("type") === "folder") {
      const id = field("id");
      if (!id || Object.hasOwn(folders, id))
        return fail(`duplicate or empty folder id ${id}.`);
      folders[id] = { id, name: field("name"), order: Number(field("order")) };
    } else if (field("type") === "snippet") {
      const id = field("id");
      if (!id || Object.hasOwn(snippets, id))
        return fail(`duplicate or empty snippet id ${id}.`);
      snippets[id] = {
        id,
        trigger: field("trigger"),
        label: field("label"),
        body: field("body"),
        format: field("format") as "text" | "html",
        ...(field("folderId") ? { folderId: field("folderId") } : {}),
        createdAt: Number(field("createdAt")),
        updatedAt: Number(field("updatedAt")),
      };
    } else return fail(`unknown CSV row type ${field("type")}.`);
  }
  if (!metadata) return fail("CSV metadata row is missing.");
  return parseLibraryBackup(
    JSON.stringify({ ...metadata, snippets, folders }),
    documentContext,
  );
}

function sanitizeLibraryHtml(
  library: Library,
  documentContext?: Document,
): Library {
  let changed = false;
  const snippets = Object.fromEntries(
    Object.entries(library.snippets).map(([id, snippet]) => {
      if (snippet.format !== "html") return [id, snippet];
      if (!documentContext) {
        throw new Error("HTML snippets require a document for safe export.");
      }
      changed = true;
      return [
        id,
        { ...snippet, body: sanitizeHtml(snippet.body, documentContext) },
      ];
    }),
  );
  return changed ? { ...library, snippets } : library;
}

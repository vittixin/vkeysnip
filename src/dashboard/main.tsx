import { render } from "preact";
import {
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "preact/hooks";
import {
  deleteFolder,
  deleteSnippet,
  addSampleSnippets,
  getAll,
  importLibrary,
  saveCustomExclusions,
  updateSettings,
  subscribe,
  upsertFolder,
  upsertSnippet,
} from "../shared/store";
import {
  parseLibraryBackup,
  parseLibraryCsv,
  serializeLibraryBackup,
  serializeLibraryCsv,
} from "../shared/library-file";
import type { Folder, Library, Snippet } from "../shared/schema";
import { getTemplateSyntaxErrors } from "../shared/expand-template";
import { DEFAULT_EXCLUSIONS } from "../shared/schema";
import {
  htmlToPlainText,
  plainTextToHtml,
  sanitizeHtml,
  sanitizeLinkUrl,
} from "../shared/sanitize-html";
import {
  getCustomExclusions,
  normalizeExclusionPattern,
} from "../shared/exclusions";
import "./style.css";

const emptyLibrary: Library = {
  schemaVersion: 1,
  snippets: {},
  folders: {},
  settings: {
    triggerPrefix: ";",
    mode: "delimiter",
    caseSensitive: false,
    theme: "system",
  },
  exclusions: [],
};

function TemplateHelp({ errors }: { errors: string[] }) {
  return (
    <div class="template-help" aria-live="polite">
      <span class="helper">
        Fields: <code>{"{name}"}</code> asks for text,{" "}
        <code>{"{dropdown:status|New|Done}"}</code> shows choices,
        <code>{"{checkbox:approved}"}</code> inserts “Yes” when checked, and
        <code>{"{if:approved}...{/if}"}</code> includes conditional text. Use
        <code>{"{date+7d}"}</code> or <code>{"{date-2d}"}</code> for date math.
      </span>
      {errors.map((error) => (
        <span class="template-error" role="alert" key={error}>
          {error}
        </span>
      ))}
    </div>
  );
}

function makeId(prefix: string): string {
  return `${prefix}_${crypto.randomUUID().replaceAll("-", "").slice(0, 10)}`;
}

function Dashboard() {
  const [library, setLibrary] = useState(emptyLibrary);
  const [query, setQuery] = useState("");
  const [folderFilter, setFolderFilter] = useState("all");
  const [editing, setEditing] = useState<Snippet | null>(null);
  const [notice, setNotice] = useState("");
  const [folderName, setFolderName] = useState("");
  const [exclusionPattern, setExclusionPattern] = useState("");
  const [linkUrl, setLinkUrl] = useState("");
  const richEditorRef = useRef<HTMLDivElement>(null);
  const richSelectionRef = useRef<Range | null>(null);

  useEffect(() => {
    let mounted = true;
    void getAll().then((value) => mounted && setLibrary(value));
    const unsubscribe = subscribe((value) => setLibrary(value));
    return () => {
      mounted = false;
      unsubscribe();
    };
  }, []);

  useLayoutEffect(() => {
    if (editing?.format === "html" && richEditorRef.current) {
      richEditorRef.current.innerHTML = sanitizeHtml(editing.body, document);
    }
  }, [editing?.id, editing?.format]);

  const folders = useMemo(
    () =>
      Object.values(library.folders).sort(
        (a, b) => a.order - b.order || a.name.localeCompare(b.name),
      ),
    [library.folders],
  );
  const customExclusions = useMemo(
    () => getCustomExclusions(library.exclusions),
    [library.exclusions],
  );
  const snippets = useMemo(() => {
    const needle = query.trim().toLocaleLowerCase();
    return Object.values(library.snippets)
      .filter(
        (snippet) =>
          folderFilter === "all" || snippet.folderId === folderFilter,
      )
      .filter(
        (snippet) =>
          !needle ||
          `${snippet.label} ${snippet.trigger} ${snippet.body}`
            .toLocaleLowerCase()
            .includes(needle),
      )
      .sort((a, b) => a.label.localeCompare(b.label));
  }, [library.snippets, folderFilter, query]);
  const templateSource = editing
    ? editing.format === "html"
      ? htmlToPlainText(
          richEditorRef.current?.innerHTML ?? editing.body,
          document,
        )
      : editing.body
    : "";
  const templateErrors = getTemplateSyntaxErrors(templateSource);

  function startNew(): void {
    const now = Date.now();
    setEditing({
      id: makeId("s"),
      trigger: library.settings.triggerPrefix,
      label: "",
      body: "",
      format: "text",
      createdAt: now,
      updatedAt: now,
    });
  }

  function rememberRichSelection(): void {
    const editor = richEditorRef.current;
    const selection = document.getSelection();
    if (
      editor &&
      selection?.rangeCount &&
      selection.anchorNode &&
      editor.contains(selection.anchorNode)
    ) {
      richSelectionRef.current = selection.getRangeAt(0).cloneRange();
    }
  }

  function restoreRichSelection(): void {
    const selection = document.getSelection();
    const range = richSelectionRef.current;
    if (!selection || !range) return;
    selection.removeAllRanges();
    selection.addRange(range);
  }

  function preserveRichSelection(event: MouseEvent): void {
    rememberRichSelection();
    event.preventDefault();
  }

  function runRichCommand(command: string): void {
    rememberRichSelection();
    richEditorRef.current?.focus();
    restoreRichSelection();
    const inlineTags: Record<string, string> = {
      bold: "strong",
      italic: "em",
      underline: "u",
    };
    const tag = inlineTags[command];
    if (tag) wrapRichSelection(tag);
    else document.execCommand(command, false);
    rememberRichSelection();
  }

  function insertRichLink(): void {
    const url = sanitizeLinkUrl(linkUrl);
    if (!url) {
      setNotice("Use an absolute http, https, mailto, or tel link.");
      return;
    }
    rememberRichSelection();
    richEditorRef.current?.focus();
    restoreRichSelection();
    wrapRichSelection("a", url);
    setLinkUrl("");
    rememberRichSelection();
  }

  function wrapRichSelection(tagName: string, href?: string): void {
    const editor = richEditorRef.current;
    const selection = document.getSelection();
    const range =
      richSelectionRef.current?.cloneRange() ??
      (selection?.rangeCount ? selection.getRangeAt(0).cloneRange() : null);
    if (
      !editor ||
      !selection ||
      !range ||
      (range.startContainer !== editor &&
        !editor.contains(range.startContainer)) ||
      (range.endContainer !== editor && !editor.contains(range.endContainer)) ||
      range.collapsed
    ) {
      return;
    }
    const wrapper = document.createElement(tagName);
    if (href) {
      wrapper.setAttribute("href", href);
      wrapper.setAttribute("rel", "noopener noreferrer");
    }
    wrapper.appendChild(range.extractContents());
    range.insertNode(wrapper);
    const next = document.createRange();
    next.selectNodeContents(wrapper);
    selection.removeAllRanges();
    selection.addRange(next);
    richSelectionRef.current = next.cloneRange();
  }

  function changeFormat(format: "text" | "html"): void {
    if (!editing || editing.format === format) return;
    const currentHtml =
      editing.format === "html"
        ? (richEditorRef.current?.innerHTML ?? editing.body)
        : plainTextToHtml(editing.body, document);
    const body =
      format === "html"
        ? sanitizeHtml(currentHtml, document)
        : htmlToPlainText(currentHtml, document);
    setEditing({ ...editing, format, body });
    setLinkUrl("");
  }

  async function saveSnippet(event: SubmitEvent): Promise<void> {
    event.preventDefault();
    const form = event.currentTarget as HTMLFormElement;
    const data = new FormData(form);
    const trigger = String(data.get("trigger") ?? "").trim();
    const label = String(data.get("label") ?? "").trim();
    const body =
      editing?.format === "html"
        ? sanitizeHtml(
            richEditorRef.current?.innerHTML ?? editing.body,
            document,
          )
        : String(data.get("body") ?? "");
    const folderId = String(data.get("folderId") ?? "") || undefined;
    const textContent =
      editing?.format === "html" ? htmlToPlainText(body, document) : body;
    const syntaxErrors = getTemplateSyntaxErrors(textContent);
    if (syntaxErrors.length) {
      setNotice(syntaxErrors[0]);
      return;
    }
    if (!trigger || !label || !textContent.trim()) {
      setNotice("Enter a trigger, label, and snippet text.");
      return;
    }
    const normalize = (value: string) =>
      library.settings.caseSensitive ? value : value.toLocaleLowerCase();
    const otherSnippets = Object.values(library.snippets).filter(
      (item) => item.id !== editing?.id,
    );
    const duplicate = otherSnippets.find(
      (item) => normalize(item.trigger) === normalize(trigger),
    );
    if (duplicate) {
      setNotice(
        `The trigger ${trigger} is already used by “${duplicate.label}”.`,
      );
      return;
    }
    const snippet: Snippet = {
      ...editing!,
      trigger,
      label,
      body,
      folderId,
      updatedAt: Date.now(),
    };
    await upsertSnippet(snippet);
    setEditing(null);
    const overlapping = otherSnippets.some((item) => {
      const existing = normalize(item.trigger);
      const next = normalize(trigger);
      return existing.startsWith(next) || next.startsWith(existing);
    });
    setNotice(
      overlapping
        ? "Snippet saved. Its trigger overlaps a shorter or longer trigger."
        : "Snippet saved.",
    );
  }

  async function addFolder(event: SubmitEvent): Promise<void> {
    event.preventDefault();
    const name = folderName.trim();
    if (!name) return;
    if (
      folders.some(
        (folder) =>
          folder.name.toLocaleLowerCase() === name.toLocaleLowerCase(),
      )
    ) {
      setNotice("A folder with that name already exists.");
      return;
    }
    const folder: Folder = { id: makeId("f"), name, order: folders.length };
    await upsertFolder(folder);
    setFolderName("");
    setNotice("Folder created.");
  }

  async function removeFolder(folder: Folder): Promise<void> {
    if (
      !confirm(
        `Delete the “${folder.name}” folder? Its snippets will be kept without a folder.`,
      )
    )
      return;
    await deleteFolder(folder.id);
    if (folderFilter === folder.id) setFolderFilter("all");
    setNotice("Folder deleted; snippets were kept.");
  }

  async function removeSnippet(snippet: Snippet): Promise<void> {
    if (!confirm(`Delete “${snippet.label}”?`)) return;
    await deleteSnippet(snippet.id);
    setNotice("Snippet deleted.");
  }

  async function saveSettings(event: SubmitEvent): Promise<void> {
    event.preventDefault();
    const form = event.currentTarget as HTMLFormElement;
    const data = new FormData(form);
    const triggerPrefix = String(data.get("triggerPrefix") ?? "").trim();
    const mode = String(data.get("mode") ?? "");
    if (!/^[^\s{}]{1,8}$/u.test(triggerPrefix)) {
      setNotice(
        "Trigger prefix must be 1–8 characters without spaces or braces.",
      );
      return;
    }
    if (mode !== "delimiter" && mode !== "immediate") {
      setNotice("Choose a valid expansion mode.");
      return;
    }
    await updateSettings({ triggerPrefix, mode });
    setNotice("Expansion settings saved.");
  }

  async function installSamples(): Promise<void> {
    const added = await addSampleSnippets();
    if (added)
      setNotice("Three sample snippets added. Try ;hello, ;thanks, or ;sig.");
    else setNotice("Samples can only be added while your library is empty.");
  }

  async function addExclusion(event: SubmitEvent): Promise<void> {
    event.preventDefault();
    const pattern = normalizeExclusionPattern(exclusionPattern);
    if (!pattern) {
      setNotice("Enter a domain such as example.com or *.example.com.");
      return;
    }
    if (customExclusions.includes(pattern)) {
      setNotice("That domain is already excluded.");
      return;
    }
    await saveCustomExclusions([...customExclusions, pattern]);
    setExclusionPattern("");
    setNotice(`Expansion disabled on ${pattern}.`);
  }

  async function removeExclusion(pattern: string): Promise<void> {
    await saveCustomExclusions(
      customExclusions.filter((item) => item !== pattern),
    );
    setNotice(`Expansion enabled again for ${pattern}.`);
  }

  function exportBackup(format: "json" | "csv"): void {
    const csv = format === "csv";
    const blob = new Blob(
      [
        csv
          ? serializeLibraryCsv(library, document)
          : serializeLibraryBackup(library, document),
      ],
      { type: csv ? "text/csv" : "application/json" },
    );
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = `vkeysnip-backup-${new Date().toISOString().slice(0, 10)}.${format}`;
    link.click();
    window.setTimeout(() => URL.revokeObjectURL(url), 1000);
    setNotice(`${format.toUpperCase()} backup downloaded.`);
  }

  async function importBackup(event: Event): Promise<void> {
    const input = event.currentTarget as HTMLInputElement;
    const file = input.files?.[0];
    input.value = "";
    if (!file) return;
    try {
      const text = await file.text();
      const imported = file.name.toLocaleLowerCase().endsWith(".csv")
        ? parseLibraryCsv(text, document)
        : parseLibraryBackup(text, document);
      const count = Object.keys(imported.snippets).length;
      const folderCount = Object.keys(imported.folders).length;
      const currentCount = Object.keys(library.snippets).length;
      const currentFolderCount = Object.keys(library.folders).length;
      const summary = `Import preview\n\nFile: ${file.name}\nIncoming: ${count} snippets, ${folderCount} folders\nCurrent library: ${currentCount} snippets, ${currentFolderCount} folders\n\nImporting will replace the current library. Continue?`;
      if (!confirm(summary)) return;
      await importLibrary(imported);
      setFolderFilter("all");
      setNotice(
        `Backup restored: ${count} snippets and ${folderCount} folders.`,
      );
    } catch (error) {
      setNotice(
        error instanceof Error ? error.message : "Could not read this backup.",
      );
    }
  }

  return (
    <main class="shell">
      <header class="topbar">
        <a class="brand" href="#">
          <span class="brand-mark">V</span>
          <span>
            VKeysnip<small>LOCAL SNIPPET LIBRARY</small>
          </span>
        </a>
        <div class="top-actions">
          <button class="button quiet" onClick={() => exportBackup("json")}>
            Export JSON
          </button>
          <button class="button quiet" onClick={() => exportBackup("csv")}>
            Export CSV
          </button>
          <label class="button quiet file-button">
            Import backup
            <input
              type="file"
              accept="application/json,.json,text/csv,.csv"
              onChange={(event) => void importBackup(event)}
            />
          </label>
          <button class="button primary" onClick={startNew}>
            ＋ New snippet
          </button>
        </div>
      </header>
      <section class="intro">
        <div>
          <p class="eyebrow">YOUR WORKSPACE</p>
          <h1>
            Make the words you reuse
            <br />
            work for you.
          </h1>
          <p class="lede">
            Your snippets are stored on this device, ready whenever you type a
            trigger.
          </p>
        </div>
        <div class="stat">
          <strong>
            {Object.keys(library.snippets).length.toString().padStart(2, "0")}
          </strong>
          <span>SNIPPETS</span>
        </div>
      </section>
      <section class="library">
        <aside class="sidebar">
          <p class="eyebrow">LIBRARY</p>
          <button
            class={`nav-item ${folderFilter === "all" ? "selected" : ""}`}
            onClick={() => setFolderFilter("all")}
          >
            <span>▦</span> All snippets{" "}
            <b>{Object.keys(library.snippets).length}</b>
          </button>
          <div class="folder-heading">
            <span>FOLDERS</span>
            <form onSubmit={addFolder}>
              <input
                aria-label="New folder name"
                placeholder="＋ Add folder"
                value={folderName}
                onInput={(event) =>
                  setFolderName((event.target as HTMLInputElement).value)
                }
              />
            </form>
          </div>
          {folders.map((folder) => (
            <div class="folder-row" key={folder.id}>
              <button
                class={`nav-item ${folderFilter === folder.id ? "selected" : ""}`}
                onClick={() => setFolderFilter(folder.id)}
              >
                <span>▰</span>
                {folder.name}
                <b>
                  {
                    Object.values(library.snippets).filter(
                      (item) => item.folderId === folder.id,
                    ).length
                  }
                </b>
              </button>
              <button
                class="icon-button folder-delete"
                aria-label={`Delete ${folder.name} folder`}
                onClick={() => void removeFolder(folder)}
              >
                ×
              </button>
            </div>
          ))}
        </aside>
        <section class="content">
          <div class="content-heading">
            <div>
              <p class="eyebrow">
                {folderFilter === "all"
                  ? "ALL SNIPPETS"
                  : library.folders[folderFilter]?.name.toLocaleUpperCase()}
              </p>
              <h2>Your library</h2>
            </div>
            <label class="search">
              <span>⌕</span>
              <input
                aria-label="Search snippets"
                placeholder="Search your snippets…"
                value={query}
                onInput={(event) =>
                  setQuery((event.target as HTMLInputElement).value)
                }
              />
              <kbd>⌘ K</kbd>
            </label>
          </div>
          {notice && (
            <p class="notice" role="status">
              {notice}
            </p>
          )}
          {snippets.length ? (
            <div class="snippet-list">
              {snippets.map((snippet) => (
                <article class="snippet-card" key={snippet.id}>
                  <div class="snippet-icon">
                    {snippet.label.slice(0, 1).toUpperCase()}
                  </div>
                  <div class="snippet-info">
                    <div class="snippet-title">
                      <h3>{snippet.label}</h3>
                      <code>{snippet.trigger}</code>
                      {snippet.format === "html" && (
                        <span class="tag">Rich text</span>
                      )}
                      {snippet.folderId &&
                        library.folders[snippet.folderId] && (
                          <span class="tag">
                            {library.folders[snippet.folderId].name}
                          </span>
                        )}
                    </div>
                    <p>
                      {(snippet.format === "html"
                        ? htmlToPlainText(snippet.body, document)
                        : snippet.body
                      ).split("\n")[0] || "Empty snippet"}
                      {(snippet.format === "html"
                        ? htmlToPlainText(snippet.body, document)
                        : snippet.body
                      ).includes("\n")
                        ? " …"
                        : ""}
                    </p>
                  </div>
                  <div class="card-actions">
                    <button
                      class="icon-button"
                      aria-label={`Edit ${snippet.label}`}
                      onClick={() => setEditing(snippet)}
                    >
                      ✎
                    </button>
                    <button
                      class="icon-button danger"
                      aria-label={`Delete ${snippet.label}`}
                      onClick={() => void removeSnippet(snippet)}
                    >
                      ×
                    </button>
                  </div>
                </article>
              ))}
            </div>
          ) : (
            <div class="empty">
              <div>✳</div>
              <h3>{query ? "No matches found" : "Welcome to VKeysnip"}</h3>
              <p>
                {query
                  ? "Try another search term."
                  : "Add a few examples to see how triggers work, or create your own snippet."}
              </p>
              {!query && Object.keys(library.snippets).length === 0 && (
                <div class="onboarding-samples">
                  <span>
                    <code>;hello</code> Quick greeting
                  </span>
                  <span>
                    <code>;thanks</code> Thank you
                  </span>
                  <span>
                    <code>;sig</code> Email signature
                  </span>
                  <div>
                    <button
                      class="button primary"
                      onClick={() => void installSamples()}
                    >
                      Add 3 sample snippets
                    </button>
                    <button class="button quiet" onClick={startNew}>
                      Create your own
                    </button>
                  </div>
                </div>
              )}
              {!query && Object.keys(library.snippets).length > 0 && (
                <button class="button primary" onClick={startNew}>
                  Create a snippet <span>→</span>
                </button>
              )}
            </div>
          )}
        </section>
      </section>
      <section class="exclusions-panel" aria-labelledby="exclusions-title">
        <div class="exclusions-heading">
          <div>
            <p class="eyebrow">SAFETY</p>
            <h2 id="exclusions-title">Site exclusions</h2>
            <p>
              Expansion is disabled on these sites. Changes apply to open tabs
              right away.
            </p>
          </div>
          <form
            class="exclusion-form"
            onSubmit={(event) => void addExclusion(event)}
          >
            <label class="sr-only" for="exclusion-pattern">
              Domain to exclude
            </label>
            <input
              id="exclusion-pattern"
              placeholder="example.com or *.example.com"
              value={exclusionPattern}
              onInput={(event) =>
                setExclusionPattern((event.target as HTMLInputElement).value)
              }
            />
            <button class="button primary" type="submit">
              Add site
            </button>
          </form>
        </div>
        {customExclusions.length ? (
          <ul class="exclusion-list">
            {customExclusions.map((pattern) => (
              <li key={pattern}>
                <code>{pattern}</code>
                <button
                  class="icon-button"
                  aria-label={`Remove ${pattern} exclusion`}
                  onClick={() => void removeExclusion(pattern)}
                >
                  ×
                </button>
              </li>
            ))}
          </ul>
        ) : (
          <p class="exclusion-empty">No custom exclusions yet.</p>
        )}
        <details class="default-exclusions">
          <summary>
            Built-in banking and password-manager exclusions (
            {DEFAULT_EXCLUSIONS.length})
          </summary>
          <ul>
            {DEFAULT_EXCLUSIONS.map((pattern) => (
              <li key={pattern}>
                <code>{pattern}</code>
                <span>Always on</span>
              </li>
            ))}
          </ul>
        </details>
      </section>
      <section class="settings-panel" aria-labelledby="settings-title">
        <div>
          <p class="eyebrow">PREFERENCES</p>
          <h2 id="settings-title">Expansion settings</h2>
          <p>
            Set the prefix suggested for new snippets and when triggers expand.
          </p>
        </div>
        <form
          key={`${library.settings.triggerPrefix}:${library.settings.mode}`}
          onSubmit={(event) => void saveSettings(event)}
        >
          <label>
            Trigger prefix
            <input
              name="triggerPrefix"
              required
              maxLength={8}
              defaultValue={library.settings.triggerPrefix}
            />
          </label>
          <label>
            Expansion mode
            <select name="mode" defaultValue={library.settings.mode}>
              <option value="delimiter">
                After a delimiter (space, Enter, or Tab)
              </option>
              <option value="immediate">Immediately after the trigger</option>
            </select>
          </label>
          <button class="button primary" type="submit">
            Save settings
          </button>
        </form>
      </section>
      <footer>
        <span>
          ✳ &nbsp;Private by design. Your data never leaves this device.
        </span>
        <span>VKEYSNIP &nbsp;·&nbsp; VERSION 0.1.0</span>
      </footer>
      {editing && (
        <div
          class="modal-backdrop"
          onClick={(event) => {
            if (event.target === event.currentTarget) setEditing(null);
          }}
        >
          <section
            class={`modal ${editing.format === "html" ? "rich-modal" : ""}`}
            role="dialog"
            aria-modal="true"
            aria-labelledby="editor-title"
          >
            <div class="modal-head">
              <div>
                <p class="eyebrow">SNIPPET EDITOR</p>
                <h2 id="editor-title">
                  {library.snippets[editing.id]
                    ? "Edit snippet"
                    : "New snippet"}
                </h2>
              </div>
              <button
                class="icon-button"
                aria-label="Close editor"
                onClick={() => setEditing(null)}
              >
                ×
              </button>
            </div>
            <form onSubmit={(event) => void saveSnippet(event)}>
              <label>
                Label
                <input
                  name="label"
                  required
                  maxLength={80}
                  placeholder="e.g. Email signature"
                  value={editing.label}
                  onInput={(event) =>
                    setEditing({
                      ...editing,
                      label: (event.target as HTMLInputElement).value,
                    })
                  }
                />
              </label>
              <div class="form-row">
                <label>
                  Trigger
                  <input
                    name="trigger"
                    required
                    maxLength={64}
                    value={editing.trigger}
                    onInput={(event) =>
                      setEditing({
                        ...editing,
                        trigger: (event.target as HTMLInputElement).value,
                      })
                    }
                  />
                </label>
                <label>
                  Folder
                  <select
                    name="folderId"
                    value={editing.folderId ?? ""}
                    onChange={(event) =>
                      setEditing({
                        ...editing,
                        folderId:
                          (event.target as HTMLSelectElement).value ||
                          undefined,
                      })
                    }
                  >
                    <option value="">No folder</option>
                    {folders.map((folder) => (
                      <option value={folder.id} key={folder.id}>
                        {folder.name}
                      </option>
                    ))}
                  </select>
                </label>
              </div>
              <label>
                Snippet format
                <select
                  aria-label="Snippet format"
                  value={editing.format}
                  onChange={(event) =>
                    changeFormat(
                      (event.target as HTMLSelectElement).value as
                        "text" | "html",
                    )
                  }
                >
                  <option value="text">Plain text</option>
                  <option value="html">Rich text</option>
                </select>
              </label>
              {editing.format === "html" ? (
                <div class="rich-editor-field">
                  <span class="field-label">Rich text snippet</span>
                  <div
                    class="rich-toolbar"
                    role="toolbar"
                    aria-label="Text formatting"
                  >
                    <button
                      type="button"
                      aria-label="Bold"
                      title="Bold"
                      onMouseDown={preserveRichSelection}
                      onClick={() => runRichCommand("bold")}
                    >
                      <strong>B</strong>
                    </button>
                    <button
                      type="button"
                      aria-label="Italic"
                      title="Italic"
                      onMouseDown={preserveRichSelection}
                      onClick={() => runRichCommand("italic")}
                    >
                      <em>I</em>
                    </button>
                    <button
                      type="button"
                      aria-label="Underline"
                      title="Underline"
                      onMouseDown={preserveRichSelection}
                      onClick={() => runRichCommand("underline")}
                    >
                      <u>U</u>
                    </button>
                    <button
                      type="button"
                      aria-label="Bulleted list"
                      title="Bulleted list"
                      onMouseDown={preserveRichSelection}
                      onClick={() => runRichCommand("insertUnorderedList")}
                    >
                      • List
                    </button>
                    <button
                      type="button"
                      aria-label="Numbered list"
                      title="Numbered list"
                      onMouseDown={preserveRichSelection}
                      onClick={() => runRichCommand("insertOrderedList")}
                    >
                      1. List
                    </button>
                    <input
                      aria-label="Link URL"
                      placeholder="https://example.com"
                      value={linkUrl}
                      onInput={(event) =>
                        setLinkUrl((event.target as HTMLInputElement).value)
                      }
                      onMouseDown={rememberRichSelection}
                    />
                    <button
                      type="button"
                      onMouseDown={preserveRichSelection}
                      onClick={insertRichLink}
                    >
                      Add link
                    </button>
                  </div>
                  <div
                    ref={richEditorRef}
                    class="rich-editor"
                    contentEditable
                    role="textbox"
                    aria-label="Rich text snippet"
                    aria-multiline="true"
                    aria-required="true"
                    onInput={() => {
                      rememberRichSelection();
                      setEditing({
                        ...editing,
                        body: richEditorRef.current?.innerHTML ?? editing.body,
                      });
                    }}
                    onKeyUp={rememberRichSelection}
                    onMouseUp={rememberRichSelection}
                  />
                  <span class="helper">
                    Formatting and links are kept as sanitized HTML. Images and
                    embedded content are removed.
                  </span>
                  <TemplateHelp errors={templateErrors} />
                </div>
              ) : (
                <label>
                  Snippet text
                  <textarea
                    name="body"
                    required
                    rows={7}
                    placeholder="Type the text you want to expand…"
                    value={editing.body}
                    onInput={(event) =>
                      setEditing({
                        ...editing,
                        body: (event.target as HTMLTextAreaElement).value,
                      })
                    }
                  />
                  <span class="helper">
                    Plain text · New lines are preserved
                  </span>
                  <TemplateHelp errors={templateErrors} />
                </label>
              )}
              <div class="modal-actions">
                <button
                  type="button"
                  class="button quiet"
                  onClick={() => setEditing(null)}
                >
                  Cancel
                </button>
                <button type="submit" class="button primary">
                  Save snippet
                </button>
              </div>
            </form>
          </section>
        </div>
      )}
    </main>
  );
}

render(<Dashboard />, document.getElementById("app")!);

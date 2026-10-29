import { render } from "preact";
import { useEffect, useMemo, useState } from "preact/hooks";
import { getAll, saveCustomExclusions } from "../shared/store";
import { getCustomExclusions, isSiteExcluded } from "../shared/exclusions";
import { DEFAULT_EXCLUSIONS, type Snippet } from "../shared/schema";
import { searchSnippets } from "../shared/snippet-search";
import { htmlToPlainText } from "../shared/sanitize-html";
import "./style.css";

function Popup() {
  const [hostname, setHostname] = useState("");
  const [exclusions, setExclusions] = useState<string[]>([]);
  const [snippets, setSnippets] = useState<Snippet[]>([]);
  const [tabId, setTabId] = useState<number | undefined>();
  const [query, setQuery] = useState("");
  const [notice, setNotice] = useState("Loading snippets…");

  useEffect(() => {
    let active = true;
    void (async () => {
      try {
        const library = await getAll();
        if (!active) return;
        setExclusions(library.exclusions);
        setSnippets(
          Object.values(library.snippets).sort((a, b) =>
            a.label.localeCompare(b.label),
          ),
        );
        const [tab] = await chrome.tabs.query({
          active: true,
          currentWindow: true,
        });
        if (tab?.id === undefined) throw new Error("No active tab");
        setTabId(tab.id);
        try {
          const response = (await chrome.tabs.sendMessage(tab.id, {
            type: "vkeysnip:get-current-hostname",
          })) as { hostname?: unknown } | undefined;
          if (typeof response?.hostname === "string")
            setHostname(response.hostname);
        } catch {
          // Some Chrome pages do not permit content-script access.
        }
        setNotice("");
      } catch {
        if (active) setNotice("Could not load your local snippet library.");
      }
    })();
    return () => {
      active = false;
    };
  }, []);

  const filteredSnippets = useMemo(() => {
    return searchSnippets(snippets, query);
  }, [snippets, query]);

  const defaultExcluded = hostname ? isSiteExcluded(hostname, []) : false;
  const customMatch = hostname
    ? getCustomExclusions(exclusions).find((pattern) =>
        isSiteExcluded(hostname, [pattern]),
      )
    : undefined;

  async function toggleCurrentSite(): Promise<void> {
    if (!hostname || defaultExcluded) return;
    const custom = getCustomExclusions(exclusions);
    const next = customMatch
      ? custom.filter((pattern) => pattern !== customMatch)
      : [...custom, hostname];
    await saveCustomExclusions(next);
    setExclusions([...DEFAULT_EXCLUSIONS, ...next]);
    setNotice(
      customMatch
        ? `Expansion enabled for ${customMatch}.`
        : `Expansion disabled on ${hostname}.`,
    );
  }

  async function insertSnippet(snippet: Snippet): Promise<void> {
    if (tabId === undefined) {
      setNotice("Open a supported page and focus a text field first.");
      return;
    }
    try {
      const readiness = (await chrome.tabs.sendMessage(tabId, {
        type: "vkeysnip:can-insert-snippet",
        snippetId: snippet.id,
      })) as { ok?: boolean; message?: string } | undefined;
      if (!readiness?.ok) {
        setNotice(
          readiness?.message ??
            "Focus a supported text field before inserting.",
        );
        return;
      }
      void chrome.tabs
        .sendMessage(tabId, {
          type: "vkeysnip:insert-snippet",
          snippetId: snippet.id,
        })
        .catch(() => undefined);
      window.close();
    } catch {
      setNotice("This page does not allow extension access.");
    }
  }

  return (
    <main class="popup-shell">
      <header>
        <span class="brand-mark">V</span>
        <div>
          <strong>VKeysnip</strong>
          <small>PRIVATE BY DESIGN</small>
        </div>
      </header>
      {hostname && (
        <section class="site-card">
          <p class="eyebrow">CURRENT SITE</p>
          <h1>{hostname}</h1>
          {defaultExcluded ? (
            <p class="status">
              Expansion is always disabled on this banking or password-manager
              site.
            </p>
          ) : customMatch ? (
            <>
              <p class="status">
                Expansion is disabled by <code>{customMatch}</code>.
              </p>
              <button
                class="button primary"
                onClick={() => void toggleCurrentSite()}
              >
                Remove {customMatch}
              </button>
            </>
          ) : (
            <>
              <p class="status">Expansion is enabled on this site.</p>
              <button
                class="button primary"
                onClick={() => void toggleCurrentSite()}
              >
                Exclude this site
              </button>
            </>
          )}
        </section>
      )}
      <section class="quick-insert">
        <p class="eyebrow">QUICK INSERT</p>
        <label class="snippet-search">
          <span>⌕</span>
          <input
            aria-label="Search snippets"
            placeholder="Search snippets…"
            value={query}
            onInput={(event) =>
              setQuery((event.target as HTMLInputElement).value)
            }
          />
        </label>
        {filteredSnippets.length ? (
          <ul class="quick-list">
            {filteredSnippets.map((snippet) => (
              <li key={snippet.id}>
                <button
                  class="quick-item"
                  onClick={() => void insertSnippet(snippet)}
                >
                  <span>
                    <strong>{snippet.label}</strong>
                    <small>
                      {
                        (snippet.format === "html"
                          ? htmlToPlainText(snippet.body, document)
                          : snippet.body
                        ).split("\n")[0]
                      }
                    </small>
                  </span>
                  <code>{snippet.trigger}</code>
                </button>
              </li>
            ))}
          </ul>
        ) : (
          <p class="status">
            {query
              ? "No matching snippets."
              : "No snippets yet. Create one in the dashboard."}
          </p>
        )}
      </section>
      {notice && (
        <p class="notice" role="status">
          {notice}
        </p>
      )}
      <button
        class="manage"
        onClick={() => void chrome.runtime.openOptionsPage()}
      >
        Manage snippets and exclusions <span>↗</span>
      </button>
      <footer>Your data stays on this device.</footer>
    </main>
  );
}

render(<Popup />, document.getElementById("app")!);

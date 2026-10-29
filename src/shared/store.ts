import {
  DEFAULT_EXCLUSIONS,
  DEFAULT_SETTINGS,
  SCHEMA_VERSION,
  type Folder,
  type Library,
  type Settings,
  type Snippet,
} from "./schema";
import { migrateLibrary, type StoredLibrary } from "./migrations";
import { getCustomExclusions, normalizeExclusionPattern } from "./exclusions";

const KEYS = [
  "schemaVersion",
  "snippets",
  "folders",
  "settings",
  "exclusions",
] as const;

export type StorageArea = Pick<
  typeof chrome.storage.local,
  "get" | "set" | "remove"
>;

function getStorage(): StorageArea {
  return chrome.storage.local;
}

export async function getAll(storage = getStorage()): Promise<Library> {
  const raw = await storage.get([...KEYS]);
  const version = typeof raw.schemaVersion === "number" ? raw.schemaVersion : 0;
  const library = migrateLibrary(
    {
      snippets: raw.snippets as Record<string, Snippet> | undefined,
      folders: raw.folders as Record<string, Folder> | undefined,
      settings: raw.settings as Settings | undefined,
      exclusions: raw.exclusions as string[] | undefined,
    },
    version,
  );

  if (version !== SCHEMA_VERSION) {
    await storage.set({ ...library, schemaVersion: SCHEMA_VERSION });
  }

  return { ...library, schemaVersion: SCHEMA_VERSION };
}

export async function upsertSnippet(
  snippet: Snippet,
  storage = getStorage(),
): Promise<void> {
  const { snippets } = await getAll(storage);
  await storage.set({ snippets: { ...snippets, [snippet.id]: snippet } });
}

export async function deleteSnippet(
  id: string,
  storage = getStorage(),
): Promise<void> {
  const { snippets } = await getAll(storage);
  const next = { ...snippets };
  delete next[id];
  await storage.set({ snippets: next });
}

export async function upsertFolder(
  folder: Folder,
  storage = getStorage(),
): Promise<void> {
  const { folders } = await getAll(storage);
  await storage.set({ folders: { ...folders, [folder.id]: folder } });
}

export async function deleteFolder(
  id: string,
  storage = getStorage(),
): Promise<void> {
  const { folders, snippets } = await getAll(storage);
  const nextFolders = { ...folders };
  delete nextFolders[id];
  const nextSnippets = Object.fromEntries(
    Object.entries(snippets).map(([snippetId, snippet]) => {
      if (snippet.folderId !== id) return [snippetId, snippet];
      const unfiledSnippet = { ...snippet };
      delete unfiledSnippet.folderId;
      return [snippetId, unfiledSnippet];
    }),
  );
  await storage.set({ folders: nextFolders, snippets: nextSnippets });
}

export async function importLibrary(
  imported: Partial<Library>,
  storage = getStorage(),
): Promise<void> {
  const version = imported.schemaVersion ?? SCHEMA_VERSION;
  const migrated = migrateLibrary(
    {
      snippets: imported.snippets,
      folders: imported.folders,
      settings: imported.settings,
      exclusions: imported.exclusions,
    },
    version,
  );
  await storage.set({ ...migrated, schemaVersion: SCHEMA_VERSION });
}

export async function exportLibrary(storage = getStorage()): Promise<Library> {
  return getAll(storage);
}

export async function saveCustomExclusions(
  patterns: string[],
  storage = getStorage(),
): Promise<void> {
  const normalized = patterns.map(normalizeExclusionPattern);
  if (normalized.some((pattern) => !pattern)) {
    throw new Error("Enter a valid domain such as example.com or *.example.com.");
  }
  await storage.set({
    exclusions: [...DEFAULT_EXCLUSIONS, ...getCustomExclusions(normalized as string[])],
  });
}

export async function updateSettings(
  patch: Partial<Settings>,
  storage = getStorage(),
): Promise<void> {
  const { settings } = await getAll(storage);
  await storage.set({ settings: { ...settings, ...patch } });
}

export async function addSampleSnippets(
  storage = getStorage(),
): Promise<boolean> {
  const { snippets } = await getAll(storage);
  if (Object.keys(snippets).length > 0) return false;
  const now = Date.now();
  const samples: Snippet[] = [
    {
      id: "sample_hello",
      trigger: ";hello",
      label: "Quick greeting",
      body: "Hello,\n\nThanks for getting in touch.",
      format: "text",
      createdAt: now,
      updatedAt: now,
    },
    {
      id: "sample_thanks",
      trigger: ";thanks",
      label: "Thank you",
      body: "Thanks for your help! I appreciate it.",
      format: "text",
      createdAt: now,
      updatedAt: now,
    },
    {
      id: "sample_signature",
      trigger: ";sig",
      label: "Email signature",
      body: "Best,\nYour Name",
      format: "text",
      createdAt: now,
      updatedAt: now,
    },
  ];
  await storage.set({ snippets: Object.fromEntries(samples.map((item) => [item.id, item])) });
  return true;
}

export function subscribe(onChange: (library: Library) => void): () => void {
  const listener = (
    changes: { [key: string]: chrome.storage.StorageChange },
    areaName: string,
  ) => {
    if (areaName !== "local" || !KEYS.some((key) => key in changes)) return;
    void getAll().then(onChange);
  };
  chrome.storage.onChanged.addListener(listener);
  return () => chrome.storage.onChanged.removeListener(listener);
}

export async function initializeStore(storage = getStorage()): Promise<void> {
  const raw = await storage.get([...KEYS]);
  if (typeof raw.schemaVersion !== "number") {
    await storage.set({
      schemaVersion: SCHEMA_VERSION,
      snippets: {},
      folders: {},
      settings: DEFAULT_SETTINGS,
      exclusions: DEFAULT_EXCLUSIONS,
    } satisfies StoredLibrary & { schemaVersion: number });
  } else {
    await getAll(storage);
  }
}

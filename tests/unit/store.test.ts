import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  deleteSnippet,
  deleteFolder,
  addSampleSnippets,
  exportLibrary,
  getAll,
  importLibrary,
  saveCustomExclusions,
  subscribe,
  updateSettings,
  upsertSnippet,
  upsertFolder,
  type StorageArea,
} from "../../src/shared/store";
import { SCHEMA_VERSION, type Snippet } from "../../src/shared/schema";

const data: Record<string, unknown> = {};
const listeners = new Set<
  (changes: Record<string, chrome.storage.StorageChange>, area: string) => void
>();
const storage = {
  get: vi.fn(async (keys: string[]) =>
    Object.fromEntries(
      keys.filter((key) => key in data).map((key) => [key, data[key]]),
    ),
  ),
  set: vi.fn(async (values: Record<string, unknown>) =>
    Object.assign(data, values),
  ),
  remove: vi.fn(async (keys: string | string[]) => {
    for (const key of Array.isArray(keys) ? keys : [keys]) delete data[key];
  }),
} as unknown as StorageArea;

const sample: Snippet = {
  id: "s1",
  trigger: ";sig",
  label: "Signature",
  body: "Regards",
  format: "text",
  createdAt: 1,
  updatedAt: 1,
};

beforeEach(() => {
  for (const key of Object.keys(data)) delete data[key];
  vi.clearAllMocks();
  vi.stubGlobal("chrome", {
    storage: {
      local: storage,
      onChanged: {
        addListener: (
          listener: (
            changes: Record<string, chrome.storage.StorageChange>,
            area: string,
          ) => void,
        ) => listeners.add(listener),
        removeListener: (
          listener: (
            changes: Record<string, chrome.storage.StorageChange>,
            area: string,
          ) => void,
        ) => listeners.delete(listener),
      },
    },
  });
});

describe("storage store", () => {
  it("migrates empty storage and writes separate keys", async () => {
    const library = await getAll(storage);
    expect(library.schemaVersion).toBe(SCHEMA_VERSION);
    expect(data).toHaveProperty("snippets", {});
    expect(data).toHaveProperty("folders", {});
    expect(data).toHaveProperty("settings");
    expect(data).toHaveProperty("exclusions");
  });

  it("upserts and deletes snippets without changing other keys", async () => {
    data.schemaVersion = SCHEMA_VERSION;
    data.folders = { f1: { id: "f1", name: "Work", order: 0 } };
    await upsertSnippet(sample, storage);
    expect(data.snippets).toEqual({ s1: sample });
    await deleteSnippet(sample.id, storage);
    expect(data.snippets).toEqual({});
    expect(data.folders).toEqual({ f1: { id: "f1", name: "Work", order: 0 } });
  });

  it("stores folders separately and preserves snippets when deleting a folder", async () => {
    data.schemaVersion = SCHEMA_VERSION;
    data.snippets = { s1: { ...sample, folderId: "f1" } };
    await upsertFolder({ id: "f1", name: "Work", order: 0 }, storage);
    expect(data.folders).toEqual({ f1: { id: "f1", name: "Work", order: 0 } });
    await deleteFolder("f1", storage);
    expect(data.folders).toEqual({});
    expect(data.snippets).toEqual({ s1: sample });
  });

  it("imports and exports the library", async () => {
    await importLibrary(
      { schemaVersion: 1, snippets: { s1: sample } },
      storage,
    );
    await expect(exportLibrary(storage)).resolves.toMatchObject({
      snippets: { s1: sample },
    });
  });

  it("updates trigger settings without rewriting snippet or folder data", async () => {
    data.schemaVersion = SCHEMA_VERSION;
    data.snippets = { s1: sample };
    data.folders = { f1: { id: "f1", name: "Work", order: 0 } };
    await updateSettings({ triggerPrefix: "!", mode: "immediate" }, storage);
    expect(data.settings).toMatchObject({ triggerPrefix: "!", mode: "immediate" });
    expect(data.snippets).toEqual({ s1: sample });
    expect(data.folders).toEqual({ f1: { id: "f1", name: "Work", order: 0 } });
  });

  it("adds the three onboarding snippets only to an empty library", async () => {
    await expect(addSampleSnippets(storage)).resolves.toBe(true);
    expect(Object.values(data.snippets as Record<string, Snippet>)).toHaveLength(3);
    await expect(addSampleSnippets(storage)).resolves.toBe(false);
    expect(Object.values(data.snippets as Record<string, Snippet>)).toHaveLength(3);
  });

  it("saves custom exclusions while retaining built-in safety domains", async () => {
    await saveCustomExclusions([" Example.COM ", "*.work.example"], storage);
    expect(data.exclusions).toContain("*.chase.com");
    expect(data.exclusions).toContain("*.bitwarden.com");
    expect(data.exclusions).toContain("example.com");
    expect(data.exclusions).toContain("*.work.example");
  });

  it("rejects invalid exclusion patterns without writing", async () => {
    await expect(saveCustomExclusions(["https://example.com/path"], storage)).rejects.toThrow("valid domain");
    expect(storage.set).not.toHaveBeenCalled();
  });

  it("notifies subscribers for local storage changes and can unsubscribe", async () => {
    const callback = vi.fn();
    const unsubscribe = subscribe(callback);
    for (const listener of listeners) listener({ snippets: {} }, "local");
    await vi.waitFor(() => expect(callback).toHaveBeenCalledOnce());
    unsubscribe();
    expect(listeners.size).toBe(0);
  });
});

import { describe, expect, it } from "vitest";
import { DEFAULT_EXCLUSIONS, DEFAULT_SETTINGS } from "../../src/shared/schema";
import { migrateLibrary } from "../../src/shared/migrations";

describe("migrateLibrary", () => {
  it("fills defaults when migrating an empty v0 library", () => {
    expect(migrateLibrary({}, 0)).toEqual({
      snippets: {},
      folders: {},
      settings: DEFAULT_SETTINGS,
      exclusions: DEFAULT_EXCLUSIONS,
    });
  });

  it("preserves stored values and supplies missing settings", () => {
    const snippets = {
      s1: {
        id: "s1",
        trigger: ";sig",
        label: "Signature",
        body: "Regards",
        format: "text" as const,
        createdAt: 1,
        updatedAt: 1,
      },
    };
    expect(
      migrateLibrary({ snippets, settings: { mode: "immediate" } }, 0),
    ).toEqual({
      snippets,
      folders: {},
      settings: { ...DEFAULT_SETTINGS, mode: "immediate" },
      exclusions: DEFAULT_EXCLUSIONS,
    });
  });

  it("rejects versions newer than the current schema", () => {
    expect(() => migrateLibrary({}, 2)).toThrow(
      "Unsupported schema version: 2",
    );
  });
});

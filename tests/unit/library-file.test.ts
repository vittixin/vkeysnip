// @vitest-environment jsdom
import { describe, expect, it } from "vitest";
import {
  parseLibraryBackup,
  parseLibraryCsv,
  serializeLibraryBackup,
  serializeLibraryCsv,
} from "../../src/shared/library-file";
import {
  DEFAULT_EXCLUSIONS,
  DEFAULT_SETTINGS,
  type Library,
} from "../../src/shared/schema";

const library: Library = {
  schemaVersion: 1,
  snippets: {
    s1: {
      id: "s1",
      trigger: ";sig",
      label: "Signature",
      body: "Regards,\nKetan",
      format: "text",
      createdAt: 1,
      updatedAt: 2,
    },
  },
  folders: { f1: { id: "f1", name: "Work", order: 0 } },
  settings: DEFAULT_SETTINGS,
  exclusions: DEFAULT_EXCLUSIONS,
};

describe("library backup files", () => {
  it("round trips a full library as readable JSON", () => {
    expect(parseLibraryBackup(serializeLibraryBackup(library))).toEqual(
      library,
    );
  });

  it("round trips CSV including commas, quotes, and multiline snippet bodies", () => {
    const richText = {
      ...library,
      snippets: {
        ...library.snippets,
        s2: {
          id: "s2",
          trigger: ";quote",
          label: 'A, "quoted" label',
          body: 'first line\nsecond, "quoted" line',
          format: "text" as const,
          folderId: "f1",
          createdAt: 3,
          updatedAt: 4,
        },
      },
    };
    expect(parseLibraryCsv(serializeLibraryCsv(richText))).toEqual(richText);
  });

  it("rejects malformed CSV and duplicate records", () => {
    expect(() => parseLibraryCsv("trigger,label\n;sig,Signature")).toThrow(
      "header is missing",
    );
    const csv = serializeLibraryCsv(library);
    expect(() =>
      parseLibraryCsv(`${csv}${csv.split("\r\n").at(-3)}\r\n`),
    ).toThrow();
  });

  it("rejects malformed JSON and unsupported versions", () => {
    expect(() => parseLibraryBackup("{")).toThrow("not valid JSON");
    expect(() =>
      parseLibraryBackup(JSON.stringify({ ...library, schemaVersion: 99 })),
    ).toThrow("unsupported schema version");
  });

  it("rejects invalid snippets, duplicate triggers, and missing folder references", () => {
    const invalid = {
      ...library,
      snippets: { s1: { ...library.snippets.s1, folderId: "missing" } },
    };
    expect(() => parseLibraryBackup(JSON.stringify(invalid))).toThrow(
      "snippet s1 is invalid",
    );
    const duplicate = {
      ...library,
      snippets: {
        ...library.snippets,
        s2: { ...library.snippets.s1, id: "s2", trigger: ";SIG" },
      },
    };
    expect(() => parseLibraryBackup(JSON.stringify(duplicate))).toThrow(
      "duplicate trigger",
    );
  });

  it("sanitizes rich HTML when importing JSON and CSV backups", () => {
    const richLibrary: Library = {
      ...library,
      snippets: {
        formatted: {
          id: "formatted",
          trigger: ";formatted",
          label: "Formatted",
          body: '<p onclick="x()"><strong>Welcome</strong><script>bad()</script><a href="javascript:bad()">link</a></p>',
          format: "html",
          createdAt: 4,
          updatedAt: 5,
        },
      },
    };
    const expected = "<p><strong>Welcome</strong><a>link</a></p>";

    expect(
      parseLibraryBackup(
        serializeLibraryBackup(richLibrary, document),
        document,
      ).snippets.formatted.body,
    ).toBe(expected);
    expect(
      parseLibraryCsv(serializeLibraryCsv(richLibrary, document), document)
        .snippets.formatted.body,
    ).toBe(expected);
  });
});

import { describe, expect, it } from "vitest";
import { searchSnippets } from "../../src/shared/snippet-search";
import type { Snippet } from "../../src/shared/schema";

const snippets: Snippet[] = [
  { id: "a", trigger: ";sig", label: "Email signature", body: "Best,\nA", format: "text", createdAt: 1, updatedAt: 1 },
  { id: "b", trigger: ";thanks", label: "Thank you", body: "We appreciate your help", format: "text", createdAt: 1, updatedAt: 1 },
];

describe("popup snippet search", () => {
  it("matches labels, triggers, and snippet bodies without case sensitivity", () => {
    expect(searchSnippets(snippets, "  ;SIG ").map((snippet) => snippet.id)).toEqual(["a"]);
    expect(searchSnippets(snippets, "appreciate").map((snippet) => snippet.id)).toEqual(["b"]);
  });

  it("returns every snippet for an empty search", () => {
    expect(searchSnippets(snippets, "  ")).toEqual(snippets);
  });
});

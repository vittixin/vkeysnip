import { describe, expect, it } from "vitest";
import { DEFAULT_EXCLUSIONS } from "../../src/shared/schema";
import {
  getCustomExclusions,
  isExcluded,
  isSiteExcluded,
  normalizeExclusionPattern,
} from "../../src/shared/exclusions";

describe("isExcluded", () => {
  it("matches a listed root domain and its subdomains case-insensitively", () => {
    expect(isExcluded("CHASE.COM", ["*.chase.com"])).toBe(true);
    expect(isExcluded("login.chase.com", ["*.chase.com"])).toBe(true);
  });

  it("does not match a lookalike domain", () => {
    expect(isExcluded("notchase.com", ["*.chase.com"])).toBe(false);
  });

  it("includes banking and password manager defaults", () => {
    expect(DEFAULT_EXCLUSIONS).toContain("*.bankofamerica.com");
    expect(DEFAULT_EXCLUSIONS).toContain("*.bitwarden.com");
  });

  it("always applies built-in safety exclusions, even when stored patterns are empty", () => {
    expect(isSiteExcluded("login.chase.com", [])).toBe(true);
    expect(isSiteExcluded("vault.bitwarden.com", ["example.com"])).toBe(true);
    expect(isSiteExcluded("example.com", [])).toBe(false);
  });

  it("normalizes valid domain patterns and rejects URLs or malformed hostnames", () => {
    expect(normalizeExclusionPattern("  *.Example.COM. ")).toBe("*.example.com");
    expect(normalizeExclusionPattern("https://example.com/path")).toBeUndefined();
    expect(normalizeExclusionPattern("bad..example.com")).toBeUndefined();
  });

  it("returns unique custom patterns without exposing built-in entries as removable", () => {
    expect(getCustomExclusions(["example.com", "EXAMPLE.COM", "*.chase.com"])).toEqual(["example.com"]);
  });
});

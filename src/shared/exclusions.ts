import { DEFAULT_EXCLUSIONS } from "./schema";

const defaultPatterns = new Set(DEFAULT_EXCLUSIONS.map(normalize));

export function isExcluded(
  hostname: string,
  exclusions: readonly string[],
): boolean {
  const host = normalize(hostname);
  if (!host) return false;

  return matchesAny(host, exclusions);
}

export function isSiteExcluded(
  hostname: string,
  customExclusions: readonly string[],
): boolean {
  const host = normalize(hostname);
  if (!host) return false;
  return (
    matchesAny(host, DEFAULT_EXCLUSIONS) || matchesAny(host, customExclusions)
  );
}

function matchesAny(host: string, exclusions: readonly string[]): boolean {
  return exclusions.some((pattern) => {
    const domain = normalize(pattern).replace(/^\*\./, "");
    return domain !== "" && (host === domain || host.endsWith(`.${domain}`));
  });
}

export function normalizeExclusionPattern(value: string): string | undefined {
  const trimmed = value.trim().toLowerCase().replace(/\.+$/, "");
  const wildcard = trimmed.startsWith("*.");
  const domain = wildcard ? trimmed.slice(2) : trimmed;
  if (!domain || domain.includes("*") || domain.length > 253) return undefined;
  const labels = domain.split(".");
  if (
    labels.some(
      (label) =>
        !label ||
        label.length > 63 ||
        !/^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$/.test(label),
    )
  ) {
    return undefined;
  }
  return wildcard ? `*.${domain}` : domain;
}

export function isDefaultExclusion(pattern: string): boolean {
  return defaultPatterns.has(normalize(pattern));
}

export function getCustomExclusions(exclusions: readonly string[]): string[] {
  const seen = new Set<string>();
  return exclusions.flatMap((value) => {
    const normalized = normalizeExclusionPattern(value);
    if (!normalized || isDefaultExclusion(normalized) || seen.has(normalized))
      return [];
    seen.add(normalized);
    return [normalized];
  });
}

function normalize(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .replace(/^\.+|\.+$/g, "");
}

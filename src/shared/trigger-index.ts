import type { Snippet } from "./schema";

export type TriggerIndex = ReadonlyMap<string, Snippet>;

export function buildTriggerIndex(
  snippets: Record<string, Snippet>,
  caseSensitive: boolean,
): TriggerIndex {
  const index = new Map<string, Snippet>();
  for (const snippet of Object.values(snippets)) {
    index.set(
      caseSensitive ? snippet.trigger : snippet.trigger.toLocaleLowerCase(),
      snippet,
    );
  }
  return index;
}

export function findLongestTriggerSuffix(
  text: string,
  index: TriggerIndex,
  caseSensitive: boolean,
): Snippet | undefined {
  const candidate = caseSensitive ? text : text.toLocaleLowerCase();
  for (let length = candidate.length; length > 0; length -= 1) {
    const match = index.get(candidate.slice(-length));
    if (match) return match;
  }
  return undefined;
}

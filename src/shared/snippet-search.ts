import type { Snippet } from "./schema";

export function searchSnippets(
  snippets: readonly Snippet[],
  query: string,
): Snippet[] {
  const needle = query.trim().toLocaleLowerCase();
  return snippets.filter(
    (snippet) =>
      !needle ||
      `${snippet.label} ${snippet.trigger} ${snippet.body}`
        .toLocaleLowerCase()
        .includes(needle),
  );
}

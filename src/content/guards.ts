export type GuardableField = {
  tagName?: string;
  type?: string;
  autocomplete?: string;
  readOnly: boolean;
  disabled: boolean;
};

export function shouldIgnoreField(field: GuardableField | null): boolean {
  if (!field || field.disabled || field.readOnly) return true;

  if (field.tagName?.toLowerCase() === "input") {
    const type = (field.type || "text").toLowerCase();
    if (type === "password") return true;
  }

  return (field.autocomplete ?? "")
    .toLowerCase()
    .split(/\s+/)
    .some((token) => token.startsWith("cc-"));
}

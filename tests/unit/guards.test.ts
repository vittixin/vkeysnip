import { describe, expect, it } from "vitest";
import { shouldIgnoreField } from "../../src/content/guards";

const field = (values: Record<string, unknown> = {}) => ({
  tagName: "INPUT",
  type: "text",
  autocomplete: "",
  readOnly: false,
  disabled: false,
  ...values,
});

describe("field guards", () => {
  it("allows ordinary text fields and textareas", () => {
    expect(shouldIgnoreField(field())).toBe(false);
    expect(
      shouldIgnoreField(field({ tagName: "TEXTAREA", type: undefined })),
    ).toBe(false);
  });

  it.each([
    ["password field", { type: "password" }],
    ["credit card autocomplete", { autocomplete: "cc-number" }],
    ["credit card autocomplete token", { autocomplete: "name cc-exp" }],
    ["read-only field", { readOnly: true }],
    ["disabled field", { disabled: true }],
  ])("ignores a %s", (_label, values) => {
    expect(shouldIgnoreField(field(values))).toBe(true);
  });
});

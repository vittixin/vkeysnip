import { describe, expect, it } from "vitest";
import {
  expandTemplate,
  getTemplateSyntaxErrors,
} from "../../src/shared/expand-template";

const fixtures: {
  name: string;
  template: string;
  values: Record<string, string>;
  expected: string;
}[] = [
  ...Array.from({ length: 10 }, (_, index) => {
    const offset = index - 5;
    const date = new Date(2025, 0, 10);
    date.setDate(date.getDate() + offset);
    const expected = [
      date.getFullYear(),
      `${date.getMonth() + 1}`.padStart(2, "0"),
      `${date.getDate()}`.padStart(2, "0"),
    ].join("-");
    return {
      name: `date math ${offset}`,
      template: `{date${offset >= 0 ? "+" : ""}${offset}d}`,
      values: {},
      expected,
    };
  }),
  ...Array.from({ length: 10 }, (_, index) => ({
    name: `checked conditional ${index}`,
    template: `Before {if:approved}item-${index}{/if} After`,
    values: { approved: index % 2 === 0 ? "true" : "false" },
    expected: index % 2 === 0 ? `Before item-${index} After` : "Before  After",
  })),
  ...Array.from({ length: 10 }, (_, index) => ({
    name: `dropdown ${index}`,
    template: `Status: {dropdown:status|Draft|Review|Published}-${index}`,
    values: { status: ["Draft", "Review", "Published"][index % 3] },
    expected: `Status: ${["Draft", "Review", "Published"][index % 3]}-${index}`,
  })),
];

describe("dynamic template fixtures", () => {
  it.each(fixtures)("expands $name", ({ template, values, expected }) => {
    expect(getTemplateSyntaxErrors(template)).toEqual([]);
    expect(expandTemplate(template, new Date(2025, 0, 10), values).text).toBe(
      expected,
    );
  });
});

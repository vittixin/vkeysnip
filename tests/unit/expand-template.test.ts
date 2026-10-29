import { describe, expect, it } from "vitest";
import {
  expandTemplate,
  getPromptFieldNames,
  getTemplateSyntaxErrors,
} from "../../src/shared/expand-template";

describe("expandTemplate", () => {
  const date = new Date(2025, 11, 31, 9, 7);

  it("expands local date and time placeholders", () => {
    expect(expandTemplate("{date} {time}", date).text).toBe("2025-12-31 09:07");
  });

  it("removes the cursor marker and reports its caret offset", () => {
    expect(expandTemplate("Hi {cursor}there", date)).toEqual({
      text: "Hi there",
      cursorOffset: 3,
    });
  });

  it("computes the cursor offset after expanded placeholders", () => {
    expect(expandTemplate("{date}{cursor}", date)).toEqual({
      text: "2025-12-31",
      cursorOffset: 10,
    });
  });

  it("leaves placeholders reserved for later tasks untouched", () => {
    expect(expandTemplate("{clipboard} {name}", date)).toEqual({
      text: "{clipboard} {name}",
      cursorOffset: undefined,
    });
  });

  it("finds unique user prompt fields but excludes built-in markers", () => {
    expect(
      getPromptFieldNames(
        "Hi {name}, {company_name}. {name} {date} {time} {cursor} {clipboard}",
      ),
    ).toEqual(["name", "company_name"]);
  });

  it("inserts multiline values and keeps the cursor offset correct", () => {
    expect(
      expandTemplate("Hello {name}{cursor}!", date, { name: "Ada\nLovelace" }),
    ).toEqual({
      text: "Hello Ada\nLovelace!",
      cursorOffset: "Hello Ada\nLovelace".length,
    });
  });

  it("expands clipboard data only when a value is supplied", () => {
    expect(
      expandTemplate("Before\n{clipboard}{cursor}After", date, {
        clipboard: "line one\nline two",
      }),
    ).toEqual({
      text: "Before\nline one\nline twoAfter",
      cursorOffset: "Before\nline one\nline two".length,
    });
  });

  it("expands dropdown, checkbox, conditional, and date-math fields", () => {
    const template =
      "{dropdown:status|New|Done} {checkbox:approved}{if:approved} Approved {date+7d}{/if}";
    expect(
      expandTemplate(template, date, { status: "Done", approved: "true" }).text,
    ).toBe("Done Yes Approved 2026-01-07");
    expect(
      expandTemplate(template, date, { status: "New", approved: "false" }).text,
    ).toBe("New ");
  });

  it("reports actionable errors for invalid dynamic-field syntax", () => {
    expect(getTemplateSyntaxErrors("{dropdown:status|Only one}")[0]).toContain(
      "Use {dropdown:name|Option 1|Option 2}",
    );
    expect(getTemplateSyntaxErrors("{if:approved}yes")[0]).toContain(
      "missing a closing",
    );
    expect(getTemplateSyntaxErrors("no{/if}")[0]).toContain(
      "without a matching",
    );
    expect(getTemplateSyntaxErrors("{date+tomorrow}")[0]).toContain(
      "Use {date+7d}",
    );
    expect(getTemplateSyntaxErrors("{dropdown:status|New")[0]).toContain(
      "Close the field with }",
    );
  });
});

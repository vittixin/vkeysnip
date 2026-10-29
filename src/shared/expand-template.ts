import {
  parseTemplate,
  type DynamicField,
  type TemplateNode,
} from "./template-parser";

export type ExpandedTemplate = {
  text: string;
  cursorOffset: number | undefined;
};

export function getTemplateFields(template: string): DynamicField[] {
  return parseTemplate(template).fields;
}

export function getPromptFieldNames(template: string): string[] {
  return getTemplateFields(template).map((field) => field.name);
}

export function expandTemplate(
  template: string,
  now = new Date(),
  values: Readonly<Record<string, string>> = {},
): ExpandedTemplate {
  const parsed = parseTemplate(template);
  const fields = new Map(parsed.fields.map((field) => [field.name, field]));
  const localTime = [
    now.getHours().toString().padStart(2, "0"),
    now.getMinutes().toString().padStart(2, "0"),
  ].join(":");
  let cursorOffset: number | undefined;
  let output = "";
  const append = (value: string) => {
    output += value;
  };
  const render = (nodes: readonly TemplateNode[]) => {
    for (const node of nodes) {
      if (node.type === "text") append(node.value);
      else if (node.type === "if") {
        const value = values[node.name];
        if (value && value !== "false") render(node.children);
      } else if (node.type === "field") {
        const field = fields.get(node.name);
        const value = Object.hasOwn(values, node.name)
          ? values[node.name]
          : `{${node.name}}`;
        append(
          field?.kind === "checkbox" ? (value === "true" ? "Yes" : "") : value,
        );
      } else if (node.type === "builtin") {
        if (node.name === "cursor") {
          if (cursorOffset === undefined) cursorOffset = output.length;
        } else if (node.name === "clipboard") {
          append(values.clipboard ?? "{clipboard}");
        } else append(localTime);
      } else {
        const shifted = new Date(
          now.getFullYear(),
          now.getMonth(),
          now.getDate(),
        );
        shifted.setDate(shifted.getDate() + node.offsetDays);
        append(formatLocalDate(shifted));
      }
    }
  };
  render(parsed.nodes);
  return { text: output, cursorOffset };
}

export function getTemplateSyntaxErrors(template: string): string[] {
  return parseTemplate(template).errors;
}

function formatLocalDate(date: Date): string {
  return [
    date.getFullYear().toString().padStart(4, "0"),
    (date.getMonth() + 1).toString().padStart(2, "0"),
    date.getDate().toString().padStart(2, "0"),
  ].join("-");
}

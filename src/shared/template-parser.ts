export type DynamicField =
  | { name: string; kind: "text" }
  | { name: string; kind: "dropdown"; options: string[] }
  | { name: string; kind: "checkbox" };

export type TemplateNode =
  | { type: "text"; value: string }
  | { type: "field"; name: string }
  | { type: "date"; offsetDays: number }
  | { type: "builtin"; name: "time" | "clipboard" | "cursor" }
  | { type: "if"; name: string; children: TemplateNode[] };

export type ParsedTemplate = {
  nodes: TemplateNode[];
  fields: DynamicField[];
  errors: string[];
};

const namePattern = /^[A-Za-z][A-Za-z0-9_]*$/;

export function parseTemplate(source: string): ParsedTemplate {
  const fields = new Map<string, DynamicField>();
  const errors: string[] = [];
  let position = 0;

  function register(field: DynamicField): void {
    const prior = fields.get(field.name);
    if (prior && JSON.stringify(prior) !== JSON.stringify(field)) {
      errors.push(
        `Field ${field.name} is defined more than once with different types or options.`,
      );
      return;
    }
    fields.set(field.name, field);
  }

  function parseSequence(nested: boolean): {
    nodes: TemplateNode[];
    closed: boolean;
  } {
    const nodes: TemplateNode[] = [];
    while (position < source.length) {
      const open = source.indexOf("{", position);
      if (open < 0) break;
      const close = source.indexOf("}", open + 1);
      if (close < 0) {
        const remainder = source.slice(open);
        if (/^\{(?:dropdown|checkbox|if:|date[+-])/.test(remainder)) {
          errors.push(
            `Incomplete template field ${remainder}. Close the field with }.`,
          );
        }
        break;
      }
      if (open > position)
        nodes.push({ type: "text", value: source.slice(position, open) });
      const raw = source.slice(open + 1, close);
      const content = raw.trim();
      position = close + 1;

      if (content === "/if") {
        if (nested) return { nodes, closed: true };
        errors.push("Found {\\/if} without a matching {if:name}.");
        nodes.push({ type: "text", value: source.slice(open, close + 1) });
        continue;
      }
      const condition = /^if:([A-Za-z][A-Za-z0-9_]*)$/.exec(content);
      if (condition) {
        const child = parseSequence(true);
        if (!child.closed)
          errors.push(
            `Condition {if:${condition[1]}} is missing a closing {\\/if}.`,
          );
        nodes.push({ type: "if", name: condition[1], children: child.nodes });
        continue;
      }
      if (content.startsWith("if:")) {
        errors.push(
          `Invalid condition {${content}}. Use {if:field}...{\\/if}.`,
        );
        nodes.push({ type: "text", value: source.slice(open, close + 1) });
        continue;
      }
      if (content.startsWith("dropdown")) {
        const [name = "", ...rawOptions] = content.startsWith("dropdown:")
          ? content.slice("dropdown:".length).split("|")
          : [];
        const options = rawOptions.map((option) => option.trim());
        if (
          !namePattern.test(name) ||
          options.length < 2 ||
          options.some((option) => !option)
        ) {
          errors.push(
            `Invalid dropdown {${content}}. Use {dropdown:name|Option 1|Option 2}.`,
          );
          nodes.push({ type: "text", value: source.slice(open, close + 1) });
        } else {
          register({ name, kind: "dropdown", options });
          nodes.push({ type: "field", name });
        }
        continue;
      }
      if (content.startsWith("checkbox")) {
        const name = content.slice("checkbox:".length);
        if (!content.startsWith("checkbox:") || !namePattern.test(name)) {
          errors.push(`Invalid checkbox {${content}}. Use {checkbox:name}.`);
          nodes.push({ type: "text", value: source.slice(open, close + 1) });
        } else {
          register({ name, kind: "checkbox" });
          nodes.push({ type: "field", name });
        }
        continue;
      }
      const date = /^date([+-])(\d+)d$/.exec(content);
      if (date) {
        const amount = Number(date[2]);
        nodes.push({
          type: "date",
          offsetDays: date[1] === "+" ? amount : -amount,
        });
      } else if (content === "date")
        nodes.push({ type: "date", offsetDays: 0 });
      else if (
        content === "time" ||
        content === "clipboard" ||
        content === "cursor"
      ) {
        nodes.push({ type: "builtin", name: content });
      } else if (namePattern.test(content)) {
        register({ name: content, kind: "text" });
        nodes.push({ type: "field", name: content });
      } else if (/^date[+-]/.test(content)) {
        errors.push(
          `Invalid date math {${content}}. Use {date+7d} or {date-2d}.`,
        );
        nodes.push({ type: "text", value: source.slice(open, close + 1) });
      } else nodes.push({ type: "text", value: source.slice(open, close + 1) });
    }
    if (position < source.length)
      nodes.push({ type: "text", value: source.slice(position) });
    position = source.length;
    return { nodes, closed: false };
  }

  const result = parseSequence(false);
  return {
    nodes: result.nodes,
    fields: [...fields.values()],
    errors: [...new Set(errors)],
  };
}

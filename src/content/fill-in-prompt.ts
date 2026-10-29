export type FillInResult = {
  values: Record<string, string>;
  clipboardText?: string;
};

import type { DynamicField } from "../shared/template-parser";

export function requestFillInValues(
  document: Document,
  fields: readonly (string | DynamicField)[],
  readClipboard?: () => Promise<string>,
): Promise<FillInResult | null> {
  return new Promise((resolve) => {
    const host = document.createElement("div");
    host.dataset.vkeysnipPrompt = "true";
    host.style.cssText =
      "all:initial!important;position:fixed!important;inset:0!important;z-index:2147483647!important;";
    const shadow = host.attachShadow({ mode: "closed" });
    const style = document.createElement("style");
    style.textContent = `
      :host{all:initial}
      .backdrop{position:fixed;inset:0;display:grid;place-items:center;padding:18px;background:#10150db3;font:14px/1.45 system-ui,sans-serif;color:#20251f}
      .panel{box-sizing:border-box;width:min(440px,100%);max-height:90vh;overflow:auto;padding:22px;border:1px solid #e7e8e1;border-radius:12px;background:#fff;box-shadow:0 18px 70px #0005}
      h2{margin:0 0 6px;font-size:19px;line-height:1.25}
      p{margin:0 0 16px;color:#73796d;font-size:12px}
      form{display:grid;gap:12px}
      label{display:grid;gap:5px;font-size:12px;font-weight:600}
      textarea{box-sizing:border-box;width:100%;min-height:56px;resize:vertical;padding:9px 10px;border:1px solid #dfe2d8;border-radius:7px;font:13px/1.5 system-ui,sans-serif;color:#20251f}
      textarea:focus{outline:3px solid #c9ed6066;border-color:#91ad43}
      .actions{display:flex;justify-content:flex-end;gap:8px;margin-top:4px}
      button{padding:9px 13px;border:0;border-radius:7px;font:600 12px system-ui,sans-serif;cursor:pointer}
      .cancel{background:#f1f2ed;color:#4e5547}.submit{background:#c9ed60;color:#263319}
      .status{min-height:1em;margin:0;color:#9b3d30;font-size:12px}
    `;
    const backdrop = document.createElement("div");
    backdrop.className = "backdrop";
    const panel = document.createElement("section");
    panel.className = "panel";
    panel.setAttribute("role", "dialog");
    panel.setAttribute("aria-modal", "true");
    panel.setAttribute("aria-labelledby", "vkeysnip-fill-title");
    const heading = document.createElement("h2");
    heading.id = "vkeysnip-fill-title";
    heading.textContent = "Fill in this snippet";
    const intro = document.createElement("p");
    intro.textContent = readClipboard
      ? "Fill in any requested values. Clipboard text is read only when you choose Insert."
      : "These values are used once and are not saved.";
    const form = document.createElement("form");
    const inputs = new Map<
      string,
      HTMLTextAreaElement | HTMLSelectElement | HTMLInputElement
    >();
    for (const rawField of fields) {
      const field: DynamicField =
        typeof rawField === "string"
          ? { name: rawField, kind: "text" }
          : rawField;
      const { name } = field;
      const label = document.createElement("label");
      label.textContent = name.replaceAll("_", " ");
      if (field.kind === "checkbox") {
        const input = document.createElement("input");
        input.type = "checkbox";
        input.name = name;
        label.append(input);
        inputs.set(name, input);
      } else if (field.kind === "dropdown") {
        const input = document.createElement("select");
        input.name = name;
        for (const text of field.options) {
          const option = document.createElement("option");
          option.value = text;
          option.textContent = text;
          input.append(option);
        }
        label.append(input);
        inputs.set(name, input);
      } else {
        const input = document.createElement("textarea");
        input.name = name;
        input.rows = 2;
        input.autocomplete = "off";
        label.append(input);
        inputs.set(name, input);
      }
      form.append(label);
    }
    const status = document.createElement("p");
    status.className = "status";
    status.setAttribute("role", "status");
    const actions = document.createElement("div");
    actions.className = "actions";
    const cancel = document.createElement("button");
    cancel.type = "button";
    cancel.className = "cancel";
    cancel.textContent = "Cancel";
    const submit = document.createElement("button");
    submit.type = "submit";
    submit.className = "submit";
    submit.textContent = readClipboard
      ? "Read clipboard and insert"
      : "Insert snippet";
    actions.append(cancel, submit);
    form.append(status, actions);
    panel.append(heading, intro, form);
    backdrop.append(panel);
    shadow.append(style, backdrop);
    document.documentElement.append(host);

    let settled = false;
    const close = (result: FillInResult | null) => {
      if (settled) return;
      settled = true;
      host.remove();
      resolve(result);
    };
    cancel.addEventListener("click", () => close(null));
    form.addEventListener("submit", (event) => {
      event.preventDefault();
      const values: Record<string, string> = {};
      for (const [name, input] of inputs) {
        values[name] =
          input.tagName === "INPUT" &&
          (input as HTMLInputElement).type === "checkbox"
            ? (input as HTMLInputElement).checked
              ? "true"
              : "false"
            : input.value;
      }
      let clipboardPromise: Promise<string> | undefined;
      try {
        clipboardPromise = readClipboard?.();
      } catch {
        status.textContent =
          "Clipboard access was denied. You can try again or cancel.";
        return;
      }
      if (!clipboardPromise) {
        close({ values });
        return;
      }
      submit.disabled = true;
      cancel.disabled = true;
      status.textContent = "Reading clipboard…";
      void clipboardPromise.then(
        (clipboardText) => close({ values, clipboardText }),
        () => {
          status.textContent =
            "Clipboard access was denied. You can try again or cancel.";
          submit.disabled = false;
          cancel.disabled = false;
        },
      );
    });
    (inputs.values().next().value ?? submit).focus();
  });
}

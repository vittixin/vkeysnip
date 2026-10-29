const host = document.querySelector("v-editor");
const shadow = host.attachShadow({ mode: "open" });
const editor = document.createElement("div");
editor.id = "target";
editor.setAttribute("contenteditable", "true");
editor.setAttribute("role", "textbox");
shadow.append(editor);

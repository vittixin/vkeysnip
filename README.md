# VKeysnip

VKeysnip is a free, open-source (MIT), privacy-first Chrome text expander. Type a short trigger such as `;sig` in a text field to expand it into saved text. Snippets and settings stay in Chrome's local extension storage.

## Install from source

```sh
npm install
npm run build
```

Then open `chrome://extensions`, enable **Developer mode**, choose **Load unpacked**, and select the generated `dist/` directory. Pin VKeysnip from the extensions menu to open its popup. The popup can exclude the current website. Use **Manage all exclusions and snippets** to open the dashboard.

## Use VKeysnip

1. In the dashboard, create a snippet with a label and trigger, then choose **Plain text** or **Rich text** for its body.
2. Type the trigger into a supported input, textarea, or plain-text contenteditable field.
3. By default, press Space, Enter, or Tab to expand. In **Immediate** mode, expansion happens as soon as the trigger is complete.
4. Use **Expansion settings** to choose the default prefix for new triggers and the expansion mode.
5. Open the popup to search snippets and insert one at the focused field, or toggle expansion for the current website.
6. Use **Site exclusions** to disable expansion for selected domains. Built-in banking and password-manager exclusions are always active.
7. Export JSON or CSV backups regularly. Import validates the file and shows a count preview before replacing the library.

An empty library offers three optional sample snippets. They are added only when you choose **Add 3 sample snippets**.

Rich snippets support bold, italic, underline, lists, and links. Stored HTML is sanitized; images, embedded content, styles, and unsafe link schemes are removed. Rich snippets paste formatted content into contenteditable editors and flatten to plain text in inputs and textareas.

Template markers include `{date}`, `{time}`, `{date+7d}`, `{date-2d}`, and `{cursor}`. Use `{clipboard}` to insert clipboard text after confirming the in-page prompt, or `{name}` to ask for text during expansion. Dynamic forms also support `{dropdown:status|New|Done}`, `{checkbox:approved}`, and conditional blocks such as `{if:approved}Approved{/if}`. Checkbox fields insert “Yes” when checked and nothing when unchecked. Prompt values are used for that expansion only and are not saved with the snippet. Invalid field syntax is shown in the dashboard before saving. See [the compatibility matrix](docs/compat.md) for real-site testing status.

## Development

```sh
npm run dev
npm run lint
npm run typecheck
npm test
npm run build
npm run test:e2e
```

The build checks the content script for network APIs and keeps its compressed size below 50 KB. Playwright tests use local fixture pages; logged-in services are tested manually.

## Privacy

VKeysnip has no account, cloud service, telemetry, analytics, or network requests. It reads the active editable field only to detect a saved trigger. It does not log page text, browsing history, or full URLs. For details, see [PRIVACY.md](PRIVACY.md).

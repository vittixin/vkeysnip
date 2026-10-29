# Chrome Web Store listing draft

## Name

VKeysnip — Private Text Expander

## Short description

Expand your reusable text with short triggers. Your snippets stay on your device.

## Detailed description

VKeysnip turns short triggers such as `;sig` into the words and formatting you reuse every day. Create and organize plain-text or rich-text snippets in a simple local library, then expand them in supported text fields as you type.

- Search snippets and insert one at the current caret from the popup.
- Format rich snippets with emphasis, lists, and links; unsafe markup is removed locally.
- Use folders, prefix and expansion settings, and per-site exclusions.
- Add `{date}`, `{date+7d}`, `{time}`, `{cursor}`, `{clipboard}`, prompt fields such as `{name}`, dropdowns, checkboxes, and conditional blocks.
- Export and restore your library with validated JSON or CSV backups.
- Keep snippets, folders, settings, and exclusions in local extension storage.

VKeysnip has no account, cloud service, telemetry, analytics, or network requests. The content script reads the active editable field only as needed to detect a configured trigger. Clipboard text is read only when a snippet includes `{clipboard}` and the user confirms insertion in the in-page prompt. Password fields and fields marked with `autocomplete="cc-*"` are skipped. Built-in banking and password-manager exclusions are always active.

## Single purpose

VKeysnip expands user-authored plain-text snippets when a user types a configured trigger in an editable field.

## Permission justifications

- **Storage:** Save snippets, folders, expansion preferences, and site exclusions locally in Chrome.
- **Clipboard read:** Read clipboard text only for a `{clipboard}` field, after the user confirms insertion.
- **Clipboard write:** Copy a snippet only as a fallback when the target field cannot accept the insertion; show a notice when this happens.
- **Site access (`<all_urls>` content script):** Detect triggers and insert the user's snippet in editable fields on pages they visit. Password and payment-card fields are skipped, sensitive sites have built-in exclusions, and users can manage additional exclusions.

## Privacy disclosures

- Data collected: none.
- Data sold or transferred: none.
- Data processed locally: snippet library and the active field text needed to match a configured trigger; clipboard text only for explicit `{clipboard}` expansions.
- Remote code or network requests: none.

## Release status

This is draft listing copy for the v1.0.0 candidate. Do not claim rich-editor compatibility until the manual checks in [the compatibility matrix](../compat.md) are recorded. Store submission and publication are not complete.

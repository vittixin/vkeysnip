# VKeysnip Privacy Policy

VKeysnip does not collect or transmit user data. It has no account, cloud service, telemetry, analytics, or network requests. Snippets, folders, settings, and exclusions are stored locally in Chrome using `chrome.storage.local`.

## Text and browsing activity

The content script reads text in the active editable field only as needed to detect a configured trigger and replace it. It does not log page text, retain page text, or store browsing history or full page URLs. A domain is saved in local exclusions only when the user chooses to exclude it. Password fields and fields marked with `autocomplete="cc-*"` are skipped.

Rich snippet HTML is sanitized locally before it is saved, imported, exported, or inserted. Only a small formatting and link allowlist is retained; images, embedded content, styling, scripts, and unsafe link schemes are removed.

## Clipboard

`clipboardWrite` is used as a fallback if a snippet cannot be inserted; the extension shows a notice when this happens. For a snippet containing `{clipboard}`, VKeysnip reads clipboard text only after the user confirms **Insert snippet** in the in-page prompt. Clipboard and prompted values are used for that expansion only and are not saved. Line breaks are preserved.

## Backups and deletion

JSON and CSV backups are created only when the user requests an export and are downloaded through Chrome. VKeysnip does not upload or inspect exported files. To remove locally stored data, uninstall VKeysnip or clear its data in Chrome's extension settings.

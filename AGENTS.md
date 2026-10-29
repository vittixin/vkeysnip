# AGENTS.md: VKeysnip

## Project

VKeysnip is a free, open-source (MIT), privacy-first Chrome text expander (Manifest V3). Users type a trigger (e.g. `;sig`) and it expands to saved text. All data stays in `chrome.storage.local`. No accounts, no cloud, no telemetry, no network requests.

## Stack (do not change without asking)

- TypeScript (strict), Vite + CRXJS (`@crxjs/vite-plugin`)
- Preact for popup and dashboard only; the content script is framework-free
- Vitest (unit), Playwright (e2e, persistent Chromium context with the built extension)
- ESLint + Prettier, GitHub Actions CI

## Layout

```text
src/content/       trigger detection and text insertion (no framework, < 50 KB gzipped)
src/background/    service worker (must hold no in-memory state)
src/popup/         popup UI
src/dashboard/     dashboard UI
src/shared/        schema, store, template expansion, typed messages
tests/unit/        unit tests
tests/e2e/         end-to-end tests
docs/              project documentation
```

## Commands

- Install: `npm install`
- Dev build: `npm run dev`
- Build: `npm run build`
- Lint: `npm run lint`
- Typecheck: `npm run typecheck`
- Unit tests: `npm test`
- E2E: `npm run test:e2e`

Run lint, typecheck, and unit tests before finishing any task.

## Hard Rules

- Never add `fetch`, `XMLHttpRequest`, `WebSocket`, analytics, or remote scripts.
- Never add permissions beyond `storage`, `clipboardRead`, `clipboardWrite` (plus the content script on `<all_urls>`) without asking.
- Never log or store page text, URLs, or snippet contents anywhere outside `chrome.storage.local`.
- Skip password fields and `autocomplete="cc-*"` fields in the content script.
- Use `beforeinput`/`input` events, not `keydown`, and ignore `isComposing`.
- Storage keys are separate (`schemaVersion`, `snippets`, `folders`, `settings`, `exclusions`); never one storage key per trigger.
- Any schema change needs a migration function plus a fixture test.
- No new dependencies without asking; prefer platform APIs.

## Out of Scope Until Told Otherwise

Contenteditable support, rich text/HTML snippets, Google Docs adapter, and on-device AI.

## Working Style

- Make small, focused commits with clear messages.
- Add or update tests with every behavior change; every real-site bug gets a fixture page and a regression test.
- If requirements are unclear or a rule here blocks the task, stop and ask.
- Finish each task with a short summary: what changed, how to test it, and open questions.

# Contributing

Thanks for helping improve VKeysnip. Keep changes focused and preserve its local-first design: do not add network calls, telemetry, remote scripts, or dependencies without maintainer approval.

## Development setup

Use Node.js 22 and npm, then run `npm install`. Run `npm run dev` for the Vite development server or `npm run build` to produce the Chrome extension in `dist/`.

## Before opening a pull request

Run:

```sh
npm run lint
npm run typecheck
npm test
npm run build
```

Add or update unit tests for behavior changes. Keep the content script framework-free and below 50 KB gzipped. Any storage schema change must include a pure migration and a fixture test. Explain the change and its rationale in the pull request; include screenshots for UI changes.

Playwright tests use a persistent Chromium context with the built extension. Install the browser once with `npx playwright install chromium`, then run `npm run test:e2e`. The command builds the extension and local fixtures first; React is bundled only into the React test fixture.

Use small commits with clear, imperative subjects, such as `Add schema migration for folders`.

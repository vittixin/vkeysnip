# v1.0 release candidate assets

Regenerate the extension and the listing graphics locally:

```sh
npm run build
node scripts/prepare-release-assets.mjs
```

Generated files in `assets/`:

- `vkeysnip-icon-128.png`: Chrome Web Store and extension icon.
- `dashboard-1280x800.png`: dashboard listing screenshot using fictional sample data.
- `promo-tile-440x280.png`: small Chrome Web Store promotional tile.

The editable promo tile source is `promo-tile.html`; the icon source is `public/assets/vkeysnip-icon.svg`. Listing text and permission justifications are in `store-listing.md`.

Before submission, complete the real-editor checks in `../compat.md`, review the store listing and privacy disclosures, upload the package through the Chrome Web Store Developer Dashboard, and tag the approved source as `v1.0.0`.

## Local performance pass

The Playwright fixtures check expansion using 10,000 snippets and idle renderer heap using 1,000 snippets. The latest run reported 4.3 ms end-to-end expansion and 1.72 MB JS heap, within the plan's `<100 ms` and `<20 MB` budgets. A Vitest microbenchmark also checks that the trigger matching decision averages under 2 ms with 10,000 snippets. Playwright event-dispatch timings are not used for the handler budget because they include automation and browser dispatch overhead.

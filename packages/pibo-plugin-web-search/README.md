# C1 Pilot: `@pasko70/pibo-plugin-web-search`

Package-local pilot for `pibo.web-search` (Beta 4.0, C1). No behavior change:
the plugin setup stays single-sourced in `src/plugins/packaged-web-search.ts`;
this directory proves the K06 pattern — manifest, bundled backend, bundled
browser view, declared dependencies — on the real implementation.

## Layout

- `package.json` — wrapper identity (name, version, files). No runtime
  dependencies: the backend bundle is fully self-contained.
- `pibo.plugin.json` — pilot manifest. Must stay deep-equal to the canonical
  `webSearchPackageManifest()` factory plus the builder's entrypoint rewrite
  (`backend.mjs`, `browser/index.js`). Canonical values are owned by I; the
  pilot test pins them, it does not redefine them.
- `src/backend.ts` — backend entry, re-exports `setupWebSearch as setup`.
- `src/browser.ts` — browser entry, re-exports `ToolFamilyView`.

## Declared dependencies

None at runtime. Build-time only: the root builder's esbuild configuration,
mirrored package-locally by `test/pilot-web-search-install.test.mjs`.

## Transitional imports (documented, not permanent)

| Specifier | Owner | Need | Expiry |
|---|---|---|---|
| `src/backend.ts` → `src/plugins/packaged-web-search.js` | B/I (K02/K06 boundary) | single-sourced behavior, no fork | neutral SDK export or declared dependency |
| `src/browser.ts` → `src/apps/chat-ui/src/plugins/tool-family-view.js` | D (K05 shell) | unchanged settings/context subviews | K05 v1 decision |

The built artefacts must contain no remaining relative (backend) or bare React
(browser) imports; the pilot test enforces this on every run.

## Preserved behavior

Tool `web_search` stays Pi-exclusive (`runtime.adapterIds: ["pi"]`,
`yieldable: false`, provider-tool execution). No new services, no renamed
contributions, no user data in the install path.

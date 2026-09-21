# C1 Pilot: `@pasko70/pibo-plugin-vscode-web`

Package-local pilot for `pibo.vscode-web` (Beta 4.0, C1). No behavior change:
the plugin setup stays single-sourced in `src/plugins/packaged-vscode-web.ts`
and the view in `src/apps/chat-ui/src/plugins/vscode-view.tsx`; this directory
proves the K06 pattern — manifest, bundled backend, bundled browser view,
declared dependencies — on the real implementation.

## Layout

- `package.json` — wrapper identity (name, version, files). No runtime
  dependencies: the backend bundle is fully self-contained.
- `pibo.plugin.json` — pilot manifest. Must stay deep-equal to the canonical
  `vscodeWebPackageManifest()` factory plus the builder's entrypoint rewrite
  (`backend.mjs`, `browser/index.js`). Canonical values are owned by I; the
  pilot test pins them, it does not redefine them.
- `src/backend.ts` — backend entry, re-exports `setupVscodeWeb as setup`.
- `src/browser.ts` — browser entry, re-exports `VscodeView` plus the pure
  helpers `vscodeWebUrl`/`vscodeWorkbenchReady` for artefact-level checks.

## Declared dependencies

None at runtime. Build-time only: the root builder's esbuild configuration,
mirrored package-locally by `test/pilot-vscode-web-install.test.mjs`.

## Transitional imports (documented, not permanent)

| Specifier | Owner | Need | Expiry |
|---|---|---|---|
| `src/backend.ts` → `src/plugins/packaged-vscode-web.js` | B/I (K02/K06 boundary) | single-sourced behavior, no fork | neutral SDK export or declared dependency |
| `src/browser.ts` → `src/apps/chat-ui/src/plugins/vscode-view.js` | C (view stays in place for C1) | unchanged route/props/lifecycle/fallback | G1-gated C2/I2 move of the view source |

The built artefacts must contain no remaining relative (backend) or bare React
(browser) imports; the pilot test enforces this on every run.

## Preserved behavior

- Route `GET /api/chat/vscode-web` (200 shape, same-origin rule, 405 on other
  methods) via required service `pibo.chat.extensions@1.0.0`.
- `PluginViewProps` contract, probe states (`checking`/`ready`/`unavailable`),
  abort handling and the unconfigured fallback of `VscodeView`.
- No visual change in C1; no new headful acceptance is owed by this pilot.
  Existing headful coverage for the view is untouched.

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
  Pilot delta vs the root builder (C1-R06): the builder bundles `VscodeView`
  only; this pilot additionally exports the 2 check helpers. Browser bundle =
  builder pattern + 2 check helpers (vscode only).

## Declared dependencies

None at runtime. Build-time only: the root builder's esbuild configuration,
mirrored package-locally by `test/pilot-vscode-web-install.test.mjs`.
Build toolchain: the repo's provisioned esbuild, resolved from the root
`node_modules` at test time. Exact versions are recorded per run in the pilot
test's JSON log line (`esbuildVersion`/`nodeVersion`); no minimum version is
claimed (C1-R07).

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
- Headful acceptance of the pilot browser artefact is REQUIRED (C1-R01):
  `test/pilot-vscode-web-browser.test.mjs` mounts the built bundle in real
  Chromium (headful gate plus a headless supplement that never replaces it).
  This pilot itself makes no visual changes to the view.

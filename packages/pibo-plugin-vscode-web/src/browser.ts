// C1 pilot browser entry for pibo.vscode-web.
//
// Re-exports the canonical VscodeView (same export the root builder bundles for
// the vscode-web package). Route, props contract, lifecycle, probe states and
// the unconfigured fallback stay exactly as implemented in the view source.
//
// TRANSITIONAL SOURCE BOUNDARY (documented, pending C2/I2 move): the relative
// import below is bundled away at build time with the host React-bridge shims.
// Owner: C view source stays in place for C1; the package owns its view source
// only after the G1-gated move. Artefact-side boundary is enforced by test:
// built browser/index.js must contain no bare react/react-dom/react-query imports.
export { VscodeView } from "../../../src/apps/chat-ui/src/plugins/vscode-view.js";
export { vscodeWebUrl, vscodeWorkbenchReady } from "../../../src/apps/chat-ui/src/plugins/vscode-view.js";

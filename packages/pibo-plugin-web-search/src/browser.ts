// C1 pilot browser entry for pibo.web-search.
//
// Re-exports the canonical ToolFamilyView used by the standard composition for
// this plugin (same export the root builder bundles for the web-search package).
//
// TRANSITIONAL SOURCE BOUNDARY (documented, pending D/I decision): the relative
// import below is bundled away at build time with the host React-bridge shims.
// Owner: D K05 shared-shell decision (host bridge export vs documented per-bundle
// duplication). Need: unchanged settings/context subviews. Expiry: K05 v1.
// Artefact-side boundary is enforced by test: built browser/index.js must contain
// no bare react/react-dom/react-query imports.
export { ToolFamilyView } from "../../../src/apps/chat-ui/src/plugins/tool-family-view.js";

// C1 pilot backend entry for pibo.web-search.
//
// Single-sourced re-export of the in-repo plugin setup: behavior stays owned by
// src/plugins/packaged-web-search.ts, this package only proves the K06 packaging
// pattern (manifest + bundled backend + declared dependencies).
//
// TRANSITIONAL SOURCE BOUNDARY (documented, pending B/I decision): the relative
// import below is bundled away at build time. Owner: B/I K02/K06 source-boundary
// decision (SDK export or declared dependency). Need: no behavior fork while the
// boundary is undecided. Expiry: replaced once the neutral boundary exists.
// Artefact-side boundary is enforced by test: built backend.mjs must contain no
// remaining relative import specifiers.
export { setupWebSearch as setup } from "../../../src/plugins/packaged-web-search.js";

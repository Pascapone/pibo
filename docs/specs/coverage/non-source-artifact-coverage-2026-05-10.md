# Coverage Analysis: Non-Source Artifact Spec Coverage

**Status:** Draft
**Created:** 2026-05-10
**Controller / Source:** Scheduled Pibo Source Specs Coverage from current workspace code
**Related docs:** `GLOSSARY.md`, `docs/specs/coverage/source-specs-coverage-2026-05-10.md`, `docs/specs/capabilities/package-build-and-distribution.md`, `docs/specs/capabilities/docker-compute-workers.md`, `docs/specs/capabilities/browser-automation-desktop-environment.md`, `docs/specs/capabilities/chat-web-static-shell-and-pwa-assets.md`, `docs/specs/capabilities/web-deployment-scripts.md`

## Why

The current `src/` tree is already broadly covered by capability specs. The remaining coverage risk is in executable project artifacts outside `src/`: root package metadata, Docker launch files, utility scripts, and generated web assets. These files affect build, deployment, browser automation, PWA output, and performance validation, but they are easier to miss when coverage checks look only at TypeScript source directories.

This analysis records the non-source artifacts inspected in this run and identifies the next useful spec work without duplicating existing capability specs.

## Scope

### In Scope

- Root package and compiler metadata that define build and validation behavior.
- Docker and compose artifacts used to run Pibo with browser automation support.
- Executable scripts under `scripts/`.
- Chat Web public PWA asset generation inputs and outputs.
- Existing specs under `docs/specs/` that already own these behaviors.

### Out of Scope

- TypeScript source directories already mapped in `source-specs-coverage-2026-05-10.md`.
- Legacy documents outside `docs/specs/` as authority.
- Source-code changes or test execution.

## Coverage Matrix

| Artifact area | Current coverage | Coverage status | Notes |
|---|---|---:|---|
| `package.json`, `tsconfig.json` | `capabilities/package-build-and-distribution.md` | Covered | Package identity, scripts, build boundaries, package files, and typecheck/test scripts are already specified. |
| `scripts/deploy-web-dev.sh`, `scripts/deploy-web.sh` | `capabilities/web-deployment-scripts.md` | Covered | Dev and production web deployment behavior, including production backup refresh and no implicit restart, is specified. |
| `Dockerfile`, `docker-compose.yml`, `scripts/docker-entrypoint.sh` | `capabilities/docker-compute-workers.md`, `capabilities/browser-automation-desktop-environment.md` | Partly covered | Compute-worker lifecycle and browser desktop prerequisites are covered, but the standalone container entrypoint contract is not isolated in one spec. |
| `scripts/prepare-browser-use-wrapper.sh` | `capabilities/curated-cli-tools.md`, `capabilities/browser-automation-desktop-environment.md` | Covered | Persistent Chrome/CDP wrapper behavior is covered by curated-tool and desktop-environment specs. |
| `scripts/chat-web-performance-check.mjs` | `capabilities/chat-web-virtualized-session-scrolling.md` | Covered | The performance check is covered as the validation script for large-session scrolling behavior. |
| `scripts/bench-signal-registry.mjs` | `capabilities/pibo-session-signals.md` | Weak | Signal semantics are specified, but the benchmark script's tunable performance contract is only implicit. |
| `scripts/pad-pwa-icons.py`, `src/apps/chat-ui/public/assets/pwa-images/**`, `manifest.webmanifest`, `sw.js` | `capabilities/chat-web-static-shell-and-pwa-assets.md` | Weak | Static serving and caching are specified. The icon-padding generation script and expected source/output constraints are not behavior-specified. |

## Remaining Gaps for Future Runs

### Gap: Standalone Docker image runtime contract is scattered

The Dockerfile installs Node 24, Chromium, Xvfb, uv, browser-use, builds the package, prepares the browser-use wrapper, exposes gateway/CDP ports, and uses `scripts/docker-entrypoint.sh` to start `gateway:web` with dev auth by default. Existing specs cover Docker compute workers and browser automation, but no single spec states the observable behavior of running the repository's standalone image or compose service.

**Suggested next artifact:** `docs/specs/capabilities/standalone-docker-runtime.md` if standalone Docker/Compose remains a supported operator path distinct from `pibo compute`.

### Gap: PWA icon generation is executable but underspecified

`scripts/pad-pwa-icons.py` parses PNG files from a zip using only the Python standard library, rejects unsupported PNG formats, scales each icon inside its original canvas, writes generated files under the Chat Web PWA image tree, and validates `--scale` bounds. The static-shell spec covers serving these assets, but not how generated assets are produced or what failures should be expected.

**Suggested next artifact:** either extend `chat-web-static-shell-and-pwa-assets.md` with a focused requirement for icon generation, or create `docs/specs/capabilities/chat-web-pwa-icon-generation.md` if the script is part of the maintained release workflow.

### Gap: Signal benchmark behavior is not a verification contract

`scripts/bench-signal-registry.mjs` imports the built signal registry from `dist`, builds a configurable deep session tree, projects leaf tool and queue events, and prints timing labels. The signal spec covers behavior and aggregation, but not benchmark inputs, required build state, or acceptable output shape.

**Suggested next artifact:** a small extension to `pibo-session-signals.md` if the benchmark is an official regression aid; otherwise keep it as an internal diagnostic script and avoid a dedicated capability spec.

## Success Criteria for This Analysis

- [x] The artifact was written under `docs/specs/coverage/` because core source behavior is already broadly specified.
- [x] It inspected existing spec titles and source coverage before identifying new gaps.
- [x] It avoids duplicate specs for package build, deployment, browser automation, and Chat Web static serving.
- [x] It names concrete future specs only where current executable artifacts have weak behavior coverage.

## Verification Basis

This analysis is based on current workspace files:

- `GLOSSARY.md`
- `docs/specs/` file inventory and spec titles
- `docs/specs/coverage/source-specs-coverage-2026-05-10.md`
- `package.json`
- `tsconfig.json`
- `Dockerfile`
- `docker-compose.yml`
- `scripts/docker-entrypoint.sh`
- `scripts/prepare-browser-use-wrapper.sh`
- `scripts/bench-signal-registry.mjs`
- `scripts/pad-pwa-icons.py`
- `src/apps/chat-ui/public/manifest.webmanifest`
- `src/apps/chat-ui/public/sw.js`

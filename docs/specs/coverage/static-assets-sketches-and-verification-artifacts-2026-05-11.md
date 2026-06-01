# Coverage Analysis: Static Assets, Sketches, and Verification Artifacts 2026-05-11

**Status:** Draft
**Created:** 2026-05-11
**Controller / Source:** Scheduled Pibo Source Specs Coverage; current workspace code and artifacts
**Related docs:** `GLOSSARY.md`, `AGENTS.md`, [Chat Web PWA Icon Generation](../capabilities/chat-web-pwa-icon-generation.md), [Chat Web Static Shell and PWA Assets](../capabilities/chat-web-static-shell-and-pwa-assets.md), [Pibo Workflow Framework Package](../capabilities/pibo-workflow-framework-package.md), [Core Plugin Profiles and Built-In Skill](../capabilities/core-plugin-profiles-and-built-in-skill.md), [Unreferenced Artifact Triage 2026-05-11](./unreferenced-artifact-triage-2026-05-11.md), [Direct Source Path Coverage Closure 2026-05-11](./direct-source-path-coverage-closure-2026-05-11.md)

## Why

The current `docs/specs/` tree already names every TypeScript source path under `src/` and all checked-in scripts. A broader scan still finds source-adjacent artifacts that are easy to misclassify: generated PWA PNG assets, workflow package test fixtures, `.gitkeep` placeholders, and `sketches/profiles.ts`.

Creating a new capability spec for these files would duplicate existing behavior contracts. This coverage artifact records their stewardship so future scheduled runs can keep expanding source-backed specs without turning generated assets, tests, or abandoned sketches into false product surfaces.

## Goal

Future source-spec runs SHOULD treat these artifacts as covered by existing capability specs or as non-contractual support material unless current code promotes one of them into an executed, shipped, or user-visible behavior surface.

## Scope

### In Scope

- Static Chat Web public PWA assets under `src/apps/chat-ui/public/assets/pwa-images/`.
- Chat Web install metadata in `src/apps/chat-ui/public/manifest.webmanifest` and service-worker behavior in `src/apps/chat-ui/public/sw.js`.
- Workflow package verification artifacts under `packages/workflows/src/testing/` and placeholder `.gitkeep` files under package source directories.
- The prototype profile sketch in `sketches/profiles.ts`.
- Existing specs under `docs/specs/`.

### Out of Scope

- Source-code, test-code, or asset changes.
- Docker, gateway, browser, or build execution.
- Generated `dist/`, backup directories, local `.pibo` state, and dependency directories.
- Legacy documents as truth over current workspace files.

## Findings

### Finding: PWA PNG assets are generated/static outputs, not individual behavior specs

The public PWA image tree currently contains Android, iOS, and Windows PNG variants under `src/apps/chat-ui/public/assets/pwa-images/`. The current manifest references the Android `192x192` and `512x512` launcher icons, and the Chat UI HTML shell references the iOS `180.png` Apple touch icon.

The durable behavior is already managed by `chat-web-pwa-icon-generation.md` and `chat-web-static-shell-and-pwa-assets.md`: generation must preserve served paths, install metadata must point at existing assets, and the web host/service worker must serve or cache assets under `/apps/chat/assets/`.

#### Future acceptance

- Do not create one spec per generated PNG file.
- If icon generation changes sizes, paths, or platform directories, update `chat-web-pwa-icon-generation.md`.
- If serving, caching, manifest scope, or service-worker behavior changes, update `chat-web-static-shell-and-pwa-assets.md`.
- A path-reference check may treat the asset directory as covered when the owning specs name the directory and verify the manifest/HTML-referenced files.

### Finding: Workflow package tests are verification evidence for the package contract

The files under `packages/workflows/src/testing/` exercise runtime, validation, persistence, retry, human-node, XState projection, and inspection behavior. They are not package API entry points. The package capability spec owns the behavior through requirements and may cite individual tests only as verification evidence.

Placeholder `.gitkeep` files under empty workflow source subdirectories carry no runtime behavior. They should not drive new specs unless a future package module gains public code under that directory.

#### Future acceptance

- New workflow test files should update the verification matrix in `pibo-workflow-framework-package.md` when they cover a requirement.
- New public workflow source modules should update or extend `pibo-workflow-framework-package.md` before a separate capability spec is created.
- `.gitkeep` files remain ignored for behavior coverage.

### Finding: `sketches/profiles.ts` is non-contractual prototype material

`sketches/profiles.ts` contains an early, non-exported sketch of tool, skill, context-file, and initial-session-context builder ideas. The executable implementation lives in `src/core/profiles.ts`, `src/core/runtime.ts`, and the plugin profile builders. Existing capability specs already cover the implemented behavior for profile construction, runtime assembly, context files, skills, tools, subagents, and package selection.

The sketch is not part of the build, package exports, tests, CLI, web app, gateway, or runtime loading path. Treating it as source-of-truth would conflict with the current implemented profile system.

#### Future acceptance

- Do not create a capability spec from `sketches/profiles.ts` unless it is moved into executed source or package exports.
- If the sketch is promoted into real code, base the spec on the promoted implementation, not the old sketch comments.
- Until then, implemented profile behavior remains managed by `core-plugin-profiles-and-built-in-skill.md`, `pibo-runtime-assembly-and-inspection.md`, `context-files.md`, `user-skills.md`, `curated-cli-tools.md`, `subagent-delegation.md`, and `pi-packages.md`.

## Coverage Decision

No new product or technical capability spec is needed in this run. The highest-value artifact is this coverage decision because it closes the remaining non-source and source-adjacent classification gap without duplicating existing specs.

## Success Criteria

- [x] SC-001: Existing `docs/specs/` were inventoried before this artifact was written.
- [x] SC-002: PWA binary assets are assigned to existing PWA generation and static-shell specs rather than individual image specs.
- [x] SC-003: Workflow package test and placeholder artifacts are assigned to the workflow package capability spec or ignored as non-behavioral placeholders.
- [x] SC-004: `sketches/profiles.ts` is classified as non-contractual prototype material, with implemented owning specs named.
- [x] SC-005: No source code, tests, assets, gateway process, cron job, or Docker worker was changed.

## Verification Basis

This analysis is based on the current workspace files and inventories:

- `GLOSSARY.md`
- `AGENTS.md`
- complete `docs/specs/` file inventory
- direct path-reference scan of `src/`, `scripts/`, `packages/workflows/`, `sketches/`, and `src/apps/chat-ui/public/`
- `src/apps/chat-ui/public/manifest.webmanifest`
- `src/apps/chat-ui/public/sw.js`
- `src/apps/chat-ui/index.html`
- `src/apps/chat-ui/public/assets/pwa-images/`
- `scripts/pad-pwa-icons.py`
- `packages/workflows/src/testing/`
- `packages/workflows/src/**/.gitkeep`
- `sketches/profiles.ts`
- `src/core/profiles.ts`
- `src/core/runtime.ts`
- `src/plugins/builtin.ts`

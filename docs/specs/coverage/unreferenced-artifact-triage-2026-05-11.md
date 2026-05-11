# Coverage Analysis: Unreferenced Artifact Triage 2026-05-11

**Status:** Draft  
**Created:** 2026-05-11  
**Owner / Source:** Scheduled Pibo Source Specs Coverage; current workspace code and specs  
**Related docs:** `GLOSSARY.md`, `AGENTS.md`, [Package Build and Distribution](../capabilities/package-build-and-distribution.md), [Chat Web Trace and Terminal View](../capabilities/chat-web-trace-and-terminal-view.md), [Chat Web Safe Content Rendering](../capabilities/chat-web-safe-content-rendering.md), [Docker Compute Workers](../capabilities/docker-compute-workers.md), [Web Auth and Same-Origin Host](../capabilities/web-auth-and-same-origin-host.md), [Pibo Workflow Framework Package](../capabilities/pibo-workflow-framework-package.md)

## Why

Most current `src/`, `packages/workflows/`, and `scripts/` behavior now has a capability spec or a coverage decision. A final inventory pass should still identify artifacts that are not named directly in existing specs, so future scheduled runs do not create duplicate specs for files that are already covered by a broader behavioral contract.

This analysis treats current code and checked-in artifacts as the source of truth. It uses direct path references in `docs/specs/**/*.md` only as a coverage signal, not as proof that behavior is implemented.

## Goal

Identify remaining source-adjacent artifacts that are not directly referenced from specs and decide whether each needs a new behavior spec, belongs under an existing spec, or is intentionally non-contractual support material.

## Scope

### In Scope

- Files under `src/`, `packages/workflows/src/`, `scripts/`, and `examples/` that are not directly named in current markdown specs.
- Coverage ownership decisions for small UI support files, package build config, embedded skills, workflow test fixtures, and examples.
- Future acceptance checks for promoting any remaining artifact into a capability spec.

### Out of Scope

- Generated `dist/`, worktrees, local `.pibo` state, and binary/static image files.
- Rewriting existing capability specs during this run.
- Treating path-reference absence as a behavior gap when an existing spec already owns the behavior.

## Current Inventory Findings

### Finding: Frontend package and TypeScript config files are build inputs, not standalone capabilities

Unreferenced artifacts include:

- `src/apps/chat-ui/package.json`
- `src/apps/chat-ui/tsconfig.json`
- `src/apps/context-files-ui/tsconfig.json`
- `src/apps/context-files-ui/index.html`

These files are owned by the package/build and static-shell contracts. Their externally visible behavior is whether Chat UI and Context Files UI can typecheck, build, and serve from their configured bases. A separate spec for each config file would duplicate the package-build contract.

#### Future acceptance

- Keep this ownership unless a config file begins to expose user-visible routing, auth, or runtime behavior that is not already covered by build/static-shell specs.
- If that happens, extend `package-build-and-distribution.md` or the relevant web-app static asset spec rather than creating a config-file spec.

### Finding: UI style files are presentation support under existing UI behavior specs

Unreferenced artifacts include:

- `src/apps/chat-ui/src/styles.css`
- `src/apps/context-files-ui/src/styles.css`
- `src/apps/chat-ui/src/session-views/compact-terminal/TerminalLine.tsx`

The CSS files and terminal line component implement visual presentation for behavior already specified in Chat Web trace/terminal, safe rendering, markdown editor, and context-files specs. `TerminalLine.tsx` maps compact terminal row prefixes, token tones, weights, function-call rendering, and optional line clamping into DOM output; it does not define a separate product capability from compact terminal rendering.

#### Future acceptance

- Add a focused UI rendering spec only if style or terminal line behavior becomes externally testable policy, such as accessibility contrast requirements, fixed terminal glyph semantics, or a public theming contract.
- Until then, future specs SHOULD cite the owning terminal/context UI specs instead of creating a component-level spec.

### Finding: The Docker dev-auth skill is instructional context for existing dev-auth behavior

`src/skills/pibo-debug-auth/SKILL.md` is not referenced by current specs. The skill describes how agents log into Chat Web inside Docker compute workers using the worker-only dev-auth plugin. The actual behavior is owned by Docker Compute Workers, Web Auth and Same-Origin Host, Standalone Docker Runtime, and Browser-use Authenticated Leases.

The skill itself is a context artifact: it must remain aligned with the current worker login flow, fixed dev identity, cookie name behavior, loopback-only constraint, and host-gateway fail-closed rule. It does not create a new auth surface.

#### Future acceptance

- If the skill changes expected endpoints, identity, cookie behavior, or safety constraints, update the owning dev-auth specs in the same change.
- If Pibo starts registering this skill as a selectable product capability, create a capability spec for built-in shipped skills and include this skill there.

### Finding: Workflow package tests are implementation verification, not separate product contracts

Several package test files under `packages/workflows/src/testing/` are not named individually in current specs. The workflow framework package spec already owns their behavior at requirement level: authoring helpers, registry, validation, runtime dispatch, persistence, inspection, XState projection, fixtures, and retry/edge-transfer behavior.

The unmatched paths are specific test cases rather than product surfaces. Creating one spec per test would fragment the workflow contract and duplicate `pibo-workflow-framework-package.md`.

#### Future acceptance

- When a workflow test adds a new externally visible behavior, add or update a requirement in `pibo-workflow-framework-package.md` or the Workflow System V1 change spec.
- Keep test filenames in verification sections only where they clarify coverage for a requirement.

### Finding: Example READMEs are operator examples derived from existing contracts

Unreferenced artifacts include:

- `examples/gateway/README.md`
- `examples/web/README.md`

The gateway example demonstrates the local gateway, console client, `/status`, `/clear`, `/abort`, and TUI gateway producer tool. The web example demonstrates Better Auth configuration, OAuth redirect origins, sign-in/out behavior, same-origin mutation protection, and stable Chat Web routes. Those behaviors are already owned by the local gateway, gateway request client, web auth, Chat Web bootstrap/navigation, and config specs.

The examples SHOULD remain executable documentation, but they do not need separate capability specs unless examples become tested release artifacts.

#### Future acceptance

- If examples are added to CI or package distribution as supported demos, create an `operator-examples` capability spec with pass/fail checks for each example.
- Until then, update the owning capability specs when example behavior changes.

## Coverage Decision

No new product capability spec is needed for the currently unreferenced artifacts. The remaining gaps are traceability and documentation-maintenance gaps, not uncovered user-facing behavior. Future scheduled runs should prioritize updating the owning capability specs when one of these artifacts changes behavior.

## Success Criteria

- [x] SC-001: A current inventory pass identified unreferenced artifacts under `src/`, `packages/workflows/src/`, `scripts/`, and `examples/` after excluding generated and local state.
- [x] SC-002: Each remaining unreferenced artifact category has an owning existing spec or a clear future acceptance trigger.
- [x] SC-003: The analysis avoids creating duplicate component, config, example, or test-file specs.
- [x] SC-004: The decision is based on current workspace files, not legacy documents.

## Verification Basis

This coverage analysis was based on:

- Full `docs/specs/` file inventory and heading inspection.
- Direct path-reference comparison across `docs/specs/**/*.md` for files under `src/`, `packages/workflows/src/`, `scripts/`, and `examples/`.
- Source inspection of `src/apps/chat-ui/src/session-views/compact-terminal/TerminalLine.tsx`.
- Source inspection of `src/skills/pibo-debug-auth/SKILL.md`.
- Source inspection of `examples/gateway/README.md` and `examples/web/README.md`.
- Current file inventory under `packages/workflows/src/testing/`.

# Coverage Analysis: Spec Inventory Deduplication 2026-05-11

**Status:** Draft  
**Created:** 2026-05-11  
**Owner / Source:** Scheduled Pibo Source Specs Coverage; current workspace code and `docs/specs/` inventory  
**Related docs:** `docs/specs/README.md`, `docs/specs/capabilities/spec-status-and-traceability.md`, `docs/specs/coverage/source-specs-continuation-readiness-2026-05-11.md`, `docs/specs/coverage/source-specs-verification-handoff-2026-05-11.md`

## Why

The scheduled source-spec job must keep expanding useful coverage without creating duplicate contracts. The current workspace already contains capability specs for the major source-owned surfaces: routed sessions, gateway protocol, Chat Web, auth, context files, tools, MCP, Pi packages, scheduled jobs, Ralph, reliability, data stores, workflow packages, Docker runtime, and validation.

This run found that the next safest artifact is not another capability spec. A new behavior spec would mostly restate existing files. This coverage note records the duplicate-avoidance decision and points future runs toward source changes or verification-specific gaps instead.

## Goal

Prevent duplicate capability specs by documenting which source areas are already owned by existing specs and what evidence a future run needs before adding another source-backed spec.

## Scope

### In Scope

- Current `docs/specs/` inventory and capability ownership.
- Source areas inspected during this run.
- Criteria for when a future scheduled run should create a new spec instead of a coverage note.
- Remaining weak spots that are better handled by verification or focused amendments to existing specs.

### Out of Scope

- Source-code changes.
- Moving or deleting legacy root-level documents.
- Reclassifying existing draft specs as approved or done.
- Adding tests or changing validation commands.

## Current Coverage State

The inspected spec inventory already contains current source-backed coverage for these source seams:

| Source area | Owning spec family | Deduplication decision |
|---|---|---|
| `src/core`, `src/sessions`, `src/gateway`, `src/local` | Routing, event contract, session store, gateway lifecycle, local routed TUI, runtime assembly | Do not create another routing/gateway spec without changed behavior. |
| `src/apps/chat`, `src/apps/chat-ui`, `src/shared/trace-*`, `src/signals` | Chat Web rooms, bootstrap/navigation, trace/terminal, compaction, workflow views, projects, settings, signals | Add only focused amendments when a concrete UI/API behavior is missing. |
| `src/auth`, `src/web`, `src/plugins/*auth*` | Web auth and same-origin host; model-provider auth | Do not split provider login or Better Auth unless a new auth boundary appears. |
| `src/cron`, `src/ralph`, `src/reliability`, `src/runs` | Scheduled jobs, continuous Ralph jobs, reliable event core, yielded-run control | Future work should strengthen verification basis, not duplicate behavior contracts. |
| `src/data`, `src/debug` | Pibo data store and ingestion, data maintenance CLI, debug CLI, live-only delta maintenance | Keep diagnostics as debug/data specs unless they become user-facing product capabilities. |
| `src/tools`, `src/mcp`, `src/pi-packages`, `src/user-skills`, `src/skills` | Curated CLI tools, persistent runtime tool, MCP integration, Pi packages, user skills | Existing capability specs own catalog, install, and runtime-selection behavior. |
| `src/compute`, `Dockerfile`, `docker-compose.yml`, `scripts/*docker*` | Docker compute workers and standalone Docker runtime | Do not create a third Docker spec unless the runtime and worker contracts diverge. |
| `packages/workflows` | Workflow change specs and workflow framework package capability spec | Workflow behavior should continue under the workflow change/capability specs. |
| `package.json`, `tsconfig.json`, build/deploy scripts | Package build and distribution, project validation harness, web deployment scripts | Build/test/deploy behavior is already covered. |

## Findings

### Finding: No unowned major product capability was found in this run

#### Current

The source tree and existing specs were inspected before writing this note. Every top-level implemented product area has a plausible owning capability spec or an existing coverage analysis that explains why no standalone capability spec is needed.

#### Acceptance for future runs

A future run SHOULD create a new capability spec only when it can name an implemented source behavior that has no owner in the table above and is not covered by the related specs listed in that file.

### Finding: The strongest remaining work is verification traceability

#### Current

Several coverage analyses identify weak verification areas, especially Ralph service/store behavior, newer CLI discovery surfaces, UI renderer safety, and source-inspected-only Chat Web details. Those are not new product capabilities; they are test and traceability gaps.

#### Acceptance for future runs

If the task remains documentation-only, future runs SHOULD either:

- amend the owning capability spec with a missing requirement and verification basis, or
- create a narrow coverage note that maps the unverified behavior to its owning spec.

### Finding: Root-level legacy documents are context, not current source truth

#### Current

Root-level documents such as old TUI, terminal, trace, and user-skill notes still exist, but current specs already cover those capabilities under `docs/specs/capabilities/`. The scheduled task treats code as the source of truth and legacy docs only as context.

#### Acceptance for future runs

A future documentation cleanup should happen under a separate docs task. It should not create duplicate specs from legacy docs unless current code exposes behavior missing from `docs/specs/`.

## Success Criteria

- [x] SC-001: This run creates exactly one documentation artifact under `docs/specs/`.
- [x] SC-002: The artifact does not duplicate an existing capability contract.
- [x] SC-003: The artifact lists inspected source areas and their owning spec families.
- [x] SC-004: Future runs receive concrete criteria for when to add a new spec versus a coverage note or amendment.

## Verification Basis

- Read `GLOSSARY.md` and `AGENTS.md` before inspecting specs.
- Inspected the full `docs/specs/` file inventory with `find docs/specs -type f`.
- Inspected spec headings across `docs/specs/**/*.md` to detect duplicate capability names and current coverage notes.
- Inspected source layout under `src/`, `src/apps/chat-ui/src`, `src/apps/context-files-ui/src`, `packages/workflows`, `scripts/`, `Dockerfile`, `docker-compose.yml`, `package.json`, and `tsconfig.json`.
- Compared likely source seams against existing capability and coverage specs before choosing this coverage artifact.

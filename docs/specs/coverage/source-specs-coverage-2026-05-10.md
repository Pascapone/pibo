# Coverage Analysis: Source Specs Coverage Snapshot

**Status:** Draft
**Created:** 2026-05-10
**Controller / Source:** Scheduled Pibo Source Specs Coverage
**Related docs:** `docs/specs/README.md`, `GLOSSARY.md`, `AGENTS.md`

## Why

The scheduled source-specs job must keep expanding Pibo specs without creating duplicates. The current `docs/specs/` tree already covers most top-level source areas, so a coverage checkpoint is more useful than another overlapping capability spec.

This analysis records which source areas have durable behavior specs, where coverage is strong enough for now, and which gaps remain for future scheduled runs.

## Scope

### In Scope

- Current source directories under `src/`.
- Current specs under `docs/specs/`.
- Testable gaps that future runs can turn into capability specs or focused extensions.

### Out of Scope

- Legacy documents outside `docs/specs/` as sources of truth.
- Source-code changes.
- Claims about unimplemented roadmap behavior.

## Coverage Matrix

| Source area | Current coverage | Coverage status | Notes |
|---|---|---:|---|
| `src/api` | `capabilities/simple-agent-http-api.md` | Covered | Simple HTTP agent API has a focused behavior spec. |
| `src/apps/chat`, `src/apps/chat-ui` | Chat Web room, trace, cache, shell, rendering, output, file-download, projects, custom-agent, cron, model, context, data specs | Covered | Coverage is broad. Future specs should avoid duplicating Chat Web basics. |
| `src/apps/context-files-ui`, `src/plugins/context-files*` | `capabilities/context-files.md` | Covered | Managed and plugin context-file behavior is specified. |
| `src/auth`, `src/web`, `src/plugins/better-auth.ts`, `src/plugins/dev-auth.ts` | `capabilities/web-auth-and-same-origin-host.md`, `capabilities/model-provider-auth-and-session-selection.md` | Covered | Web auth, dev auth, provider login, and usage behavior are captured. |
| `src/bin`, `src/cli.ts`, `src/cli-errors.ts` | `capabilities/operator-cli-discovery-and-dispatch.md`, `capabilities/operator-cli-error-contract.md` | Covered | General CLI dispatch and error behavior are covered; command-specific behavior lives in capability specs. |
| `src/compute` | `capabilities/docker-compute-workers.md` | Covered | Worker lifecycle and dev-auth isolation have a current spec. |
| `src/config` | `capabilities/local-config-cli.md` | Covered | Local config persistence, redaction, and CLI behavior are covered. |
| `src/core` | Runtime, session routing, event contract, prompt, model, home/workspace, codex profile specs | Covered | Core product-boundary behavior has several focused specs. |
| `src/cron` | `capabilities/scheduled-pibo-jobs.md` | Covered | Durable jobs, reservations, visible routed runs, and Chat Web APIs are specified. |
| `src/data` | `capabilities/pibo-data-store-and-ingestion.md` | Covered | V2 data store and ingestion are covered. |
| `src/debug` | `capabilities/debug-cli.md` | Covered | Read-only store/session/trace diagnostics are specified. |
| `src/gateway`, `src/channels` | `capabilities/local-gateway-protocol-and-lifecycle.md`, `capabilities/core-gateway-actions-and-session-controls.md` | Covered | Protocol, lifecycle, channels, and gateway actions are specified. |
| `src/local` | `capabilities/local-routed-tui.md` | Covered | Routed terminal adapter behavior is covered. |
| `src/mcp` | `capabilities/mcp-server-integration.md`, `capabilities/mcp-registry-python-runtimes.md` | Covered | MCP config, calls, daemon, registry, and Python runtime installs are covered. |
| `src/pi-packages` | `capabilities/pi-packages.md` | Covered | Package store, installer, catalog, CLI, Chat Web, and runtime loading are covered. |
| `src/plugins` | `capabilities/plugin-registry-and-capability-catalog.md` plus plugin-specific specs | Covered | Registry behavior and major plugin capabilities are covered. |
| `src/reliability` | `capabilities/reliable-event-core.md` | Covered | Event streams, durable jobs, yielded-run records, and pruning are covered. |
| `src/runs` | `capabilities/yielded-run-control.md` | Covered | Run-control tools and run registry behavior are covered. |
| `src/sessions` | `capabilities/pibo-session-store.md`, `capabilities/pibo-session-routing.md` | Covered | Store semantics and routing identity are covered. |
| `src/shared` | `capabilities/chat-web-trace-and-terminal-view.md`, `capabilities/chat-web-cache-and-live-state.md` | Covered | Trace ordering/projection behavior is covered through Chat Web specs. |
| `src/signals` | `capabilities/pibo-session-signals.md` | Covered | Signal producers, aggregation, registry, and SSE contracts are covered. |
| `src/skills`, `src/user-skills` | `capabilities/user-skills.md` | Covered | User-skill CLI, store, install, catalog sync, and runtime expansion are covered. |
| `src/subagents` | `capabilities/subagent-delegation.md` | Covered | Child session delegation and trace surfacing are covered. |
| `src/tools` | Curated tools, browser-use, persistent runtime, web-search, desktop specs | Covered | Current tool families have focused specs. |

## Remaining Gaps for Future Runs

### Gap: Spec status is inconsistent

Several specs mark implemented current behavior as `Draft`, while traceability rows mix `Draft`, `Covered`, `Implemented`, and `Pending`. Future coverage work should standardize what spec status means before using it as a project-health signal.

**Suggested next artifact:** `docs/specs/capabilities/spec-status-and-traceability.md` or a small extension to `docs/specs/README.md` if that file already owns conventions.

### Gap: Cross-spec stewardship of Chat Web v2 data vs legacy stores is hard to audit

The specs correctly distinguish Pibo Session Store, Chat Web Read Model, Chat Event Log, v2 Pibo Data Store, Projects Store, Cron Store, Auth Store, and Reliability Store. However, no single current spec lists which store owns which product fact and which consumers may treat it as canonical.

**Suggested next artifact:** a capability spec for local store stewardship and canonical-data boundaries, unless future inspection finds this already captured in `docs/project/` and better suited as canonical documentation.

### Gap: Test coverage pointers are uneven

Most specs include a verification basis, but success criteria often point to future tests without naming current tests. Future runs can tighten high-value specs by mapping each requirement to existing tests and marking uncovered acceptance checks.

**Suggested next artifact:** a coverage report under `docs/specs/coverage/` per subsystem, not a duplicate behavior spec.

## Success Criteria for This Analysis

- [x] The analysis was written only under `docs/specs/coverage/`.
- [x] It inspected the existing spec tree before identifying gaps.
- [x] It maps every top-level `src/` area to an existing spec or a concrete future gap.
- [x] It avoids treating legacy docs as source of truth.

## Verification Basis

This analysis is based on:

- `GLOSSARY.md`
- `AGENTS.md`
- the full file list under `docs/specs/`
- top-level source inventory under `src/`
- focused inspection of representative current specs and source files, including `src/auth/openai-codex-usage.ts`, `src/auth/login-actions.ts`, `src/skills/cli.ts`, and selected tests under `test/`

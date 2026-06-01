# PRD Catalog: Ink CLI Session UI

**Status:** Draft  
**Created:** 2026-05-16  
**Source change:** `docs/specs/changes/ink-cli-session-ui/`  
**Source report:** `docs/reports/ink-cli-session-subset-report.md`

This directory translates the Ink CLI Session UI report, capability specs, change proposal, change spec, design, and task list into implementation-grade Markdown PRDs and Ralph-ready JSON PRDs.

## Source Documents

- `../../../../reports/ink-cli-session-subset-report.md`
- `../../capabilities/cli-session-ui.md`
- `../../capabilities/shared-terminal-view-model.md`
- `../proposal.md`
- `../spec.md`
- `../design.md`
- `../tasks.md`

## Product Position

The Ink CLI Session UI is a reduced, native terminal subset of Pibo Web Chat. It is not a replacement for Web Chat. Web Chat remains the primary control center for Projects, Workflows, Cron, Ralph, Agent Designer, complete Settings, and full context-management surfaces.

The V1 command is `pibo tui:sessions`. The CLI exists for SSH, bootstrap, recovery, and fast local session work. It should share trace/session view-model logic with Web Chat while using a separate Ink renderer.

## PRDs

| PRD | Scope | Ralph JSON |
|---|---|---|
| `01-product-overview.md` | Product framing, personas, scope, success criteria, rollout | `prd_01_product_overview.json` |
| `02-shared-terminal-view-model.md` | Shared renderer-neutral terminal row model for Web and CLI | `prd_02_shared_terminal_view_model.json` |
| `03-ink-renderer.md` | Static Ink transcript renderer, terminal-safe rows, markdown/JSON simplification | `prd_03_ink_renderer.json` |
| `04-session-source-runtime-integration.md` | `CliSessionSource`, local/direct session source, live updates | `prd_04_session_source_runtime_integration.json` |
| `05-interactive-cli-commands.md` | CLI app, command registration, Slash Commands, pickers, input | `prd_05_interactive_cli_commands.json` |
| `06-ssh-recovery-hardening.md` | TTY fallback, cleanup, large-session bounds, docs and validation | `prd_06_ssh_recovery_hardening.json` |

## Authoritative V1 Scope Matrix

| Capability | V1 Scope | Later / Web-only |
|---|---|---|
| Primary interface | Web Chat remains full control center | CLI never replaces Web Chat |
| CLI purpose | SSH, bootstrap, recovery, fast local session work | Full browser admin surface |
| Rendering | Ink `Box`/`Text` terminal renderer | DOM/Tailwind/Virtuoso/lucide reuse |
| Shared logic | Trace/session data and compact terminal rows | Shared presentation components |
| Sessions | create/select/send/view live transcript | Project/workflow session design surfaces |
| Agents | select existing agent/profile | edit/create/delete Agent Designer flows |
| Commands | `/help`, `/new`, `/session`, `/agent`, `/status`, `/clear`, `/exit`, `/quit` | `/model`, `/thinking`, `/fork`, `/details` unless later approved |
| Data source | local/direct first with interface for Gateway later | hard dependency on Web UI |
| Transcript | bounded compact rows | unbounded virtualized browser transcript |
| Web UI impact | behavior unchanged | Web refactors not required for CLI |

## Ralph Execution Order

1. `prd_01_product_overview.json` — documentation guardrails and final scope decisions.
2. `prd_02_shared_terminal_view_model.json` — shared model extraction and tests.
3. `prd_03_ink_renderer.json` — static renderer and render-to-string tests.
4. `prd_04_session_source_runtime_integration.json` — session source and live update integration.
5. `prd_05_interactive_cli_commands.json` — interactive app, command registration, Slash Commands.
6. `prd_06_ssh_recovery_hardening.json` — TTY/recovery hardening, docs, final validation.

Each story is intended to fit into one Ralph iteration and includes `Typecheck passes` as a completion gate.

## Shared QA Conventions

- Do not change Web Chat behavior unless a story explicitly says so.
- Do not import Web DOM presentation dependencies into Ink renderer modules.
- Do not add CLI-only trace mapping when the shared terminal row model can be used.
- Keep CLI output bounded for large sessions.
- Add tests before relying on behavior: row model, command parser, fake session source, Ink render snapshots.
- Validate with `npm run typecheck` before considering a story complete.

## Web / CLI Boundary Checklist

Review each implementation batch against this checklist:

- Web Chat remains behaviorally unchanged; existing session view registry and compact terminal behavior are preserved unless a story explicitly approves a Web change.
- Existing `pibo tui` and `pibo tui:routed` keep working unless a separate migration is approved.
- Shared terminal view-model modules stay renderer-neutral and avoid React DOM, browser APIs, Tailwind/CSS, Virtuoso, lucide-react, and Ink imports.
- Ink renderer modules use Ink-native presentation only and do not import Web DOM presentation dependencies.
- CLI rendering consumes shared compact terminal rows instead of adding a CLI-only trace mapper.
- CLI output is bounded for large sessions and handles narrow terminals without unbounded expansion.
- CLI V1 does not expose Projects, Workflows, Cron, Ralph, Agent Designer, full Settings, or full context-management surfaces.
- CLI V1 Slash Commands are limited to `/help`, `/new`, `/session`, `/agent`, `/status`, `/clear`, `/exit`, and `/quit`; `/model`, `/thinking`, `/fork`, and `/details` remain later-scope unless separately approved.
- Validate root typecheck with `npm run typecheck`; for Web-impacting changes also run Chat Web typecheck/build (`npm run chat-ui:typecheck` and `npm run chat-ui:build`).

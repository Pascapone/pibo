# PRD Catalog: PTY Debug and E2E Tooling

**Status:** Draft  
**Created:** 2026-05-16  
**Source change:** `docs/specs/changes/pty-debug-e2e-tooling/`  
**Capability:** `docs/specs/capabilities/cli-pty-validation.md`

This directory translates the PTY Debug and E2E Tooling specs into implementation-grade Markdown PRDs and Ralph-compatible JSON story batches.

## Source Documents

- `../../capabilities/cli-pty-validation.md`
- `../proposal.md`
- `../spec.md`
- `../design.md`
- `../tasks.md`

## PRDs

| PRD | Scope | JSON |
|---|---|---|
| `01-command-and-scenario-contract.md` | `pibo debug pty` command family, CLI options, scenario schema, validation errors | `prd_01_command_and_scenario_contract.json` |
| `02-host-pty-runner.md` | Host PTY execution, terminal sizing, input steps, timeouts, deterministic runner tests | `prd_02_host_pty_runner.json` |
| `03-assertions-and-artifacts.md` | Raw/clean output, expected/rejected assertions, artifact directory and diagnostics | `prd_03_assertions_and_artifacts.json` |
| `04-docker-worker-target.md` | Docker worker execution backend, capability detection, artifact retrieval | `prd_04_docker_worker_target.json` |
| `05-provider-modes-and-loop-safety.md` | Mocked default, explicit real-provider mode, max iterations, fail-closed loop prevention | `prd_05_provider_modes_and_loop_safety.json` |
| `06-canonical-cli-session-ui-scenarios.md` | Canonical `pibo tui:sessions` mocked and optional real-provider PTY scenarios | `prd_06_canonical_cli_session_ui_scenarios.json` |
| `07-documentation-and-ralph-guidance.md` | User docs, debug workflow, Ralph validation gates, evidence requirements | `prd_07_documentation_and_ralph_guidance.json` |

## Global Decisions Inherited by All PRDs

- The user-facing command family is `pibo debug pty`.
- Host execution and Docker-worker execution are both required.
- Mocked or deterministic provider mode is the default for model-output scenarios.
- Live provider calls require explicit `--real-provider`.
- Real-provider mode defaults to `--max-iterations 10` and must enforce wall-clock timeout, idle timeout, and stop conditions.
- The tool must fail closed if real-provider iteration bounds cannot be enforced.
- PTY E2E scenarios are not part of default `npm test` unless explicitly opted in.
- Failed PTY runs must preserve actionable artifacts, including raw ANSI and cleaned text.
- Visual screenshot diffing is not the primary assertion mechanism.
- The canonical CLI Session UI scenario must validate the real default path, not only `--demo`.

## Traceability Matrix

| Source requirement / task | PRD coverage |
|---|---|
| Command group and `run`/`scenario`/`list-scenarios` shape | `01` |
| Scenario schema, scriptable inputs, reviewable definitions | `01`, `02`, `03`, `05`, `06` |
| Host PTY execution, terminal size, input typing, key presses | `02` |
| Wall-clock timeout and idle timeout | `02`, `05` |
| Output assertions against expected and forbidden text | `03` |
| Failure artifacts: metadata, input, assertions, raw ANSI, clean text, screen | `03` |
| Docker worker execution and capability detection | `04` |
| Mocked provider default | `05`, `06` |
| Explicit bounded real-provider mode | `05`, `06` |
| Agent-to-agent loop prevention | `05` |
| Canonical CLI Session UI scenario | `06` |
| Ralph guidance and validation gates | `07` |

## Implementation Guidance

Give implementation agents this whole directory, not a single PRD. The JSON files are intentionally split by dependency order so Ralph can run smaller, verifiable batches. Later PRDs depend on the command/scenario contract and host runner from PRDs 01 and 02.

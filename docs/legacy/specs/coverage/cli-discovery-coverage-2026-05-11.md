# Coverage Analysis: CLI Discovery Verification 2026-05-11

**Status:** Draft  
**Created:** 2026-05-11  
**Owner / Source:** Scheduled Pibo Source Specs Coverage; current workspace code  
**Related docs:** [Operator CLI Discovery and Dispatch](../capabilities/operator-cli-discovery-and-dispatch.md), [Operator CLI Error Contract](../capabilities/operator-cli-error-contract.md), [Curated CLI Tools](../capabilities/curated-cli-tools.md), [Debug CLI](../capabilities/debug-cli.md), [Data Maintenance CLI](../capabilities/data-maintenance-cli.md), [MCP Server Integration](../capabilities/mcp-server-integration.md), [Pibo Pi Packages](../capabilities/pi-packages.md), [Scheduled Pibo Jobs](../capabilities/scheduled-pibo-jobs.md), [Continuous Ralph Jobs](../capabilities/continuous-ralph-jobs.md)

## Why

Pibo's CLI is an agent-facing discovery surface. The code already has broad CLI capability specs, but verification is spread across command-family tests. This makes it hard to see which command families directly assert progressive help and which are only covered by source inspection or functional command tests.

This coverage artifact avoids another broad CLI capability spec. It records current verification status so later scheduled runs can improve the weakest command-family contracts without duplicating existing specs.

## Goal

Future CLI changes SHALL preserve compact progressive discovery at each command level, and each major command family SHOULD have at least one focused test that asserts its discovery output does not dump deeper schemas, full examples, or unrelated implementation details.

## Scope

### In Scope

- Top-level `pibo` discovery and early dispatch in `src/cli.ts`.
- Current delegated command families visible from root discovery.
- Tests under `test/*.test.mjs` that execute the built CLI.
- Source-inspected command families without direct discovery tests.

### Out of Scope

- Changing CLI output or tests in this run.
- Repeating each command family's detailed behavior spec.
- Web UI command surfaces and slash-command rendering.
- Legacy docs as authority over current code.

## Current Coverage Matrix

| Command family | Source basis | Direct discovery assertion | Functional CLI assertion | Coverage status |
|---|---|---:|---:|---|
| Root `pibo` | `src/cli.ts` | `test/mcp-cli.test.mjs` checks no-args and `--help` compact output | N/A | Strong |
| `config` | `src/cli.ts`, `src/config/config.ts` | `test/mcp-cli.test.mjs` checks compact config help | `test/config.test.mjs` checks key storage, validation, and redaction | Strong |
| `mcp` | `src/mcp/index.ts`, `src/mcp/config-command.ts` | `test/mcp-cli.test.mjs` checks progressive MCP and config help | `test/mcp-cli.test.mjs` checks version, config, registry behavior | Strong |
| `tools` | `src/tools/index.ts`, `src/tools/guides.ts` | `test/mcp-cli.test.mjs` and `test/tools-cli.test.mjs` check tool discovery and browser-use helper output | `test/tools-cli.test.mjs` checks list, guide, install, env, leases, targets | Strong |
| `pi-packages` | `src/pi-packages/cli.ts` | `test/pi-packages.test.mjs` checks progressive help | `test/pi-packages.test.mjs` checks local add/list/remove and package behavior | Strong |
| `debug` | `src/debug/index.ts`, `src/debug/*` | `test/debug-cli.test.mjs` checks root and `db` help stay progressive | `test/debug-cli.test.mjs` checks db/session/trace/events/jobs/runs behavior | Strong |
| `data` | `src/data/cli.ts` | No focused help assertion found | `test/data-cli.test.mjs` checks inventory and unread-baseline repair | Partial |
| `gateway` | `src/gateway/cli.ts`, `src/gateway/*` | No focused help assertion found | `test/gateway-request.test.mjs`, `test/gateway-restart-safety.test.mjs`, `test/web-gateway.test.mjs`, and `test/gateway-backpressure-subscriptions.test.mjs` check gateway behavior | Partial |
| `compute` | `src/compute/cli.ts`, `src/compute/docker.ts` | No focused help assertion found | No direct built-CLI compute test found in `test/*.test.mjs` | Weak |
| `skills` | `src/skills/cli.ts`, `src/user-skills/*` | No focused help assertion found | `test/user-skills.test.mjs` checks user-skill store/metadata behavior, not CLI discovery | Weak |
| `cron` | `src/cron/cli.ts`, `src/cron/*` | No focused help assertion found | `test/cron-schedule-store.test.mjs` checks CLI owner-scope add/edit paths | Partial |
| `ralph` | `src/ralph/cli.ts`, `src/ralph/*` | No focused help assertion found | No direct Ralph CLI test found in `test/*.test.mjs` | Weak |
| `profile` | `src/cli.ts`, `src/core/runtime.ts` | No focused help assertion found | Profile construction is covered indirectly by runtime/profile tests | Partial |
| `tui` / `tui:routed` | `src/cli.ts`, `src/local/tui.ts`, `src/core/runtime.ts` | No focused help assertion found | `test/local-routed-tui.test.mjs` covers routed TUI behavior, not root help | Partial |
| `gateway:web` | `src/cli.ts`, `src/gateway/web.ts` | No focused help assertion found | `test/web-gateway.test.mjs` and auth tests cover web gateway behavior, not root command parsing | Partial |

## Findings

### Finding: Root and several high-use command families have direct progressive-help tests

Root discovery, `config`, `mcp`, `tools`, `pi-packages`, and `debug` have direct assertions that help stays compact or progressive. These are the strongest examples for future command-family tests.

#### Acceptance for future parity

- Each major command family has one test that invokes `node dist/bin/pibo.js <family> --help` or the family-specific discovery command.
- The test asserts a next-step command and asserts absence of deeper schema or unrelated dump text.

### Finding: Several command families are functionally tested but not discovery-tested

`data`, `gateway`, `cron`, `profile`, `tui:routed`, and `gateway:web` have meaningful behavior coverage elsewhere, but the current inventory does not make their help/discovery output easy to audit.

#### Acceptance for future improvement

- Add compact discovery assertions to the command-family test that already owns the functional behavior.
- Do not copy full help output into specs; assert stable landmarks and absence of noisy output.

### Finding: Compute, Skills CLI, and Ralph CLI are weakest for built-CLI discovery coverage

The source tree contains CLI implementations for compute workers, user skills, and Ralph jobs, and capability specs describe their behavior. Current tests focus on stores, web/API behavior, or source contracts rather than direct CLI discovery.

#### Acceptance for future improvement

- Add one built-CLI test each for `pibo compute --help`, `pibo skills --help`, and `pibo ralph --help`.
- Each test should run with an isolated `PIBO_HOME` when persistence could be touched.
- The assertions should prove the command is discoverable without starting Docker, creating jobs, or mutating user skills.

## Recommended Next Scheduled Runs

1. Extend `docs/specs/capabilities/operator-cli-discovery-and-dispatch.md` traceability rows with the strong direct tests from this matrix.
2. Extend the relevant command-family specs for `data`, `gateway`, `cron`, `compute`, `skills`, and `ralph` with explicit discovery-test success criteria.
3. If source code changes are requested later, add focused help tests for the weak and partial command families rather than changing broad behavior.

## Success Criteria

- [x] This artifact is under `docs/specs/coverage/` because it is a verification map, not a new product capability.
- [x] It inspected the existing `docs/specs/` tree before proposing coverage work.
- [x] It uses current source and test files as the source of truth.
- [x] It identifies non-duplicative follow-up targets for future scheduled runs.
- [x] It does not change source code or spawn Docker.

## Verification Basis

This coverage analysis is based on current workspace files:

- `GLOSSARY.md`
- `AGENTS.md`
- `docs/specs/` inventory
- `src/cli.ts`
- `src/config/config.ts`
- `src/mcp/index.ts`
- `src/tools/index.ts`
- `src/pi-packages/cli.ts`
- `src/debug/index.ts`
- `src/data/cli.ts`
- `src/gateway/cli.ts`
- `src/compute/cli.ts`
- `src/skills/cli.ts`
- `src/cron/cli.ts`
- `src/ralph/cli.ts`
- `test/mcp-cli.test.mjs`
- `test/tools-cli.test.mjs`
- `test/pi-packages.test.mjs`
- `test/debug-cli.test.mjs`
- `test/data-cli.test.mjs`
- `test/config.test.mjs`
- `test/cron-schedule-store.test.mjs`
- current `test/*.test.mjs` inventory

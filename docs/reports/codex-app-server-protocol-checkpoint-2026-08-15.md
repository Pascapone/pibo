---
type: "Research"
title: "Codex App Server Protocol Checkpoint — 2026-08-15"
description: "Preserves the original report body as stable research without promoting historical claims."
tags: ["migration","research","report"]
status: "stable"
authority: "informative"
migration_lineage:
  source_path: "docs/reports/codex-app-server-protocol-checkpoint-2026-08-15.md"
  source_commit: "15f2cd832e627d49c71be6a60708e5409be8772f"
  baseline_commit: "2aef244301f5d181624662fdad53e18e83e80bd9"
  baseline_blob_oid: "33fcdc4ce2ac46da4c005833ddac57d47b967399"
  source_bytes: 8372
  source_sha256: "303c184762f03a7bde69dca4c9aa9685558829208acbc1f074118098c8bab696"
  source_body_sha256: "303c184762f03a7bde69dca4c9aa9685558829208acbc1f074118098c8bab696"
generated:
  by: "process:pibo-okf-c-reports"
  at: "2026-09-01T07:57:34Z"
---
# Codex App Server Protocol Checkpoint — 2026-08-15

**Status:** Milestone 9.1 pass; Pi-parity gate subsequently resolved with approved Pibo2-managed authentication; Milestone 9.2 unblocked

**Branch:** `feature/agent-runtime-codex-native`

**Stacked on:** adapter-authoring skill PR #488

**Pull request:** #489

**Pi parity 2.11:** **Pass** — see `pi-agent-runtime-parity-approved-auth-validation-2026-08-15.md`

## Outcome

The dedicated Pibo2 host now has an isolated, versioned installation of the official OpenAI Codex CLI/App Server. The exact binary generated stable TypeScript and JSON Schema outputs, and Pibo stores the complete stable protocol and stable v2 schema bundles with pinned hashes and a narrow supported version range.

This checkpoint does **not** implement the native adapter. At the time of the protocol checkpoint, work beyond task 9.1 remained gated pending approved target-managed model authentication. An operator later completed Pibo2's supported Chat Web OAuth flow, and the separate approved-auth validation report closed Pi parity 2.11 without copying local OAuth/API credentials to Pibo2.

## Exact Pibo2 binary

| Item | Value |
|---|---|
| npm package | `@openai/codex@0.147.0` |
| Reported version | `codex-cli 0.147.0` |
| Versioned install root | `/opt/pibo-codex/0.147.0` |
| Platform binary | `@openai/codex-linux-x64` musl x86_64 binary |
| Binary SHA-256 | `cb0a15567e9a60a5820d54b0f6ae86d504dc3805c1eab21a47f70e3eb7b73a40` |
| Pinned adapter range | `>=0.147.0 <0.148.0` |
| Protocol name | `codex-app-server-v2` |

The install is versioned and has no global `codex` symlink. The running Pibo service was not changed to select a native Codex runtime during this checkpoint.

## Schema generation

The exact Pibo2 binary generated stable output without `--experimental`:

```text
codex app-server generate-json-schema --out <schema-dir>
codex app-server generate-ts --out <typescript-dir>
```

Observed generation results:

- 927 generated files;
- approximately 6.3 MB before compression;
- complete generated-output archive SHA-256 `ab890a36f19a6b48284c34dd46bb5154ccc34185c4c4d0f05c16e0bf113956a1`;
- generated TypeScript `index.ts` SHA-256 `1cca50b4003a6661cd211dff7c655ecf03ecfe4c7bba8e72a5bbc9af33ee5086`;
- complete stable schema SHA-256 `f72b2caa3cbfa4298de9e85c62dda6dfbaf2266ffeb916fed30615ca69ff8c74`;
- stable v2 schema SHA-256 `f3dec1e031d99a420b137b903f02196d4325eece57620c925bb7130b25f168d2`.

Committed protocol artifacts:

- `src/agent-runtimes/codex-native/generated/codex_app_server_protocol.schemas.json`;
- `src/agent-runtimes/codex-native/generated/codex_app_server_protocol.v2.schemas.json`;
- `src/agent-runtimes/codex-native/protocol-version.ts`.

The full schema contains 82 definitions, including bidirectional server requests for command approval, file-change approval, and structured user input. The stable v2 schema contains 557 definitions, including thread start/resume/read/list, turn start/steer/interrupt, model catalog, skill extra roots, MCP status, and token-usage notifications.

The exact official source checkpoint is tag `rust-v0.147.0`. Its `codex-rs/app-server/README.md` SHA-256 is `5d7d3da891a81d657c0c8a9192565466654a6d4636f19abaa5dd6af82b9663d4`.

## Local verification

- `npm run typecheck`: passed.
- `npm run build`: passed.
- Focused schema/version integrity tests: **2/2 passed**.
- Full suite: **1,662/1,662 passed across 12 suites**.
- `git diff --check`: passed.

The tests parse both committed schema bundles, verify their exact SHA-256 digests, assert the pinned version/range metadata, and require the stable lifecycle, turn, model, skill, MCP, usage, approval, and input definitions named in this checkpoint.

## Protocol classification

Stable, generated surfaces relevant to Pibo include:

- newline-delimited stdio JSON-RPC with the wire-level JSON-RPC header omitted;
- one `initialize` request followed by one `initialized` notification;
- persistent thread start, resume, fork, read, list, archive/delete, and compaction;
- turn start, steering, interruption, assistant deltas, reasoning deltas, item lifecycle, usage, plans, and diffs;
- model catalog and model-advertised reasoning/service-tier options;
- process-scoped `skills/extraRoots/set`;
- MCP server status/resource/tool operations;
- command and file-change approval server requests.

Explicitly non-stable or gated surfaces include:

- WebSocket App Server transport, which the exact official documentation labels experimental/unsupported;
- caller-supplied ChatGPT token login, which the exact binary rejects unless `initialize.capabilities.experimentalApi` is enabled;
- structured `request_user_input`, which the generated types and exact documentation label experimental.

No implementation may advertise these experimental surfaces as stable. If used later, the configured runtime must opt in explicitly, pin the supported binary range, expose the limitation, and test the exact method/field gate.

## Native-behavior constraints recorded for implementation

Future adapter work must:

- use only `codex app-server --stdio` protocol messages, never terminal/TUI scraping;
- preserve Codex native base instructions and standard tools;
- never load Pibo's Pi base prompt or Pi Codex-compatibility extension;
- expose native Codex only as runtime/profile `codex-native`;
- leave existing explicit or persisted Pi-backed `codex` compatibility references unchanged;
- keep per-session process, thread, resource, and cleanup ownership;
- deliver Pibo tools through the existing session-scoped Streamable HTTP MCP bridge;
- deliver selected skills through official extra roots and selected context without replacing native instructions;
- keep all credentials out of generated schema/config artifacts, shell snapshots, bindings, logs, debug output, and reports.

## Diagnostic probe exclusion and cleanup

A diagnostic-only probe exercised the official App Server before the authentication rule was corrected. Because that route involved non-approved local credential material, none of its model-turn results count as Pi parity or native-Codex validation evidence, and the credential route must not be repeated.

Cleanup was verified immediately:

- the temporary `openai-codex` entry was removed from Pibo2 Pi auth storage;
- the only pre-cleanup exact credential match was the temporary auth entry itself;
- post-cleanup exact credential matches were zero in checked files and live process environments;
- at that cleanup checkpoint, Pibo2 Pi auth contained only its pre-existing non-OpenAI provider entry;
- no native Codex auth storage exists on Pibo2;
- zero Codex App Server processes remained;
- zero probe home directories and OAuth temporary files remained;
- the temporary Pibo custom agent and Pibo Session were archived and permanently deleted;
- Context Build for the deleted session returned HTTP 404;
- the temporary native Pi transcript was found and removed;
- local diagnostic directories/scripts were removed, and a local artifact scan found zero unexpected copies of the source credential.

The official Codex binary and generated, credential-free schema checkpoint remain installed/stored. They do not contain authentication material.

## Pi parity gate resolution

An operator subsequently authenticated `openai-codex` through Pibo2 Chat Web Settings. Metadata-only checks confirmed target-managed OAuth with access, refresh, and expiry fields present in mode-`0600` Pi auth storage; no credential value was copied, printed into the report, or transferred from a local machine.

The exact committed candidate then passed real baseline/candidate text and Bash-tool parity, public-Web streaming and tool execution, unchanged Pi binding across `pibo-web.service` restart, prior-tool-history recovery, post-restart streaming, model/thinking/usage/Fast controls, product trace consistency, and sanitized browser evidence. Full evidence is in `docs/reports/pi-agent-runtime-parity-approved-auth-validation-2026-08-15.md`.

Diagnostic runs using transferred local credentials remain excluded. They were not used to close the gate.

## Checkpoint boundary

Task 9.1 is complete, and task 9.2 is now unblocked by the approved-auth Pi parity result. No protocol client, runtime driver, configured instance, profile, or session implementation is included in the 9.1 checkpoint itself.

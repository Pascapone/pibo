# Codex App Server Protocol Checkpoint — 2026-08-15

**Status:** Milestone 9.1 pass; Milestones 9.2+ blocked by the Pi-parity authentication gate

**Branch:** `feature/agent-runtime-codex-native`

**Stacked on:** adapter-authoring skill PR #488

**Pi parity 2.11:** **Blocked — not complete**

## Outcome

The dedicated Pibo2 host now has an isolated, versioned installation of the official OpenAI Codex CLI/App Server. The exact binary generated stable TypeScript and JSON Schema outputs, and Pibo stores the complete stable protocol and stable v2 schema bundles with pinned hashes and a narrow supported version range.

This checkpoint does **not** implement the native adapter and does **not** claim Pi parity. Work beyond task 9.1 remains gated until Pibo2 has approved, target-managed model authentication. Local OAuth/API credentials must not be copied or transferred to Pibo2.

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
- Pibo2 Pi auth now contains only its pre-existing non-OpenAI provider entry;
- `/root/.codex/auth.json` does not exist;
- zero Codex App Server processes remained;
- zero probe home directories and OAuth temporary files remained;
- the temporary Pibo custom agent and Pibo Session were archived and permanently deleted;
- Context Build for the deleted session returned HTTP 404;
- the temporary native Pi transcript was found and removed;
- local diagnostic directories/scripts were removed, and a local artifact scan found zero unexpected copies of the source credential.

The official Codex binary and generated, credential-free schema checkpoint remain installed/stored. They do not contain authentication material.

## Pi parity gate

Pi parity 2.11 remains explicitly open. Pibo2 currently has no approved OpenAI Codex authentication managed on the target, and no native Codex auth file is provisioned. Earlier baseline/candidate provider-auth failures therefore remain the admissible state: real-model Pi parity cannot be closed yet.

The gate may be closed only after an operator provisions approved Pibo2-managed authentication and exact-candidate evidence proves real routed Pi text, streaming, tools, persistence, and restart/resume against the baseline. Diagnostic runs using transferred local credentials are excluded by policy and by this report.

## Checkpoint boundary

Task 9.1 is complete. Tasks 9.2 through 9.14 and integrated Codex validation remain blocked by the explicit Pi-parity gate. No protocol client, runtime driver, configured instance, profile, or session implementation is included in this checkpoint.

# Multi-Agent Runtime Adapter Integrated Validation

**Date:** 2026-08-16

**Environment:** Pibo2 development server
**Result:** Deterministic two-adapter product matrix passed for the recorded candidate. A later August 16 audit found and corrected a separate Chat Web provider-auth routing gap; the exact focused candidate subsequently passed Pibo2 managed authentication and one bounded native-Codex production-provider turn, documented in `runtime-auth-control-plane-validation-2026-08-16.md`.

## Exact artifacts

| Artifact | Exact value |
|---|---|
| Branch | `feature/agent-runtime-integrated-validation` |
| Candidate commit | `2404ca5d6466486c1a1c525964c24770be6b06b9` |
| Package | `@pasko70/pibo@1.7.2` |
| Package SHA-256 | `dd0966a2712ee2d78d6e9da0cdf72ea78592f6b9c113884ee9a62163f332936b` |
| Installed candidate | `agent-runtime-integrated-validation-pty-final` |
| Candidate install time | `2026-08-16T05:02:46Z` |
| Codex CLI / App Server | `0.147.0` |
| Native Codex binary SHA-256 | `cb0a15567e9a60a5820d54b0f6ae86d504dc3805c1eab21a47f70e3eb7b73a40` |
| Codex protocol | `codex-app-server-v2` |

The exact package ran through the public authenticated Chat Web path, the service process selected that exact candidate, and every native-Codex process used the pinned App Server executable rather than terminal-output scraping.

## Validation fixture boundary

Native Codex had no approved production-provider credential on Pibo2. Integrated protocol and product behavior therefore used a disposable loopback Responses-compatible provider and a disposable external MCP server while retaining the real:

- public HTTPS gateway and authenticated browser;
- Pibo session/router/database/reliability path;
- official Codex App Server process and stable v2 JSON-RPC protocol;
- native thread, turn, tool, request, history, interrupt, and process behavior;
- Agent Designer, Context Build, trace, workflow, Loop, Cron, and TUI surfaces.

Pi validation used the existing Pibo2-managed real `openai-codex` provider path. Deterministic native-Codex evidence is not represented as production-provider evidence.

## Database and migration audit

Before cleanup, the schema-v5 store passed `PRAGMA integrity_check` with:

- 498 Pibo Sessions and 498 runtime bindings;
- 2,308 product messages, 166,799 product events, and 3,938 payloads;
- 21 native-Codex bindings and 477 Pi bindings;
- zero sessions without bindings;
- zero orphan bindings;
- zero duplicate `(adapter, native session id)` pairs;
- zero Pi compatibility/native-id mismatches.

The matrix included `bound`, intentional `missing`, and expected fresh `unbound` states. Existing Pi ids and compatibility fields remained unchanged. A deleted Codex rollout persisted `missing` and returned a safe conflict instead of creating a replacement thread.

After supported product deletion plus validation-only store cleanup, the store again passed integrity checks with 473 sessions and 473 bindings, all pre-existing Pi data. No validation agents, sessions, rooms, projects, workflows, Loop/Cron runs, reliability events, native rollouts, or generated runtime roots remained.

## Integrated scenario matrix

### Pi parity and portable resources

A fresh custom Pi agent selected:

- built-in and user skills, including `pibo-agent-runtime-adapter` and `outcome-first-prompting`;
- managed context;
- one external MCP server;
- a native-Codex subagent;
- built-in Pi tools, run control, and goal control.

Context Build delivered 65 nodes and approximately 5,541 tokens with zero warnings or errors. Selected skills were `ACTIVE`, `DELIVERED`, `NATIVE`, and `EXACT`; known unselected skills were absent.

The Pi session remained bound to Pi native session `769d6bfe-5fee-4fb2-a363-285d891a6d5b` across gateway restart. A real Pi provider turn invoked Bash and reached the selected external MCP server. The final turn completed in 6.501 seconds; Bash/MCP execution accounted for 948 ms.

A Pi parent invoked the reusable `pibo_subagent_codex_helper` tool with stable thread key `integrated-shared`. Pibo reused child session `ps_e3c067d1-5ff9-4b4a-9a8f-bb3e5e6c3e8c` and native thread `01a008ad-935a-7823-a92a-96971ace32a5` after restart, preserving prior child history.

### Native Codex lifecycle and restart

The primary native-Codex Pibo Session retained native thread `01a008a8-a513-7fd0-881e-33995f2fa76b` through candidate activation and `pibo-web.service` restart. Subsequent turns resumed the same binding; no `thread/start` replacement occurred.

Provider inspection proved each integrated request retained Codex's native prompt, omitted Pibo's Pi base prompt, and added only selected context/resources. The exact session delivered:

- selected Pibo and user skills;
- explicit Pibo context;
- native project instructions;
- selected Pibo MCP tools;
- selected external MCP;
- native command tools.

Stable Codex `0.147.0` exposed selected MCP tools immediately and observed native tool names only after native item notifications. Product inspection continued to report native-tool inventory as degraded and native-tool yielding as unsupported.

### Native and portable tools together

One native-Codex session used both:

- a native command execution request rendered through the Chat Web approval panel; and
- model-initiated `integrated-external/external_echo` through Codex's selected external MCP inventory.

The Pibo-generated MCP server alone received scoped `default_tools_approval_mode = "approve"`. The external MCP server was not blanket-preapproved. For the disposable fixture, native policy was `on-request`, and the read-only/idempotent `external_echo` annotations allowed the approved model call to execute. The recorded external tool execution took 7 ms.

### Subagents, Loop, Cron, and workflows

- Native Codex invoked selected Pibo-managed subagents through the generated session-scoped Pibo MCP bridge.
- Pi invoked and reused a native-Codex child with an independently frozen binding.
- A native-Codex Goal Loop completed with `reason: goal-complete`; one exact run completed in 661 ms and used `update_goal`.
- One-shot native-Codex Cron completed `status: ok` in 515 ms. Short validation used absolute `--at` scheduling because `--in 2s` correctly returned `Duration must look like 20m, 2h, or 1d`.
- Project workflow run `wfr_e19b4c2d-c1df-4d52-8eb7-bb7b926ea5b7` was accepted for a Codex-routed project session.
- Manual editor test run `wfr_ccab3900-4931-4125-b038-a2d19e148db6` validated the graph, created a `workflow-agent` session, and completed with `P2_20260816a_CODEX_WORKFLOW complete.` in approximately 483 ms.

### Approval, abort, failure, and missing state

Command approval was rendered in the authenticated browser and resolved through the generic request/action path. Structured user input remained disabled because the installed runtime did not opt in to the experimental method.

A live streaming turn was interrupted after the disposable provider accepted the request:

- the HTTP stream closed before its normal terminator (`ended: false`);
- the turn and separate abort action each terminalized as aborted;
- processing and streaming returned false;
- the App Server process was recycled;
- the next turn resumed native thread `01a008fa-70b4-7b32-a995-440f04953182` and completed in 93 ms of router turn time.

A provider failure normalized to `session_error`; the following turn recovered on the unchanged binding. A removed rollout returned HTTP 409, redacted the absolute path, persisted `missing`, and did not silently start a new thread. Invalid Designer runtime selection returned HTTP 400. Capability inspection visibly explained degraded native inventory, unsupported native-tool yielding, and disabled structured input.

## Product surfaces and timings

| Surface | Evidence |
|---|---|
| Chat Web approval | [`assets/codex-native-integrated-approval-2026-08-16.png`](./assets/codex-native-integrated-approval-2026-08-16.png) |
| Chat Web trace | [`assets/codex-native-integrated-trace-2026-08-16.png`](./assets/codex-native-integrated-trace-2026-08-16.png) |
| Runtime-aware debug | `debug session`, `final`, `events`, `failures`, `trace --check`, and telemetry all reported frozen adapter/binding identity |
| TUI/PTY | Exact installed candidate passed `cli-session-ui-mocked-e2e` in 3.225 seconds |
| Final clean browser reload | bootstrap HTTP 200 in 75 ms; DOM/load in 174 ms; composer and Terminal surface present; zero console errors, exceptions, failed requests, or non-success responses |

The stale built-in PTY scenario was a real regression in the validation surface: it expected the removed `Pibo CLI Sessions` banner and skipped the current room/session pickers. Commit `2404ca5d` repairs the scenario and adds a PTY-backed regression test.

## Defects found and fixed

### Interrupted provider stream and missing rollout safety

Commit `59b7dc53`:

- recycles the native App Server after interruption so the provider connection cannot remain live;
- recognizes missing-rollout failures;
- redacts absolute native paths;
- persists `missing`;
- returns safe HTTP 409 rather than HTTP 500;
- adds Codex fixture/router/Web regression coverage.

### Stale CLI session PTY scenario

Commit `2404ca5d`:

- follows the current room picker and session picker;
- creates a session before sending the mocked turn;
- verifies `/status` reports `Runtime: local`;
- exits through `/exit`;
- adds a real PTY artifact assertion.

## Local verification

The integrated branch passed:

- focused Codex thread/turn/Web and PTY regression tests;
- `npm run typecheck -- --pretty false` with the configured 1.2-GB Node heap;
- `npm run build`;
- the complete canonical suite: **1,736/1,736 tests**, 12 suites, zero failures/skips/cancellations;
- `git diff --check`.

## Historical native-Codex authentication blocker

Pibo2 has no approved native-Codex credential:

- official `account/read` reported no authenticated account;
- the service environment contains neither `OPENAI_API_KEY` nor `CODEX_ACCESS_TOKEN`;
- no native `auth.json` exists in the private runtime home;
- the supported App Server `account/login/start` flow opened the OpenAI login page in the existing Pibo2 browser;
- `Continue with Google` reached Google sign-in, but the browser had no reusable Google session and required interactive account verification;
- the App Server reported unsuccessful completion (`managed_login_rejected`).

No local OAuth/API credential, Pi auth record, browser cookie, access token, device code, or account metadata was copied or exposed. For this recorded candidate, interactive authentication blocked a production-provider native-Codex turn. The later final-audit review additionally found that Chat Web provider settings still targeted Pi globally; that product gap is corrected on the focused runtime-auth branch rather than being hidden by this evidence.

## Cleanup proof

Cleanup completed before this report was finalized:

- deleted four validation agents and their 23 sessions through authenticated product APIs;
- deleted two remaining validation-only `codex-native` sessions;
- deleted the validation room, project, workflow, Loop jobs/runs, Cron jobs/runs, and reliability events;
- stopped and removed the disposable provider/MCP/login services;
- removed the service override, temporary MCP root, scripts, logs, workspace, PTY artifacts, and state files;
- restored the original private Codex config, mode `0600`, SHA-256 `f1ff5a4395ba88db2e155b7cc422675c2b5b79a0ac385964b6c1973883a915c1`;
- removed all validation native rollouts and generation roots;
- confirmed zero files under global `/root/.codex`;
- restarted the exact candidate and revalidated the authenticated Chat Web shell.

## Follow-up provider-auth correction

The focused runtime-auth control-plane change moves Pi credential operations behind the Pi adapter, adds official native-Codex account operations in the private configured-instance home, routes product mutations by explicit runtime target, and makes Provider Settings/Designer/model menus consume truthful runtime status. Its deterministic local matrix and 1,752-test full suite pass. Exact commit `cc0dcde6616dcec6a8dcf7cd0f78e70478a8ab1c` (package SHA-256 `4cabc5f1687381fa1b5be8c094b5893d71686309d45c2195c34968af8fb117f5`) is active on Pibo2.

After the authorized user completed the managed Device code flow, safe Provider Settings/API projection reported the private target connected (`chatgpt`, plan `pro`) without account identity or credential material. A fresh public `codex-native` session bound to the official App Server and `openai-codex/gpt-5.6-sol high`, returned `NATIVE CODEX READY` for the bounded validation prompt, passed `debug trace --check` with zero issues, and reported zero failures. The validation session/native rollout was then removed while private auth/configuration remained; final database integrity, process, global-state, and connected-status checks passed. Safe screenshots are linked from the focused validation report.

## Conclusion

The recorded integrated product matrix and focused runtime-auth correction now form a complete evidence chain: deterministic and real-Pi behavior, exact-candidate Pibo2 activation, runtime-neutral managed authentication, one bounded native-Codex production-provider turn, trace validation, and cleanup all pass. No known invalidating regression remains.

# Multi-Agent Runtime Adapter Final Audit

**Date:** 2026-08-16

**Scope:** REQ-001 through REQ-019 in [`../specs/changes/multi-agent-runtime-adapters/spec.md`](../specs/changes/multi-agent-runtime-adapters/spec.md)

**Overall result:** **BLOCKED on one human evidence gate.** The August 16 follow-up audit found and corrected a real provider-auth architecture gap: Chat Web had still written Pi `AuthStorage` before runtime routing. The runtime-neutral correction passes local deterministic verification, focused PR review packaging, and exact Pibo2 public-Web readiness. Native Codex remains intentionally disconnected; production-provider authentication requires authorized interactive verification.

## Verification baseline

- Prior integrated product candidate: `2404ca5d6466486c1a1c525964c24770be6b06b9`
- Prior integrated package SHA-256: `dd0966a2712ee2d78d6e9da0cdf72ea78592f6b9c113884ee9a62163f332936b`
- Focused runtime-auth candidate commit: `cc0dcde6616dcec6a8dcf7cd0f78e70478a8ab1c`
- Focused runtime-auth package SHA-256: `4cabc5f1687381fa1b5be8c094b5893d71686309d45c2195c34968af8fb117f5`
- Exact Codex App Server: `0.147.0`
- Native binary SHA-256: `cb0a15567e9a60a5820d54b0f6ae86d504dc3805c1eab21a47f70e3eb7b73a40`
- Focused correction local verification: typecheck passed; build passed; **1,752/1,752 tests across 12 suites** passed with zero failures, skips, cancellations, or todos
- Final Pibo2 database: schema 5, integrity `ok`, 473 sessions/bindings, zero binding anomalies, zero validation fixtures
- PR stack: #476, #477, #478, #479, #483, #486, #487, #488, #489, #490, #491, #492, #493, #494, #495, #497, #498, #499, #501, #502, #503, and #518

## Requirement audit

| Requirement | Implemented code paths | Focused tests | Build / full-suite evidence | Migration / Pibo2 / browser evidence | PRs | Limitation / uncertainty | Result |
|---|---|---|---|---|---|---|---|
| REQ-001 Product authority | `src/core/session-router.ts`, `src/gateway/server.ts`, workflow/Loop/Cron services, Pibo subagent router | `subagents.test.mjs`, `codex-native-subagents.test.mjs`, `loop-goal-mode.test.mjs`, workflow tests | All milestone suites plus final verification | Pi↔Codex child sessions, reusable child binding, native-Codex Goal Loop/Cron/project/manual workflow all completed on exact candidate | #476–#502, #503 | None in implemented product authority | PASS |
| REQ-002 Explicit registry | `src/agent-runtime/registry.ts`, built-in plugins, Pi and native-Codex drivers/instances | `agent-runtime-registry.test.mjs`, profile/catalog tests | Foundation/full suites and final verification | Exact candidate catalog exposed `pi` and distinct `codex-native`; no implicit native `codex` alias | #476, #501 | None | PASS |
| REQ-003 Generic lifecycle | `src/agent-runtime/types.ts`, `src/core/runtime-routed-session.ts`, Pi/Codex adapters | shared adapter contract, `codex-native-thread.test.mjs`, `codex-native-turn.test.mjs` | Codex matrix 76/76; final verification | Pi and Codex resume across gateway restart; interrupt recycled App Server; same Codex thread recovered | #476, #477, #492, #493, #499, #503 | None | PASS |
| REQ-004 Explicit capabilities | capability descriptors/inspection, Designer validation, runtime status | registry/Designer/options/request/resource/tool-inventory tests | Focused/full suites and final verification | Designer and Context Build showed supported, degraded, disabled, and unsupported states; invalid selection returned HTTP 400 | #476, #479, #495, #498, #501 | Stable `0.147.0` native inventory is observed/degraded by design | PASS |
| REQ-005 Normalized events | runtime semantic events, routed-session normalization, Chat Web request/output paths | contract suite; turn/request/history/Web tests | Codex matrix/full suite and final verification | Assistant/tool/usage/request/failure/abort events reached product history, SSE, trace, and telemetry | #476, #477, #487, #493, #494, #503 | None | PASS |
| REQ-006 Exact Pi parity | Pi driver/adapter, compatibility runtime facade, Pi history/recovery/control paths | Pi/fake contracts plus existing complete suite | Approved-auth baseline/candidate suite; final verification | Real Pibo2 Pi text, Bash, SSE, restart/resume, Fast/model/thinking/usage, trace, skill/context/MCP/subagent paths passed | #477 and dependent stack | None | PASS |
| REQ-007 Additive bindings | schema-v4/v5 stores/migrations, CAS binding store, compatibility projections | binding migration/CAS/uniqueness/missing/history tests | Full suites and final verification | Existing-data migration across hundreds of sessions; final schema 5 integrity `ok`, zero missing/orphan/duplicate/mismatch anomalies | #478, #487, #492, #503 | Rollback cannot execute non-Pi sessions, as documented | PASS |
| REQ-008 Frozen selection | profile/runtime selection and persisted binding creation | profile edit/session binding/cross-runtime child tests | Focused/full suites and final verification | Existing sessions retained runtime/native ids after profile edits and restart; children froze target bindings independently | #478, #479, #499, #501 | None | PASS |
| REQ-009 Agent Designer | catalog APIs, custom-agent store, Designer runtime controls, runtime-scoped auth join, and disabled explanations | Designer autosave/default-model/catalog/save validation plus `chat-ui-provider-auth-methods.test.mjs` | Focused correction and 1,752-test full suite | Exact Pibo2 Provider Settings/API render Pi shared scope and native Codex private disconnected status truthfully | #479, #495, #498, #499, #501, #518 | No focused invalidating uncertainty | PASS |
| REQ-010 Native behavior | Pi prompt/runtime assembly; Codex native process/resources/tool inspection | Pi parity tests; Codex resource/tool-inventory tests | 9.8/9.9 suites and final verification | Provider inspection proved native Codex prompt present, Pi base prompt absent, native tools unchanged, selected MCP additive | #477, #497, #498 | Complete pre-turn native inventory is unavailable in stable `0.147.0`; reported truthfully | PASS |
| REQ-011 Portable tools | Pibo JSON-Schema tool contract, Pi compiler, scoped MCP bridge, yielded-run integration | `pibo-portable-tool-session.test.mjs`, resource/subagent/security tests | Focused/full suites and final verification | Scoped credential denial/renewal/revocation, model-initiated Pibo tools/subagents, native+external tools in one session | #483, #497, #499 | Harness-private native-tool yielding remains unsupported and unadvertised | PASS |
| REQ-012 Skills/context/MCP | runtime resource service, isolated roots, secret-safe external HTTP/stdio MCP delivery | `agent-runtime-resource-service.test.mjs`, `codex-native-resources.test.mjs` | 9.8 focused 65/65 plus full/final verification | Pi and Codex selected-only skills/context/MCP passed; unselected skills absent; connected inventory and cleanup verified | #486, #497, #503 | None | PASS |
| REQ-013 History/debug | runtime-neutral product history, adapter history providers, debug/trace/telemetry | `agent-runtime-history.test.mjs`, trace/debug/Codex thread tests | Full suites and final verification | Native restart history, safe missing fallback, public trace screenshot, `debug trace --check`, telemetry, 21-MB legacy Pi coverage | #487, #492, #493, #501, #503 | None | PASS |
| REQ-014 Built-in authoring skill | `pibo-agent-runtime-adapter` skill and progressive references | `agent-runtime-adapter-skill.test.mjs`, Orion/Relay evals | 25/25 focused; full suite; eval 20/20 with skill vs 9/20 baseline | Exact Pibo2 catalog/Designer/Context Build/package validation | #488 | None | PASS |
| REQ-015 Official native Codex | `src/agent-runtimes/codex-native/*`, including stable App Server account auth in the private configured-instance home | protocol/client/process/thread/turn/request/model/resource/subagent plus `codex-native-auth.test.mjs` | 76/76 prior Codex matrix and focused 1,752-test full suite | Exact `0.147.0` account/read reports private target disconnected; public UI exposes Device code/API key and leaves no process/generation/auth artifact | #489–#503, #518 | **Production-provider account remains unauthenticated and interactive verification is required.** | BLOCKED |
| REQ-016 Compatibility alias | native plugin/profile registration and compatibility lookup | profile/plugin/registry/session compatibility tests | Focused/full suites and final verification | `codex-native` has no aliases; implicit `codex` rejected; explicit/persisted Pi-backed `codex` unchanged | #501 | None | PASS |
| REQ-017 Complete verification | reusable contract suites, import boundaries, auth fixtures, Pibo2 ladder | all files above plus `agent-runtime-auth`, `login-actions`, `codex-native-auth`, provider Web/UI, debug PTY, workflow/Loop/Cron tests | Typecheck/build passed; **1,752/1,752 tests across 12 suites**; exact package inventory passes | Prior integrated matrix plus focused exact Pibo2 auth/API/browser/cleanup readiness pass | Entire stack through #518 | **One authenticated native-Codex production-provider run is absent.** | BLOCKED |
| REQ-018 Reviewable delivery | canonical specs/plans/project docs/reports, focused branches/commits | documentation links and diff checks | focused local verification, exact package, and clean diff pass | Exact auth candidate/report/safe screenshot recorded; Pibo2 remains on that candidate | #476–#503, #518 | Goal remains blocked rather than falsely completed | PASS |
| REQ-019 Runtime provider auth | `src/agent-runtime/auth.ts`, registry/router/channel dispatch, Pi/Codex auth controllers, product API, Provider Settings, Terminal/Designer model joins | `agent-runtime-auth`, `login-actions`, `codex-native-auth`, routed-session, Web, UI-source, skill tests | Typecheck/build and 1,752/1,752 full suite pass | Exact Pibo2 API/browser: Pi shared partial, native Codex private disconnected, Device code/API-key ready, no auth/process/generation residue | #518 | Native production-provider turn intentionally remains a later human gate | PASS |

## PR and evidence index

| Area | PR / report |
|---|---|
| Runtime foundation | #476; `agent-runtime-foundation-validation-2026-08-14.md` |
| Pi extraction/parity | #477; `pi-runtime-adapter-parity-validation-2026-08-14.md`; `pi-agent-runtime-parity-approved-auth-validation-2026-08-15.md` |
| Bindings / Designer / tools / resources / history | #478, #479, #483, #486, #487 |
| Authoring skill | #488; `runtime-adapter-authoring-skill-validation-2026-08-15.md` |
| Native Codex protocol through contracts | #489, #490, #491, #492, #493, #494, #495, #497, #498, #499, #501, #502 |
| Integrated fixes, prior exact candidate, docs, cleanup | #503; `multi-agent-runtime-adapter-integrated-validation-2026-08-16.md` |
| Runtime-neutral provider-auth correction | #518; `runtime-auth-control-plane-validation-2026-08-16.md` |

## Final decision

The previous statement that only external interactive authentication remained was incomplete: the Chat Web-to-Pi auth bypass was a real architecture gap. That gap is corrected in PR #518, the 1,752-test canonical suite passes, and exact Pibo2 Provider Settings truthfully show native Codex disconnected with managed Device code/API-key controls. The single remaining substantive action is an authorized human completing managed login so one bounded public native-Codex production-provider turn can close REQ-015, REQ-017, and the overall goal.

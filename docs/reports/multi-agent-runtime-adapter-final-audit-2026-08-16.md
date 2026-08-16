# Multi-Agent Runtime Adapter Final Audit

**Date:** 2026-08-16

**Scope:** REQ-001 through REQ-018 in [`../specs/changes/multi-agent-runtime-adapters/spec.md`](../specs/changes/multi-agent-runtime-adapters/spec.md)
**Overall result:** **BLOCKED on one external evidence gate.** Implementation, deterministic contracts, exact-candidate Pibo2 integration, Pi real-provider parity, documentation, security, migration, and cleanup pass. Pibo2-managed native-Codex production-provider authentication still requires interactive Google account verification.

## Verification baseline

- Exact integrated commit: `2404ca5d6466486c1a1c525964c24770be6b06b9`
- Exact package SHA-256: `dd0966a2712ee2d78d6e9da0cdf72ea78592f6b9c113884ee9a62163f332936b`
- Exact Codex App Server: `0.147.0`
- Native binary SHA-256: `cb0a15567e9a60a5820d54b0f6ae86d504dc3805c1eab21a47f70e3eb7b73a40`
- Final local verification: typecheck passed; build passed; 1,736/1,736 tests across 12 suites passed with zero failures, skips, or cancellations
- Final Pibo2 database: schema 5, integrity `ok`, 473 sessions/bindings, zero binding anomalies, zero validation fixtures
- PR stack: #476, #477, #478, #479, #483, #486, #487, #488, #489, #490, #491, #492, #493, #494, #495, #497, #498, #499, #501, #502, and #503

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
| REQ-009 Agent Designer | catalog APIs, custom-agent store, Designer runtime controls and disabled explanations | Designer autosave/default-model/catalog/save validation tests | Focused/full suites and final verification | Authenticated browser rendered native runtime diagnostics/options/capabilities; selected resources appeared in Context Build | #479, #495, #498, #499, #501 | None | PASS |
| REQ-010 Native behavior | Pi prompt/runtime assembly; Codex native process/resources/tool inspection | Pi parity tests; Codex resource/tool-inventory tests | 9.8/9.9 suites and final verification | Provider inspection proved native Codex prompt present, Pi base prompt absent, native tools unchanged, selected MCP additive | #477, #497, #498 | Complete pre-turn native inventory is unavailable in stable `0.147.0`; reported truthfully | PASS |
| REQ-011 Portable tools | Pibo JSON-Schema tool contract, Pi compiler, scoped MCP bridge, yielded-run integration | `pibo-portable-tool-session.test.mjs`, resource/subagent/security tests | Focused/full suites and final verification | Scoped credential denial/renewal/revocation, model-initiated Pibo tools/subagents, native+external tools in one session | #483, #497, #499 | Harness-private native-tool yielding remains unsupported and unadvertised | PASS |
| REQ-012 Skills/context/MCP | runtime resource service, isolated roots, secret-safe external HTTP/stdio MCP delivery | `agent-runtime-resource-service.test.mjs`, `codex-native-resources.test.mjs` | 9.8 focused 65/65 plus full/final verification | Pi and Codex selected-only skills/context/MCP passed; unselected skills absent; connected inventory and cleanup verified | #486, #497, #503 | None | PASS |
| REQ-013 History/debug | runtime-neutral product history, adapter history providers, debug/trace/telemetry | `agent-runtime-history.test.mjs`, trace/debug/Codex thread tests | Full suites and final verification | Native restart history, safe missing fallback, public trace screenshot, `debug trace --check`, telemetry, 21-MB legacy Pi coverage | #487, #492, #493, #501, #503 | None | PASS |
| REQ-014 Built-in authoring skill | `pibo-agent-runtime-adapter` skill and progressive references | `agent-runtime-adapter-skill.test.mjs`, Orion/Relay evals | 25/25 focused; full suite; eval 20/20 with skill vs 9/20 baseline | Exact Pibo2 catalog/Designer/Context Build/package validation | #488 | None | PASS |
| REQ-015 Official native Codex | `src/agent-runtimes/codex-native/*`, official stable App Server v2 client/process/thread/turn/request/model/resource/subagent stack | protocol/client/process/thread/turn/request/model/resource/subagent matrix | 76/76 Codex matrix, import boundaries, complete/full suites, final verification | Exact `0.147.0` App Server passed restart, native/Pibo/external tools, context/skills, subagents, jobs/workflows, approvals, abort/failure/missing, browser/trace/cleanup | #489–#502, #503 | **Pibo2-managed production-provider account is unauthenticated; Google verification needs human completion. Deterministic provider evidence cannot close this gate.** | BLOCKED |
| REQ-016 Compatibility alias | native plugin/profile registration and compatibility lookup | profile/plugin/registry/session compatibility tests | Focused/full suites and final verification | `codex-native` has no aliases; implicit `codex` rejected; explicit/persisted Pi-backed `codex` unchanged | #501 | None | PASS |
| REQ-017 Complete verification | reusable contract suites, import boundaries, fixtures, Pibo2 ladder | all files above plus `debug-pty.test.mjs`, workflow/Loop/Cron/Web tests | Typecheck/build passed; 1,736/1,736 tests across 12 suites; exact package and Pibo2 reports | Migration, real Pi, deterministic Codex, restart, browser, TUI, cleanup all pass | Entire stack | **One required authenticated native-Codex production-provider run is absent.** | BLOCKED |
| REQ-018 Reviewable delivery | canonical specs/plans/project docs/reports, focused branches/commits | documentation links and diff checks | final verification and clean branch | Exact package/report/assets recorded; Pibo2 restored and clean | #476–#502, #503 | Goal remains blocked rather than falsely completed | PASS |

## PR and evidence index

| Area | PR / report |
|---|---|
| Runtime foundation | #476; `agent-runtime-foundation-validation-2026-08-14.md` |
| Pi extraction/parity | #477; `pi-runtime-adapter-parity-validation-2026-08-14.md`; `pi-agent-runtime-parity-approved-auth-validation-2026-08-15.md` |
| Bindings / Designer / tools / resources / history | #478, #479, #483, #486, #487 |
| Authoring skill | #488; `runtime-adapter-authoring-skill-validation-2026-08-15.md` |
| Native Codex protocol through contracts | #489, #490, #491, #492, #493, #494, #495, #497, #498, #499, #501, #502 |
| Integrated fixes, exact candidate, docs, cleanup | #503; `multi-agent-runtime-adapter-integrated-validation-2026-08-16.md` |

## Final decision

Seventeen requirement rows are implemented and evidenced without a known code regression. REQ-015 and REQ-017 remain blocked solely because no authorized Pibo2-managed native-Codex production-provider credential exists. The smallest remaining action is for an authorized human to complete the already-supported Google/OpenAI login in the Pibo2 browser; the agent can then run one bounded public native-Codex turn, record the trace, and change those two rows to PASS.

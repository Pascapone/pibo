# Runtime-Neutral History, Trace, and Debug Validation — 2026-08-15

**Status:** Pass

**Branch:** `feature/agent-runtime-history`

**Stacked on:** runtime-resource materialization PR #486

**Pull request:** #487

**Primary implementation commit:** `50256373efc2c54b0af6302add8e569f2e54837b`

**Final runtime-fix commit validated on Pibo2:** `9a8e6510b3d9b74fbdb407748ed83870aa888272`

## Outcome

Pibo-owned messages, normalized events, observations, and durable payloads are now the primary source of product-visible history for new Pibo-routed turns. Harness-native history is isolated behind adapter history providers and is used only for explicit runtime-history reads and compatibility-marked legacy sessions. Pi JSONL discovery and parsing no longer live in generic Chat Web or debug code.

The exact candidate passed schema-v5 migration, fresh product-history reconstruction without a native transcript, missing-transcript fallback, large-payload hydration, legacy Pi compatibility, runtime-history pagination and cursor rejection, runtime-aware debug/telemetry, authenticated browser rendering, service restart, and validation-fixture cleanup on Pibo2.

## Candidate

| Item | Value |
|---|---|
| Package | `@pasko70/pibo@1.7.2` |
| Commit | `9a8e6510b3d9b74fbdb407748ed83870aa888272` |
| Artifact | `/tmp/pibo-history-pack-9a8e6510/pasko70-pibo-1.7.2.tgz` |
| Artifact SHA-256 | `994fd18cdb771bf23d3d544c71a631713948fe863aef4e48ca1fdb0e35738c58` |
| Installed path | `/opt/pibo-candidates/agent-runtime-history/9a8e6510b3d9b74fbdb407748ed83870aa888272` |
| Final active PID | `403293` |
| Final public check | HTTP 200 in 19 ms |

The active process command and `PIBO_DEPLOY_CANDIDATE` / `PIBO_DEPLOY_COMMIT` service environment were checked before and after authenticated requests and after two explicit gateway restarts. They continued to identify the exact candidate.

## Local verification

- `npm run typecheck`: passed.
- `npm run build`: passed.
- Focused history, registry, schema migration, ingestion, debug, trace, UI, and Web API tests: passed.
- Final full suite: **1,656/1,656 passed across 12 suites**.
- Import-boundary tests prevent generic runtime/history modules from importing Pi or Codex implementations.

Representative coverage includes:

- `test/agent-runtime-history.test.mjs`
- `test/agent-runtime-registry.test.mjs`
- `test/agent-runtime-boundaries.test.mjs`
- `test/data-v2-store.test.mjs`
- `test/data-v2-ingest-service.test.mjs`
- `test/debug-cli.test.mjs`
- `test/chat-trace-materialization.test.mjs`
- `test/chat-ui-integration.test.mjs`
- `test/web-channel.test.mjs`

## Schema-v5 migration

The existing Pibo2 database was inspected immediately before first activation and after schema application.

| Measure | Before | After |
|---|---:|---:|
| Schema version | 4 | 5 |
| Pibo Sessions | 472 | 472 |
| Runtime bindings | 472 | 472 |
| `nativeHistoryFallback` markers | 0 | 472 |
| `historyMigrationSource=schema-v5` | 0 | 472 |
| Messages | 2,242 | 2,242 |
| Events | 166,470 | 166,470 |
| Payloads | 3,938 | 3,938 |
| Integrity | `ok` | `ok` |

The session digest remained `644a833b2459c2945c41eb5170a34b0a0a8cd1c6285465404cd617fd773c3b29`. The binding identity digest remained `fd1bba0a300199b2bea4fead6f8a35d6a3aea4049fa15a32ec7a9e6304ddce32`. Existing Pibo ids, native Pi ids, binding states, and binding revisions were not rewritten.

A fresh session created on the final candidate had:

- runtime instance `pi`;
- adapter `pi`;
- state `unbound`;
- revision 1;
- an empty metadata object;
- no native JSONL file.

After gateway restart, the same binding still had revision 1 and no fallback metadata. This proves that schema-v5 fallback is migration-only rather than a default for new sessions.

## New product history without native transcript reads

Validation session `ps_acc918ce-182f-4aa1-95de-a38644550da1` was created with no Pi JSONL. A deterministic ingest fixture persisted:

- 20,058-byte user text;
- 18,068-byte reasoning text;
- a 20,105-byte structured tool result;
- 24,068-byte assistant text;
- two durable messages, eight normalized events, seven observations, and four payload references.

Authenticated trace results were:

- summary: HTTP 200, eight events, runtime `pi/pi`;
- V2 timeline: HTTP 200, five nodes;
- node types: `user.message`, `agent.turn`, `model.reasoning`, `tool.call`, and `assistant.message`;
- sources: `product-history` and `event-log` only;
- compatibility trace: HTTP 200 with all begin/end markers present;
- locator/config leakage checks: false.

The tool output payload endpoint returned all 20,105 bytes with `hasMore:false` and both validation markers. Runtime-aware debug read the full 24,068-byte assistant message and complete tool result rather than previews; the compatibility trace contained both reasoning markers. `debug trace --check` reported `historySource: product`, five nodes, and `checks: ok`.

The session was then deliberately marked `missing` with the compatibility fallback flag while its native transcript remained absent. Summary, V2 timeline, compatibility trace, normal debug trace, and explicit `--native-history` debug trace all continued to reconstruct the same product history. No replacement Pi transcript was created. This validates visible missing-native diagnostics without losing Pibo-owned conversation history or silently inventing a harness conversation.

## Legacy Pi history compatibility

Legacy validation session `ps_069cced9-7902-4b10-8bd6-279d7b98ece1` retained its frozen `pi/pi` binding and approximately 21 MB native transcript. Its migrated binding preserved prior metadata and added only the schema-v5 history markers.

Final exact-candidate debug results were:

- product history coverage: 310 messages, 16,005 events, 15,987 observations, and 126 payload references;
- explicit native history source: `native`;
- merged sources: `transcript` and `event-log`;
- reconstructed nodes: 5,202;
- native session id matched the frozen binding;
- consistency checks: `ok` with zero issues;
- binding locator and metadata values were not emitted.

The first candidate exposed a real compatibility defect on this large transcript: broad native-history echo suppression removed parent turns while retaining 2,454 event-log tool nodes, producing 2,454 `missing_parent` warnings. Commit `9a8e6510` changed suppression to use covered turn/tool sets. The final candidate retained event scaffolds for history not covered by the bounded native page, eliminated every orphan, and added a partial-native-history regression test.

An oversized V1 full-trace request was correctly rejected with HTTP 413 and directed the caller to bounded V2 timeline/payload APIs. The V2 tail returned HTTP 200 with 100 bounded nodes in about 321 ms.

## Runtime-history pagination and cursor isolation

The authenticated V2 API was paged through the legacy session's normalized event history until it transitioned to an opaque `runtime-history:` cursor. The transition occurred after 67 bounded 240-node event pages. The cursor contained only Pibo Session/runtime scope and a cutoff timestamp; it contained no transcript path or adapter locator.

Two runtime-history requests returned HTTP 200, advanced the opaque cursor, and reached `hasOlder:false`. These pages contained no additional nodes because the normalized event history already covered the transcript time range; the Pi provider still advanced its bounded reverse-scan cursor instead of performing an unbounded 21 MB read.

A cursor copied to a different Pibo Session was rejected before the provider ran:

```json
{"status":409,"error":"Runtime history cursor belongs to a different Pibo session"}
```

Local Web API coverage additionally rejects cursors whose runtime instance or adapter no longer matches the frozen binding and verifies that provider failures are sanitized.

## Runtime-aware debug and telemetry

The installed candidate's real CLI was exercised directly on Pibo2.

- `pibo debug session <id> runtime --json` reported runtime instance, adapter, binding state/revision, metadata keys, and product-history coverage without locator or metadata values.
- `pibo debug trace <id> --check --json` used product history by default.
- `pibo debug trace <id> --native-history --check --json` explicitly requested the selected adapter's compatibility history and fell back safely to product history when the transcript was missing.
- The legacy native trace returned 5,202 nodes and `checks: ok` after the suppression fix.
- Debug messages, events, tools, failures, summary, and final-message reads hydrate durable `payload_ref` values before presenting content.
- `pibo debug telemetry session ps_06925bab-aa85-4676-afab-ba0be8fb1283 --json` reported `runtimeInstanceId: pi`, `runtimeAdapterId: pi`, a scoped native id, and binding state `unbound` alongside the existing telemetry detail.

Generic debug identity now centers the Pibo Session and persisted runtime binding. The old `sessions.pi_session_id` column is used only as a compatibility fallback when a store predates runtime bindings.

## Restart and browser evidence

Two explicit production-gateway restarts completed with zero active runtime sessions. The active PID changed while the exact candidate commit remained unchanged. After restart:

- the fresh final-candidate session retained its unbound `pi/pi` binding and empty metadata;
- the missing-native fixture reconstructed five product-history nodes with complete user and assistant markers;
- the 21 MB legacy session again produced 5,202 mixed-source nodes with `checks: ok` and no orphan parents.

The authenticated Terminal view rendered the product-history fixture with:

- visible `pi · missing` runtime state;
- one user turn;
- persisted reasoning/tool structure;
- the complete assistant end marker despite there being no native transcript.

Evidence: `docs/reports/screenshots/runtime-history-product-fallback-pibo2-2026-08-15.png`

Screenshot SHA-256: `311220ceaff72b5710dd5942f5f35c02ed4c024ead28c5f15ada700530000501`.

The screenshot is cropped to the session pane and omits account identity and unrelated rooms.

## Cleanup

Both temporary sessions were archived and permanently deleted through the authenticated API. Their runtime-binding endpoints immediately returned HTTP 404, and no native transcript had been created for either native id.

Validation created seven durable payload objects: four seeded large payloads and three bounded trace-page payloads. After confirming that none remained referenced by messages, events, observations, or telemetry tables, the fixture-specific rows and files were removed and the gateway restarted to clear trace caches.

Final state returned exactly to:

- 472 sessions and 472 bindings;
- 2,242 messages and 166,470 events;
- 3,938 payloads;
- schema version 5 and integrity `ok`;
- the same session and binding identity digests recorded immediately after migration;
- zero active runtime sessions and zero active yielded runs.

## Remaining scope

- This milestone does not claim real-model Pi parity. Pibo2 model turns remain separately blocked by the pre-existing `No API key for provider: openai-codex` failure reproduced on the pre-adapter baseline.
- Native Codex remains gated on that broader Pi parity proof.
- Native transcripts remain authoritative harness resume state. This milestone makes them optional for normal new-turn product rendering; it does not replace or rewrite them.
- The built-in adapter-authoring skill and native `codex-native` adapter remain later milestones.

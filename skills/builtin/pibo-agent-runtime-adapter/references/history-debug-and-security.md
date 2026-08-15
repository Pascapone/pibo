# History, Debug, and Security

Use this reference when implementing native history, product trace reconstruction, runtime-aware diagnostics, payload handling, or adapter security boundaries.

## Two history responsibilities

### Pibo product history

Pibo persists normalized messages, terminal semantic events, observations, and large payloads for new routed turns. This is the normal source for Chat Web, Terminal View, and generic debug trace reconstruction after restart.

An adapter must emit enough terminal semantic data for Pibo to reconstruct:

- accepted user turn;
- assistant content;
- reasoning when exposed;
- tool call/start/update/finish;
- turn completion/failure;
- usage/compaction/approval/input states where applicable.

Do not require native transcript discovery for every normal trace read.

### Harness-native history

Native history remains harness-owned resume state and may support legacy compatibility, import, repair, or explicit debug drill-down. Access it only through the selected adapter's provider.

Generic trace/debug code must never parse a harness transcript format or infer its path.

## History provider contract

An adapter declaring `maintenance.history:true` implements both:

```ts
inspectHistory(input: InspectAgentRuntimeHistoryInput): Promise<AgentRuntimeHistoryInspection>
readHistory(input: ReadAgentRuntimeHistoryInput): Promise<AgentRuntimeHistoryPage>
```

`inspectHistory()` reports bounded safe metadata:

- runtime instance and adapter;
- binding state;
- available/not available;
- title/first message/timestamps/count/size/version when safe;
- adapter-scoped locator for internal use;
- redacted diagnostics.

`readHistory()` returns normalized `AgentRuntimeHistoryEntry` values, an opaque provider cursor, `hasMore`, optional order offset, and inspection.

Never return a provider credential, raw local path in product responses, global config, or an unbounded native object.

## Normalized entries

Use:

- message roles `user`, `assistant`, `tool`, `system`;
- text, reasoning, and tool-call content parts;
- stable entry/native turn/native entry ids;
- timestamps and optional sequence/order;
- tool call id/name/result/error/status;
- session-info entries for safe titles/labels.

Normalize at the adapter boundary. Do not leak protocol classes or SDK types into `src/shared/trace-*` or debug code.

## Pagination

Native history reads must be bounded by count and bytes/time where relevant. Provider cursors are opaque to product code.

Chat Web wraps provider pagination in a `runtime-history:` cursor scoped to:

- Pibo Session id;
- frozen runtime instance;
- frozen adapter;
- provider cursor and/or cutoff timestamp.

Reject cross-session, cross-instance, and cross-adapter cursor reuse before calling the provider. Sanitize provider failures.

For file transcripts, reverse pagination may need a bounded scan cursor. Empty pages are acceptable only when the cursor advances and the API accurately reports whether another bounded scan remains.

## Compatibility markers

When introducing complete product history at a schema boundary:

- mark only sessions that predate it for native fallback;
- leave fresh sessions product-history-primary;
- preserve Pibo ids, native ids, transcript paths, binding revisions, and existing metadata;
- make migration idempotent;
- document rollback behavior.

Missing native history must not delete the Pibo Session or create a replacement conversation. Keep surviving product history visible and report the missing binding/history state.

## Echo suppression

When merging native history and normalized events, suppress only content actually covered by the native page.

Track covered turn and tool identities. Do not suppress parent turn scaffolds for event nodes whose native parent is outside the bounded page. Test partial history pages against orphan parent/tool nodes.

Product history usually suppresses duplicate assistant echoes while retaining reasoning, tool, and lifecycle events not represented in durable message rows.

## Durable payloads

Large message, reasoning, tool, error, or assistant bodies may be stored behind `payload_ref`.

Rules:

- hydrate the durable payload for full reconstruction or explicit full debug reads;
- never treat a preview as complete history;
- keep default list/timeline output bounded;
- expose payload refs and chunk APIs for large UI details;
- validate content type/encoding and byte limits;
- do not place secrets in payload previews or metadata;
- clean validation fixtures according to retention policy.

Add tests with begin/end markers beyond preview limits so truncation cannot pass unnoticed.

## Runtime-aware debug identity

Generic debug output centers the Pibo Session and frozen binding:

- Pibo Session id;
- runtime instance;
- adapter;
- binding state/revision;
- native id only as clearly labeled adapter metadata;
- bounded product-history counts;
- metadata key names only when useful.

Apply this to session, summary, messages, events, tools, failures, telemetry, trace, and live signals.

Use legacy `sessions.pi_session_id` only as an explicitly scoped compatibility fallback when modern binding storage is absent.

## Debug drill-down

Keep normal output runtime neutral:

```text
pibo debug session <ps_...> runtime
pibo debug trace <ps_...> --check
pibo debug messages <ps_...> list
pibo debug events <ps_...> --limit 20
```

Use explicit native history only for compatibility/diagnosis:

```text
pibo debug trace <ps_...> --native-history --check
```

Adapter-specific protocol diagnostics should use a namespaced bounded command or inspection surface. Do not make every generic command understand each protocol.

## Redaction boundary

Never expose:

- API keys, OAuth material, cookies, machine keys, bearer tokens;
- Pibo tool MCP raw credentials or hashes;
- secret environment values;
- authorization headers;
- unredacted provider requests/responses;
- generated config containing resolved secrets;
- binding locator values in normal product/debug output;
- binding metadata values that may contain credentials;
- full stderr or crash dumps without redaction/bounds.

Safe output may include stable diagnostic codes, adapter/instance ids, protocol/version, native id when needed, locator kind, metadata key names, exit code, bounded redacted stderr summary, and correlation ids.

Test redaction with realistic secret-like values in config, metadata, environment, MCP arguments, provider failures, and history errors.

## Credential isolation

For Pibo tool MCP:

- credentials are random, short-lived, hashed in memory, and scoped to Pibo Session/runtime/adapter/generation/tool set;
- cross-session discovery/calls and transport-session hijacking fail;
- renewal never broadens scope or exceeds maximum lifetime;
- disposal revokes credentials and closes MCP sessions.

For external MCP/harness auth:

- resolve secrets into session-only environment/process state;
- generated files contain references, not resolved values;
- do not inherit unrelated gateway environment by default;
- do not persist raw secrets in bindings, payloads, logs, telemetry, or reports.

## Filesystem isolation

Generated adapter state is private, selected-only, generation-scoped, and disposable.

- reject path traversal, escaping symlinks, cycles, excessive files/bytes;
- create directories/files with restrictive modes;
- do not mutate source skills/context/MCP config;
- do not point the harness at global roots containing unselected resources;
- remove generations on disposal, failed startup, deletion, and stale-process recovery.

## Process and network isolation

- Bind Pibo's tool MCP bridge to loopback only.
- Authenticate every MCP discovery/call.
- Bound protocol input sizes, request counts, and pending work.
- Separate stderr diagnostics from protocol stdout.
- Do not expose a native app-server port publicly unless the adapter design includes authenticated transport and threat analysis.
- Terminate only processes owned by the adapter/session.

## Security review questions

- Can one Pibo Session call another session's tools or MCP transport?
- Can unselected skills/context/MCP appear in native discovery?
- Can a generated config or debug response reveal a resolved secret?
- Can a native id or cursor be replayed against another binding?
- Can malformed protocol input create unbounded memory, disk, or pending requests?
- Can a failed startup leave a process, token, port, or private directory behind?
- Can a profile claim support that bypasses save/start validation?
- Does any generic module read adapter-specific files or config?

Add a negative test for each credible answer of "yes."

# Design: Yielded Agent Orchestration

## Decisions

### Pibo Run owns request identity

The yielded `runId` is passed into the nested tool execution context as `yieldedRunId`. Delegated sends use that value as `requestId`; no second request identity is introduced.

### Send is hidden, not rejected after selection

Tool assembly keeps `pibo_agents_send_message` in the yieldable catalog but omits it from the direct runtime definitions. List, observe, and kill remain direct management tools.

### Waiting has no lifetime effect

The reply waiter accepts an optional deadline for non-agent compatibility, but the agent controller supplies none. Run wait remains bounded and non-destructive.

### Provenance follows recursive delegation

A subagent-request provenance record carries request identity and optional originating Loop job/run identity. Nested delegated turns propagate the same Loop identity. Runtime-routed turn outputs copy active message provenance after adapter normalization so usage remains attributable across child and grandchild sessions.

### Runtime manifest is resolution evidence

Build Context adds a structured runtime-manifest node after resolving the concrete inspected session. It reports effective model/thinking values, directly callable managed tool names, yielded targets, active packages, context, skills, and delegated-agent selections. Descriptive agent/package/yielded labels remain separate from `activeToolNames`. The node is read-only inspection data, not profile input or prompt content; portable adapters explicitly mark tool discovery as Pibo-managed-only when harness-native names are unavailable.

### Results distinguish inline and complete artifacts

A delegated final message is retained completely, including every ordered text part from a multi-part provider message. Bash keeps Pi's existing bounded inline output contract; when truncated, the complete output remains referenced by `fullOutputPath` in structured details.

### Cancellation is request-specific and acknowledgement-driven

Explicit delegated cancellation uses the child message event ID. Queued cancellation removes only that message; active cancellation aborts that turn and waits for that request's in-flight settlement without waiting for unrelated queued work. Explicit cancellation, session kill, subtree disposal, and router disposal enumerate active runs without mutating them, await bounded cancellation settlement and execution cleanup, release admission, and only then commit terminal `cancelled` state. Rejected abort or non-settlement remains an explicit failure rather than a false cancelled response.

### Public controller changes are additive

The package-root agents-controller types keep the prior input and result shape valid. Yielded request identity and complete final text are optional additions at the controller boundary; the shared send tool normalizes missing values to the yielded run ID and `reply.text` before producing text, structured content, or details.

## Risks / Trade-offs

- Removing the implicit deadline permits legitimately stuck work. The orchestrator handles this through Observe followed by explicit cancel or kill.
- Existing profiles with `timeoutMs` no longer receive that deadline. The field remains readable for compatibility but is deprecated behaviorally.
- Recursive accounting is additive JSON state and therefore remains readable by older installations, which ignore unknown fields.

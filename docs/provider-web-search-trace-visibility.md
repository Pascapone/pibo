# Provider Web Search Trace Visibility

## Status

Provider-backed `web_search` works as a native Pibo tool, but provider-hosted search calls are not yet visible as first-class trace nodes.

The current implementation selects `web_search` through the Pibo profile and exposes the capability through the OpenAI Responses hosted `web_search` provider tool. This means no local Pibo `tool_execution_started` / `tool_execution_finished` events are expected for a successful search call.

## Reference Session

- Pibo Session: `ps_5ee14c39-b987-4b67-b5ff-75f5a97cb711`
- Pi Session: `380ca3ac-a716-4599-aa7d-33d48aa6b3a1`
- Profile: `codex-compat-openai-web`
- Provider/model: `openai-codex` / `gpt-5.4`
- User request: `Fuehre eine Websuche zu honker einem SQL Event System durch.`

The final assistant answer contained external sources and no DuckDuckGo-backed local tool result details. That matches the provider-backed runtime path. The trace and persisted Pi JSONL did not expose a separate `web_search_call` item, so Chat Web and `pibo debug trace` had no provider search node to render.

## Desired Trace Shape

Provider-hosted tool calls should be normalized into trace-readable content without changing the model-facing tool name.

Minimal provider tool call data:

```ts
{
  type: "provider_tool_call",
  provider: "openai",
  toolName: "web_search",
  providerType: "web_search_call",
  callId?: string,
  status?: "running" | "completed" | "failed",
  query?: string,
  action?: unknown,
  sources?: Array<{ title?: string; url?: string; snippet?: string }>,
  raw?: unknown
}
```

The shape is intentionally generic enough for future provider-hosted tools, but the first implementation target is OpenAI hosted `web_search_call`.

## Expected UX

Chat Web should show provider-backed search activity in the same places where local tool calls are useful during debugging:

- Trace Timeline
- Compact Terminal Session View
- `pibo debug trace`
- JSON debug output when available

The visible node should identify `web_search`, the provider, status, and any returned sources. It should appear in chronological order between the triggering user/model context and the assistant response.

## Implementation Notes

Start by checking whether OpenAI Responses emits `web_search_call` data that Pi Coding Agent currently drops during stream normalization or session persistence.

Relevant paths:

- `<HOME>/code/pi-mono/packages/ai/src/stream.ts`
- `<HOME>/code/pi-mono/packages/coding-agent/src/core/agent-session.ts`
- `src/apps/chat/trace.ts`

If Pi does not persist provider-hosted tool calls, add a small Pi-side transcript part instead of reconstructing calls from logs in Pibo.

The implementation plan is tracked in `plans/implement-provider-web-search-trace-visibility.md`.

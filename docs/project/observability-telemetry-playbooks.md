# Observability Telemetry Debug Playbooks

Use these playbooks when a Pibo session stalls or telemetry looks suspicious. Start with bounded summary commands. Use JSON when an agent needs ids for the next command. Do not use payload preview commands unless the summary path fails; V1 preview capture is disabled/unavailable by default.

## Safety rules

- Work from Pibo Session ids, turn ids, provider request ids, and tool call ids.
- Prefer `--json` for agent loops and plain text for humans.
- Keep `--limit` small when streams are noisy.
- Do not expect telemetry to fix a hang. Automatic timeout, abort, retry, and recovery are separate runtime-hardening work.
- Treat `pibo debug telemetry prune --apply` as destructive. Run the same prune command without `--apply` first.

## Stuck streaming session

Use this when a session shows `streaming=true`, `processing=true`, or a live stale hint.

Human path:

```bash
pibo debug telemetry session <pibo-session-id> --limit 10
pibo debug telemetry turn <turn-id> --limit 20
pibo debug telemetry provider <provider-request-id>
pibo debug telemetry provider <provider-request-id> events --limit 20
```

Agent path:

```bash
pibo debug telemetry session <pibo-session-id> --limit 10 --json
pibo debug telemetry turn <turn-id> --limit 20 --json
pibo debug telemetry provider <provider-request-id> --json
```

Look for an open `provider_stream`, `tool_args`, or `tool_execution` phase. Compare `lastProgressAt`, `staleForMs`, provider `lastRawEventAt`, and provider `lastNormalizedEventAt`. If provider events are paged, continue with `--after <nextAfterSequence>`.

## Partial tool-call arguments

Use this when the trace shows a tool call with incomplete arguments or no execution start.

Human path:

```bash
pibo debug telemetry session <pibo-session-id>
pibo debug telemetry turn <turn-id>
pibo debug telemetry tool <tool-call-id>
pibo debug telemetry provider <provider-request-id> events --limit 20 --fields eventType,itemId,toolCallId
```

Agent path:

```bash
pibo debug telemetry tool <tool-call-id> --json
pibo debug telemetry provider <provider-request-id> events --limit 20 --fields eventType,itemId,toolCallId --json
```

Confirm `argsBytes`, `parseStatus`, `argsComplete`, `executionStartedAt`, and the latest tool-argument event. Telemetry shows safe argument keys and byte counts only; it does not store full tool arguments.

## Provider parse error or malformed event

Use this when provider counters show parse errors or unknown event types.

```bash
pibo debug telemetry provider <provider-request-id>
pibo debug telemetry provider <provider-request-id> events --limit 50 --fields eventType,parseStatus,byteSize
pibo debug telemetry provider <provider-request-id> events --after <sequence> --limit 50 --json
```

Check `parseErrorCount`, `unknownEventCount`, event `parseStatus`, event type, sequence, and byte size. Default output omits raw provider bodies. If a payload command exists, expect a preview-unavailable result unless a later release enables bounded preview capture.

## Unknown provider event type

Use this when a new provider event type appears but normalized events stop.

```bash
pibo debug telemetry provider <provider-request-id> --json
pibo debug telemetry provider <provider-request-id> events --limit 50 --fields eventType,parseStatus,itemId,toolCallId --json
```

Use `eventType`, `safeFields`, `itemId`, `toolCallId`, and normalized-event links to decide whether parser support is missing. Do not request raw event bodies in normal triage.

## Stale tool execution

Use this when a tool started but did not finish.

Human path:

```bash
pibo debug telemetry stale --limit 20
pibo debug telemetry turn <turn-id>
pibo debug telemetry tool <tool-call-id>
```

Agent path:

```bash
pibo debug telemetry stale --limit 20 --json
pibo debug telemetry tool <tool-call-id> --json
```

Check `activePhase=tool_execution`, `staleForMs`, `thresholdMs`, `thresholdSource`, execution start/end timestamps, and safe error summary fields. The stale detector is read-only; it never aborts or clears a session.

## Preview unavailable

Use this when an event row has a payload or preview reference and an operator wants to confirm V1 preview behavior.

```bash
pibo debug telemetry provider <provider-request-id> payload <preview-or-event-summary-id>
pibo debug telemetry provider <provider-request-id> payload <preview-or-event-summary-id> --json
```

Expected V1 behavior is `unavailable` or `disabled`. The command must not fall back to raw provider payloads, full transcripts, normalized event payloads, or full tool arguments.

## Retention cleanup

Use this when telemetry stats show old diagnostic or provider-event rows.

```bash
pibo debug telemetry stats
pibo debug telemetry stats --json
pibo debug telemetry prune --retention provider_event --before <iso-date>
pibo debug telemetry prune --retention provider_event --before <iso-date> --json
# Destructive only after reviewing the dry-run result:
pibo debug telemetry prune --retention provider_event --before <iso-date> --apply
```

Prune affects telemetry rows only. It must not delete Pibo Sessions, Chat events, Pi transcripts, normalized event payloads, or unrelated stores.

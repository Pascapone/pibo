# Chat Web Live Streaming Fix Implementation Plan

Date: 2026-05-20
Investigation source: `docs/reports/chat-web-live-streaming-e2e-investigation-2026-05-20.md`

## Goals

1. Stop selected-session live SSE churn during normal streaming.
2. Recover live UI state after browser background/foreground, BFCache restore, focus, and online transitions.
3. Avoid hidden-tab `requestAnimationFrame` stalls for pending stream deltas.
4. Handle signal SSE errors with snapshot recovery instead of ignoring them.
5. Validate the fix with typecheck/build and a targeted browser/CDP SSE lifecycle test.

## Implementation steps

### 1. Decouple live SSE lifecycle from trace cursor

- Add refs for the last seen stream id per Pibo Session.
- Seed the ref from fetched trace pages.
- Update the ref from incoming SSE event ids.
- Open live SSE with the ref/base trace cursor.
- Remove `currentTraceView.latestStreamId` from the live SSE effect dependencies.

Success criteria: ordinary live events no longer cause `EventSource.close()` and reconstruct cycles.

### 2. Add live stream health and explicit reconnect

- Track selected live stream state in refs: session id, `EventSource`, opened time, last activity, reconnect generation, and reconnect timer.
- Add `onopen`/`onerror` handlers.
- Reconnect stale or errored streams with bounded backoff.
- Flush pending events before replacing a stream.

Success criteria: transport errors schedule reconnect without waiting for a full page reload.

### 3. Add foreground recovery

- Add a shared recovery callback for selected sessions.
- On `visibilitychange` visible, `pageshow`, `focus`, and `online`:
  - flush pending stream events;
  - refetch selected trace;
  - refetch bootstrap/navigation;
  - reconnect live SSE if stale.

Success criteria: foregrounding a tab/app catches up without reload.

### 4. Add hidden-page flush fallback

- Keep `requestAnimationFrame` for visible pages.
- Use a short `setTimeout` fallback when hidden or when rAF may be throttled.
- Clear both frame and timer on unmount.

Success criteria: pending text/reasoning events do not remain stuck solely behind a hidden-page rAF.

### 5. Recover signal SSE snapshots on errors

- Replace ignored `subscribeSignalTree` errors with a debounced `fetchSignalTree` snapshot refresh.
- Clear the recovery timer on subscription cleanup.

Success criteria: signal tree can recover after signal SSE errors.

## Validation

1. `npm run typecheck`
2. `npm run chat-ui:build`
3. Targeted Docker browser/CDP test:
   - instrument `EventSource`;
   - open a session;
   - trigger multiple `status` actions;
   - assert selected live SSE has one construct/open and zero closes during the burst.

## Non-goals

- Production deployment.
- Server-side observer TTL changes unless client-side validation reveals a remaining server leak.
- Real Spark model streaming validation in this implementation pass; that should follow after deterministic checks pass.

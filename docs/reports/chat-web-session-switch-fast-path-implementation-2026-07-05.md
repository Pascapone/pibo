# Chat Web Session Switch Fast Path Implementation Report

Date: 2026-07-05

## Goal

Bring local Chat Web session switching below 100 ms for the visible Terminal View load path, especially for large sessions.

## Implemented Changes

- Added `idx_event_log_session_sequence_stream` on `event_log(session_id, session_sequence DESC, stream_id DESC)` so trace tail pages and latest-sequence lookups do not scan large session histories.
- Changed latest event lookup from `MAX(session_sequence)` aggregation to indexed `ORDER BY session_sequence DESC, stream_id DESC LIMIT 1`.
- Added fast Pi transcript metadata loading for the Trace V2 hot path. It reads only the transcript header window and stat data instead of parsing the full JSONL file.
- Stopped reading transcript tail files for normal Trace V2 tail pages when bounded V2 events are present. Transcript reads remain lazy for transcript-history cursors and empty-event fallback.
- Lowered synchronous JSON gzip eligibility from 512 KB to 64 KB and added `response_compress` server timing for compressed responses.
- Made Chat Web session selection optimistic:
  - selected session updates in the next UI task;
  - unread counts are cleared locally;
  - mark-read and navigation refresh run in the background;
  - the route effect sees the optimistic bootstrap selection and does not immediately trigger a redundant navigation load.
- Removed Trace Summary from the normal initial session-switch path.
- Rehydrated compact trace pages from TanStack Query cache immediately on session selection.

## Validation

Environment:

- Isolated Pibo compute worker: `pibo-dev-session-switch-fast-path-worker`
- Worker web URL: `http://127.0.0.1:4802/apps/chat`
- Copied local `pibo.sqlite` into the worker for large-session validation.
- Large session tested: `ps_c553ff1a-4287-47d0-8e76-2ffbe2805a72`

Browser/CDP session-switch measurements after final UI timeout adjustment:

| Session | Selection visible | Terminal ready | Trace/API notes |
| --- | ---: | ---: | --- |
| `ps_04c8591a-2a10-43ce-a7e3-5bea037512a7` | 15.4 ms | 68.5 ms | timeline page-hit, 19.4 ms fetch |
| `ps_c553ff1a-4287-47d0-8e76-2ffbe2805a72` | 18.7 ms | 69.8 ms | large session 304, 20.7 ms fetch |
| `ps_fb018813-b580-4384-8bd3-76cd5d689f16` | 15.3 ms | 68.5 ms | timeline page-hit, 13.5 ms fetch |
| `ps_c553ff1a-4287-47d0-8e76-2ffbe2805a72` revisit | 14.7 ms | 66.4 ms | cached trace rendered immediately |

Uncached large-session Trace V2 API probes with alternate limits:

| Limit | Browser fetch | Server timing | Response bytes |
| ---: | ---: | --- | ---: |
| 49 | 12.5 ms | `trace_timeline;dur=7.8`, `trace_metadata;dur=0.0`, `trace_cache;desc="miss"` | 34,201 |
| 48 | 11.8 ms | `trace_timeline;dur=7.7`, `trace_metadata;dur=0.1`, `trace_cache;desc="miss"` | 34,201 |
| 47 | 11.2 ms | `trace_timeline;dur=7.0`, `trace_metadata;dur=0.0`, `trace_cache;desc="miss"` | 34,036 |

Targeted test/build commands:

- `npm run typecheck`
- `npm run build`
- `node --test test/chat-v2-native-services.test.mjs test/chat-ui-app-navigation-merge.test.mjs test/web-http.test.mjs test/chat-trace-tail-entries.test.mjs test/trace-v2-fast-path.test.mjs`
- Additional final `npm run chat-ui:typecheck` and final `npm run build` after the spinner timeout adjustment.

## Residual Notes

- Navigation refresh still runs after selection, but it is no longer in the critical click-to-render path.
- The test worker used copied local DB state, not the live host gateway process.
- Full auth/local-auth behavior in the worker was not part of the performance fix; the authenticated Chrome tab on the worker port was used for browser validation.

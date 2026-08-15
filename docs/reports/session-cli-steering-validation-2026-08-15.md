# Session CLI steering validation — 2026-08-15

## Scope

Branch `feature/session-cli-steering` adds session-scoped delivery selection to `pibo client` without changing the default behavior of existing plain messages:

- plain text queues as before;
- `/queue <message>` explicitly queues a follow-up turn;
- `/steer <message>` steers the currently active streaming turn;
- empty delivery commands fail locally with usage guidance;
- accepted steering prints the active turn id when the gateway provides it;
- `pibo client --help` and root discovery expose the feature.

The gateway protocol validator accepts only `queue` and `steer` as message delivery values.

## Verification

Base: `upstream/dev` at `54176105c2f0c752a3d6de017fbebb40e301e565`.

- `npm run typecheck` — passed.
- Focused gateway/client/web tests — 30 passed, 0 failed.
- `npm test` — 1,604 passed, 0 failed across 12 suites.
- `git diff --check` — passed.

## PTY validation

The built CLI was run through `pibo debug pty run` against a deterministic TCP gateway fixture. The PTY completed normally and observed the steering confirmation:

```text
steer: delivered to active turn active-turn-1
```

The gateway received these distinct session message events:

```json
{"type":"message","piboSessionId":"ps_running","text":"change the active approach","source":"user","delivery":"steer"}
{"type":"message","piboSessionId":"ps_running","text":"follow up afterward","source":"user","delivery":"queue"}
```

The PTY artifact was written to `/tmp/pibo-pty-session-cli-steering` on the validation host. No live user or Loop session was modified during this deterministic test.

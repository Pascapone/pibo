# Immediate top trace pagination validation — 2026-08-07

## Verdict

The authenticated Pibo2 Compact Terminal history path passes on immutable combined candidate `immediate-top-trace-pagination/e088ddf7`.

Reaching the exact history edge now starts the first older-page request in **3.4 ms** instead of **703.5 ms**, a 700.1 ms / 99.5% reduction in request-start delay. Near-top speculative prefetch retains the existing 700 ms scroll-intent settle behavior.

No release was performed.

## Original delay

Historical trace pages themselves were already fast. In a continuous real UI run, distinct cursor pages returned in roughly 48–84 ms with no duplicate cursor request.

The dominant delay was client-side:

```text
OLDER_TRACE_INTENT_SETTLE_MS = 700
```

Compact Terminal applied that settle timer even after the viewport reached the exact top. Baseline timing from a user-intent upward scroll:

```text
first page request start: 703.5 ms
first page response end: 763.4 ms
first page request total: 59.9 ms
scroll-height change: 793.6 ms
post-prepend top shift: 1,124.7 ms
```

The API occupied only about 60 ms; the UI waited about 700 ms before sending the request.

## Implemented behavior

Focused branch `fix/immediate-top-trace-pagination` distinguishes two paths:

- **near top:** preserve the existing 700 ms intent-settle delay;
- **exact top:** cancel any pending settle timer and request the next page immediately.

Request deduplication, cursor handling, prepend preparation, reading-position persistence, and the non-Terminal trace view remain unchanged.

Focused implementation commit:

```text
e560d7d1 perf(chat): load trace history immediately at top
```

## Automated validation

Focused worktree `/root/code/pibo/.worktrees/immediate-top-trace-pagination`:

```bash
npm run build
node --test \
  test/chat-ui-trace-infinite-scroll.test.mjs \
  test/sticky-virtuoso-state.test.mjs \
  test/use-sticky-virtuoso.test.mjs
npm run chat-ui:typecheck
git diff --check
```

Results:

- 8 focused tests passed;
- tests require near-top settled loading, exact-top immediate loading, and cancellation of a pending timer;
- Chat UI typecheck passed;
- production build passed;
- `git diff --check` passed.

Combined validation candidate:

- 72 focused integration/regression tests passed;
- full typecheck passed;
- production build and package creation passed.

## Backup, candidate, and rollback

Pre-activation full backup:

```text
/root/.pibo/server-backups/31.70.66.85-pibo-20260807T051331Z.tar.zst
SHA-256 2f08d051df5bee7d237133ba98c8ec04b29df624fedf11780ac11f7afb4e09b8
restore quick_check: 15 SQLite databases OK
```

Validation branch head:

```text
e088ddf7 perf(chat): load trace history immediately at top
```

Package:

```text
/root/.pibo/candidate-packages/pibo-e088ddf7.tgz
SHA-256 028e04f6ee1c6243976b3970afcbe4a8b7ec4c2b5f8b98555de1d1ba53c54ef5
```

Active installation:

```text
/opt/pibo-candidates/immediate-top-trace-pagination/e088ddf7
```

Activation rollback:

```text
/root/.pibo-deploy-rollbacks/20260807T052203Z-immediate-top-trace-pagination
```

The running service reports `PIBO_DEPLOY_CANDIDATE=immediate-top-trace-pagination` and `PIBO_DEPLOY_COMMIT=e088ddf7`.

## Real browser scenario

Environment:

- public UI: `https://pibo2.neuralnexus.me/apps/chat`;
- session: `ps_03bb744d-0cb8-43b6-9900-c3b0e110b43c`;
- authenticated supervised non-headless Chrome over loopback-only CDP;
- one Chat tab during timing;
- persisted Terminal reading position cleared before reload;
- initial bounded tail positioned at the latest row.

Action:

1. Dispatch a real upward wheel intent.
2. Move the Compact Terminal scroller to the exact top.
3. Measure Resource Timing relative to that action.
4. Continue loading five more historical pages.
5. Return to the latest row and verify the final response remains intact.

## Measured result

### Exact-top latency

| Check | Baseline | Candidate | Improvement |
|---|---:|---:|---:|
| First request starts | 703.5 ms | 3.4 ms | 700.1 ms / 99.5% |
| First response ends | 763.4 ms | 105.4 ms | 658.0 ms earlier |
| Scroll height changes | 793.6 ms | 89.9 ms | 703.7 ms earlier |
| Post-prepend top shift | 1,124.7 ms | 460.6 ms | 664.1 ms earlier |

The candidate's first API request took 102.0 ms in this sample. The improvement comes from removing the artificial client wait, not from claiming a faster server response.

The second older page used the next distinct cursor and started at 372.1 ms:

```text
before=1992
before=1942
```

### Continuous pagination

Five subsequent exact-top cycles requested:

```text
before=1892  65.6 ms
before=1842  60.0 ms
before=1792  63.0 ms
before=1742  60.9 ms
before=1692  61.9 ms
```

Results:

- five requests;
- five unique cursors;
- zero duplicate cursors within the continuous run;
- historical content advanced on each cycle;
- no stuck loading state.

After returning to the bottom:

```text
latest visible row: Amended commit
Working... footer: absent
```

The final persisted response remained intact after historical pagination.

## Evidence

```text
/tmp/pibo2-trace-pagination-baseline-2026-08-07.json
SHA-256 1363175fe2420e9d49398a72cca3f85887d896d9d60f38de045b70a0a127b492

/tmp/pibo2-trace-pagination-post-2026-08-07.json
SHA-256 c0930d5abee383380e0b85faaa9b651249c1b695c1d88de44862a7ec6cae947a
3976 bytes
```

## Remaining scope

- One exact-top action can legitimately trigger a second distinct page after the first prepend leaves the viewport at the history edge.
- The validation proves cursor uniqueness and latest-row preservation for the observed run; it does not exhaust the session's full history.
- Browser-process supervision remains necessary. Chrome had recovered nine clean process exits by this validation, and the authenticated page remained usable after recovery.

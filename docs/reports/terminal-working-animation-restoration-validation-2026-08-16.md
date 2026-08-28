# Terminal working animation restoration validation

**Date:** 2026-08-16
**Branch:** `fix/restore-terminal-working-animation`
**Implementation commit:** `4c23a30e723f677fbd1fd01100a9db9f6ce815c7`
**Base:** `upstream/dev` at `54176105c2f0`

## Change

The Terminal View footer again decodes random printable ASCII into `Working...` and moves the earlier bright highlight through the active character. The current elapsed timer, Goal indicator, footer layout, status semantics, and active-turn timestamp remain in place.

The scramble interval runs only while the working state is visible. With `prefers-reduced-motion: reduce`, the hook renders stable `Working...` text and does not start the interval.

## Historical source

The restored behavior was reconstructed from the final May 6, 2026 animation commits, ending at `94ee6039` (`Adjust working scramble rotation span`). It had been removed by `d04d0f8f` (`fix(chat): stabilize terminal working indicator`) on August 7, 2026.

## Local validation

Commands:

```bash
npm run build
node --test \
  test/chat-ui-terminal-message-timing.test.mjs \
  test/session-ui-view-models.test.mjs \
  test/chat-ui-session-overlay-cache.test.mjs \
  test/terminal-parity-fixtures.test.mjs
npm run typecheck
```

Results:

- production build: passed;
- focused tests: 30 passed, 0 failed;
- full TypeScript checks: passed.

## Pibo2 candidate

- candidate: `terminal-working-animation`;
- candidate commit: `4c23a30e723f677fbd1fd01100a9db9f6ce815c7`;
- package SHA-256: `45fea92d7c21fabebb1f355ededad7108b8497a0bf978e4cbf459496b7568b26`;
- installed path: `/opt/pibo-candidates/terminal-working-animation/4c23a30e723f677fbd1fd01100a9db9f6ce815c7`.

The candidate activated successfully and the public Chat UI loaded the expected new asset files.

## Real-browser evidence

Authenticated non-headless Chrome exercised a real `pibo-agent-v2` turn in Pibo Session `ps_7eaa055c-2312-4b91-9b8d-75189a6d933a`.

A bounded DOM watch captured:

- 245 active footer samples over the first 15 seconds;
- 223 distinct scramble strings;
- every highlighted character index from 0 through 9;
- the fully decoded `Working...` target;
- elapsed values from `00:00:00` through `00:00:15`;
- constant animation width of 66.19 px;
- unchanged accessible label `Working` and active-turn timestamp;
- active highlight color `rgb(163, 163, 163)` with the restored soft text shadow.

A screenshot captured the timer and scrambled label together during the active `sleep 8` tool call. The screenshot remains in temporary validation artifacts and is not committed.

## Reduced motion

The Terminal renderer was remounted with `matchMedia("(prefers-reduced-motion: reduce)")` returning true. Across 20 samples over 1.5 seconds:

- visible text remained exactly `Working...`;
- no character had the active highlight class;
- the elapsed timer continued from `00:01:34` to `00:01:35`.

After restoring the browser media function and reloading, the inactive footer disappeared. A clean post-reload console check reported no warnings or errors.

## Separate observation

The validation turn later emitted `Session disposed while a message was active: session disposed` after the requested tool call, and the live signal required a reload to reconcile with the status API's idle state. The animation behavior had already been proven before that unrelated runtime-path anomaly. This candidate is based on canonical `upstream/dev`, while the server previously ran a separate runtime-adapter integration candidate, so the observation was not attributed to this UI change.

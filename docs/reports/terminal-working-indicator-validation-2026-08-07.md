---
type: "Evidence Report"
title: "Terminal working indicator validation"
description: "Preserves the original report body as stable evidence without promoting historical claims."
tags: ["evidence","migration","report"]
status: "stable"
authority: "evidentiary"
migration_lineage:
  source_path: "docs/reports/terminal-working-indicator-validation-2026-08-07.md"
  source_commit: "15f2cd832e627d49c71be6a60708e5409be8772f"
  baseline_commit: "2aef244301f5d181624662fdad53e18e83e80bd9"
  baseline_blob_oid: "bde907cfa80c2049192becdb44768bd2b92fefa5"
  source_bytes: 3571
  source_sha256: "bce0a071bc4196ceddc6b9754297c11bd7848bf0e7cfd4b1fb8b297356523a88"
  source_body_sha256: "bce0a071bc4196ceddc6b9754297c11bd7848bf0e7cfd4b1fb8b297356523a88"
generated:
  by: "process:pibo-okf-c-reports"
  at: "2026-09-01T07:57:34Z"
evidence:
  id: "pibo-okf-c-reports:terminal-working-indicator-validation-2026-08-07"
  published_at: "2026-09-01T07:57:34Z"
---
# Terminal working indicator validation

**Date:** 2026-08-07  
**Branch:** `fix/terminal-working-indicator`  
**Fix commit:** `d04d0f8fdd012103480a5b7dfe6b17baa3f6b282`  
**Base:** `upstream/dev` at `8e6df91f4f8afaac78debf8ef474850a9ffef978`

## Problem

Pibo2 Terminal View rendered the active-turn label by replacing individual characters in `Working...` with random printable ASCII every 55 ms. During long real-agent turns this resembled corrupted terminal output and continuously mutated the DOM. The JavaScript interval also continued under `prefers-reduced-motion` because the media query changed only color and text shadow.

## Change

The footer now renders the stable literal `Working...`. The random-character hook, interval, constants, helpers, per-character spans, and scramble CSS were removed. The elapsed turn duration still updates once per second, and the existing role, accessible label, timestamp marker, dimensions, and Virtuoso footer placement remain unchanged.

## Local validation

Commands:

```bash
npm run build
node --test \
  test/chat-ui-terminal-message-timing.test.mjs \
  test/session-ui-view-models.test.mjs
npm run typecheck
```

Results:

- production build: passed;
- focused tests: 15 passed, 0 failed;
- TypeScript checks for core, Chat UI, Context Files UI, and VS Code surfaces: passed.

The source test asserts that the stable label is rendered and that `useWorkingScramble`, `WORKING_SCRAMBLE`, `randomAsciiChar`, and the scramble CSS classes are absent.

## Pibo2 candidate validation

A validation-only commit combined the focused UI fix with the separately reviewed machine-auth candidate so the real authenticated browser path remained available:

- validation commit: `db76043d`;
- source auth commit: `a9974a2e`;
- package SHA-256: `0cfb06f66af0b771d71a3f76fd6b27a37253dede366b03960f41cf910587c603`;
- candidate path: `/opt/pibo-candidates/terminal-working-indicator/db76043d`;
- rollback path: `/root/.pibo-deploy-rollbacks/20260807T015536Z-terminal-working-indicator`.

Before cutover, a fresh state and host backup was created and restore-tested:

- archive: `/root/.pibo/server-backups/31.70.66.85-pibo-20260807T014548Z.tar.zst`;
- SHA-256: `b6b3e1b49a5c9a733ac962ff18ee224e86ee44b4de0efc5e62dcd99c543abaed`;
- all 15 restored SQLite databases passed `PRAGMA quick_check`.

The public machine-auth bootstrap, authenticated non-headless Chrome, CDP tunnel, Chat UI, and real OpenAI-backed `pibo-agent-v2` turn all remained functional.

## DOM evidence

A 6.5-second `MutationObserver` watch during a real active turn observed eight footer samples. The only changing text was the once-per-second elapsed duration:

```text
00:00:44 Working...
00:00:45 Working...
00:00:46 Working...
00:00:47 Working...
00:00:48 Working...
00:00:49 Working...
00:00:50 Working...
00:00:51 Working...
```

The footer contained `compact-terminal-working-label` and no scramble class. A 269,998-byte authenticated screenshot is retained in the local ignored evidence directory `docs/reports/artifacts/terminal-working-indicator-2026-08-07/`; binary artifacts are intentionally excluded from the review branch.

## Separate performance finding

The same turn reproduced delayed optimistic delivery. The message POST completed in 26.132 seconds, but 25.065 seconds elapsed before `requestStart`; server wait after dispatch was 1.066 seconds. CDP reported `http/1.1`, while multiple long-lived Chat event and signal requests occupied browser connections. This is a distinct transport starvation issue, not part of the working-indicator fix.

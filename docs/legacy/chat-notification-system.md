---
type: "Historical Record"
title: "Chat Notification System"
description: "Preserves the original body as a deprecated historical record without promoting historical claims."
tags: ["historical","legacy","migration"]
status: "deprecated"
authority: "historical"
migration_lineage:
  source_path: "docs/legacy/chat-notification-system.md"
  source_commit: "0cd6a73449e1b555fa6e590d839d7e03c8dc98bf"
  baseline_commit: "2aef244301f5d181624662fdad53e18e83e80bd9"
  baseline_blob_oid: "e1ae8942f1774c2ee38c2a6d0b385ea29a743385"
  source_bytes: 3120
  source_sha256: "6733209ab73d4deb3ec15fd1729152a1dc783fe279d6e1439bb78f90d6debd85"
  source_body_sha256: "6733209ab73d4deb3ec15fd1729152a1dc783fe279d6e1439bb78f90d6debd85"
generated:
  by: "process:pibo-okf-c-legacy"
  at: "2026-09-01T09:50:26Z"
---
# Chat Notification System

This document defines Chat Web notification behavior for unread assistant messages.

## User-facing rules

- Room unread badges show the number of unread completed assistant turns in that room.
- Parent room badges include unread turns from child rooms.
- The top-bar **sessions** badge shows the total unread count across all top-level rooms.
- Badge labels cap at `99+`.
- Room and top-bar unread badges are blue.
- Session rows do not show numeric unread badges. They use the session status lamp only.
- Archived sessions do not contribute to unread counts.
- Archiving an unread session marks that session subtree as read for the current user.

## Backend rules

Unread state is backend-owned. The client reports visibility and selection context, but the server computes unread counts from persisted chat events and read cursors.

A turn counts as unread only when both events exist for the same turn:

1. `assistant_message`
2. `message_finished`

An unfinished `assistant_message` must not increase unread counts.

Read cursors are stored per session and principal. Opening a session or keeping it visible while a turn finishes should advance the read cursor for that principal.

## UI refresh expectations

The client should update navigation state without requiring a reload or session switch when:

- a background session finishes an assistant turn,
- the active session is marked read,
- a session is archived or restored,
- a room is archived or restored.

If a notification appears only after reload or navigation, inspect the room/session SSE stream and the bootstrap refresh path.

## Acceptance tests

### Unfinished assistant message

Given a background session receives `assistant_message` without `message_finished`:

- room badge stays empty,
- top-bar sessions badge stays empty,
- no session numeric badge appears.

### Finished background assistant turn

Given a background session receives a matching `message_finished`:

- its room badge increments,
- the top-bar sessions badge increments,
- the session row does not show a numeric badge,
- the update appears without reload or manual session switching.

### Opening unread session

Given a session has unread completed assistant turns, when the user opens that session:

- the session read cursor is persisted,
- room unread count decreases,
- top-bar sessions badge decreases,
- the cleared state survives reload.

### Active visible session

Given the active visible session finishes an assistant turn:

- unread counts stay empty,
- no stale room or top-bar badge remains,
- the read state survives reload.

### Archived sessions

Given an unread session is archived:

- room unread count decreases immediately,
- top-bar sessions badge decreases immediately,
- the archived session is marked read,
- restoring the session does not restore the old unread count.

## Relevant code

- Backend event/read model: `src/apps/chat/event-log.ts`
- Bootstrap and SSE handling: `src/apps/chat/web-app.ts`
- Navigation badges and session rows: `src/apps/chat-ui/src/App.tsx`
- Integration tests: `test/web-channel.test.mjs`

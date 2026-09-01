---
type: "Historical Record"
title: "Proposal: Session Live Previews"
description: "Historical copy of a completed Pibo change-packet document."
tags: ["session-live-previews", "change-packet", "history"]
status: "deprecated"
authority: "historical"
generated:
  by: "process:pibo-okf-b02-completed-history"
  at: "2026-08-30T18:25:11Z"
---
# Proposal: Session Live Previews

## Why

Pibo agents commonly develop web applications on remote servers. Users should be able to inspect a running application from authenticated Chat Web without cloning the project or establishing a separate tunnel.

## What changes

- Add a progressively discoverable `pibo preview` CLI for external and Preview-managed loopback servers.
- Persist definitions, generation-bound ownership, runtime leases, one-time tickets, and browser sessions in an isolated Preview store.
- Add an authenticated, bounded HTTP/SSE/WebSocket proxy on unique preview hostnames.
- Add current Settings integration and Session/Project Preview tabs with selection, lifecycle controls, iframe rendering, and trusted application fullscreen.
- Keep managed servers independent of agent turns and yielded runs.

## Impact and boundary

- Browser APIs cannot define commands or targets and never expose stored commands or ownership identity.
- Production remains dormant without operator-provided `preview.baseURL`, wildcard DNS/TLS, and explicit deployment approval.
- This feature does not widen controller or production gateway authority.

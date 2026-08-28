# Design: Session Live Previews

## Goals

- Support root-hosted loopback applications without path rewriting.
- Keep Preview JavaScript outside the canonical Pibo origin.
- Exchange existing authenticated authority for a one-time Preview-only session without forwarding Pibo credentials.
- Keep managed process, connection, ticket, and browser-session resources durable, bounded, and recoverable.
- Keep every UI result and action scoped to the currently selected Pibo Session.

## Decisions

### Unique hostname and ticket exchange

Each Preview uses `<preview-id>.<preview-base-host>`. An authenticated main-origin endpoint issues a short-lived opaque ticket; a generated form POST exchanges it on the Preview host for a scoped, hashed browser session cookie. Tickets are single-use. Redirect, cookie, framing, and credential headers are sanitized before traffic reaches the application.

### Durable launch ownership

A `BEGIN IMMEDIATE` transaction reserves capacity, a random generation, and exact controller ownership before launch. Systemd uses a precommitted transient unit id. Detached Linux launch uses a precommitted opaque owner token held by a Preview supervisor; PID and start ticks enrich that owner after launch. Publication, stop, reconciliation, and cleanup require the same generation and exact owner. Ambiguous commit and launch outcomes reconcile from durable state instead of clearing ownership.

### Bounded proxying

Only exact pinned loopback listeners are eligible. HTTP bodies stream, and global plus per-Preview admission bounds HTTP, SSE, and WebSocket connections. Disconnect, upgrade failure, gateway disposal, and reaper races release admission exactly once.

### Session-specific UI authority

The query key and query payload both carry the selected Pibo Session ID. Loading, error, unconfigured, and empty results contain no Preview records. Selection, reload counters, pending actions, action responses, iframe keys, and fullscreen content are validated against that same authority. A stale session, fork, or project response cannot render or mutate the current view.

### Dormant deployment

The plugin is inactive without `preview.baseURL`. Public wildcard DNS/TLS and gateway routing are operator prerequisites and are not activated by this change.

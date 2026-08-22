# Design: Session Live Previews

## Context

Pibo's Web Gateway currently routes Fetch-style requests by path and delegates authentication to Better Auth. It does not route by hostname or handle HTTP upgrade events. Chat Web already supports extra session tabs and an application fullscreen pattern.

## Goals / Non-Goals

- Support arbitrary root-hosted development applications without base-path rewriting.
- Keep Preview JavaScript outside the canonical Pibo origin.
- Reuse existing Pibo authentication without forwarding its cookie.
- Keep CLI-created exposures ephemeral and bounded.
- Do not supervise the development process or create anonymous links.

## Decisions

### Decision: One isolated hostname per preview

- **Choice:** Build preview URLs as `<preview-id>.<preview-base-host>`.
- **Rationale:** Root-relative assets, APIs, and HMR paths work without application rewriting, while browser origin isolation protects Pibo.
- **Alternative considered:** Same-origin path prefixes. Rejected because they expose Pibo origin authority and break generic root-relative applications.

### Decision: Opaque one-time tickets and preview-only sessions

- **Choice:** The authenticated main-origin open endpoint creates a short-lived opaque ticket. A generated HTML form POST exchanges it on the preview host for a scoped cookie backed by hashed SQLite records.
- **Rationale:** No Pibo cookie or bearer token reaches the application and the ticket is not placed in a URL.
- **Alternative considered:** Domain-wide Better Auth cookie. Rejected because the preview application could receive it.

### Decision: Persistent SQLite registry with runtime health checks

- **Choice:** Store exposures, tickets, and preview sessions in `previews.sqlite` under `PIBO_HOME`.
- **Rationale:** CLI and gateway are separate processes and need one durable coordination boundary.

### Decision: Extend web apps with host and upgrade handlers

- **Choice:** Add optional host matching and Node HTTP/WebSocket handlers to `PiboWebApp`. Host-routed apps run before canonical-origin redirects.
- **Rationale:** Preview traffic needs streaming and upgrades and should remain a plugin capability rather than hard-coded Chat routing.

### Decision: Session-level Preview view

- **Choice:** `SessionTracePane` queries previews for its selected Pibo Session and adds a Preview tab. Project sessions inherit the same behavior.
- **Rationale:** The preview stays attached to the work that created it and uses existing extra-tab infrastructure.

### Decision: Application fullscreen, not browser fullscreen

- **Choice:** Generalize the existing Terminal fullscreen shell for Preview.
- **Rationale:** The trusted exit bar stays in the parent application and does not depend on browser fullscreen permissions.

## Risks / Trade-offs

- Wildcard DNS/TLS is required before arbitrary preview ids can operate permanently on a public deployment.
- A preview-only session remains valid until its short expiry even if the main Pibo login logs out.
- Linux exposures are pinned to the original listening process and socket; other platforms retain the hard boundary of explicit local CLI registration, loopback-only targeting, port restrictions, and expiry.
- Some applications deliberately reject reverse-proxy Host or Origin values and may require their own development-server configuration.

## Migration / Rollback

The feature is inactive unless `preview.baseURL` is configured and a preview is exposed. Rollback removes the plugin registration and CLI surface; the isolated SQLite database can remain without affecting existing data.

## Open Questions

None blocking. Access policy is resolved: all accounts allowed by the Pibo instance may access previews.

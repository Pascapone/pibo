# Spec: Session Live Previews

**Status:** Implementing
**Created:** 2026-08-22
**Requester / Source:** User request in Pibo Session `ps_3da7f026-bfbe-4ccb-87b6-370fa8e3c85e`
**Related docs:** [Proposal](./proposal.md), [Design](./design.md), [Tasks](./tasks.md)

## Why

Remote development should be inspectable from the authenticated Pibo Web UI without copying the project to another machine. The preview must support normal development-server traffic while keeping untrusted application JavaScript isolated from Pibo Chat and Pibo authentication.

## Goal

Pibo MUST let an agent expose a loopback HTTP port, associate it with a Pibo Session, and let any authenticated account allowed by that Pibo instance open it in an isolated iframe or fullscreen Preview view.

## Scope

### In Scope

- Explicit loopback-port exposure through `pibo preview`.
- Session and optional Project metadata.
- Authenticated preview discovery and bootstrap.
- Preview-only sessions, HTTP proxying, SSE, and WebSocket upgrades.
- Session and Project Preview tabs, reload, open-window, close, and fullscreen controls.
- Expiration, health state, and closed/offline states.

### Out of Scope

- Public anonymous share links.
- Exposing remote hosts, Unix sockets, databases, CDP endpoints, or arbitrary URLs.
- Starting or supervising the development-server process.
- Per-account product ownership. All Pibo-allowed accounts share access.
- Rewriting applications for path-prefix hosting.

## Requirements

### Requirement: CLI exposure is explicit and discoverable

The CLI MUST expose `pibo preview expose`, `list`, `show`, `doctor`, and `close` through progressive help.

#### Acceptance

- `pibo preview expose 5173 --session ps_...` creates an active preview only when the port is allowed and reachable on loopback.
- The command prints the preview id and configured URL.
- Invalid, privileged, reserved, unreachable, or missing-session inputs fail without creating a record.

### Requirement: Preview targets remain loopback-only

The system MUST proxy only the exact loopback host and port recorded by the local CLI.

#### Acceptance

- The Web API cannot create or change an upstream target.
- Ports below 1024 and reserved Pibo, CDP, Docker, and common data-service ports are rejected.
- Preview records expire and closed records no longer proxy traffic.

### Requirement: Pibo authentication gates preview bootstrap

Any account accepted by the Pibo instance MUST be able to list and open active previews. Unauthenticated callers MUST NOT receive a preview session.

#### Acceptance

- Management routes require the existing Pibo web session.
- Opening a preview creates a one-time ticket and exchanges it for a preview-only cookie.
- The development application never receives the Pibo auth cookie or Authorization header.
- Tickets are single-use and expire quickly.

### Requirement: Preview applications use isolated origins

Each preview MUST use a hostname derived from its opaque preview id and the configured preview base domain.

#### Acceptance

- Preview JavaScript is cross-origin from Chat Web.
- Requests on an unknown preview hostname return not found.
- Canonical Pibo redirects do not capture valid preview hosts.

### Requirement: Development-server protocols work through the proxy

The proxy MUST preserve request paths and queries and support streaming HTTP responses, SSE, and WebSocket upgrades.

#### Acceptance

- A fixture page, nested asset, API request, SSE stream, and WebSocket echo all work through a preview hostname.
- Upstream redirect and cookie headers cannot redirect to loopback or broaden cookie scope to the Pibo host.

### Requirement: Chat Web exposes session-linked previews

Chat Web MUST show a Preview tab when the selected Pibo Session has at least one active or recently unavailable preview.

#### Acceptance

- The view loads the selected preview through the authenticated bootstrap endpoint.
- Multiple previews are selectable.
- The view displays online, offline, expired, and closed states.
- Normal session and Project navigation remains available after leaving Preview.

### Requirement: Preview fullscreen keeps a trusted exit control

The Preview view MUST support an application fullscreen mode whose exit controls remain outside the untrusted iframe.

#### Acceptance

- Fullscreen hides normal Pibo chrome and the composer.
- A trusted top bar remains visible with preview label, reload, open-window, and exit actions.
- Exiting restores the previous session view without reloading the Chat application.

## Edge Cases

- The target process exits after exposure or another process later occupies the port.
- The gateway restarts while preview records exist.
- The preview cookie expires while the iframe is open.
- A preview server returns `X-Frame-Options` or a conflicting `frame-ancestors` policy.
- A preview sends absolute loopback redirects or Domain cookies.
- Multiple authenticated accounts open the same preview concurrently.

## Constraints

- **Security / Privacy:** Login identity gates preview access but does not create per-user ownership. Preview apps remain on separate origins and receive no Pibo credentials.
- **Compatibility:** The first release proxies HTTP upstreams on loopback and externally serves the scheme configured by `preview.baseURL`.
- **Performance:** Proxy bodies stream and are not buffered through the normal Fetch request adapter.
- **Dependencies:** Wildcard DNS and TLS for the configured preview base domain are operational prerequisites outside the package.

## Success Criteria

- [ ] SC-001: CLI lifecycle tests cover expose, list, show, doctor, expiration, and close.
- [ ] SC-002: Auth/API integration tests reject unauthenticated bootstrap and allow every accepted Pibo account.
- [ ] SC-003: HTTP, SSE, and WebSocket proxy integration fixtures pass.
- [ ] SC-004: Browser validation proves inline and fullscreen Preview behavior through the authenticated development server.
- [ ] SC-005: An adversarial preview cannot read or receive Pibo authentication material.

# Spec: Session Live Previews

**Status:** Review candidate

## Goal

Pibo MUST let an operator or agent register and optionally start a loopback web server as a Preview-owned resource, associate it with a Pibo Session and optional Project, and let authenticated Chat Web users inspect and control it without keeping the agent runtime busy.

## Requirements

1. CLI exposure is explicit and progressively discoverable. Invalid, sensitive, occupied, unreachable, or missing-session targets fail closed.
2. Managed launch atomically reserves capacity, generation, and exact durable ownership before any external process can become live.
3. Reconciliation safely handles starting, running, stopping, stopped, error, expired, ambiguous commit, failed stop, stale generation, PID reuse, wrong process group, and replaced listeners.
4. Bootstrap requires normal Pibo authentication, then exchanges a one-time ticket for a hashed, expiring Preview-only session on a unique hostname.
5. Proxy targets remain exact loopback listeners. Pibo/auth/forwarding credentials are stripped; cookies, redirects, CSP, and framing are sanitized; HTTP/SSE/WebSocket concurrency is bounded.
6. Session and Project views use session-specific authority for loading, error, unconfigured, empty, selection, lifecycle actions, iframe identity, and fullscreen.
7. The iframe uses a unique Preview origin after ticket exchange, an explicit sandbox, and `no-referrer`; fullscreen retains trusted Pibo controls and keyboard exit outside the iframe.
8. Defaults are three concurrently starting/running managed servers and a fixed ten-minute lease, configurable under current Settings without changing transcription or speech settings.
9. The feature remains dormant until an operator configures dedicated wildcard DNS/TLS and `preview.baseURL`.

## Out of scope

- Anonymous links or per-account Preview ownership.
- Remote hosts, arbitrary URLs, databases, Unix sockets, or CDP endpoints.
- Browser editing of start commands or target ports.
- Production/controller deployment or wildcard DNS/TLS activation in this PR.

## Success criteria

- Focused ownership, persistence, proxy-security, API, settings, and UI suites pass on one frozen source identity.
- One canonical full source gate passes on that identity.
- Two canonical packages bind distinct source-tree, package, normalized archive, and installed-runtime identities.
- One exact package passes disposable Pibo2 managed lifecycle, authenticated ticket exchange, HTTP/SSE/WebSocket, persistence/reconciliation, and headful Session/Project UI acceptance.

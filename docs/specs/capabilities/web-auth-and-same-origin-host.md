# Spec: Web Auth and Same-Origin Host

**Status:** Draft
**Created:** 2026-05-10
**Updated:** 2026-06-14
**Controller / Source:** Scheduled Pibo Source Specs Coverage
**Related plan:** [Local Auth Gateway Implementation Plan](../../plans/local-auth-gateway-implementation-plan-2026-06-14.md)
**Related docs:** [Chat Web Rooms and Event Streams](./chat-web-rooms-and-event-streams.md), [Custom Agents and Agent Designer](./custom-agents.md), [Scheduled Pibo Jobs](./scheduled-pibo-jobs.md), [Local Config CLI](./local-config-cli.md)

## Why

Pibo's Chat Web App, auth routes, and web APIs share one HTTP origin. This boundary decides who may use web apps, how auth differs between production and Docker development, and how browser requests are routed to registered apps. Authenticated identity is kept for display, logout, and technical auth diagnostics; product handlers use the app context context.

A spec is needed because several capabilities depend on the same behavior: Better Auth in normal gateways, dev auth only inside Docker workers, app-context Chat Web APIs, and safe same-origin routing.

## Goal

The web host MUST expose auth, health/status, simple-agent, and registered web app routes through one predictable HTTP channel while mapping every authenticated web request to the app context context.

## Background / Current State

Current code defines a `web-host` channel with required auth mode. It converts Node HTTP requests to Fetch `Request` objects, enforces a maximum request body size, optionally redirects browser GET/HEAD requests to a canonical base URL, delegates `/api/auth/*` to the registered auth service, and dispatches registered web apps by `mountPath` or `apiPrefix`.

Normal web gateways register Better Auth. Host gateways and Docker worker gateways may both opt into local auth. Local auth is the same code path on host and in Docker, and is gated by a loopback bind check on the host. The legacy `PIBO_DEV_AUTH=1` environment switch fails closed with a migration message pointing operators to the new explicit mode.

## Scope

### In Scope

- HTTP route stewardship for the web host channel.
- Better Auth service requirements for normal web gateways.
- Local auth behavior on host gateways and in Docker workers, including the loopback-bind gate and the three request-time safety layers.
- Mapping auth sessions to the app context context.
- Registered web app route dispatch and route conflict constraints.
- Basic request/response handling that is externally observable.
- The `auth.mode` config key and `--auth` CLI flag that select the auth service.

### Out of Scope

- Chat Web domain behavior such as rooms, timelines, agents, or cron APIs — covered by separate capability specs.
- Better Auth's internal OAuth implementation — treated as an external dependency behind Pibo's auth service contract.
- Browser UI design and visual states.
- Non-web channels such as local TUI or remote agent TCP protocol.
- Automatic detection of bind address from environment. The bind is always explicit (`--web-host` flag or `127.0.0.1` default).

## Requirements

### Requirement: Web gateways select exactly one auth service

The web gateway MUST register exactly one auth service before serving authenticated web apps.

#### Current

`createWebPiboPluginRegistry` registers either Better Auth or local auth (`pibo.dev-auth` plugin). The plugin registry rejects a second auth service. The selected mode is determined by, in priority order: an explicit `auth` option on `runWebGatewayServer`, the `auth.mode` value in the persisted Pibo config, and finally the default `"better-auth"`. The legacy `devAuth: true` option is an alias for `auth: "local"` and remains valid for one release.

#### Acceptance

- Starting a normal web gateway registers the Better Auth service.
- Starting a host or Docker worker web gateway with `auth: "local"` registers the local auth service.
- Registering two auth services fails before requests are served.
- `auth.mode` in `pibo config` accepts only `"better-auth"` or `"local"`; other values are rejected.

#### Scenario: Duplicate auth service registration

- GIVEN a plugin registry already has an auth service
- WHEN another plugin registers a second auth service
- THEN registry creation fails with an auth service conflict

### Requirement: Normal web gateways use Better Auth configuration

The normal web gateway MUST require Better Auth configuration before accepting sessions, unless the active mode is local.

#### Current

Better Auth requires `auth.baseURL`, `auth.secret`, `auth.googleClientId`, `auth.googleClientSecret`, and at least one allowed email. Secrets shorter than 32 characters are rejected. The auth database defaults to `.pibo/auth.sqlite` unless configured otherwise. When the active mode is `local`, the Better Auth service is not instantiated and none of the five keys are required. The setup doctor warns about missing Google configuration in local mode instead of failing.

#### Acceptance

- With `auth.mode = "better-auth"` (or unset), missing required auth config prevents service creation or startup.
- With `auth.mode = "local"`, the gateway starts without any of the five Better Auth keys.
- `auth.secret` shorter than 32 characters is rejected whenever Better Auth is instantiated.
- Empty or missing `auth.allowedEmails` is rejected whenever Better Auth is instantiated.
- Configured `auth.trustedOrigins` are combined with the auth base URL origin.

#### Scenario: Missing allowed email list

- GIVEN `auth.mode = "better-auth"`
- AND the gateway config has OAuth credentials and a valid secret
- AND `auth.allowedEmails` is missing or empty
- WHEN the gateway creates the Better Auth service
- THEN startup fails with a clear configuration error

#### Scenario: Local mode skips Better Auth

- GIVEN `auth.mode = "local"`
- AND the gateway has no Google OAuth configuration
- WHEN the web gateway starts
- THEN the local auth service is registered and the gateway accepts loopback sign-ins

### Requirement: Better Auth authorizes only allowed emails

The Better Auth service MUST return a Pibo auth session only for signed-in users whose email appears in the allowed email set.

#### Current

`getSession` calls Better Auth, normalizes the user's email to lowercase, rejects non-allowed users with `403`, and maps allowed users to a Pibo identity with provider `google`.

#### Acceptance

- No Better Auth session returns no Pibo auth session.
- A signed-in user outside `auth.allowedEmails` receives `403 Forbidden`.
- A signed-in allowed user receives an auth session containing `identity.userId`, email, name, optional image, provider, session id, and expiry.

#### Scenario: Signed-in user is not allowed

- GIVEN Better Auth resolves a Google user with email `other@example.com`
- AND `auth.allowedEmails` does not include that email after lowercase normalization
- WHEN a web API requires a session
- THEN the request fails with `403 Forbidden`

### Requirement: Local auth is bound to loopback on the host gateway

The local auth service MUST be selected only when the host bind is loopback, and MUST refuse non-loopback auth route requests. Docker workers MAY opt in to local auth with an in-container `0.0.0.0` bind because the container network is the real security boundary.

#### Current

`resolveWebGatewayAuthMode` reads the active mode from the explicit option, then from `auth.mode` in the persisted config, and defaults to `"better-auth"`. When the active mode is `local` (or the legacy `devAuth: true` alias is set), the bind is validated against the loopback predicate. A bind of `127.0.0.1`, `::1`, or `localhost` is loopback; `0.0.0.0` and any other value is not. The Docker worker gateway sets `auth: "local"` with an in-container `0.0.0.0` bind, which is allowed by the host bind check only when `isDockerRuntime()` is true. Local auth accepts only loopback host and forwarded host values. It simulates Google sign-in by redirecting through callback routes and setting an HTTP-only, same-site cookie.

#### Acceptance

- `auth: "local"` with a non-loopback `--web-host` fails before server startup with a clear "local auth requires loopback bind" error.
- `auth: "local"` with no `--web-host` defaults to `127.0.0.1` and is allowed.
- `devAuth: true` is an alias for `auth: "local"` and enforces the same loopback bind gate.
- `PIBO_DEV_AUTH=1` alone does not enable host dev auth and instead returns an explicit migration error pointing to `--auth=local`.
- The startup banner prints a loud "LOCAL AUTH ENABLED" warning that names the bind address whenever local auth is the active mode.
- Local auth `/api/auth/*` requests with non-loopback host context receive `403`.
- A loopback local sign-in creates a session for the fixed dev identity.

#### Scenario: Host tries to enable dev auth by environment

- GIVEN the gateway is not running inside Docker
- AND `PIBO_DEV_AUTH=1` is set
- WHEN the normal web gateway resolves auth mode
- THEN it fails with the migration error pointing to `pibo gateway:web --auth=local --web-host=127.0.0.1`

#### Scenario: Operator forces a non-loopback bind with local auth

- GIVEN the gateway is on the host (not in Docker)
- WHEN the operator runs `pibo gateway:web --auth=local --web-host=0.0.0.0`
- THEN the pre-flight CLI check refuses the request before the gateway is imported, and the gateway itself would also refuse at startup

### Requirement: Authenticated web requests enter the app context context

Every authenticated web app request that requires a session MUST expose the same app context context to product handlers. The auth session remains available for display, logout, and technical diagnostics only.

#### Current

`requireWebSession` calls the channel auth service and returns the authenticated session plus `appContext`. A deprecated compatibility controller value may be present for legacy storage paths, but it is pinned to the app context and is not derived from the authenticated user id.

#### Acceptance

- Missing sessions fail with `401 Unauthenticated`.
- Two allowed authenticated identities resolve to the same app context context.
- Web app code does not receive product visibility keys from request bodies, query parameters, or auth identity ids.

#### Scenario: Chat API request uses the app context context

- GIVEN a request carries a valid auth session for user id `abc123`
- WHEN a registered web app calls `requireSession`
- THEN it receives the app context context used by any other allowed account.

### Requirement: Web host routes same-origin requests deterministically

The web host MUST route requests in a deterministic order: canonical redirect, health/status, auth routes, simple-agent API, registered web apps, root redirect, and not found.

#### Current

The channel handles `/health`, `/gateway/status`, `/api/auth/*`, simple-agent requests, registered apps matching `mountPath` or `apiPrefix`, `/`, and finally `404` JSON.

#### Acceptance

- `/health` returns JSON status without requiring a web app route.
- `/gateway/status` returns gateway mode, runtime statuses, and active runs.
- `/api/auth/*` is always delegated to the auth service before app routing.
- Unknown paths return JSON `404`.

#### Scenario: Auth route is not claimed by an app

- GIVEN a registered app has broad route prefixes
- WHEN a request path starts with `/api/auth/`
- THEN the web host sends the request to the auth service, not the app

### Requirement: Canonical redirects protect browser-facing origins

When a canonical base URL is configured, the web host MUST redirect only safe browser-facing GET/HEAD routes from a non-canonical origin to the configured origin.

#### Current

Canonical redirects apply to GET/HEAD requests for `/`, `/apps...`, and `/api/auth...`. Other methods and paths are not redirected.

#### Acceptance

- GET `/apps/chat` on a non-canonical origin redirects to the same path and query on the canonical origin.
- POST requests are not redirected by this mechanism.
- Non-browser API paths outside `/apps` and `/api/auth` are not canonical-redirected.

#### Scenario: OAuth callback reaches loopback origin

- GIVEN a normal web gateway has canonical base URL `https://pibo.example.test`
- WHEN a GET request reaches `/api/auth/callback/google?code=x` on another origin
- THEN the web host redirects to `https://pibo.example.test/api/auth/callback/google?code=x`

### Requirement: Registered web app routes must not overlap

The plugin registry MUST reject duplicate or overlapping web app mount and API prefixes before the web host starts.

#### Current

`registerWebApp` validates that routes start with `/`, do not end with `/` except root, and do not overlap existing app routes.

#### Acceptance

- A mount path or API prefix without leading `/` is rejected.
- A non-root route ending in `/` is rejected.
- Overlapping app routes such as `/apps/chat` and `/apps/chat/admin` are rejected.

#### Scenario: Two apps claim the same API prefix

- GIVEN one web app has API prefix `/api/chat`
- WHEN another app registers API prefix `/api/chat`
- THEN registration fails before the channel starts

### Requirement: HTTP request and response handling is bounded and explicit

The web host MUST bound incoming request bodies and preserve externally important response headers.

#### Current

Non-GET/HEAD request bodies are limited to 4 MiB. JSON responses may be gzip-compressed when the client accepts gzip and the response is large enough. `Set-Cookie` headers are preserved when sending Fetch responses through Node HTTP.

#### Acceptance

- Requests with bodies larger than 4 MiB fail with `413`.
- Invalid JSON bodies read through `readJsonBody` fail with `400`.
- Auth responses may set or clear cookies through `Set-Cookie` headers.
- Large JSON responses include `content-encoding: gzip` only when the client accepts gzip.

#### Scenario: Oversized API body

- GIVEN a POST request body exceeds 4 MiB
- WHEN the web host converts the Node request to a Fetch request
- THEN the request fails with HTTP `413 Request body too large`

## Edge Cases

- Better Auth may return no session; Pibo must treat that as `401`, not as an anonymous controller.
- Local auth must check `Host`, `X-Forwarded-Host`, and the TCP socket peer address so a remote forwarded request cannot obtain a local session, even if both headers are rewritten to `localhost`.
- If no web apps are registered, `/` returns a small HTML page instead of failing server startup.
- If an auth service does not expose HTTP routes, `/api/auth/*` returns `500` because the selected web auth mode is misconfigured.
- Gzip must not apply to `204`, `304`, or already encoded responses.
- The local auth socket peer is communicated from the channel to the auth plugin through a request header that is stripped from any response before reaching the browser.

## Constraints

- **Security / Privacy:** Production web gateways use Better Auth, not local auth. Allowed email checks are enforced after provider session resolution. Auth identity gates access and must not partition product data. Local auth is restricted to loopback binds and to request paths that pass the three safety layers (startup bind, request headers, request socket peer).

## Constraints (Better Auth specifics)

- **Compatibility:** The web host uses Fetch `Request`/`Response` objects internally while serving through Node HTTP.
- **Performance:** Request bodies are bounded at 4 MiB; large JSON responses can use gzip with low compression level.
- **Dependencies:** Normal auth depends on Better Auth, Google OAuth settings, and SQLite migrations from Better Auth.

## Requirement: Local auth enforces three independent request-time safety layers

The local auth service MUST reject any request that fails any of the three independent safety layers. Each layer covers a distinct attacker model and they MUST be evaluated for every request that reaches the auth service.

#### Layer 1 — Startup bind

The web gateway process MUST bind to a loopback address (`127.0.0.1`, `::1`, or `localhost`) before local auth is selected on the host. The bind is enforced at startup by `resolveWebGatewayAuthMode` and is reported in the startup banner. Operators that explicitly set `--web-host` to a non-loopback value and `--auth=local` receive a fail-closed error before the gateway module is loaded.

This layer catches: operator misconfiguration, automation that sets `auth: "local"` while leaving `--web-host=0.0.0.0` in place, and copy-paste of unsafe systemd units.

#### Layer 2 — Request headers

For every request handled by the local auth plugin, the `Host` header and the `X-Forwarded-Host` header (when present) MUST both resolve to a loopback host. The existing `isLoopbackDevAuthRequest` predicate is the canonical implementation.

This layer catches: a browser hitting a public hostname, a reverse proxy that forwards the public `Host` header unchanged, and a reverse proxy that sets `X-Forwarded-Host` to the public origin.

#### Layer 3 — TCP socket peer

For every request handled by the local auth plugin, the TCP socket peer address (`request.socket.remoteAddress`) MUST resolve to `127.0.0.1` or `::1`. The channel passes the socket peer to the auth plugin through a request header that the channel MUST strip from the response before forwarding it to the client.

This layer catches: a reverse proxy on the same host that rewrites both `Host` and `X-Forwarded-Host` to `localhost` while accepting public traffic. The socket peer cannot be rewritten by a reverse proxy, so this is the strongest of the three layers.

#### Acceptance

- A request with `Host: localhost`, no `X-Forwarded-Host`, and socket peer `203.0.113.7` is rejected with `403`.
- A request with `Host: localhost`, `X-Forwarded-Host: localhost`, and socket peer `127.0.0.1` is accepted.
- A request with `Host: localhost`, `X-Forwarded-Host: pibo.example.com`, and socket peer `127.0.0.1` is rejected.
- The channel strips the socket-peer header from every response that leaves the web host.

#### Scenario: Reverse proxy rewrites both headers

- GIVEN a public reverse proxy at `pibo.example.com` rewrites `Host: localhost` and strips `X-Forwarded-Host` before forwarding to the gateway
- AND the gateway is bound to `127.0.0.1` and running local auth
- WHEN a public request reaches the local auth service
- THEN the socket peer is `127.0.0.1` only if the proxy is on the same host; a request from a remote client appears with a public IP and is rejected with `403`

## Assumptions and Open Questions

### Assumptions

- `auth.allowedEmails` is the intended production access-control list for Chat Web and other same-origin apps.
- Local auth is safe when bound to loopback on the host. Docker workers and host loopback are both valid use cases; non-loopback binds require Better Auth.
- The TCP socket peer is the strongest request-time signal available to the gateway and is not under the control of a reverse proxy.
- **Compatibility:** The web host uses Fetch `Request`/`Response` objects internally while serving through Node HTTP.
- **Performance:** Request bodies are bounded at 4 MiB; large JSON responses can use gzip with low compression level.
- **Dependencies:** Normal auth depends on Better Auth, Google OAuth settings, and SQLite migrations from Better Auth.

## Success Criteria

- [ ] SC-001: A normal gateway with complete Better Auth config starts and serves `/health`, `/gateway/status`, `/api/auth/*`, and registered apps from one origin.
- [x] SC-002: Better Auth rejects an empty allowed-email list and weak secrets before accepting authenticated app traffic, as covered by `test/better-auth-config.test.mjs`.
- [x] SC-003: Docker worker local auth safety is fail-closed at the host boundary and loopback-gated at auth routes, as covered by `test/web-gateway.test.mjs` and `test/dev-auth.test.mjs`.
- [x] SC-004: Web app handlers receive the app context context for authenticated requests, as covered by `test/web-auth-app-context-context.test.mjs` and `test/web-channel.test.mjs`.
- [x] SC-005: Overlapping web app routes are rejected at plugin registration time, as covered by `test/plugin-registry.test.mjs`.
- [ ] SC-006: Local auth rejects requests that pass header checks but have a non-loopback TCP socket peer, as covered by `test/local-auth.test.mjs` and `test/dev-auth.test.mjs`.
- [ ] SC-007: `pibo gateway:web --auth=local --web-host=0.0.0.0` is refused before the gateway module is loaded, as covered by `test/local-auth.test.mjs`.
- [ ] SC-008: `pibo config set auth.mode local` persists the value and round-trips, and `pibo config set auth.mode bogus` is rejected, as covered by `test/auth-mode-config.test.mjs`.

## Verification Coverage

This section records which parts of the web-auth and same-origin host contract are directly tested today. Local auth safety is intentionally tracked here rather than split into a standalone capability spec because local auth is the same code path on host and in Docker.

### Directly Tested

- Better Auth configuration rejects empty `allowedEmails`, rejects secrets shorter than 32 characters, and preserves trusted origin expansion. Verified by `test/better-auth-config.test.mjs`.
- Legacy host dev-auth activation fails closed: `PIBO_DEV_AUTH=1` does not enable `gateway:web`, and the default auth mode remains Better Auth. Verified by `test/web-gateway.test.mjs`.
- Dev-auth route access is loopback-gated by both `Host` and `X-Forwarded-Host`; public forwarded host values are rejected by the loopback predicate. Verified by `test/dev-auth.test.mjs`.
- Authenticated Chat Web requests receive app context product context while preserving auth errors; forbidden auth errors surface as `403`, cross-origin mutations are rejected, local reverse-proxy same-origin mutations are accepted, and oversized bodies return `413`. Verified by `test/web-auth-app-context-context.test.mjs` and `test/web-channel.test.mjs`.
- Duplicate auth service registration and overlapping web app routes fail during plugin registry creation. Verified by `test/plugin-registry.test.mjs`.
- Dynamic JSON response compression honors gzip support, rejects `gzip;q=0`, does not use Brotli for dynamic JSON, and leaves small JSON uncompressed. Verified by `test/web-http.test.mjs`.

### Source-Inspected Only

- Full normal gateway startup with real Better Auth, Google OAuth, and a registered Chat Web app is source-inspected from `src/gateway/web.ts`, `src/plugins/better-auth.ts`, `src/plugins/web.ts`, and `src/apps/chat/web-app.ts`; current tests cover the component contracts but do not perform a real OAuth login.
- `/api/auth/*` delegation precedence over app routes is source-inspected in `src/web/channel.ts`; plugin route-overlap tests prevent many conflicting routes but do not assert a malicious broad app claiming auth routes.
- Canonical redirects for `/api/auth/*` callbacks are source-inspected in `src/web/channel.ts`; tests directly assert app-link canonical redirects.

### Test Gaps

- Add an integration test that builds `createWebPiboPluginRegistry` with complete Better Auth config and asserts the selected auth service plus registered web apps without contacting Google.
- Add a web-host route-order test proving `/api/auth/*` is delegated to auth before registered app routing.
- Add a canonical redirect test for `/api/auth/callback/google` specifically, matching the OAuth callback scenario.

## Assumptions and Open Questions

### Open Questions

- Should `/gateway/status` require authentication, or is current unauthenticated status output intentional for gateway supervision?
- Should simple-agent API routes have an explicit spec and auth policy separate from registered web apps?

## Traceability

| Requirement | Scenario / Story | Code Basis | Verification | Status |
|---|---|---|---|---|
| REQ-001 Web gateways select exactly one auth service | Duplicate auth service registration | `src/gateway/web.ts`, `src/plugins/registry.ts` | `test/plugin-registry.test.mjs` | Component-tested |
| REQ-002 Normal web gateways use Better Auth configuration | Missing allowed email list, local mode skips Better Auth | `src/auth/better-auth.ts`, `src/config/config.ts` | `test/better-auth-config.test.mjs`, `test/local-auth.test.mjs` | Component-tested |
| REQ-003 Better Auth authorizes only allowed emails | Signed-in user is not allowed | `src/auth/better-auth.ts`, `src/web/channel.ts` | `test/web-channel.test.mjs` covers auth-service `403`; real Better Auth allowlist path is source-inspected | Partly tested |
| REQ-004 Local auth is bound to loopback on the host gateway | Host tries env dev auth, operator forces non-loopback bind | `src/gateway/web.ts`, `src/plugins/dev-auth.ts`, `src/cli.ts` | `test/web-gateway.test.mjs`, `test/dev-auth.test.mjs`, `test/local-auth.test.mjs` | Component-tested |
| REQ-005 Authenticated web requests enter the app context context | Chat API request uses app context context | `src/web/auth.ts`, `src/web/types.ts`, `src/apps/chat/web-app.ts` | `test/web-auth-app-context-context.test.mjs`, `test/web-channel.test.mjs` | Integration-tested |
| REQ-006 Web host routes same-origin requests deterministically | Auth route is not claimed by an app | `src/web/channel.ts` | Component behavior source-inspected; app shell/authenticated API routes covered by `test/web-channel.test.mjs` | Partly tested |
| REQ-007 Canonical redirects protect browser-facing origins | OAuth callback reaches loopback origin | `src/web/channel.ts`, `src/gateway/web.ts` | `test/web-channel.test.mjs` covers app-link redirect; auth-callback redirect is source-inspected | Partly tested |
| REQ-008 Registered web app routes must not overlap | Two apps claim same API prefix | `src/plugins/registry.ts`, `src/web/types.ts` | `test/plugin-registry.test.mjs` | Component-tested |
| REQ-009 HTTP request and response handling is bounded and explicit | Oversized API body | `src/web/http.ts`, `src/web/channel.ts` | `test/web-channel.test.mjs`, `test/web-http.test.mjs` | Component-tested |
| REQ-010 Local auth enforces three independent request-time safety layers | Reverse proxy rewrites both headers | `src/web/channel.ts`, `src/plugins/dev-auth.ts` | `test/local-auth.test.mjs`, `test/dev-auth.test.mjs` | Component-tested |

## Verification Basis

This spec was derived from the current implementation in `src/web/*`, `src/auth/*`, `src/plugins/better-auth.ts`, `src/plugins/dev-auth.ts`, `src/plugins/web.ts`, `src/plugins/registry.ts`, `src/gateway/web.ts`, `src/config/config.ts`, and web app integration points in `src/apps/chat/web-app.ts`.

Verification coverage was updated from `test/better-auth-config.test.mjs`, `test/dev-auth.test.mjs`, `test/web-gateway.test.mjs`, `test/web-channel.test.mjs`, `test/plugin-registry.test.mjs`, `test/web-http.test.mjs`, `test/local-auth.test.mjs`, and `test/auth-mode-config.test.mjs`.

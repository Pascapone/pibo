# Spec: Web Auth and Same-Origin Host

**Status:** Draft  
**Created:** 2026-05-10  
**Updated:** 2026-05-11  
**Owner / Source:** Scheduled Pibo Source Specs Coverage  
**Related docs:** [Chat Web Rooms and Event Streams](./chat-web-rooms-and-event-streams.md), [Custom Agents and Agent Designer](./custom-agents.md), [Scheduled Pibo Jobs](./scheduled-pibo-jobs.md)

## Why

Pibo's Chat Web App, auth routes, and web APIs share one HTTP origin. This boundary decides who may use web apps, how auth differs between production and Docker development, and how browser requests are routed to registered apps. Authenticated identity is kept for display, logout, and technical auth diagnostics; product handlers use the shared app context.

A spec is needed because several capabilities depend on the same behavior: Better Auth in normal gateways, dev auth only inside Docker workers, shared-app Chat Web APIs, and safe same-origin routing.

## Goal

The web host MUST expose auth, health/status, simple-agent, and registered web app routes through one predictable HTTP channel while mapping every authenticated web request to the shared app context.

## Background / Current State

Current code defines a `web-host` channel with required auth mode. It converts Node HTTP requests to Fetch `Request` objects, enforces a maximum request body size, optionally redirects browser GET/HEAD requests to a canonical base URL, delegates `/api/auth/*` to the registered auth service, and dispatches registered web apps by `mountPath` or `apiPrefix`.

Normal web gateways register Better Auth. Docker worker gateways may opt into dev auth. Dev auth is rejected outside a Docker runtime and the legacy `PIBO_DEV_AUTH=1` environment switch no longer enables host dev auth.

## Scope

### In Scope

- HTTP route ownership for the web host channel.
- Better Auth service requirements for normal web gateways.
- Docker-only dev auth behavior.
- Mapping auth sessions to the shared app context.
- Registered web app route dispatch and route conflict constraints.
- Basic request/response handling that is externally observable.

### Out of Scope

- Chat Web domain behavior such as rooms, timelines, agents, or cron APIs — covered by separate capability specs.
- Better Auth's internal OAuth implementation — treated as an external dependency behind Pibo's auth service contract.
- Browser UI design and visual states.
- Non-web channels such as local TUI or remote agent TCP protocol.

## Requirements

### Requirement: Web gateways select exactly one auth service

The web gateway MUST register exactly one auth service before serving authenticated web apps.

#### Current

`createWebPiboPluginRegistry` registers either Better Auth or dev auth. The plugin registry rejects a second auth service.

#### Acceptance

- Starting a normal web gateway registers the Better Auth service.
- Starting a Docker worker web gateway with dev auth enabled registers the dev auth service.
- Registering two auth services fails before requests are served.

#### Scenario: Duplicate auth service registration

- GIVEN a plugin registry already has an auth service
- WHEN another plugin registers a second auth service
- THEN registry creation fails with an auth service conflict

### Requirement: Normal web gateways use Better Auth configuration

The normal web gateway MUST require Better Auth configuration before accepting sessions.

#### Current

Better Auth requires `auth.baseURL`, `auth.secret`, `auth.googleClientId`, `auth.googleClientSecret`, and at least one allowed email. Secrets shorter than 32 characters are rejected. The auth database defaults to `.pibo/auth.sqlite` unless configured otherwise.

#### Acceptance

- Missing required auth config prevents service creation or startup.
- `auth.secret` shorter than 32 characters is rejected.
- Empty or missing `auth.allowedEmails` is rejected.
- Configured `auth.trustedOrigins` are combined with the auth base URL origin.

#### Scenario: Missing allowed email list

- GIVEN a normal web gateway config has OAuth credentials and a valid secret
- AND `auth.allowedEmails` is missing or empty
- WHEN the gateway creates the Better Auth service
- THEN startup fails with a clear configuration error

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

### Requirement: Dev auth is available only inside Docker workers

The dev auth service MUST be selectable only for Docker worker runtimes and MUST refuse non-loopback auth route requests.

#### Current

`resolveWebGatewayAuthMode` throws when dev auth is requested outside Docker. Dev auth accepts only loopback host and forwarded host values. It simulates Google sign-in by redirecting through callback routes and setting an HTTP-only, same-site cookie.

#### Acceptance

- `devAuth: true` outside Docker fails before server startup.
- `PIBO_DEV_AUTH=1` alone does not enable host dev auth and instead returns an explicit error for normal gateway startup.
- Dev auth `/api/auth/*` requests with non-loopback host context receive `403`.
- A loopback dev sign-in creates a session for the fixed dev identity.

#### Scenario: Host tries to enable dev auth by environment

- GIVEN the gateway is not running inside Docker
- AND `PIBO_DEV_AUTH=1` is set
- WHEN the normal web gateway resolves auth mode
- THEN it fails and tells the operator to use the Docker worker entrypoint

### Requirement: Authenticated web requests enter the shared app context

Every authenticated web app request that requires a session MUST expose the same shared app context to product handlers. The auth session remains available for display, logout, and technical diagnostics only.

#### Current

`requireWebSession` calls the channel auth service and returns the authenticated session plus `appContext`. A deprecated compatibility owner value may be present for legacy storage paths, but it is pinned to the shared app and is not derived from the authenticated user id.

#### Acceptance

- Missing sessions fail with `401 Unauthenticated`.
- Two allowed authenticated identities resolve to the same shared app context.
- Web app code does not receive product visibility keys from request bodies, query parameters, or auth identity ids.

#### Scenario: Chat API request uses the shared app context

- GIVEN a request carries a valid auth session for user id `abc123`
- WHEN a registered web app calls `requireSession`
- THEN it receives the shared app context used by any other allowed account.

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

- Better Auth may return no session; Pibo must treat that as `401`, not as an anonymous owner.
- Dev auth must check both `Host` and `X-Forwarded-Host` so a remote forwarded request cannot obtain a dev session.
- If no web apps are registered, `/` returns a small HTML page instead of failing server startup.
- If an auth service does not expose HTTP routes, `/api/auth/*` returns `500` because the selected web auth mode is misconfigured.
- Gzip must not apply to `204`, `304`, or already encoded responses.

## Constraints

- **Security / Privacy:** Production web gateways use Better Auth, not dev auth. Allowed email checks are enforced after provider session resolution. Auth identity gates access and must not partition product data.
- **Compatibility:** The web host uses Fetch `Request`/`Response` objects internally while serving through Node HTTP.
- **Performance:** Request bodies are bounded at 4 MiB; large JSON responses can use gzip with low compression level.
- **Dependencies:** Normal auth depends on Better Auth, Google OAuth settings, and SQLite migrations from Better Auth.

## Success Criteria

- [ ] SC-001: A normal gateway with complete Better Auth config starts and serves `/health`, `/gateway/status`, `/api/auth/*`, and registered apps from one origin.
- [x] SC-002: Better Auth rejects an empty allowed-email list and weak secrets before accepting authenticated app traffic, as covered by `test/better-auth-config.test.mjs`.
- [x] SC-003: Docker worker dev auth safety is fail-closed at the host boundary and loopback-gated at auth routes, as covered by `test/web-gateway.test.mjs` and `test/dev-auth.test.mjs`.
- [x] SC-004: Web app handlers receive the shared app context for authenticated requests, as covered by `test/web-auth-shared-app-context.test.mjs` and `test/web-channel.test.mjs`.
- [x] SC-005: Overlapping web app routes are rejected at plugin registration time, as covered by `test/plugin-registry.test.mjs`.

## Verification Coverage

This section records which parts of the web-auth and same-origin host contract are directly tested today. Dev-auth safety is intentionally tracked here rather than split into a standalone capability spec because dev auth is not a supported host product mode.

### Directly Tested

- Better Auth configuration rejects empty `allowedEmails`, rejects secrets shorter than 32 characters, and preserves trusted origin expansion. Verified by `test/better-auth-config.test.mjs`.
- Legacy host dev-auth activation fails closed: `PIBO_DEV_AUTH=1` does not enable `gateway:web`, and the default auth mode remains Better Auth. Verified by `test/web-gateway.test.mjs`.
- Dev-auth route access is loopback-gated by both `Host` and `X-Forwarded-Host`; public forwarded host values are rejected by the loopback predicate. Verified by `test/dev-auth.test.mjs`.
- Authenticated Chat Web requests receive shared app product context while preserving auth errors; forbidden auth errors surface as `403`, cross-origin mutations are rejected, local reverse-proxy same-origin mutations are accepted, and oversized bodies return `413`. Verified by `test/web-auth-shared-app-context.test.mjs` and `test/web-channel.test.mjs`.
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

### Assumptions

- `auth.allowedEmails` is the intended production access-control list for Chat Web and other same-origin apps.
- Dev auth is meant for isolated Docker workers only and should not become a general local development mode on the host gateway.

### Open Questions

- Should `/gateway/status` require authentication, or is current unauthenticated status output intentional for gateway supervision?
- Should simple-agent API routes have an explicit spec and auth policy separate from registered web apps?

## Traceability

| Requirement | Scenario / Story | Code Basis | Verification | Status |
|---|---|---|---|---|
| REQ-001 Web gateways select exactly one auth service | Duplicate auth service registration | `src/gateway/web.ts`, `src/plugins/registry.ts` | `test/plugin-registry.test.mjs` | Component-tested |
| REQ-002 Normal web gateways use Better Auth configuration | Missing allowed email list | `src/auth/better-auth.ts`, `src/config/config.ts` | `test/better-auth-config.test.mjs` | Component-tested |
| REQ-003 Better Auth authorizes only allowed emails | Signed-in user is not allowed | `src/auth/better-auth.ts`, `src/web/channel.ts` | `test/web-channel.test.mjs` covers auth-service `403`; real Better Auth allowlist path is source-inspected | Partly tested |
| REQ-004 Dev auth is available only inside Docker workers | Host tries env dev auth | `src/gateway/web.ts`, `src/plugins/dev-auth.ts` | `test/web-gateway.test.mjs`, `test/dev-auth.test.mjs` | Component-tested |
| REQ-005 Authenticated web requests enter the shared app context | Chat API request uses shared app context | `src/web/auth.ts`, `src/web/types.ts`, `src/apps/chat/web-app.ts` | `test/web-auth-shared-app-context.test.mjs`, `test/web-channel.test.mjs` | Integration-tested |
| REQ-006 Web host routes same-origin requests deterministically | Auth route is not claimed by an app | `src/web/channel.ts` | Component behavior source-inspected; app shell/authenticated API routes covered by `test/web-channel.test.mjs` | Partly tested |
| REQ-007 Canonical redirects protect browser-facing origins | OAuth callback reaches loopback origin | `src/web/channel.ts`, `src/gateway/web.ts` | `test/web-channel.test.mjs` covers app-link redirect; auth-callback redirect is source-inspected | Partly tested |
| REQ-008 Registered web app routes must not overlap | Two apps claim same API prefix | `src/plugins/registry.ts`, `src/web/types.ts` | `test/plugin-registry.test.mjs` | Component-tested |
| REQ-009 HTTP request and response handling is bounded and explicit | Oversized API body | `src/web/http.ts`, `src/web/channel.ts` | `test/web-channel.test.mjs`, `test/web-http.test.mjs` | Component-tested |

## Verification Basis

This spec was derived from the current implementation in `src/web/*`, `src/auth/*`, `src/plugins/better-auth.ts`, `src/plugins/dev-auth.ts`, `src/plugins/web.ts`, `src/plugins/registry.ts`, `src/gateway/web.ts`, `src/config/config.ts`, and web app integration points in `src/apps/chat/web-app.ts`.

Verification coverage was updated from `test/better-auth-config.test.mjs`, `test/dev-auth.test.mjs`, `test/web-gateway.test.mjs`, `test/web-channel.test.mjs`, `test/plugin-registry.test.mjs`, and `test/web-http.test.mjs`.

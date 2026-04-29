---
title: Pibo Web Gateway Auth And Chat Specification
version: 1.0
date_created: 2026-04-28
last_updated: 2026-04-29
owner: Pibo maintainers
tags: [infrastructure, web, auth, gateway, chat]
---

# Introduction

This specification defines the current authenticated web gateway and chat app behavior implemented by Pibo.

## 1. Purpose & Scope

This specification covers:

- Web gateway plugin composition.
- Better Auth service requirements.
- Same-origin web host behavior.
- Chat web app routes and security checks.
- HTTP request and response handling constraints.

This specification does not define non-web local gateway behavior except where web gateway composition uses the same gateway server.

## 2. Definitions

- **Web gateway**: A `PiboGatewayServer` started with Better Auth, web host, and chat web plugins.
- **Web host channel**: The same-origin HTTP channel named `web-host`.
- **Chat web app**: The app named `pibo.chat-web`, mounted at `/apps/chat` with API prefix `/api/chat`.
- **Better Auth service**: The auth implementation named `better-auth`.
- **Allowed email allowlist**: Configured set of Google account emails allowed to use the web app.
- **Same-origin mutation**: A non-GET request that requires `Content-Type: application/json` and an `Origin` equal to the request origin.
- **Pibo Session**: The product session record used by the Chat Web App for routing, ownership, session listing, and trace reconstruction.

## 3. Requirements, Constraints & Guidelines

- **REQ-001**: `gateway:web` MUST create a plugin registry containing default Pibo plugins plus Better Auth, web host, and chat web plugins.
- **REQ-002**: The web host channel MUST have auth mode `"required"`.
- **REQ-003**: The gateway MUST reject startup for any channel with auth mode `"required"` when no auth service is registered.
- **REQ-004**: The default web host MUST listen on `127.0.0.1:4788` unless overridden.
- **REQ-005**: `/api/auth/*` routes MUST be delegated to the registered auth service HTTP handler.
- **REQ-006**: Registered web apps MUST receive requests whose pathname matches their mount path or API prefix.
- **REQ-007**: Root `/` MUST redirect to the first registered web app mount path when at least one app exists.
- **REQ-008**: Root `/` MUST return a minimal HTML page when no web apps are registered.
- **REQ-009**: Unknown web routes MUST return JSON `404`.
- **REQ-010**: HTTP request bodies MUST be capped at `4 MiB`.
- **REQ-011**: Oversized request bodies MUST fail with status `413`.
- **REQ-012**: Better Auth MUST require `auth.baseURL`, `auth.secret`, `auth.googleClientId`, `auth.googleClientSecret`, and at least one `auth.allowedEmails` entry.
- **REQ-013**: Better Auth secret MUST be at least 32 characters.
- **REQ-014**: Better Auth MUST use Google as the social provider.
- **REQ-015**: Better Auth MUST use the bearer plugin.
- **REQ-016**: Better Auth MUST default its SQLite database path to `.pibo/auth.sqlite`.
- **REQ-017**: Better Auth startup MUST run database migrations.
- **REQ-018**: Users whose email is not in the allowlist MUST receive `403`.
- **REQ-019**: Missing auth sessions MUST receive `401`.
- **REQ-020**: The chat web app page MUST be served at `GET /apps/chat`.
- **REQ-021**: `GET /api/chat/bootstrap` MUST require an auth session and return identity, selected Pibo Session, session tree, agent inventory, and available gateway actions.
- **REQ-022**: Chat session ownership MUST use `ownerScope=user:<authenticated user id>` and default profile `pibo-minimal` unless overridden.
- **REQ-023**: `POST /api/chat/sessions` MUST require same-origin JSON and create a new top-level personal Pibo Session.
- **REQ-024**: `PATCH /api/chat/sessions/:piboSessionId` MUST require same-origin JSON and update only mutable Chat Web session metadata such as `title` and `archived`.
- **REQ-025**: `POST /api/chat/message` MUST require same-origin JSON, an authenticated session, non-empty string `text`, and MUST emit a `message` input event with source `"user"`.
- **REQ-026**: `POST /api/chat/action` MUST require same-origin JSON, an authenticated session, a non-empty string `action`, and JSON-serializable optional `params`.
- **REQ-027**: `GET /api/chat/events` MUST return a Server-Sent Events stream.
- **REQ-028**: The SSE stream MUST send an initial `ready` event containing the selected `piboSessionId`.
- **REQ-029**: The SSE stream MUST forward only router output events whose `piboSessionId` matches the authenticated user's selected Pibo Session.
- **REQ-030**: Chat UI thinking output MUST be user-toggleable and hidden by default.
- **REQ-031**: Chat APIs that accept a `piboSessionId` MUST reject sessions whose `ownerScope` does not match the authenticated user.
- **REQ-032**: `GET /api/chat/trace` MUST pass the selected session's current read-model status into trace reconstruction so live running nodes can be distinguished from interrupted stale nodes.
- **SEC-001**: Chat mutation routes MUST reject non-JSON content types with `415`.
- **SEC-002**: Chat mutation routes MUST reject missing `Origin` headers with `403`.
- **SEC-003**: Chat mutation routes MUST reject cross-origin `Origin` headers with `403`.
- **SEC-004**: Web apps MUST use same-origin cookies and MUST NOT require iframe or cross-origin auth flow.
- **CON-001**: Google OAuth redirect URIs are exact per deployment and are not wildcarded by Pibo.

## 4. Interfaces & Data Contracts

### Auth Session

```ts
type PiboAuthSession = {
  identity: {
    userId: string;
    email?: string;
    name?: string;
    image?: string;
    provider?: string;
  };
  sessionId?: string;
  expiresAt?: Date;
};
```

### Web App

```ts
type PiboWebApp = {
  name: string;
  mountPath: string;
  apiPrefix: string;
  handleRequest(request: Request, context: PiboWebAppContext): Promise<Response | undefined> | Response | undefined;
};
```

### Chat Routes

| Route | Method | Auth | Behavior |
| --- | --- | --- | --- |
| `/apps/chat` | GET | UI handles auth state | Returns HTML chat app |
| `/api/chat/bootstrap` | GET | required | Returns identity, selected session, session tree, capabilities |
| `/api/chat/session` | GET | required | Compatibility endpoint returning identity, selected session, capabilities |
| `/api/chat/sessions` | GET | required | Returns owned session tree |
| `/api/chat/sessions` | POST | required | Creates a new top-level personal session |
| `/api/chat/sessions/:piboSessionId` | PATCH | required | Updates mutable session metadata such as title or archived state |
| `/api/chat/trace` | GET | required | Returns selected session trace view |
| `/api/chat/message` | POST | required | Emits message event |
| `/api/chat/action` | POST | required | Emits execution event |
| `/api/chat/events` | GET | required | Opens SSE stream |
| `/api/auth/*` | any | auth-service-owned | Delegates to Better Auth |

### Bootstrap Response

```json
{
  "identity": {
    "userId": "user-id",
    "email": "user@example.com",
    "provider": "google"
  },
  "session": {
    "id": "ps_...",
    "piSessionId": "uuid",
    "channel": "pibo.chat-web",
    "kind": "chat",
    "profile": "pibo-minimal",
    "ownerScope": "user:user-id",
    "createdAt": "2026-04-28T00:00:00.000Z",
    "updatedAt": "2026-04-28T00:00:00.000Z"
  },
  "selectedPiboSessionId": "ps_...",
  "sessions": [],
  "agents": [],
  "capabilities": {
    "actions": []
  }
}
```

## 5. Acceptance Criteria

- **AC-001**: Given web gateway startup without an auth service, When the web host channel is registered, Then startup fails.
- **AC-002**: Given missing Better Auth config, When creating the Better Auth service, Then creation fails with a config-specific error.
- **AC-003**: Given an unauthenticated request to `/api/chat/bootstrap`, When handled, Then response status is `401`.
- **AC-004**: Given an authenticated user outside the allowlist, When `/api/chat/bootstrap` is requested, Then response status is `403`.
- **AC-005**: Given an authenticated allowed user, When `/api/chat/bootstrap` is requested, Then a persistent personal Pibo Session is returned.
- **AC-006**: Given a cross-origin POST to `/api/chat/message`, When handled, Then response status is `403`.
- **AC-007**: Given a request body larger than `4 MiB`, When converted to a web request, Then status `413` is returned.
- **AC-008**: Given an SSE subscription, When another session emits an event, Then that event is not written to this stream.
- **AC-009**: Given an authenticated user requests another user's `piboSessionId`, When the request is handled, Then the response is rejected.
- **AC-010**: Given an authenticated user patches their own session title or archived state, When the request is valid, Then the returned session and subsequent bootstrap response reflect the update.
- **AC-011**: Given a trace request for a running selected session, When live delta events exist, Then trace reconstruction receives the session status as `running`.

## 6. Test Automation Strategy

- **Test Levels**: Unit and integration tests.
- **Frameworks**: Node.js built-in test runner and TypeScript compiler.
- **Primary Command**: `npm test`.
- **Focused Commands**: `node --test test/better-auth-config.test.mjs`, `node --test test/web-channel.test.mjs`, `node --test test/channel-runtime.test.mjs`.

## 7. Rationale & Context

The web implementation keeps auth, web hosting, and chat as separate plugin capabilities. This preserves the plugin boundary and avoids cross-origin complexity by serving auth and apps from the same origin.

## 8. Dependencies & External Integrations

### Third-Party Services

- **SVC-001**: Google OAuth - Required social login provider for the current Better Auth implementation.

### Infrastructure Dependencies

- **INF-001**: `.pibo/config.json` for auth configuration.
- **INF-002**: `.pibo/auth.sqlite` by default for Better Auth persistence.
- **INF-003**: Pibo Session store, default `.pibo/pibo-sessions.sqlite` when the gateway owns the store.

### Technology Platform Dependencies

- **PLT-001**: Better Auth library.
- **PLT-002**: Node.js HTTP server APIs.
- **PLT-003**: SQLite through Node.js database APIs.

## 9. Examples & Edge Cases

### Required Local OAuth Redirect

```text
http://localhost:4788/api/auth/callback/google
```

### Same-Origin Message Request

```http
POST /api/chat/message
Content-Type: application/json
Origin: http://localhost:4788

{"text":"Hello"}
```

Current clients SHOULD include `piboSessionId`:

```json
{"piboSessionId":"ps_...","text":"Hello"}
```

### Invalid Action Params

`POST /api/chat/action` rejects params containing non-JSON values such as functions, symbols, `undefined`, or non-finite numbers.

## 10. Validation Criteria

- Web channel and Better Auth tests pass.
- `npm run typecheck` passes.
- Manual local smoke flow works after required auth config is set:

```bash
npm run gateway:web
```

## 11. Related Specifications / Further Reading

- [docs/architecture.md](../docs/architecture.md)
- [README.md](../README.md)
- [spec-schema-events-and-gateway.md](./spec-schema-events-and-gateway.md)

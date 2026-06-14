---
name: pibo-debug-auth
description: Use the Pibo local auth gateway, both on the host and inside Docker workers. Use this when you need authenticated access to the Chat Web App without configuring Google OAuth, when you want to test against a local gateway on a developer laptop, or when you are working inside a Docker worker and need a fast authenticated session.
---

# Pibo Local Auth Gateway

Local auth is a single code path that runs on the host (`pibo gateway:web --auth=local`) and inside Docker workers (set by the worker entrypoint). It skips Google OAuth and uses a fixed dev identity so the Chat Web App can be reached without external setup.

## When to use this

- You need to reach the Chat Web App on a developer laptop without configuring Google OAuth.
- You need a fast authenticated session inside a Docker worker.
- You want to validate the Chat Web App end-to-end without setting up `auth.googleClientId` / `auth.googleClientSecret` / `auth.allowedEmails`.
- Real Better Auth is unavailable, misconfigured, or out of scope for the current test.

## How local auth works

Local auth is selected by one of:

- The CLI flag `--auth=local` on `pibo gateway:web`.
- The `auth.mode` config key set to `local`.
- The legacy `devAuth: true` option, kept as an alias for one release.

The selection is gated by a loopback bind on the host. The operator MUST bind the gateway to `127.0.0.1`, `::1`, or `localhost`. A non-loopback bind (for example `0.0.0.0` or a public IP) fails the startup with a clear error pointing to `--web-host=127.0.0.1`. Inside a Docker worker, the in-container bind is `0.0.0.0`; the Docker network is the security boundary and the host port mapping is the operator's responsibility (use `127.0.0.1:<port>:<container-port>` for loopback-only access).

The dev-auth plugin (`src/plugins/dev-auth.ts`) installs a `PiboAuthService` named `dev-auth` with a fixed identity:

- Email: `dev@pibo.local`
- User ID: `dev-user-001`
- Name: `Dev User`

The Chat Web App sees a normal authenticated session. All app context data (sessions, chat history) is available after this dev identity passes the auth gate.

## Three independent safety layers

Local auth refuses a request that fails ANY of these layers:

1. **Startup bind check** — the gateway process must be bound to a loopback address. This is checked once when the gateway starts.
2. **Request header check** — the `Host` header and `X-Forwarded-Host` header (when present) must both resolve to a loopback host. This catches browsers hitting a public hostname and most reverse-proxy configurations.
3. **TCP socket peer check** — the actual TCP peer address (`request.socket.remoteAddress`) must be `127.0.0.1` or `::1`. The web host channel attaches the peer to the request via an internal header (`x-pibo-socket-peer`) and strips it from the response. A reverse proxy that rewrites both `Host` and `X-Forwarded-Host` to `localhost` cannot fake the socket peer, so this layer closes the residual reverse-proxy exploit.

See `docs/specs/capabilities/web-auth-and-same-origin-host.md` REQ-010 for the full specification.

## Local on the host (no Docker required)

Set the mode in config and start the gateway:

```bash
# 1. Set the local mode once
pibo config set auth.mode local

# 2. Start the gateway — defaults to 127.0.0.1:4788
pibo gateway:web --auth=local
# Output starts with: [pibo] LOCAL AUTH ENABLED — bound to 127.0.0.1
```

Or skip the config and use the flag alone:

```bash
pibo gateway:web --auth=local
```

Refusing a non-loopback bind:

```bash
pibo gateway:web --auth=local --web-host=0.0.0.0
# Error: --auth=local requires a loopback bind (127.0.0.1, ::1, or localhost).
# Got '0.0.0.0'. Either drop --web-host or pick --auth=better-auth for a public bind.
```

Once running, follow the login flow on the host:

```bash
# 1. Follow the login flow and save the cookie
curl -L -c /tmp/dev_cookie.txt \
  http://localhost:4788/api/auth/sign-in/social

# 2. Verify the session
curl -b /tmp/dev_cookie.txt \
  http://localhost:4788/api/auth/session
# → {"identity":{"userId":"dev-user-001","email":"dev@pibo.local",...}}

# 3. Open the Chat Web App
open http://localhost:4788/apps/chat
```

The `-L` flag follows redirects. The flow is:

1. `GET /api/auth/sign-in/social` → `302` to `/api/auth/callback/google`
2. `GET /api/auth/callback/google` → sets cookie, `302` to `/apps/chat`

## Inside a Docker worker

Docker workers are spawned by `pibo compute dev spawn` and start the gateway via the worker entrypoint with `authMode: "local"`. The in-container bind is `0.0.0.0:4789`; map the host port to `127.0.0.1:<port>:4789` for loopback-only access from the host.

```bash
# 1. Spawn a worker
pibo compute dev spawn --worktree <topic>
# Returns: { "webPort": <port>, ... }

# 2. Follow the login flow and save the cookie (host side)
curl -L -c /tmp/dev_cookie.txt \
  http://localhost:<webPort>/api/auth/sign-in/social

# 3. Verify the session
curl -b /tmp/dev_cookie.txt \
  http://localhost:<webPort>/api/auth/session

# 4. Open the Chat Web App in a browser
open http://localhost:<webPort>/apps/chat
```

## Available auth endpoints

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/api/auth/sign-in/social` | GET | Starts the fake login flow. Redirects to callback. |
| `/api/auth/callback/google` | GET | Sets the session cookie. Redirects to `/apps/chat`. |
| `/api/auth/sign-out` | GET | Clears the session cookie. Redirects to `/apps/chat`. |
| `/api/auth/session` | GET | Returns the current session JSON or `null`. |

## Notes

- The local auth session lives in an HTTP cookie (`pibo_dev_session`). Pass the cookie jar (`-c`/`-b`) to every request that needs authentication.
- Sessions do not persist across worker restarts. Each new `pibo compute spawn` or `pibo gateway:web` restart generates a random session token, so cookies from one run do not work on another.
- Host gateways with `--auth=local` are restricted to loopback binds. A request to `http://<public-hostname>:<port>` is rejected with `403` by the header check or the socket peer check, even when both `Host` and `X-Forwarded-Host` are rewritten to `localhost` by a reverse proxy.
- The legacy `PIBO_DEV_AUTH=1` environment switch fails closed with a migration error pointing to `--auth=local` and `--web-host=127.0.0.1`.
- Production gateways use Better Auth (`--auth=better-auth` or the default when `auth.mode` is unset / `better-auth`). Better Auth requires the five `auth.*` config keys.
- If you see a `LOCAL AUTH ENABLED` warning in the startup banner, the gateway is in local mode. Switch to Better Auth (`--auth=better-auth` plus a complete Google config) before exposing the port to the public internet.

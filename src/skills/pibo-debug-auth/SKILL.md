---
name: pibo-debug-auth
description: Log into a Pibo Docker compute worker with dev authentication. Use this when you need to access the Chat Web App inside a container worker, when real Better Auth is unavailable, or when the user asks about logging in, authentication, or session handling inside a Docker worker.
---

# Pibo Docker Dev Auth

Every Docker compute worker starts with a built-in dev authentication plugin. No Google OAuth, no credentials, no setup. The worker handles login automatically.

## When to use this

- You need to log into the Chat Web App inside a Docker worker.
- Real Better Auth is unavailable or the container lacks OAuth config.
- You need a fast authenticated session for testing or development.

## How dev auth works in a Docker worker

When `pibo compute spawn` creates a worker, the entrypoint sets `PIBO_DEV_AUTH=1`. This activates the dev-auth plugin (`src/plugins/dev-auth.ts`) instead of Better Auth.

The plugin provides a cookie-based session with a fixed identity:

- Email: `dev@pibo.local`
- User ID: `dev-user-001`
- Name: `Dev User`

The Chat Web App sees a normal authenticated session. All owner-scoped data (sessions, chat history) belongs to this dev identity.

## Log in programmatically

```bash
# 1. Spawn a worker
pibo compute spawn
# Returns: { "webPort": 32804, ... }

# 2. Follow the login flow and save the cookie
curl -L -c /tmp/dev_cookie.txt \
  http://localhost:<webPort>/api/auth/sign-in/social

# 3. Verify the session
curl -b /tmp/dev_cookie.txt \
  http://localhost:<webPort>/api/auth/session
# → {"identity":{"userId":"dev-user-001","email":"dev@pibo.local",...}}

# 4. Access the Chat Web App with the cookie
curl -b /tmp/dev_cookie.txt \
  http://localhost:<webPort>/apps/chat/
# → 200 with valid HTML
```

The `-L` flag follows redirects. The flow is:

1. `GET /api/auth/sign-in/social` → `302` to `/api/auth/callback/google`
2. `GET /api/auth/callback/google` → sets cookie, `302` to `/apps/chat`

## Log in via browser

1. Spawn the worker:
   ```bash
   pibo compute spawn
   ```

2. Open the web port in a browser:
   ```
   http://localhost:<webPort>/apps/chat
   ```

3. Click **Sign in with Google**. No real OAuth happens. The page redirects
   through the callback and lands back at `/apps/chat` with an active session.

## Available auth endpoints

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/api/auth/sign-in/social` | GET | Starts the fake login flow. Redirects to callback. |
| `/api/auth/callback/google` | GET | Sets the session cookie. Redirects to `/apps/chat`. |
| `/api/auth/sign-out` | GET | Clears the session cookie. Redirects to `/apps/chat`. |
| `/api/auth/session` | GET | Returns the current session JSON or `null`. |

## Notes

- The dev-auth session lives in an HTTP cookie (`pibo_dev_session`). Pass the
  cookie jar (`-c`/`-b`) to every request that needs authentication.
- Sessions do not persist across worker restarts. Each new `pibo compute spawn`
  creates a fresh dev identity with the same fixed values.
- Better Auth stays available on the host gateway. The dev-auth plugin only
  runs inside Docker workers.
- To use real Better Auth in a container, mount a valid `.pibo/config.json`
  and set `PIBO_DEV_AUTH=0` before starting the gateway.

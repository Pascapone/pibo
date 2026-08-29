# Install Pibo as a User Host

Use this path when you want to run Pibo, not develop Pibo itself.

## What this installs

A user host has one gateway and one data directory:

```text
/root/.pibo
pibo-web.service
127.0.0.1:4788  web app
127.0.0.1:4789  internal gateway
```

It does not require Docker, a dev gateway, a GitHub App, or branch worktrees.

## Recommended flow

```bash
npm install -g @pasko70/pibo
pibo setup doctor --domain pibo.example.com --expected-ip <server-ip>
pibo setup user-host --domain pibo.example.com --print-files
```

Review the generated files before installing them. To stage the exact paths without touching the host, use:

```bash
pibo setup user-host --domain pibo.example.com --write-to /tmp/pibo-setup
find /tmp/pibo-setup -type f -maxdepth 5 -print
```

After review, apply directly on the host with:

```bash
pibo setup user-host --domain pibo.example.com --apply --yes
systemctl daemon-reload
```

## Configure auth

For a public deployment with Google OAuth:

```bash
pibo config set auth.baseURL https://pibo.example.com
pibo config set auth.secret <at-least-32-characters>
pibo config set auth.googleClientId <google-client-id>
pibo config set auth.googleClientSecret <google-client-secret>
pibo config set auth.allowedEmails you@example.com
```

For a local development install on a developer laptop, use the local auth mode. This skips Google OAuth and binds the gateway to loopback only:

```bash
pibo config set auth.mode local
pibo gateway:web --auth=local
# Open http://localhost:4788/apps/chat and click "Sign in with Google".
# The dev identity dev@pibo.local is auto-attached without OAuth.
```

Local auth refuses a non-loopback bind:

```bash
pibo gateway:web --auth=local --web-host=0.0.0.0
# Error: --auth=local requires a loopback bind (127.0.0.1, ::1, or localhost).
```

Three independent request-time safety layers guard the local auth service. See `docs/specs/capabilities/web-auth-and-same-origin-host.md` REQ-010 and the `pibo-debug-auth` skill for the full model.

## Start the gateway

`pibo-web` will not start until Better Auth config is complete. This cannot be automated because you must create/select your Google OAuth client and allowed user list. Check it first:

```bash
pibo setup doctor --pibo-home /root/.pibo
```

If auth is incomplete, the doctor prints a hard blocker and the exact missing keys. After installing the rendered systemd unit:

```bash
systemctl daemon-reload
systemctl enable --now pibo-web
pibo gateway web status
```

If you use Caddy, point DNS at the host before expecting Let's Encrypt to issue a certificate. Local auth mode bypasses the Better Auth requirement and prints a warning instead of a hard blocker.

## When not to use this path

Use the developer-host path if you need:

- a separate dev gateway;
- Docker compute workers;
- multiple agents working in isolated containers;
- GitHub App PR automation;
- `main` and `dev` branch deployment on the same host.

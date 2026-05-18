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

```bash
pibo config set auth.baseURL https://pibo.example.com
pibo config set auth.secret <at-least-32-characters>
pibo config set auth.googleClientId <google-client-id>
pibo config set auth.googleClientSecret <google-client-secret>
pibo config set auth.allowedEmails you@example.com
```

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

If you use Caddy, point DNS at the host before expecting Let's Encrypt to issue a certificate.

## When not to use this path

Use the developer-host path if you need:

- a separate dev gateway;
- Docker compute workers;
- multiple agents working in isolated containers;
- GitHub App PR automation;
- `main` and `dev` branch deployment on the same host.

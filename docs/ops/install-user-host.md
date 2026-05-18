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
pibo setup doctor
pibo setup user-host --domain pibo.example.com --print-files
```

Review the generated files before installing them.

## Configure auth

```bash
pibo config set auth.baseURL https://pibo.example.com
pibo config set auth.secret <at-least-32-characters>
pibo config set auth.googleClientId <google-client-id>
pibo config set auth.googleClientSecret <google-client-secret>
pibo config set auth.allowedEmails you@example.com
```

## Start the gateway

After installing the rendered systemd unit:

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

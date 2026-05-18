# Design: Bootstrap Host Installation

**Status:** Draft
**Created:** 2026-05-18

## Overview

The setup system starts as a planner and artifact renderer inside the Pibo CLI:

```bash
pibo setup user-host
pibo setup developer-host
pibo setup doctor
```

This keeps npm installs lightweight while still giving operators concrete systemd and Caddy output to apply. Later work can add `--apply` once the rendered files and validation flow are stable.

## Modes

### User Host

For normal use:

```text
/root/.pibo
pibo-web.service
127.0.0.1:4788 web
127.0.0.1:4789 internal gateway
```

Docker is optional. GitHub App secrets are not part of this path.

### Developer Host

For core development:

```text
/root/code/pibo                  main / production
/root/code/pibo/.worktrees/dev   dev / development

/root/.pibo                      production data
/root/.pibo-dev                  development data

pibo-web.service                 4788 / 4789
pibo-web-dev.service             4808 / 4809
```

Docker is required for compute workers so agents can work in isolated containers and restart their own gateways without interrupting host production or other agents.

## Learned from the server restore

- Pibo now requires Node `>=24`; Node 22 caused install warnings and should not be suggested.
- `npm ci` is correct only when package and lock are synchronized.
- `pibo gateway:web --web-port 4808` does not change the internal gateway port; dev needs a wrapper around `runWebGatewayServer` to bind `4809`.
- Caddy can be prepared before DNS cutover, but Let's Encrypt will fail until the A records point to the host.
- `www` domains should redirect to the canonical host instead of running separate apps.
- Developer remotes must be explicit: `origin` is a server-specific fork; `upstream` is the canonical project.

## Generated Artifacts

The planner renders:

- production systemd unit
- developer systemd unit
- dev gateway start wrapper
- Caddyfile
- environment template

The first implementation prints these artifacts. It does not write them.

## Future Apply Mode

A later `--apply` mode should:

1. verify root privileges;
2. validate Node, npm, git, Docker, and Caddy availability;
3. ask for confirmation unless `--yes` is passed;
4. write generated files atomically;
5. run `systemctl daemon-reload`;
6. optionally start services;
7. run gateway and HTTP health checks.

The planner should remain usable without root and without side effects.

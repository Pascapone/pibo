---
type: "Historical Record"
title: "Dev Web Gateway"
description: "Preserves the original body as a deprecated historical record without promoting historical claims."
tags: ["historical","legacy","migration"]
status: "deprecated"
authority: "historical"
migration_lineage:
  source_path: "docs/legacy/dev-web-gateway.md"
  source_commit: "0cd6a73449e1b555fa6e590d839d7e03c8dc98bf"
  baseline_commit: "2aef244301f5d181624662fdad53e18e83e80bd9"
  baseline_blob_oid: "168a6a856c43b87a278f7987605d761060a9485c"
  source_bytes: 2840
  source_sha256: "ea480c6f925cbaff813bad19310ac6d7e6f1effba15ee309f252bb05f263dcc3"
  source_body_sha256: "ea480c6f925cbaff813bad19310ac6d7e6f1effba15ee309f252bb05f263dcc3"
generated:
  by: "process:pibo-okf-c-legacy"
  at: "2026-09-01T09:50:26Z"
---
# Dev Web Gateway

Pibo has a staging-grade web gateway for testing changes before production.

## Purpose

Use the dev web gateway after Docker worker validation and before production deployment. It runs the normal Better Auth stack, uses Google OAuth, and keeps its state separate from the production gateway.

```text
Docker compute worker -> Dev web gateway -> Production web gateway
```

## Services and ports

| Environment | systemd service | Web port | Gateway port | Public origin | Pibo home |
| --- | --- | ---: | ---: | --- | --- |
| Dev | `pibo-web-dev.service` | `127.0.0.1:4808` | `127.0.0.1:4809` | `https://dev.pibo.neuralnexus.me` | `~/.pibo-dev` |
| Production | `pibo-web.service` | `127.0.0.1:4788` | `127.0.0.1:4789` | `https://pibo.neuralnexus.me` | `~/.pibo` |

The dev gateway stores Better Auth data at `~/.pibo-dev/auth.sqlite` and keeps chat, session, event, context-file, and agent stores under `~/.pibo-dev`.

## Deployment scripts

Deploy to dev first:

```bash
./scripts/deploy-web-dev.sh
```

Deploy to production only after dev testing succeeds and the user approves production rollout:

```bash
./scripts/deploy-web.sh
```

`deploy-web-dev.sh` builds the current worktree and restarts only `pibo-web-dev.service`. `deploy-web.sh` builds the current worktree, refreshes the stable fallback backup, restarts `pibo-web.service`, and verifies the production URL.

## Public access, TLS, and Google OAuth

The hosted dev gateway is publicly reachable at:

```text
https://dev.pibo.neuralnexus.me/apps/chat
```

`www.dev.pibo.neuralnexus.me` redirects to `dev.pibo.neuralnexus.me`.

DNS is configured for both hosts:

```text
dev.pibo.neuralnexus.me A <SERVER_IP>
www.dev.pibo.neuralnexus.me A <SERVER_IP>
```

Let's Encrypt TLS is installed for both names:

```bash
certbot certificates | grep -A8 dev.pibo.neuralnexus.me
```

Google OAuth is configured for the dev origin and callback URI:

```text
Authorized JavaScript origin:
https://dev.pibo.neuralnexus.me

Authorized redirect URI:
https://dev.pibo.neuralnexus.me/api/auth/callback/google
```

Google OAuth redirects are exact per origin. Do not expect `pibo.neuralnexus.me` to cover `dev.pibo.neuralnexus.me`.

## Operator checks

```bash
systemctl is-active pibo-web-dev
curl -fsS http://127.0.0.1:4808/health
curl -fsS https://dev.pibo.neuralnexus.me/health
PIBO_HOME=~/.pibo-dev npm run --silent dev -- config show
```

Production checks remain separate:

```bash
systemctl is-active pibo-web
curl -fsS http://127.0.0.1:4788/health
```

## Agent rule

Do not use production as the first host-level test target. Validate inside a Docker compute worker first. When host-level testing is needed, deploy with `./scripts/deploy-web-dev.sh` and test `https://dev.pibo.neuralnexus.me`. Use `./scripts/deploy-web.sh` only for approved production deployment.

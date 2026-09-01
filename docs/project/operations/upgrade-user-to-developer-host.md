---
type: "Guide"
title: "Upgrade a User Host to a Developer Host"
description: "Guides operators through upgrading a Pibo user host to a developer host without replacing production state."
tags: ["developer-host", "operations", "setup", "upgrade"]
status: "draft"
authority: "directive"
generated:
  by: "openai/codex"
  at: "2026-08-30T15:47:50Z"
sources:
  - id: "foundation-relocation-source"
    resource: "https://github.com/Pascapone/pibo/blob/2aef244301f5d181624662fdad53e18e83e80bd9/docs/ops/upgrade-user-to-developer-host.md"
    title: "Original byte-preserved user-host upgrade guide"
    commit: "2aef244301f5d181624662fdad53e18e83e80bd9"
    path: "docs/ops/upgrade-user-to-developer-host.md"
    sha256: "a48141d6456800b5e05472dfa7464d44a3b1605ad25a3209145a4d5bfcef22f8"
    relation: "Byte-identical body lineage before Foundation relocation."
---
# Upgrade a User Host to a Developer Host

A normal npm-installed Pibo host can be upgraded later. The upgrade must preserve the production gateway and add development infrastructure next to it.

## Starting point

```text
/root/.pibo
pibo-web.service
```

## Target point

```text
/root/.pibo                      unchanged production data
/root/.pibo-dev                  new development data
/root/code/pibo                  source checkout on main
/root/code/pibo/.worktrees/dev   source worktree on dev
pibo-web.service                 existing production service
pibo-web-dev.service             new development service
Docker                           installed for compute workers
```

## Plan first

```bash
pibo setup developer-host \
  --origin git@github.com:<server-or-user-fork>/pibo.git \
  --prod-domain pibo.example.com \
  --dev-domain dev.pibo.example.com \
  --print-files

pibo setup developer-host \
  --origin git@github.com:<server-or-user-fork>/pibo.git \
  --prod-domain pibo.example.com \
  --dev-domain dev.pibo.example.com \
  --write-to /tmp/pibo-setup
```

## Upgrade rules

- Do not replace `/root/.pibo`.
- Do not stop production unless a user approves it.
- Create `/root/.pibo-dev` separately.
- Keep `pibo-web` on `4788/4789`.
- Start `pibo-web-dev` on `4808/4809`.
- Install Docker only for the developer path.
- Provision swap at the OS level for developer hosts, then verify it with `--min-swap-gb 8`.
- Build each checkout with `npm ci && npm run build`; do not globally install the dev worktree over production.
- Keep generated services pinned to branch-specific entrypoints instead of relying on one mutable global `pibo` symlink.
- Keep `origin` pointed at the host-specific fork.
- Keep `upstream` pointed at `git@github.com:Pascapone/pibo.git`.

## Validation

```bash
pibo setup doctor --domain pibo.example.com --dev-domain dev.pibo.example.com --expected-ip <server-ip> --require-docker --min-swap-gb 8
pibo gateway web status
PIBO_GATEWAY_DEV_PORT=4808 pibo gateway dev status
docker --version
pibo compute spawn --help
```

After DNS is updated, check both browser URLs:

```text
https://pibo.example.com/apps/chat
https://dev.pibo.example.com/apps/chat
```

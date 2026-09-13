---
type: "Reference"
title: "Installation profiles"
description: "Explains supported Pibo installation profiles, ownership boundaries, migration, upgrade, rollback, and recovery."
tags: ["installation", "operations", "profiles"]
status: "draft"
authority: "informative"
migration_lineage:
  source_path: "docs/project/installation-profiles.md"
  source_commit: "debba32a68137205df6351da9f3ae461004ca0c0"
  baseline_commit: "2aef244301f5d181624662fdad53e18e83e80bd9"
  baseline_blob_oid: "04ba7be002c1a1cee6f0fa173801dd870127f7b3"
  source_bytes: 6918
  source_sha256: "b0bc367fcf9fb515803da3f305b66467b1c1947c26ef755f1f8c019b5bfe7f82"
  source_body_sha256: "b0bc367fcf9fb515803da3f305b66467b1c1947c26ef755f1f8c019b5bfe7f82"
generated:
  by: "openai/codex"
  at: "2026-09-12T13:40:00Z"
---
# Installation profiles

Pibo's package installation remains side-effect free. After `npm install -g @pasko70/pibo`, use `pibo setup` to inspect or apply one of two supported host profiles.

## Supported hosts and resource budget

Planning and staging work wherever the Pibo CLI runs. Host apply currently targets Linux with systemd and one of `apt-get`, `dnf`, or `pacman`. Containers and other service managers should use Vanilla plan JSON or a staged tree as the integration contract instead of `--apply`.

Vanilla adds only the gateway service and Caddy beyond the installed npm package. Batteries Included also installs Chromium, two isolated browser-tool runtimes, Web Annotations, and isolated MCP defaults. Exact size and memory depend on the distribution and workload; budget several gigabytes of disk and at least 2 GiB of available memory for a practical Batteries Included host. Browser sessions add workload-dependent processes.

## Choose a profile

### Batteries Included (recommended)

Use this for a complete self-hosted Pibo workstation. It adds:

- the Pibo gateway and Chat Web;
- Browser Use and Agent Browser from Pibo's pinned tool registry;
- managed Chromium/CDP prerequisites;
- Web Annotations from the installed Pibo package;
- an allowlisted Chrome DevTools MCP default;
- systemd, Caddy, status, doctor, upgrade, and rollback metadata.

It consumes more disk, memory, network downloads, and background processes than Vanilla. Browser automation remains isolated under Pibo Home and is exposed only through the authenticated gateway and tool contracts.

```bash
pibo setup plan --profile batteries-included --domain pibo.example.com
pibo setup install --profile batteries-included --domain pibo.example.com --apply --yes
pibo setup status
pibo setup doctor --domain pibo.example.com
```

Configure Better Auth before applying a public domain. Setup refuses to expose local-auth mode through a public proxy because Caddy reaches the gateway over loopback. A domain enables trusted automatic TLS; without one Caddy remains loopback-only at `http://127.0.0.1:8080`.

### Vanilla

Use this when you want only the Pibo gateway and Chat Web, or when another system owns the proxy and optional tooling. Vanilla does not install Chromium, browser automation tools, Web Annotations, or MCP defaults.

```bash
pibo setup plan --profile vanilla --domain pibo.example.com
pibo setup install --profile vanilla --domain pibo.example.com --apply --yes
```

## Review before applying

Plans are deterministic JSON and never modify the host:

```bash
pibo setup plan --profile batteries-included --json
```

A staged installation writes the complete owned filesystem tree and manifest under a review directory, without installing packages or starting services:

```bash
pibo setup install --profile batteries-included \
  --pibo-home /root/.pibo \
  --domain pibo.example.com \
  --write-to /tmp/pibo-install
pibo setup status --pibo-home /root/.pibo --root /tmp/pibo-install
```

Real host mutation requires both `--apply` and `--yes`, requires root, and uses `pibo gateway web restart` instead of bypassing the gateway's active-session safety check.

## Components and migration

The manifest records the installed component set and pinned versions. To move from Vanilla to the complete maintained set, apply the Batteries Included profile explicitly after reviewing its plan. To move from Batteries Included to Vanilla, uninstall setup-owned resources and install Vanilla; Pibo Home, workspaces, browser profiles, sessions, and user data remain in place. Upgrades from historical manifests also stop and disable retired setup-owned services without reintroducing them as supported components.

## Upgrade, repair, and rollback

```bash
pibo setup status --json
pibo setup doctor
pibo setup upgrade --apply --yes
pibo setup uninstall --apply --yes
```

The private manifest at `$PIBO_HOME/setup/installation.json` records the profile version, component versions, download checksums, and SHA-256 digest of each owned file. Reapplying an unchanged plan leaves files and the manifest untouched. Upgrade replaces only files still matching their previous owned digest and reruns an installation action only when its recorded fingerprint or health check is stale. Uninstall removes only unchanged owned files; locally modified files are reported and preserved.

To roll back component pins, install the previous Pibo package version, inspect `pibo setup upgrade --json`, and apply that older catalog with `pibo setup upgrade --apply --yes`. Preserve a copy of the manifest before rollback when you need an audit record of both states.

Package-manager removal is separate from profile removal. `npm uninstall -g @pasko70/pibo` does not delete Pibo Home or setup-managed system files. Run `pibo setup uninstall --apply --yes` first when you want to remove those owned host resources.

## Migrating an existing manual installation

Keep the existing Pibo Home and workspace directories. First stage the target profile and compare its service, environment, and proxy resources with the manually maintained files:

```bash
pibo setup install --profile batteries-included \
  --pibo-home /root/.pibo \
  --domain pibo.example.com \
  --write-to /tmp/pibo-install
```

Stop any retired manually managed Pibo sidecar services, archive their units and Caddy configuration outside `/etc`, and then apply the profile. Setup deliberately refuses to overwrite an unmanaged or locally modified target file. This makes ownership transfer explicit instead of silently deleting unrelated proxy sites or service customizations. Reuse the existing workspace root with `--workspace-root`; the installer does not copy or delete workspace data. Existing browser templates under Pibo Home also remain in place.

If the old reverse proxy serves unrelated sites, keep it under operator ownership and copy only the staged Pibo route into that configuration instead of applying setup ownership. In that case, use the generated plan as the supported routing contract and retain the external proxy in your own upgrade and rollback procedure.

## Recovery

A failed package download, service start, or gateway restart leaves the manifest and completed files available for diagnosis. Correct the reported prerequisite and rerun:

```bash
pibo setup status
pibo setup doctor
pibo setup upgrade --apply --yes
```

The lifecycle is idempotent. Setup does not store OAuth secrets in plans or manifests and does not bypass an active-session restart block.

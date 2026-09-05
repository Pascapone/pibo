---
type: "Runbook"
title: "Session Live Preview operations"
description: "Provides the supported production setup, validation, lifecycle, and rollback procedure for session live previews."
tags: ["operations", "previews", "sessions"]
status: "stable"
authority: "directive"
migration_lineage:
  source_path: "docs/project/session-live-previews.md"
  source_commit: "debba32a68137205df6351da9f3ae461004ca0c0"
  baseline_commit: "2aef244301f5d181624662fdad53e18e83e80bd9"
  baseline_blob_oid: "3d73df5a9a9c337b40b5a658cf3867b62006f07d"
  source_bytes: 4376
  source_sha256: "ac1eed234dc204a640d9295264aa5616f539bcea4216b0ba49fcf06e0a368ad5"
  source_body_sha256: "ac1eed234dc204a640d9295264aa5616f539bcea4216b0ba49fcf06e0a368ad5"
generated:
  by: "openai/codex"
  at: "2026-09-05T12:06:19Z"
---
# Purpose

Session Live Previews expose an explicitly selected loopback development port through an isolated, authenticated browser origin. Each Preview belongs to a Pibo Session.

Production activation requires a dedicated base hostname, wildcard DNS, trusted TLS, reverse-proxy routing to the Pibo Web Gateway, and `preview.baseURL`. The feature stays dormant until the operator completes these steps.

The current behavior and security contract are specified in [/specs/compute/session-live-previews.md](/specs/compute/session-live-previews.md).

# Before changing the host

Choose a dedicated base hostname such as `preview.example.com`. Pibo turns Preview ids into one-label subdomains such as `pv-abcd.preview.example.com`.

Ask the DNS operator to create and confirm this record before changing TLS or proxy configuration:

```text
Type: A or AAAA
Name: *.preview.example.com
Value: <public IP of the Pibo Web Gateway host>
```

Use an `A` record for IPv4 and an `AAAA` record for IPv6. Create both when the host accepts both address families. Do not put `*` in `preview.baseURL`.

Generate host-specific instructions:

```bash
pibo preview setup \
  --base-url https://preview.example.com \
  --public-ip 203.0.113.10
```

Omit `--public-ip` when the address is not yet known. The command prints the exact wildcard record, supported Caddy fragments, configuration command, safe gateway restart, and verification command. It does not mutate DNS, Caddy, or Pibo configuration.

# Recommended Caddy setup

Caddy can issue a normal certificate for each active Preview hostname through HTTP-01. Pibo provides an authorization endpoint so unknown wildcard names cannot trigger unbounded certificate issuance.

Merge this stanza into the existing Caddy global options block:

```caddyfile
{
	on_demand_tls {
		ask http://127.0.0.1:4788/api/previews/tls-authorize
	}
}
```

A Caddyfile may contain only one global options block. Add `on_demand_tls` to the existing block instead of creating a second block.

Add the Preview site:

```caddyfile
*.preview.example.com {
	tls {
		on_demand
	}
	reverse_proxy 127.0.0.1:4788
}
```

Caddy forwards HTTP and WebSocket traffic through `reverse_proxy`. Do not proxy Preview hosts directly to development ports. Pibo must remain in the path for authentication, expiration, target validation, concurrency admission, and credential stripping.

The authorization endpoint returns success only when the requested hostname maps to an active Preview definition. It returns no Preview metadata and denies malformed, unknown, closed, and expired Preview ids.

# nginx alternative

nginx does not provide Caddy-style on-demand certificate issuance. Supply a trusted wildcard certificate for `*.preview.example.com`, normally through DNS-01, or use another certificate manager that can provision dynamic Preview names safely.

```nginx
map $http_upgrade $preview_connection {
    default upgrade;
    '' close;
}

server {
    listen 443 ssl;
    server_name *.preview.example.com;

    ssl_certificate /path/to/fullchain.pem;
    ssl_certificate_key /path/to/privkey.pem;

    location / {
        proxy_pass http://127.0.0.1:4788;
        proxy_http_version 1.1;
        proxy_set_header Host $host;
        proxy_set_header X-Forwarded-Host $host;
        proxy_set_header X-Forwarded-Proto https;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection $preview_connection;
    }
}
```

Do not use a certificate that omits the wildcard Preview hostname. A certificate covering only the base hostname does not cover Preview subdomains.

# Activation sequence

1. Confirm wildcard DNS resolves to the public Pibo host.
2. Set the base URL:

   ```bash
   pibo config set preview.baseURL https://preview.example.com
   ```

3. Install or merge the proxy configuration.
4. Validate and reload the proxy:

   ```bash
   caddy validate --config /etc/caddy/Caddyfile
   systemctl reload caddy
   ```

5. Inspect gateway restart safety:

   ```bash
   pibo gateway web status
   ```

6. Restart through the Pibo CLI:

   ```bash
   pibo gateway web restart
   ```

The gateway reads `preview.baseURL` when it starts. Do not use another restart mechanism. If the CLI reports active production work, ask the operator before interrupting those sessions.

# Create and verify a Preview

Let Preview own development-server processes instead of starting them as yielded runs:

```bash
pibo preview expose 5173 \
  --session ps_... \
  --workspace /path/to/project \
  --name "Website" \
  --command 'npm run dev'
```

An already-running external loopback server remains supported:

```bash
pibo preview expose 5173 --session ps_... --name "External website"
```

Run local diagnostics first, then verify the public route with the returned Preview id:

```bash
pibo preview doctor
pibo preview doctor pv-... --public
```

The public check verifies:

- the exact Preview hostname resolves through DNS;
- the HTTPS certificate is trusted for that hostname;
- the request reaches the Preview gateway rather than redirecting to Chat Web or another site;
- anonymous access receives HTTP 401, which proves the Preview authentication boundary is active.

A health check against the main Chat hostname does not prove Preview routing works.

# Lifecycle and limits

Discover and manage Previews progressively:

```bash
pibo preview
pibo preview list
pibo preview show pv-...
pibo preview start pv-...
pibo preview stop pv-...
pibo preview doctor pv-...
pibo preview remove pv-...
```

`close` remains an alias for `remove`. Stop preserves a managed Preview definition and saved command. Remove stops the process, revokes browser access, and removes it from active lists.

Defaults are three concurrently starting or running managed servers and a fixed ten-minute runtime lease. Change both under **Settings > Previews**. HTTP, SSE, WebSocket, and HMR traffic do not extend the lease.

# Chat behavior

When a Preview is created after subscription, Chat Web automatically selects it and opens the deduplicated Preview workspace tab only if its owning Pibo Session is still selected and the Desktop workspace is active. Background Sessions and mobile layouts do not open a tab. Switching to a Session does not replay Previews that already existed before its subscription.

# Troubleshooting

## `preview.baseURL is required`

Run `pibo preview setup --base-url https://preview.example.com`, complete the printed DNS and proxy steps, set the configuration, and restart the gateway.

## DNS succeeds but HTTPS fails

Check the wildcard proxy block and certificate issuance logs. For Caddy, confirm the global `ask` URL points to the active Pibo Web Gateway and that the Preview definition is still active.

## Preview redirects to the main Chat hostname

The wildcard hostname is reaching a proxy or gateway process that did not load the Preview configuration. Confirm proxy routing and restart the Pibo gateway safely.

## `doctor --public` receives a status other than 401

A redirect usually means the wildcard host reached the wrong virtual host. HTTP 404 or 503 usually means the wrong gateway process or stale Preview state. A TLS error means certificate provisioning or hostname coverage failed.

# Rollback

1. Stop and remove active Previews.
2. Remove the wildcard Preview site from the reverse proxy and reload it.
3. Remove the on-demand TLS authorization stanza when no other site uses it.
4. Delete the Preview configuration:

   ```bash
   pibo config del preview.baseURL
   ```

5. Restart the gateway through `pibo gateway web restart` after checking restart safety.
6. Remove the wildcard DNS record after public traffic has drained.

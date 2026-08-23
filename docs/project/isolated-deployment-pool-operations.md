# Isolated Deployment Pool Operations

## Purpose

The deployment pool runs exact Pibo candidates in fixed, isolated Docker slots on the dedicated development host. A lease owns one slot until explicit release or TTL expiry.

Default host policy:

- 10 configured slots: `slot-01` through `slot-10`
- maximum 3 active leases
- 60-minute default TTL
- 1 CPU, 1536 MiB memory, 512 PIDs, and 512 MiB shared memory per container
- failed slot retention for 120 minutes, capped at 3 snapshots
- artifact retention for 24 hours, capped at 10 inactive artifacts
- 1536 MiB available-memory and 10 GiB available-disk host reserves

## Controller workflow

Set the configured SSH alias or target without committing it:

```bash
export PIBO_POOL_SSH_HOST=<configured-development-host>
```

Build the current checkout, upload the exact package archive by SHA-256, and acquire a lease:

```bash
scripts/deployment-pool-remote.sh acquire "$PIBO_SESSION_ID" medium 60
```

Other lifecycle commands:

```bash
scripts/deployment-pool-remote.sh status
scripts/deployment-pool-remote.sh doctor
scripts/deployment-pool-remote.sh renew <lease-id> "$PIBO_SESSION_ID" 60
scripts/deployment-pool-remote.sh release <lease-id> "$PIBO_SESSION_ID"
scripts/deployment-pool-remote.sh reap
scripts/deployment-pool-remote.sh reap --apply
```

The acquire result is the lease record. Persist its `id`, `slotId`, `publicUrl`, `expiresAt`, commit, and artifact digest in the caller's task state.

## Host workflow

The host wrapper loads `/etc/pibo-deployment-pool.env` and exposes the same commands:

```bash
pibo-pool status --json
pibo-pool doctor --json
pibo-pool acquire --holder <holder> --seed medium --ttl-minutes 60 \
  --commit <commit> --artifact <package.tgz> --json
pibo-pool renew <lease-id> --holder <holder> --ttl-minutes 60 --json
pibo-pool release <lease-id> --holder <holder> --json
pibo-pool reap --json
pibo-pool reap --apply --json
pibo-pool artifacts --json
```

Use `--runtime <installed-runtime-directory>` only for an already installed candidate. The pool hashes the complete `@pasko70/pibo` package tree so distinct installed builds receive distinct runtime identities. Package archives use the archive SHA-256 and are installed once into the content-addressed artifact cache.

## Seed modes

- `fresh`: operational and authentication configuration, Machine Auth records, and model credentials; no existing Pibo product databases.
- `medium`: selected configuration, contexts, skills, projects, and product databases.
- `full`: the broadest safe seed, excluding Better Auth sessions, previews, secrets, backups, tools, candidate packages, and editor runtime state.

Live SQLite databases are copied using SQLite online backup. Each lease receives separate home, Pi home, and workspace directories.

## Cleanup and recovery

The gateway Resource Reaper checks the pool when its registry exists. It expires overdue leases, removes labeled orphan containers, cleans dirty free slots, prunes expired or excess failure snapshots, and prunes inactive artifacts beyond retention limits.

Run a read-only plan before manual cleanup:

```bash
pibo-pool reap --json
```

Apply only the selected actions:

```bash
pibo-pool reap --apply --json
```

A failed acquisition returns the slot to `free`. When seed preparation had begun, its isolated home is retained under the failure root with `failure.json` until retention cleanup.

## DNS, TLS, and nginx activation

Let `POOL_BASE_HOST` be the hostname portion of `PIBO_COMPUTE_POOL_BASE_URL` and let `DEVELOPMENT_IPV4` be the stable public IPv4 address from the operator environment.

Create these public DNS records:

| Type | Name | Value |
| --- | --- | --- |
| `A` | `POOL_BASE_HOST` | `DEVELOPMENT_IPV4` |
| `A` | `*.POOL_BASE_HOST` | `DEVELOPMENT_IPV4` |

Do not publish an `AAAA` record unless the development host has a confirmed stable IPv6 address and inbound IPv6 HTTPS is configured. A transient or dynamically leased IPv6 address is not suitable.

Issue a certificate containing both names:

```text
POOL_BASE_HOST
*.POOL_BASE_HOST
```

A wildcard certificate requires DNS-01. Configure the DNS client's provider-specific API credential outside the repository, or delegate `_acme-challenge.POOL_BASE_HOST` with a CNAME to an automated challenge zone controlled by the certificate client. The resulting client must be able to create and delete TXT records at `_acme-challenge.POOL_BASE_HOST` unattended for renewal.

After DNS resolves and the certificate and key exist, rerun host setup with their absolute paths:

```bash
sudo -E \
  PIBO_COMPUTE_POOL_BASE_URL="https://${POOL_BASE_HOST}" \
  PIBO_POOL_RUNTIME_BINARY=<installed-pibo-binary> \
  PIBO_POOL_TLS_CERTIFICATE=<wildcard-fullchain-path> \
  PIBO_POOL_TLS_CERTIFICATE_KEY=<wildcard-private-key-path> \
  scripts/deployment-pool-host-setup.sh --apply --restart-gateway
```

The setup script writes fixed nginx mappings for all configured slots, validates nginx, and reloads it. It must not be given TLS paths until DNS and the certificate are ready.

## Google OAuth registration

Register one exact redirect URI per fixed slot:

```bash
for index in $(seq -w 1 10); do
  printf 'https://slot-%s.%s/api/auth/callback/google\n' "$index" "$POOL_BASE_HOST"
done
```

If the Google client configuration also uses authorized JavaScript origins, register:

```bash
for index in $(seq -w 1 10); do
  printf 'https://slot-%s.%s\n' "$index" "$POOL_BASE_HOST"
done
```

Do not register wildcard OAuth callback URIs; Google requires exact redirect URIs.

## Acceptance checks

1. `pibo-pool doctor --json` reports the runtime image and seed source as available.
2. Three concurrent leases become `ready`; a fourth acquisition reports capacity and nearest expiry.
3. Machine Auth returns HTTP 200 for each active slot and an unauthenticated bootstrap returns HTTP 401.
4. `fresh`, `medium`, and `full` expose their expected data volumes without sharing mutations.
5. A model turn produces live SSE frames and a final assistant message.
6. Renew updates expiry; explicit release removes the container and isolated active data.
7. An expired lease is removed by the Resource Reaper.
8. A labeled orphan is selected by dry-run and removed by apply.
9. Public HTTPS has a valid wildcard certificate, Google OAuth completes on a slot callback, and a headful browser can use Chat Web.
10. The canonical development instance remains healthy before and after pool activity.

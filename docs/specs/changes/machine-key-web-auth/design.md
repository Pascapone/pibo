# Design: Machine-key Web authentication

**Status:** Draft
**Created:** 2026-08-07

## Architecture

Machine auth composes inside `createBetterAuthService` rather than creating a second registered auth service. `PiboAuthService` remains the only request-auth boundary:

1. inspect `X-Pibo-Machine-Key`;
2. if a valid active machine record matches, return its Pibo identity;
3. otherwise continue through Better Auth's Google/session-token path.

This preserves the plugin registry invariant of one auth service and avoids changing every Web app.

## Token and record

Token format:

```text
pibo_mk_<16 lowercase hex key id>_<32 random bytes encoded base64url>
```

Record format:

```json
{
  "id": "...",
  "label": "...",
  "hash": "64 lowercase hex characters",
  "identity": {
    "userId": "existing Better Auth user id",
    "email": "allowed account email",
    "name": "optional",
    "provider": "machine-key"
  },
  "createdAt": "ISO timestamp",
  "expiresAt": "optional ISO timestamp",
  "revokedAt": "optional ISO timestamp"
}
```

The full token is hashed with SHA-256. Because the token has 256 random bits, a stolen hash file does not create a practical dictionary-attack concern. SHA-256 avoids adding an expensive password KDF to every Chat API and SSE request.

## Store and hot reload

Default store: `$PIBO_HOME/machine-keys.json`.

The authenticator caches records and checks file modification metadata on requests. Atomic writes replace the file; changed metadata triggers reload, so import and revocation take effect without gateway restart.

## Provisioning

1. On the server, look up an existing identity by allowed email.
2. On the controller, generate a key and two files: raw secret and hash-only record.
3. Import only the record on the server over SSH.
4. Keep the raw secret in a controller root-only credential path.
5. Verify valid and invalid requests.
6. Inject the header through CDP or a purpose-built local browser launcher.

The CLI never prints the raw token.

## Browser usage

A normal browser page cannot set a custom header for all fetch/EventSource requests without code changes. Automation therefore uses CDP request interception or a local extension/profile that injects the header only for the configured HTTPS origin. Pibo's shipped Web bundle remains credential-free.

## Alternatives rejected

- **Public local auth:** intentionally unsafe and violates the loopback gate.
- **Human cookie copying:** difficult to revoke independently and conflates human/machine activity.
- **Better Auth API-key plugin:** unavailable in the repository's pinned Better Auth 1.6.9 export surface; upgrading auth dependencies is a separate risk.
- **Password KDF per request:** unnecessary for a uniformly random 256-bit secret and harmful to streaming/UI request latency.

# Spec: Machine-key Web authentication

**Status:** Draft
**Created:** 2026-08-07

## Requirement: Machine auth is additive and opt-in

The Better Auth service MUST continue to accept existing Google sessions. Machine auth MUST be inactive when no machine-key records exist and MUST NOT enable public local-auth mode.

### Acceptance

A request without the machine header follows the existing Better Auth path, and existing auth tests remain green.

## Requirement: Server records contain no raw secret

A generated key MUST contain at least 256 random bits. The server record MUST contain only an identifier, SHA-256 hash, label, identity, creation metadata, optional expiration, and optional revocation metadata.

### Acceptance

The generated token does not occur in serialized record or list output, and the stored digest is 32 bytes represented as hexadecimal.

## Requirement: Verification is bounded and constant-time

The authenticator MUST parse a versioned token format, select one record by key identifier, hash the complete presented token, and compare equal-length digest buffers with `timingSafeEqual`.

### Acceptance

Valid keys authenticate; malformed and invalid keys do not. Verification does not linearly compare every stored key.

## Requirement: Machine identity maps to a Pibo identity

Each record MUST contain the existing Pibo `userId` and MAY include email, name, and image. Authenticated requests MUST receive that identity with provider `machine-key` and a key-specific session identifier.

### Acceptance

Chat bootstrap returns the same user-scoped data as the linked human identity.

## Requirement: Expiration and revocation are enforced

An expired record or a record with `revokedAt` MUST NOT authenticate. Store changes MUST become effective without replacing the gateway process.

### Acceptance

Tests change an active record to expired or revoked and the same authenticator rejects it after the store file update.

## Requirement: Raw credentials use a request header

The raw key MUST be accepted only from `X-Pibo-Machine-Key`. Pibo MUST NOT accept the raw key from query strings, cookies, or request bodies.

### Acceptance

A query parameter containing a valid token does not authenticate.

## Requirement: Browser sessions are short-lived and key-backed

`POST /api/auth/machine-session` MUST exchange a valid machine-key header for a signed host-only cookie. The cookie MUST be `HttpOnly`, `Secure`, `SameSite=Strict`, limited to eight hours or the earlier key expiration, and contain no raw API key. Public non-HTTPS exchange requests MUST be rejected.

Every cookie-authenticated request MUST re-check that the referenced key still exists, is active, and remains linked to an allowed email. Revoking a key MUST therefore invalidate its existing browser cookies without restarting the gateway.

### Acceptance

A valid exchange returns a no-store response and cookie, that cookie authenticates without the raw key, tampering fails, expiration fails, and key revocation makes the same cookie fail.

## Requirement: Operator tooling is progressively discoverable

`pibo auth` MUST point to `pibo auth machine-key`; that area MUST expose focused commands for identity lookup, generation, import, list, and revoke. Generation MUST require explicit root-only secret and record output paths and MUST not print the token.

### Acceptance

Help/discovery output remains concise, list output contains no hash or token, and generated secret files use mode `0600`.

## Constraints

- Header transport requires TLS outside loopback.
- Raw keys must not be committed, logged, embedded in browser bundles, or placed in URLs.
- Import must reject malformed records, duplicate IDs, raw-token fields, and non-machine providers.
- Store writes must be atomic and mode `0600`.

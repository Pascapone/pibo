---
type: "Specification"
title: "Web, Machine, Local, and Development Authentication"
description: "Defines the implemented web, machine, local, and development authentication contract and its current ownership, security, and verification boundaries."
tags: ["security", "trust-boundaries"]
status: "stable"
authority: "normative"
generated:
  by: "openai/codex"
  at: "2026-08-30T08:51:56Z"
sources:
  - resource: "scope:Current implementation and tests at traceability.commit"
    title: "Source and test evidence inspected for SPC-SEC-001"
implementation:
  state: "current"
  baseline_commit: "38bb6e57f118c1543e7263c68d27e5103d3b1262"
  package: "WP-03-RESOURCES-SECURITY"
  source_evidence: "performed"
  focused_test_execution: "performed: 383 passed, 2 baseline failures in local-auth.test.mjs"
  build_and_typecheck_execution: "performed: npm run typecheck and npm run build passed"
traceability:
  commit: "38bb6e57f118c1543e7263c68d27e5103d3b1262"
  requirements:
    - id: "SEC-AUTH-001"
      status: "implemented"
      sources:
        - path: "src/auth/better-auth.ts"
          symbol: "createTrustedOrigins"
        - path: "src/auth/better-auth.ts"
          symbol: "createBetterAuthService"
        - path: "src/web/auth.ts"
          symbol: "requireWebSession"
        - path: "src/plugins/better-auth.ts"
          symbol: "createPiboBetterAuthPlugin"
      tests:
        - path: "test/better-auth-config.test.mjs"
          name: "better auth requires an allowed email allowlist"
        - path: "test/better-auth-config.test.mjs"
          name: "better auth requires a strong secret"
        - path: "test/better-auth-config.test.mjs"
          name: "better auth trusts loopback aliases for the configured base URL"
        - path: "test/web-auth-app-context.test.mjs"
          name: "web auth still gates unauthenticated app requests"
        - path: "test/web-auth-app-context.test.mjs"
          name: "web auth maps different identities to the same app context context"
        - path: "test/machine-key-auth.test.mjs"
          name: "Better Auth service rejects a valid machine key linked to a disallowed email"
      public:
        - "/api/auth route family and authenticated App Context session"
        - "pibo auth machine-key generate/import/list/revoke and machine-session exchange"
        - "auth.sqlite, machine-keys.json, and signed machine-session cookie"
        - "Google OAuth/Bearer sessions with allowed-email gate and trusted origins protect all App Context web surfaces."
        - "CLI generates/imports/lists/revokes hashed machine keys; short machine-session cookies bridge approved clients; local dev auth supports loopback workers/VS Code."
      failures:
        - "Secret length, allowlist, trusted origins, secure cookies/bearer, timing-safe hashes, HTTPS outside loopback, auth-only repair checks, backup/rollback, and public-bind refusal."
        - "Secret >=32 chars, email allowlist, trusted origins, secure cookies/bearer handling, and no tenant partition inference."
        - "Timing-safe hash comparison, private files, HTTPS outside loopback, allowed-email identity, and worker-only dev mode."
      confidence: "high"
    - id: "SEC-AUTH-002"
      status: "implemented"
      sources:
        - path: "src/auth/better-auth.ts"
          symbol: "recoverBetterAuthSqliteDatabase"
        - path: "src/auth/better-auth.ts"
          symbol: "createBetterAuthService"
      tests:
        - path: "test/better-auth-sqlite-migration.test.mjs"
          name: "Pibo repairs deterministic required Better Auth columns without losing rows"
        - path: "test/better-auth-sqlite-migration.test.mjs"
          name: "Pibo backs up and replaces an auth schema that cannot be repaired safely"
        - path: "test/better-auth-sqlite-migration.test.mjs"
          name: "Pibo refuses destructive recovery when the configured database contains non-auth tables"
        - path: "test/better-auth-sqlite-migration.test.mjs"
          name: "Pibo restores the original auth database when fresh-schema recovery fails"
      public:
        - "/api/auth route family and authenticated App Context session"
        - "pibo auth machine-key generate/import/list/revoke and machine-session exchange"
        - "auth.sqlite, machine-keys.json, and signed machine-session cookie"
        - "Google OAuth/Bearer sessions with allowed-email gate and trusted origins protect all App Context web surfaces."
        - "CLI generates/imports/lists/revokes hashed machine keys; short machine-session cookies bridge approved clients; local dev auth supports loopback workers/VS Code."
      failures:
        - "Secret length, allowlist, trusted origins, secure cookies/bearer, timing-safe hashes, HTTPS outside loopback, auth-only repair checks, backup/rollback, and public-bind refusal."
        - "Secret >=32 chars, email allowlist, trusted origins, secure cookies/bearer handling, and no tenant partition inference."
        - "Timing-safe hash comparison, private files, HTTPS outside loopback, allowed-email identity, and worker-only dev mode."
      confidence: "high"
    - id: "SEC-AUTH-003"
      status: "implemented"
      sources:
        - path: "src/auth/machine-keys.ts"
          symbol: "generateMachineKey"
        - path: "src/auth/machine-keys.ts"
          symbol: "importMachineKeyRecord"
        - path: "src/auth/machine-keys.ts"
          symbol: "listMachineKeys"
        - path: "src/auth/machine-keys.ts"
          symbol: "revokeMachineKey"
        - path: "src/auth/machine-keys.ts"
          symbol: "createMachineKeyAuthenticator"
        - path: "src/auth/machine-session.ts"
          symbol: "createMachineSessionManager"
        - path: "src/auth/cli.ts"
          symbol: "runAuthCli"
      tests:
        - path: "test/machine-key-auth.test.mjs"
          name: "machine-key generation keeps the raw secret out of the record"
        - path: "test/machine-key-auth.test.mjs"
          name: "machine-key store imports private records and lists only redacted metadata"
        - path: "test/machine-key-auth.test.mjs"
          name: "machine-key authenticator hot-reloads expiration and revocation"
        - path: "test/machine-key-auth.test.mjs"
          name: "machine-key import rejects duplicate ids and raw-secret fields"
        - path: "test/machine-session.test.mjs"
          name: "machine session cookie is signed, secure, short-lived, and contains no raw API key"
        - path: "test/machine-session.test.mjs"
          name: "machine session cookie rejects tampering and becomes invalid when its key is revoked"
        - path: "test/machine-session.test.mjs"
          name: "machine session exchange rejects invalid keys and public plain HTTP"
        - path: "test/machine-key-auth-cli.test.mjs"
          name: "machine-key CLI resolves, generates, imports, lists, and revokes without leaking the token"
      public:
        - "/api/auth route family and authenticated App Context session"
        - "pibo auth machine-key generate/import/list/revoke and machine-session exchange"
        - "auth.sqlite, machine-keys.json, and signed machine-session cookie"
        - "Google OAuth/Bearer sessions with allowed-email gate and trusted origins protect all App Context web surfaces."
        - "CLI generates/imports/lists/revokes hashed machine keys; short machine-session cookies bridge approved clients; local dev auth supports loopback workers/VS Code."
      failures:
        - "Secret length, allowlist, trusted origins, secure cookies/bearer, timing-safe hashes, HTTPS outside loopback, auth-only repair checks, backup/rollback, and public-bind refusal."
        - "Secret >=32 chars, email allowlist, trusted origins, secure cookies/bearer handling, and no tenant partition inference."
        - "Timing-safe hash comparison, private files, HTTPS outside loopback, allowed-email identity, and worker-only dev mode."
      confidence: "high"
    - id: "SEC-AUTH-004"
      status: "implemented"
      sources:
        - path: "src/plugins/dev-auth.ts"
          symbol: "isLoopbackDevAuthRequest"
        - path: "src/plugins/dev-auth.ts"
          symbol: "isTrustedLocalSocketPeerForDevAuth"
        - path: "src/plugins/dev-auth.ts"
          symbol: "createDevAuthService"
        - path: "src/gateway/web.ts"
          symbol: "resolveWebGatewayAuthMode"
        - path: "src/cli.ts"
          symbol: "isLoopbackBindForCli"
        - path: "src/cli.ts"
          symbol: "isComputeWorkerRuntimeForCli"
      tests:
        - path: "test/dev-auth.test.mjs"
          name: "getSession accepts Docker bridge callers only inside compute workers"
        - path: "test/dev-auth.test.mjs"
          name: "getSession rejects callers when the socket peer header is missing"
        - path: "test/dev-auth.test.mjs"
          name: "dev auth rejects non-loopback socket peer even when host headers are loopback"
        - path: "test/local-auth.test.mjs"
          name: "three safety layers reject a public reverse proxy that rewrites both headers"
        - path: "test/local-auth.test.mjs"
          name: "authMode=local with --web-host=0.0.0.0 fails closed"
      public:
        - "/api/auth route family and authenticated App Context session"
        - "pibo auth machine-key generate/import/list/revoke and machine-session exchange"
        - "auth.sqlite, machine-keys.json, and signed machine-session cookie"
        - "Google OAuth/Bearer sessions with allowed-email gate and trusted origins protect all App Context web surfaces."
        - "CLI generates/imports/lists/revokes hashed machine keys; short machine-session cookies bridge approved clients; local dev auth supports loopback workers/VS Code."
      failures:
        - "Secret length, allowlist, trusted origins, secure cookies/bearer, timing-safe hashes, HTTPS outside loopback, auth-only repair checks, backup/rollback, and public-bind refusal."
        - "Secret >=32 chars, email allowlist, trusted origins, secure cookies/bearer handling, and no tenant partition inference."
        - "Timing-safe hash comparison, private files, HTTPS outside loopback, allowed-email identity, and worker-only dev mode."
      confidence: "high"
verification:
  required_evidence_classes:
    - "source inspection"
    - "focused tests"
    - "build/package checks"
    - "external-provider/Pibo2 acceptance"
  performed:
    - evidence_class: "source inspection"
      status: "performed"
      detail: "Exact source files, symbols, test files, and test names were reconciled to Foundation commit 38bb6e57f118c1543e7263c68d27e5103d3b1262."
    - evidence_class: "focused tests"
      status: "performed_with_baseline_failures"
      detail: "Exact parent/candidate inventory ran in the same fresh isolated worker: 385 tests, 383 passed, and 2 identical local-auth baseline assertions failed; no source or test files were changed."
    - evidence_class: "build/package checks"
      status: "performed"
      detail: "npm run typecheck and npm run build passed; build emitted existing Vite chunk-size warnings only."
  unperformed:
    - evidence_class: "local real-path/PTY/headful browser validation"
      status: "unperformed"
      reason: "No browser, PTY, or real-path acceptance flow was performed for this package."
    - evidence_class: "external-provider/Pibo2 acceptance"
      status: "unperformed"
      reason: "No real provider, external MCP, package-manager, host lifecycle, or Pibo2 acceptance was performed."
stale_claims_to_reject:
  - id: "WP03-STALE-001"
    claim: "Development auth alone prevents public binding."
    reason: "Dev auth validates request trust; public-bind refusal is gateway/CLI host mechanics under GW-003."
open_evidence_gaps:
  - id: "WP03-GAP-005"
    specs: ["SPC-SEC-001", "SPC-SEC-002"]
    gap: "Direct Windows Better Auth recovery, ACL, symlink/reparse-point, and machine-session validation remains unperformed."
  - id: "WP03-GAP-009"
    specs: ["SPC-RES-001", "SPC-RES-002", "SPC-RES-003", "SPC-RES-004", "SPC-RES-005", "SPC-SEC-001", "SPC-SEC-002", "SPC-SEC-003"]
    gap: "Canonical synthesis and this read-only brief executed no focused tests, build/package checks, real paths, browser flows, or external/Pibo2 acceptance."
---

# Scope and exclusions

Better Auth Google/bearer access, email allowlist, trusted origins, guarded SQLite repair, machine keys, signed machine sessions, loopback local fallback, and worker-only dev auth.

This specification records current behavior only. It does not authorize unimplemented hardening, duplicate the linked runtime/gateway/data owner, or convert unperformed validation into evidence.

# Current behavior and public surfaces

The implementation state is current at the exact accepted Foundation traceability commit `38bb6e57f118c1543e7263c68d27e5103d3b1262`.

Implemented behavior:
- "/api/auth route family and authenticated App Context session"
- "pibo auth machine-key generate/import/list/revoke and machine-session exchange"
- "auth.sqlite, machine-keys.json, and signed machine-session cookie"
- "Google OAuth/Bearer sessions with allowed-email gate and trusted origins protect all App Context web surfaces."
- "CLI generates/imports/lists/revokes hashed machine keys; short machine-session cookies bridge approved clients; local dev auth supports loopback workers/VS Code."
- "Better Auth requires a base URL, strong secret, provider configuration, and nonempty email allowlist; trusted origins include configured values, the base origin, and loopback aliases only for a loopback base."
- "Auth maps every allowed identity to one App Context and composes machine identity before Google sessions; there are no per-user product partitions."
- "Auth SQLite repair adds deterministic required columns transactionally; destructive replacement is allowed only for an auth-only database with protected backup and rollback."
- "Machine keys store hashes and redacted metadata, hot-reload revocation/expiry, and exchange for signed HttpOnly Secure SameSite=Strict short-lived cookies over HTTPS except true loopback."
- "Local/dev auth requires trusted host and socket-peer evidence; Docker bridge callers are accepted only inside compute-worker runtime."

Public surfaces:
- "/api/auth route family and authenticated App Context session"
- "pibo auth machine-key generate/import/list/revoke and machine-session exchange"
- "auth.sqlite, machine-keys.json, and signed machine-session cookie"
- "Google OAuth/Bearer sessions with allowed-email gate and trusted origins protect all App Context web surfaces."
- "CLI generates/imports/lists/revokes hashed machine keys; short machine-session cookies bridge approved clients; local dev auth supports loopback workers/VS Code."

# State, lifecycle, and invariants

- "Authentication grants access to one App Context and never partitions product data; raw machine tokens display only on creation/import."
- "Auth DB recovery backs up and replaces only auth-only databases; outside-loopback machine exchange requires HTTPS."
- "Raw machine tokens display only at creation/import; revoked/expired keys fail; dev auth cannot bind publicly."
- "Raw machine token material is returned only at generation boundaries or written to explicit private output; stores, lists, cookies, and imported records contain no raw token field."
- "Machine-session tampering, key revocation/expiry, disallowed identity, public plaintext exchange, missing socket-peer evidence, and public bind attempts fail closed."
- "Shared/non-auth database tables prohibit destructive auth recovery."
- "Direct Windows auth-database recovery validation remains unperformed."

Persistence and lifecycle state: auth.sqlite and protected recovery backups. machine-keys.json; signed in-memory/cookie session state.

# Requirements and invariants

## Requirement: SEC-AUTH-001: Authenticate Better Auth Google/bearer or machine identities only when provider configuration, trusted origin, session validity, and allowed-email policy pass, then map allowed identities to the single App Context

Authenticate Better Auth Google/bearer or machine identities only when provider configuration, trusted origin, session validity, and allowed-email policy pass, then map allowed identities to the single App Context.

**Implementation state:** `implemented_at_baseline` at `38bb6e57f118c1543e7263c68d27e5103d3b1262`.

**Confidence:** `high`. Confidence describes source/test trace quality, not a claim that the package validation suite has passed.

**Source traceability:**
- `src/auth/better-auth.ts` — `createTrustedOrigins`
- `src/auth/better-auth.ts` — `createBetterAuthService`
- `src/web/auth.ts` — `requireWebSession`
- `src/plugins/better-auth.ts` — `createPiboBetterAuthPlugin`

**Named test traceability:**
- `test/better-auth-config.test.mjs` — `better auth requires an allowed email allowlist`
- `test/better-auth-config.test.mjs` — `better auth requires a strong secret`
- `test/better-auth-config.test.mjs` — `better auth trusts loopback aliases for the configured base URL`
- `test/web-auth-app-context.test.mjs` — `web auth still gates unauthenticated app requests`
- `test/web-auth-app-context.test.mjs` — `web auth maps different identities to the same app context context`
- `test/machine-key-auth.test.mjs` — `Better Auth service rejects a valid machine key linked to a disallowed email`

**Acceptance boundary:** The named source and test records are exact regular-file evidence records. Their presence does not mean the named test ran in this package execution.


## Requirement: SEC-AUTH-002: Repair deterministic required Better Auth columns transactionally and permit backup/replacement only for an auth-only database, restoring the original if fresh-schema recovery fails

Repair deterministic required Better Auth columns transactionally and permit backup/replacement only for an auth-only database, restoring the original if fresh-schema recovery fails.

**Implementation state:** `implemented_at_baseline; direct Windows evidence gap` at `38bb6e57f118c1543e7263c68d27e5103d3b1262`.

**Confidence:** `high`. Confidence describes source/test trace quality, not a claim that the package validation suite has passed.

**Source traceability:**
- `src/auth/better-auth.ts` — `recoverBetterAuthSqliteDatabase`
- `src/auth/better-auth.ts` — `createBetterAuthService`

**Named test traceability:**
- `test/better-auth-sqlite-migration.test.mjs` — `Pibo repairs deterministic required Better Auth columns without losing rows`
- `test/better-auth-sqlite-migration.test.mjs` — `Pibo backs up and replaces an auth schema that cannot be repaired safely`
- `test/better-auth-sqlite-migration.test.mjs` — `Pibo refuses destructive recovery when the configured database contains non-auth tables`
- `test/better-auth-sqlite-migration.test.mjs` — `Pibo restores the original auth database when fresh-schema recovery fails`

**Acceptance boundary:** The named source and test records are exact regular-file evidence records. Their presence does not mean the named test ran in this package execution.


## Requirement: SEC-AUTH-003: Generate, import, hash, protect, list-redacted, revoke, expire, hot-reload, and authenticate machine keys; exchange valid keys for signed, bounded, secure machine-session cookies without embedding the raw key

Generate, import, hash, protect, list-redacted, revoke, expire, hot-reload, and authenticate machine keys; exchange valid keys for signed, bounded, secure machine-session cookies without embedding the raw key.

**Implementation state:** `implemented_at_baseline` at `38bb6e57f118c1543e7263c68d27e5103d3b1262`.

**Confidence:** `high`. Confidence describes source/test trace quality, not a claim that the package validation suite has passed.

**Source traceability:**
- `src/auth/machine-keys.ts` — `generateMachineKey`
- `src/auth/machine-keys.ts` — `importMachineKeyRecord`
- `src/auth/machine-keys.ts` — `listMachineKeys`
- `src/auth/machine-keys.ts` — `revokeMachineKey`
- `src/auth/machine-keys.ts` — `createMachineKeyAuthenticator`
- `src/auth/machine-session.ts` — `createMachineSessionManager`
- `src/auth/cli.ts` — `runAuthCli`

**Named test traceability:**
- `test/machine-key-auth.test.mjs` — `machine-key generation keeps the raw secret out of the record`
- `test/machine-key-auth.test.mjs` — `machine-key store imports private records and lists only redacted metadata`
- `test/machine-key-auth.test.mjs` — `machine-key authenticator hot-reloads expiration and revocation`
- `test/machine-key-auth.test.mjs` — `machine-key import rejects duplicate ids and raw-secret fields`
- `test/machine-session.test.mjs` — `machine session cookie is signed, secure, short-lived, and contains no raw API key`
- `test/machine-session.test.mjs` — `machine session cookie rejects tampering and becomes invalid when its key is revoked`
- `test/machine-session.test.mjs` — `machine session exchange rejects invalid keys and public plain HTTP`
- `test/machine-key-auth-cli.test.mjs` — `machine-key CLI resolves, generates, imports, lists, and revokes without leaking the token`

**Acceptance boundary:** The named source and test records are exact regular-file evidence records. Their presence does not mean the named test ran in this package execution.


## Requirement: SEC-AUTH-004: Permit local/dev fallback only when host and socket-peer evidence is trusted loopback, allow Docker bridge peers only in compute workers, and reject public bind, forwarded-public, mapped-public, or missing-peer cases

Permit local/dev fallback only when host and socket-peer evidence is trusted loopback, allow Docker bridge peers only in compute workers, and reject public bind, forwarded-public, mapped-public, or missing-peer cases.

**Implementation state:** `implemented_at_baseline_with_GW_003_bind_mechanics` at `38bb6e57f118c1543e7263c68d27e5103d3b1262`.

**Confidence:** `high`. Confidence describes source/test trace quality, not a claim that the package validation suite has passed.

**Source traceability:**
- `src/plugins/dev-auth.ts` — `isLoopbackDevAuthRequest`
- `src/plugins/dev-auth.ts` — `isTrustedLocalSocketPeerForDevAuth`
- `src/plugins/dev-auth.ts` — `createDevAuthService`
- `src/gateway/web.ts` — `resolveWebGatewayAuthMode`
- `src/cli.ts` — `isLoopbackBindForCli`
- `src/cli.ts` — `isComputeWorkerRuntimeForCli`

**Named test traceability:**
- `test/dev-auth.test.mjs` — `getSession accepts Docker bridge callers only inside compute workers`
- `test/dev-auth.test.mjs` — `getSession rejects callers when the socket peer header is missing`
- `test/dev-auth.test.mjs` — `dev auth rejects non-loopback socket peer even when host headers are loopback`
- `test/local-auth.test.mjs` — `three safety layers reject a public reverse proxy that rewrites both headers`
- `test/local-auth.test.mjs` — `authMode=local with --web-host=0.0.0.0 fails closed`

**Acceptance boundary:** The named source and test records are exact regular-file evidence records. Their presence does not mean the named test ran in this package execution.


# Interfaces and ownership

Capability IDs: "pibo.security.web-auth", "pibo.security.machine-local".

Exact source files inspected for this owner:
- "src/auth/better-auth.ts"
- "src/auth/cli.ts"
- "src/auth/machine-keys.ts"
- "src/auth/machine-session.ts"
- "src/cli.ts"
- "src/gateway/web.ts"
- "src/plugins/better-auth.ts"
- "src/plugins/dev-auth.ts"
- "src/web/auth.ts"

Related ownership boundaries:
- SPC-PROD-001: [app-context.md](/specs/product/app-context.md) owns the linked contract; this specification does not duplicate it.
- SPC-GW-003: [web-host-and-channel.md](/specs/gateway/web-host-and-channel.md) owns the linked contract; this specification does not duplicate it.
- SPC-SEC-002: [private-files-and-http.md](/specs/security/private-files-and-http.md) owns the linked contract; this specification does not duplicate it.

The security policy/mechanics split is explicit: this specification defines the resource or security decision, while linked runtime, gateway, data, web, orchestration, compute, and operator owners provide their execution mechanics.

# Failure, security, privacy, and compatibility behavior

- "Secret length, allowlist, trusted origins, secure cookies/bearer, timing-safe hashes, HTTPS outside loopback, auth-only repair checks, backup/rollback, and public-bind refusal."
- "Secret >=32 chars, email allowlist, trusted origins, secure cookies/bearer handling, and no tenant partition inference."
- "Timing-safe hash comparison, private files, HTTPS outside loopback, allowed-email identity, and worker-only dev mode."

Compatibility and privacy limits:
- "Raw machine token material is returned only at generation boundaries or written to explicit private output; stores, lists, cookies, and imported records contain no raw token field."
- "Machine-session tampering, key revocation/expiry, disallowed identity, public plaintext exchange, missing socket-peer evidence, and public bind attempts fail closed."
- "Shared/non-auth database tables prohibit destructive auth recovery."
- "Direct Windows auth-database recovery validation remains unperformed."

# Known limits and rejected stale claims

The following over-broad claims are rejected and must not be inferred from this specification:

- **Rejected claim:** Development auth alone prevents public binding. — Dev auth validates request trust; public-bind refusal is gateway/CLI host mechanics under GW-003.

Open evidence gaps carried forward:
- `WP03-GAP-005` — Direct Windows Better Auth recovery, ACL, symlink/reparse-point, and machine-session validation remains unperformed.
- `WP03-GAP-009` — Canonical synthesis and this read-only brief executed no focused tests, build/package checks, real paths, browser flows, or external/Pibo2 acceptance.

# Verification and traceability

All requirement traceability records use exact repository-relative regular files at `38bb6e57f118c1543e7263c68d27e5103d3b1262`. The brief and synthesis were generated from a stale baseline, so this package deliberately rebinds operational authority to `38bb6e57f118c1543e7263c68d27e5103d3b1262`.

Performed evidence:
- Source inspection: performed. Exact source paths, symbols, test paths, test names, ownership seams, and the accepted parent commit were checked.

Additional unperformed evidence:
- No browser, real provider, external MCP, real Pi package, Windows ACL/auth-recovery, real-host/systemd/pressure/restart, or Pibo2 evidence is claimed.

Package commands after authoring:
- `npm run typecheck` — passed
- `npm run build` — passed, with existing Vite chunk-size warnings
- Exact focused test inventory from the WP-03 brief — 385 tests: 383 passed and 2 identical local-auth baseline failures in exact parent/candidate runs
- Foundation validator/authoring suite — 82 passed

# Related concepts

- [SPC-PROD-001](/specs/product/app-context.md)
- [SPC-GW-003](/specs/gateway/web-host-and-channel.md)
- [SPC-SEC-002](/specs/security/private-files-and-http.md)

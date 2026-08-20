# Windows Better Auth Direct Validation Plan

**Status:** Ready; waiting for the previously authorized Windows Server host to be started.

## Goal

Prove the Better Auth SQLite recovery path through the actual packed/global Windows installation shape and NTFS, including the exact startup command reported by the user.

## Preconditions

- Use a disposable or explicitly test-only Windows Server/Windows 11 host on NTFS.
- Use the checksum-verified integrated package, not a registry package with unknown contents.
- Keep the dedicated SSH key private and readable only by its owner.
- Install a supported Node.js release and npm.
- Do not copy production auth databases, cookies, OAuth records, API keys, or machine credentials to the host.

## Artifact

Use the integrated archive built from commit `e0fd14fb8c050c28cb7c9d7096317482d211edff`:

```text
pasko70-pibo-1.7.2.tgz
SHA-256 63f5af4f364755da9c6cc10e6fd62287308cf72ad10f180639c0d7959643b8aa
```

Verify the checksum on Windows before installation:

```powershell
(Get-FileHash .\pasko70-pibo-1.7.2.tgz -Algorithm SHA256).Hash.ToLowerInvariant()
```

## Validation sequence

### 1. Packed installation

Install into an isolated prefix first, then repeat with the global npm shape used by the reported failure.

```powershell
$ErrorActionPreference = "Stop"
$Root = Join-Path $env:TEMP ("pibo-auth-validation-" + [guid]::NewGuid().ToString("N"))
$Prefix = Join-Path $Root "prefix"
$Home = Join-Path $Root "home"
New-Item -ItemType Directory -Force -Path $Prefix, $Home | Out-Null
npm install --ignore-scripts --prefix $Prefix .\pasko70-pibo-1.7.2.tgz
$env:PIBO_HOME = $Home
```

Acceptance:

- the installed Pibo package starts from the isolated prefix;
- Pi Coding Agent resolves to `0.84.2`;
- Better Auth resolves exactly to `1.6.30`;
- `npm audit --omit=dev` reports zero advisories;
- MDX Editor is absent from the production installation.

### 2. Safe populated-schema repair

Create a test-only Better Auth SQLite database with a populated legacy `user` table that has valid identity fields but lacks required `updatedAt`.

Start the packed gateway:

```powershell
& "$Prefix\node_modules\.bin\pibo.cmd" gateway:web --web-host 127.0.0.1 --web-port 3700 --gateway-port 3701
```

Acceptance:

- startup reaches HTTP readiness instead of throwing `Cannot add a NOT NULL column with default value NULL`;
- the existing identity row remains present;
- `updatedAt` is non-NULL;
- no recovery backup is created;
- a second start is idempotent.

Do not print row contents during validation.

### 3. Unsafe auth-only recovery

Create a test-only populated `user` table missing a required identity field such as `email`, plus an unrelated sentinel table in a separate product database.

Acceptance:

- startup creates one protected backup and replaces only the configured Better Auth database;
- the backup filename contains no colon and is valid on Windows;
- the original schema/row remains in the backup;
- the unrelated sentinel remains unchanged;
- the replacement has the current Better Auth schema;
- SQLite integrity checks return `ok` for original backup and replacement;
- the warning contains bounded recovery guidance and no row values or credentials;
- a second start creates no additional backup.

### 4. NTFS access-control proof

Inspect the recovery backup with `Get-Acl` and `icacls` without printing database contents.

Acceptance:

- the current Administrator and `SYSTEM` retain required access;
- no `Everyone`, `Users`, `Authenticated Users`, or anonymous principal receives an allow rule granting read, modify, or full control;
- the backup is not writable by an unrelated standard user;
- ACL inheritance behavior is recorded exactly rather than inferred from POSIX modes.

### 5. Rollback on fresh-schema failure

Run the exported recovery helper with deterministic fresh-schema failure injection after the replacement has begun.

Acceptance:

- the failed replacement is closed and removed;
- the original database is restored byte-for-byte or by verified schema/row checks;
- the partial replacement table is absent;
- the protected backup remains;
- the surfaced error states that the original database was restored;
- no row values or credentials appear in output.

### 6. Global-install-shaped startup

Install the same checksum-verified archive globally on the disposable host:

```powershell
npm install --global .\pasko70-pibo-1.7.2.tgz
$env:PIBO_HOME = Join-Path $Root "global-home"
pibo gateway:web --web-port 3700
```

Acceptance:

- the exact command reaches readiness;
- public Chat shell and bootstrap return HTTP 200 on localhost;
- graceful Ctrl+C/SIGTERM-equivalent shutdown succeeds;
- restart is idempotent;
- no credentials, database contents, or complete environment are printed.

## Evidence to retain

- Windows edition and exact build number;
- Node/npm/Pibo/Pi/Better Auth versions;
- package SHA-256;
- scenario names and pass/fail status;
- backup basename, not database contents;
- sanitized ACL principal/rights summary;
- HTTP status and timing;
- SQLite integrity results;
- restart count and idempotence result.

Do not retain the SSH private key, OAuth files, cookies, database rows, authorization headers, machine keys, or complete process environments in the report.

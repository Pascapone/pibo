# Spec: Chat Web File Upload Storage

**Status:** Implemented
**Created:** 2026-08-20
**Source:** Pibo 2 security hardening
**Related docs:** `GLOSSARY.md`, `docs/specs/capabilities/web-auth-and-same-origin-host.md`, `docs/specs/capabilities/local-store-stewardship-and-canonical-data-boundaries.md`

## Why

Chat uploads can contain credentials, private documents, screenshots, and other sensitive user data. The upload store previously resolved only from the operating-system home and used default process permissions. On POSIX hosts this produced a `0755` directory and `0644` files, allowing unrelated local users to read uploaded private keys.

## Goal

Chat Web MUST store uploads inside the active Pibo Home and protect the upload directory and newly written files from unrelated local users.

## Scope

### In Scope

- Chat Web multipart uploads.
- Upload path selection from `PIBO_HOME`.
- POSIX directory and file permissions.
- Existing permissive upload-directory repair during Chat Web initialization.
- User-facing upload text for configured Pibo homes.

### Out of Scope

- Content classification or secret scanning.
- Encryption at rest.
- Upload retention and deletion policy.
- Workspace file downloads.
- Rewriting ACLs for arbitrary manually copied files.

## Requirements

### Requirement: Uploads follow the active Pibo Home

The upload directory MUST resolve to `$PIBO_HOME/uploads`, with `~/.pibo/uploads` only as the default when `PIBO_HOME` is unset.

#### Acceptance

- Distinct Pibo homes resolve distinct upload directories.
- A configured instance does not write uploads into another instance's default home.
- API responses continue to return the actual saved path.

### Requirement: POSIX upload storage is private

On POSIX hosts, Chat Web MUST create or repair the upload directory to mode `0700` and MUST create each uploaded file with mode `0600`.

#### Acceptance

- A pre-existing `0755` upload directory becomes `0700` during Chat Web initialization.
- New multipart upload files are `0600` even under a permissive process umask.
- Existing files are protected by the repaired `0700` directory boundary.

### Requirement: User-facing guidance reflects configured storage

CLI and Chat Web text MUST describe the configured Pibo uploads directory rather than claiming that every instance writes to `~/.pibo/uploads`.

#### Acceptance

- Terminal guidance names `$PIBO_HOME/uploads` and its default.
- Browser upload prompts use path-neutral configured-directory wording.

## Constraints

- **Compatibility:** Default installations still use `~/.pibo/uploads`.
- **Security:** Paths and file contents must not be logged as part of permission repair.
- **Windows:** Windows continues to rely on the user profile/Pibo Home NTFS ACL boundary; POSIX mode assertions do not substitute for direct NTFS validation.
- **Atomicity:** Existing exclusive filename allocation remains unchanged.

## Success Criteria

- [x] SC-001: Upload storage follows `PIBO_HOME`.
- [x] SC-002: POSIX upload directories are `0700`.
- [x] SC-003: POSIX uploaded files are `0600`.
- [x] SC-004: Existing default-path behavior remains compatible.
- [x] SC-005: User-facing guidance no longer hard-codes one instance path.

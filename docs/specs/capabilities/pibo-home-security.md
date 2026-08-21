# Spec: Private Pibo Home

**Status:** Implementing
**Created:** 2026-08-20
**Requester / Source:** Pibo V2 stabilization and security audit
**Related docs:** `docs/specs/capabilities/chat-web-file-upload.md`

## Why

Pibo Home contains conversation data, runtime events, authentication state, configuration secrets, uploaded files, generated credentials, and tool state. On POSIX hosts with a conventional `umask 022`, a fresh Pibo Home was created as `0755` and SQLite stores as `0644`. If the parent user home was traversable, another local account could read Pibo data.

## Goal

Pibo must establish Pibo Home as a private per-account storage boundary before product state is read or written.

## Scope

### In Scope

- Creating and tightening the configured Pibo Home.
- CLI and default core-store entry points.
- Private configuration-file modes.
- Compatibility with existing Pibo Home contents.

### Out of Scope

- Recursively rewriting permissions inside existing tool, browser, or package trees.
- Permission policy for explicitly configured state paths outside Pibo Home.
- Claiming Windows ACL behavior without direct Windows/NTFS validation.

## Requirements

### Requirement: Private POSIX root

On POSIX systems, Pibo MUST create Pibo Home as `0700` and MUST tighten an existing broader mode to `0700` before stateful CLI dispatch or default core-store initialization.

#### Acceptance

- A missing Pibo Home becomes a directory with mode `0700`.
- An existing `0755` Pibo Home becomes `0700` without deleting or rewriting its contents.
- A path occupied by a regular file fails with a clear error.

### Requirement: Discovery remains side-effect free

Root discovery, root help, and version output MUST NOT create Pibo Home.

### Requirement: Private configuration

On POSIX systems, Pibo configuration writes MUST create and retain mode `0600`, including when rewriting a pre-existing broader file mode.

### Requirement: Default non-CLI stores

Default Pibo data and reliability stores MUST establish the same private Pibo Home boundary when initialized directly rather than through the CLI.

### Requirement: Windows validation

Windows startup MUST preserve a user-private Pibo Home and configuration through inherited NTFS ACLs. This requirement remains unverified until exercised on an actual Windows/NTFS host; POSIX mode tests do not substitute for that evidence.

## Edge Cases

- `:memory:` SQLite stores do not create or modify Pibo Home.
- Explicit database paths outside Pibo Home do not cause unrelated parent directories to be chmodded.
- Existing files and nested directories are preserved.
- Symlink targets follow the host filesystem's normal permission semantics.

## Success Criteria

- [x] SC-001: Fresh and existing POSIX Pibo Home modes are deterministically tested.
- [x] SC-002: Stateful CLI and direct default-store paths are covered.
- [x] SC-003: Root discovery/version remain side-effect free.
- [x] SC-004: Configuration writes are `0600`, including rewrites.
- [ ] SC-005: Direct Windows/NTFS startup and ACL validation passes.

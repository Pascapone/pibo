---
type: "Specification"
title: "Pibo Home, Workspace, Configuration, and Prompts"
description: "Defines Pibo Home resolution and permissions, default workspace selection, supported configuration storage, and base/compaction prompt files."
tags: ["product", "pibo-home", "workspace", "configuration", "prompts"]
status: "stable"
authority: "normative"
generated:
  by: "openai/codex"
  at: "2026-09-01T20:42:35Z"
sources:
  - resource: "scope:Current implementation and tests at traceability.commit"
traceability:
  commit: "39090b8850758293e69380a52bb7498d7c955bc2"
  requirements:
    - id: "PROD-HOME-001"
      status: "implemented"
      sources:
        - path: "src/core/pibo-home.ts"
          symbol: "ensurePrivatePiboHome"
      tests:
        - path: "test/pibo-home-security.test.mjs"
          name: "ensurePrivatePiboHome tightens an existing directory"
      failures:
        - "A Pibo Home path that is a file is rejected; corrupt/unknown base-prompt state falls back to library mode."
        - "Pibo Home is mode 0700, rewritten configuration is mode 0600, and displayed secret keys are masked."
      confidence: "high"
    - id: "PROD-HOME-002"
      status: "implemented"
      sources:
        - path: "src/config/config.ts"
          symbol: "PIBO_CONFIG_KEYS"
        - path: "src/config/config.ts"
          symbol: "getDisplayPiboConfigValue"
      tests:
        - path: "test/config.test.mjs"
          name: "pibo config validates supported keys and auth secret length"
        - path: "test/config.test.mjs"
          name: "pibo config display masks secret keys"
      failures:
        - "A Pibo Home path that is a file is rejected; corrupt/unknown base-prompt state falls back to library mode."
        - "Pibo Home is mode 0700, rewritten configuration is mode 0600, and displayed secret keys are masked."
      confidence: "high"
    - id: "PROD-HOME-003"
      status: "implemented"
      sources:
        - path: "src/core/workspace.ts"
          symbol: "getDefaultPiboWorkspace"
      source_inspected: true
      follow_up: "In a separate code/test change, add focused tests for user-home selection and cwd fallback to test/workspace.test.mjs; only after that file exists, trace the test names here and run it."
      failures:
        - "A Pibo Home path that is a file is rejected; corrupt/unknown base-prompt state falls back to library mode."
        - "Pibo Home is mode 0700, rewritten configuration is mode 0600, and displayed secret keys are masked."
      confidence: "low"
    - id: "PROD-HOME-004"
      status: "implemented"
      sources:
        - path: "src/core/base-prompt.ts"
          symbol: "readPiboBasePrompt"
        - path: "src/core/compaction-prompt.ts"
          symbol: "readPiboCompactionPrompt"
      tests:
        - path: "test/base-prompt.test.mjs"
          name: "base prompt switches between library and custom prompt without losing custom content"
      failures:
        - "A Pibo Home path that is a file is rejected; corrupt/unknown base-prompt state falls back to library mode."
        - "Pibo Home is mode 0700, rewritten configuration is mode 0600, and displayed secret keys are masked."
      confidence: "medium"
    - id: "PROD-HOME-005"
      status: "implemented"
      sources:
        - path: "src/previews/base-url.ts"
          symbol: "parsePreviewBaseURL"
        - path: "src/previews/config.ts"
          symbol: "requirePreviewBaseURL"
      tests:
        - path: "test/preview-cli.test.mjs"
          name: "preview base URL config rejects values that Preview commands cannot consume"
        - path: "test/debug-pty.test.mjs"
          name: "pibo debug pty reports invalid preview base URL config without replacing the prior value"
      failures:
        - "Invalid schemes, credentials, paths, queries, fragments, ports, or hostnames are rejected before replacing the prior Preview base URL."
      confidence: "high"
---

# Scope

Own PIBO_HOME path resolution, private directory/config handling, default workspace, and library/custom base and compaction prompt state.

This specification describes implemented behavior at the traceability commit. Planned changes and behavior owned by related concepts are outside its normative scope.

# Current behavior

- Lifecycle: Stateful commands protect Pibo Home before use; prompt mode changes preserve custom content.
- State: PIBO_HOME defaults to ~/.pibo; workspace defaults to the user home when available, otherwise cwd; prompt modes are library or custom.
- Failure: A Pibo Home path that is a file is rejected; corrupt/unknown base-prompt state falls back to library mode.
- Security: Pibo Home is mode 0700, rewritten configuration is mode 0600, and displayed secret keys are masked.
- Compatibility: A leading UTF-8 BOM is accepted in config; legacy SYSTEM.md disables the managed base-prompt path.
- Preview configuration accepts only a consumable HTTP(S) origin and rejects malformed or unsafe URL shapes without replacing the prior value.

# Requirements and invariants

## Requirement: PROD-HOME-001

Pibo SHALL resolve PIBO_HOME or ~/.pibo and create or tighten it as a private directory before stateful use.

## Requirement: PROD-HOME-002

Configuration SHALL accept only supported keys, preserve private file permissions, and mask secret values for display.

## Requirement: PROD-HOME-003

The default workspace SHALL be the user home when available and cwd otherwise.

## Requirement: PROD-HOME-004

Base and compaction prompts SHALL support library/custom state under the workspace .pibo directory without losing saved custom content.

## Requirement: PROD-HOME-005

Preview base URL configuration SHALL validate the complete origin contract before persistence and SHALL preserve the prior value on failure.

# Interfaces and ownership

Implemented public contracts:

- `getPiboHome`
- `piboHomePath`
- `ensurePrivatePiboHome`
- `getDefaultPiboWorkspace`
- `PIBO_CONFIG_KEYS`
- `loadPiboConfig`
- `savePiboConfig`
- `readPiboBasePrompt`
- `readPiboCompactionPrompt`
- `parsePreviewBaseURL`

Related ownership boundaries:

- `SPC-RUN-008`: model-defaults.json precedence and active model freezing.
- `SPC-SEC-001`: broader secret and credential policy.
- `SPC-DATA-001`: database files and migrations under Pibo Home.

# Failure and security behavior

- A Pibo Home path that is a file is rejected; corrupt/unknown base-prompt state falls back to library mode.
- Pibo Home is mode 0700, rewritten configuration is mode 0600, and displayed secret keys are masked.

# Known limits

- Evidence gap: No listed focused test covers getDefaultPiboWorkspace.
- Evidence gap: No listed focused test covers compaction-prompt library/custom state independently of its implementation.
- Non-current claim excluded: This spec owns model-default precedence or active-session model freezing.
- Non-current claim excluded: Configuration may write arbitrary keys.
- Non-current claim excluded: Managed base prompts remain active when legacy SYSTEM.md exists.

# Verification and traceability

Source symbols and named tests are bound to commit `39090b8850758293e69380a52bb7498d7c955bc2`. Requirement confidence measures trace quality, not whether a command ran.

Package verification commands:

- `npm run build`
- `node --test test/config.test.mjs test/pibo-home-security.test.mjs test/base-prompt.test.mjs`
- `Run a bounded platform permission check for PIBO_HOME and config modes on each supported OS.`

# Related concepts

- `SPC-RUN-008` owns model-defaults.json precedence and active model freezing.
- `SPC-SEC-001` owns broader secret and credential policy.
- `SPC-DATA-001` owns database files and migrations under Pibo Home.

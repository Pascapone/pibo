# Spec: Local Config CLI

**Status:** Draft
**Created:** 2026-05-10
**Controller / Source:** Scheduled Pibo Source Specs Coverage
**Related docs:** `docs/specs/capabilities/web-auth-and-same-origin-host.md`, `docs/specs/capabilities/model-provider-auth-and-session-selection.md`

## Why

Pibo needs one small, predictable operator surface for machine-local settings. Today the local config store primarily drives web authentication and related gateway behavior. Agents and operators must be able to discover supported keys, set values safely, inspect non-secret values, and avoid leaking credentials in logs or chat transcripts.

This spec captures the current behavior of `pibo config` and the local config file as a durable capability separate from the features that consume those values.

## Goal

Pibo SHALL provide a progressively discoverable local config CLI backed by a JSON config file under the configured Pibo home, with strict supported keys and redacted secret display.

## Background / Current State

The implementation stores local config in `config.json` under `PIBO_HOME` or the user's default `.pibo` directory. The public config type currently contains an `auth` section for Better Auth and OAuth settings. The CLI exposes `keys`, `show`, `get`, `set`, and `del` beneath `pibo config`. Config key parsing, value validation, redaction, load, and save behavior live in `src/config/config.ts`; command discovery and command dispatch live in `src/cli.ts`.

## Scope

### In Scope

- Local config path resolution through Pibo home.
- Supported config key discovery.
- Setting, getting, deleting, and showing supported config values.
- Validation for key names, list values, and minimum auth secret length.
- Redaction for secret values in all display-oriented config outputs.
- JSON object load and pretty-printed save semantics.

### Out of Scope

- Validation of whether configured OAuth credentials work against Google — provider login and Better Auth startup own that behavior.
- Editing MCP server config — covered by the MCP integration spec and MCP-specific config files.
- Profile, room, session, or per-controller settings — this spec covers machine-local config only.
- Secret encryption at rest — the current code redacts display output but stores JSON values directly.

## Requirements

### Requirement: Config path is deterministic

The system MUST resolve the default local config file to `config.json` under Pibo home. Pibo home MUST be `PIBO_HOME` when set, otherwise the user's home directory plus `.pibo`.

#### Current

`getDefaultPiboConfigPath()` delegates to `piboHomePath("config.json")`; `getPiboHome()` checks `process.env.PIBO_HOME` before falling back to `~/.pibo`.

#### Acceptance

- With `PIBO_HOME=/tmp/example`, `pibo config --help` identifies `/tmp/example/config.json` as the local config path.
- Without `PIBO_HOME`, the default path is below the user's `.pibo` directory.

#### Scenario: Custom Pibo home

- GIVEN `PIBO_HOME` is set to an absolute directory
- WHEN an operator runs `pibo config --help`
- THEN the output names the config file in that directory

### Requirement: Config discovery is compact and progressive

The CLI MUST print compact discovery output for `pibo config` and `pibo config --help` without Commander usage boilerplate, and MUST point to `pibo config keys` as the next detailed command.

#### Current

`runPiboCli()` intercepts `pibo config`, `pibo config --help`, and `pibo config -h` before Commander parsing and prints `printConfigDiscoveryText()`.

#### Acceptance

- `pibo config --help` includes the command list: `keys`, `show`, `get`, `set`, and `del`.
- The help output includes `Next: pibo config keys`.
- The help output does not include generic `Usage:` text.

#### Scenario: Agent discovers config commands

- GIVEN an agent does not know which config operations exist
- WHEN it runs `pibo config`
- THEN it sees only the config command surface and the next discovery command

### Requirement: Supported keys are explicit

The CLI MUST accept only known config keys and MUST list every supported key with type, visibility, and description.

#### Current

Supported keys are declared in `PIBO_CONFIG_KEYS`. Unknown keys throw `Unknown config key` before read, write, display, or delete operations continue.

#### Acceptance

- `pibo config keys` lists `auth.baseURL`, `auth.secret`, `auth.googleClientId`, `auth.googleClientSecret`, `auth.allowedEmails`, `auth.trustedOrigins`, and `auth.databasePath`.
- Each listed key includes its value type and either `secret` or `public` visibility.
- `pibo config set unknown.key value` fails and does not create an unknown top-level config entry.

#### Scenario: Unknown key rejected

- GIVEN the config file is empty or missing
- WHEN an operator tries to set `unknown.key`
- THEN the command fails with an unknown-key error
- AND no unsupported key is persisted

### Requirement: Values are parsed by declared type

The system MUST parse values according to the supported key definition. String keys MUST store the exact provided string after key-specific validation. String-array keys MUST accept comma-separated text or a JSON string array, trim entries, and drop empty entries.

#### Current

`parseConfigValue()` dispatches by key definition. `parseListValue()` supports JSON arrays and comma-separated strings.

#### Acceptance

- Setting `auth.allowedEmails` to `a@example.com,b@example.com` stores `['a@example.com', 'b@example.com']`.
- Setting `auth.trustedOrigins` to a JSON string array stores the array values after trimming.
- A JSON array containing non-string values is rejected.

#### Scenario: List value from comma-separated input

- GIVEN an operator sets `auth.allowedEmails` to `you@example.com, friend@example.com`
- WHEN the config is loaded
- THEN `auth.allowedEmails` is an array with those two email strings

### Requirement: Auth secret length is validated before persistence

The system MUST reject `auth.secret` values shorter than 32 characters before writing config.

#### Current

`parseConfigValue()` checks `auth.secret` length and throws `auth.secret must be at least 32 characters`.

#### Acceptance

- `pibo config set auth.secret too-short` fails.
- The previous config file remains unchanged by the rejected short secret.
- A 32-character or longer `auth.secret` can be persisted.

#### Scenario: Short secret rejected

- GIVEN an operator configures web auth
- WHEN they set `auth.secret` to a short value
- THEN the CLI rejects the value before saving

### Requirement: Config load and save preserve a JSON object contract

The config loader MUST return an empty object when the config file does not exist, and MUST reject existing config files whose top-level JSON value is not an object. Saves MUST create the parent directory and write pretty-printed JSON with a trailing newline.

#### Current

`loadPiboConfig()` returns `{}` for missing files and calls `assertObject()` for parsed files. `savePiboConfig()` creates the parent directory recursively and writes `JSON.stringify(config, null, 2) + "\n"`.

#### Acceptance

- Missing config loads as `{}`.
- A config file containing a JSON array is rejected.
- Saving to a new Pibo home creates the directory and writes formatted JSON.

#### Scenario: First config write

- GIVEN the Pibo home directory does not yet exist
- WHEN an operator sets a supported config key
- THEN Pibo creates the directory and writes `config.json`

### Requirement: Display output redacts secrets

Display-oriented config commands MUST redact secret values. The raw config value MAY remain available internally to runtime code that loads the config directly.

#### Current

`getDisplayPiboConfigValue()` masks secret string values for `get`. `redactPiboConfig()` masks secret string values for `show`. `auth.secret` and `auth.googleClientSecret` are secret keys.

#### Acceptance

- `pibo config get auth.secret` never prints the full stored secret.
- `pibo config show` never prints full values for secret keys.
- Non-secret values such as `auth.baseURL` are displayed as stored.
- Secrets of length eight or less display as `********`; longer secrets display the first four and last four characters separated by `...`.

#### Scenario: Redacted full config display

- GIVEN `auth.secret` and `auth.googleClientSecret` are stored
- WHEN an operator runs `pibo config show`
- THEN both secret values are masked
- AND public keys remain readable

### Requirement: Delete removes empty auth sections

Deleting a supported key MUST remove that value. If the `auth` section becomes empty, the saved config MUST omit the empty `auth` object.

#### Current

`deletePiboConfigValue()` removes the requested field and returns `auth: undefined` when no auth keys remain.

#### Acceptance

- Deleting an existing key removes it from later `get` and `show` output.
- Deleting a missing supported key is a no-op.
- Deleting the last auth key removes the auth section from the saved object.

#### Scenario: Delete last auth key

- GIVEN the config only contains `auth.baseURL`
- WHEN an operator deletes `auth.baseURL`
- THEN `pibo config show` no longer includes an `auth` section

## Edge Cases

- Malformed JSON causes config loading to fail instead of silently replacing the file.
- Unknown keys fail before nested object traversal exposes arbitrary config contents.
- Secret masking applies only to string values; malformed secret values from hand-edited files are not expanded or normalized by display helpers.
- `pibo config get <key>` exits with a non-zero status and no value output when the supported key is unset.

## Constraints

- **Compatibility:** The config file remains JSON at `.pibo/config.json` by default.
- **Security / Privacy:** CLI display commands redact configured secret keys, but this capability does not encrypt secrets at rest.
- **Performance:** Config operations read and write one small local JSON file synchronously.
- **Dependencies:** Consuming systems such as Better Auth are responsible for semantic validation beyond supported key parsing.

## Success Criteria

- [ ] SC-001: Config CLI help stays compact and points agents to `pibo config keys`.
- [ ] SC-002: All supported keys are discoverable with type, visibility, and description.
- [ ] SC-003: Unknown keys and short `auth.secret` values are rejected before persistence.
- [ ] SC-004: String-array config values parse from comma-separated and JSON-array input.
- [ ] SC-005: `get` and `show` redact configured secret keys.
- [ ] SC-006: Missing config files load as empty config and first save creates parent directories.

## Assumptions and Open Questions

### Assumptions

- Local config is machine-scoped, not app-spaced.
- Plain JSON storage is intentional for current local development and gateway operation.
- The auth key list is the complete supported local config surface in the current code.

### Open Questions

- Should future non-auth config sections keep the same flat `section.name` key model?
- Should secret values move to an OS keychain or encrypted local store before production multi-user deployments?
- Should `pibo config get` provide an explicit `--raw` mode for secret retrieval, or should secrets remain write-only through the CLI?

## Traceability

| Requirement | Scenario / Story | Code / Test Basis | Status |
|---|---|---|---|
| REQ-001 Config path is deterministic | Custom Pibo home | `src/core/pibo-home.ts`, `src/config/config.ts`, `src/cli.ts` | Implemented |
| REQ-002 Config discovery is compact and progressive | Agent discovers config commands | `src/cli.ts`, `test/mcp-cli.test.mjs` | Implemented |
| REQ-003 Supported keys are explicit | Unknown key rejected | `src/config/config.ts`, `test/config.test.mjs` | Implemented |
| REQ-004 Values are parsed by declared type | List value from comma-separated input | `src/config/config.ts`, `test/config.test.mjs` | Implemented |
| REQ-005 Auth secret length is validated before persistence | Short secret rejected | `src/config/config.ts`, `test/config.test.mjs` | Implemented |
| REQ-006 Config load and save preserve a JSON object contract | First config write | `src/config/config.ts` | Implemented |
| REQ-007 Display output redacts secrets | Redacted full config display | `src/config/config.ts`, `test/config.test.mjs` | Implemented |
| REQ-008 Delete removes empty auth sections | Delete last auth key | `src/config/config.ts`, `test/config.test.mjs` | Implemented |

## Verification Basis

This spec was refreshed against the current implementation in `src/config/config.ts`, `src/core/pibo-home.ts`, `src/cli.ts`, and behavioral tests in `test/config.test.mjs` and `test/mcp-cli.test.mjs`.

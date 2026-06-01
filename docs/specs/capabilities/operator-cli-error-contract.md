# Spec: Operator CLI Error Contract

**Status:** Draft
**Created:** 2026-05-10
**Controller / Source:** Scheduled Pibo Source Specs Coverage; current workspace code
**Related docs:** `GLOSSARY.md`, `docs/specs/capabilities/operator-cli-discovery-and-dispatch.md`, `docs/specs/capabilities/mcp-server-integration.md`, `docs/specs/capabilities/curated-cli-tools.md`

## Why

Pibo is operated by agents as much as by humans. When a CLI command fails, the output must help the next agent action instead of only reporting a stack trace or a terse parse error.

Pibo already uses a shared `CliError` shape in the MCP and curated-tools command paths. That behavior deserves an explicit contract so future command families preserve actionable recovery messages, stable exit categories, and bounded diagnostic detail.

## Goal

Pibo CLI commands MUST report expected operator errors with a stable type, readable message, optional details, actionable suggestion, and an exit category that lets agents distinguish client, network, auth, and server failures.

## Background / Current State

The current implementation is centered on `src/cli-errors.ts`, `src/mcp/errors.ts`, `src/mcp/index.ts`, `src/mcp/commands/*`, `src/mcp/config-command.ts`, `src/mcp/config.ts`, `src/tools/index.ts`, `src/tools/python-runtime.ts`, and `src/tools/browser-use-leases.ts`.

`CliError` carries `code`, `type`, `message`, optional `details`, and optional `suggestion`. `formatCliError()` renders these fields as compact lines. MCP command handlers use specialized error builders for missing config, invalid JSON, unknown options, unknown subcommands, connection failures, tool lookup failures, disabled tools, ambiguous commands, and argument mistakes. Curated CLI tools reuse the same formatter for missing tools, guides, leases, and invalid runtime states.

## Scope

### In Scope

- The shared `CliError` shape and formatted text contract.
- Exit categories exposed by `ErrorCode`.
- Expected operator errors in MCP and curated-tools commands.
- Recovery suggestions for missing arguments, invalid targets, invalid JSON, unknown commands, unavailable servers, missing tools, disabled tools, and failed tool execution.
- Bounded details for large user input, available tool lists, and environment diagnostics.

### Out of Scope

- Full localization or translation of CLI errors.
- Replacing every thrown internal exception in the codebase with `CliError` in one step.
- Browser API error response shapes — those are covered by web capability specs.
- Provider-specific runtime failure semantics beyond the CLI category and message surfaced to the operator.

## Requirements

### Requirement: Expected CLI failures use the shared error shape

The system MUST represent expected operator failures with `code`, `type`, `message`, and optional `details` and `suggestion` fields before formatting them for stderr or thrown command errors.

#### Current

`src/cli-errors.ts` defines `CliError`, `ErrorCode`, and `formatCliError()`. MCP and curated-tools code call specialized builders or inline `formatCliError()` calls for expected invalid input and unavailable-resource states.

#### Acceptance

- Expected command validation failures include a stable uppercase `type` string.
- The primary `message` says what failed without requiring stack traces.
- Optional `details` explain bounded context such as available choices or parse failures.
- Optional `suggestion` names a next command or input shape the agent can try.

#### Scenario: Missing curated CLI tool

- GIVEN an operator runs `pibo tools show missing-tool`
- WHEN the command validates the tool name
- THEN stderr includes `Error [CLI_TOOL_NOT_FOUND]`
- AND includes available curated tool names or the command to list them.

### Requirement: Formatted errors are compact and line-oriented

The system MUST format CLI errors as a short, stable, line-oriented block that is easy for agents to parse and humans to scan.

#### Current

`formatCliError()` renders `Error [<type>]: <message>`, then optional indented `Details:` and `Suggestion:` lines.

#### Acceptance

- The first line always contains the error type and message.
- Details and suggestions appear only when present.
- The formatter does not print JavaScript stack traces for expected operator errors.
- The output remains plain text unless the command has an explicit JSON mode.

#### Scenario: Invalid JSON arguments

- GIVEN an operator runs an MCP tool call with malformed JSON
- WHEN the command rejects the arguments
- THEN stderr starts with `Error [INVALID_JSON_ARGUMENTS]: Invalid JSON in tool arguments`
- AND includes a suggestion to use valid JSON or inspect the tool schema.

### Requirement: Exit categories distinguish failure stewardship

The system MUST map expected CLI failures to exit categories that identify the likely controller of the next fix.

#### Current

`ErrorCode` defines `CLIENT_ERROR = 1`, `SERVER_ERROR = 2`, `NETWORK_ERROR = 3`, and `AUTH_ERROR = 4`. MCP command paths call `process.exit()` or set `process.exitCode` with these categories for validation, server, and connection failures.

#### Acceptance

- Invalid arguments, unknown commands, missing config, disabled tools, and missing resources exit as client errors.
- Remote or child-process connection failures exit as network errors.
- Tool execution failures caused by the server or tool implementation exit as server errors.
- Auth failures use the auth category when a command can identify them directly.
- Unexpected bugs may still exit through the process default or a generic server error, but expected user-actionable failures use a category.

#### Scenario: MCP server cannot be reached

- GIVEN an MCP server command cannot connect because the executable is missing or the HTTP endpoint is unavailable
- WHEN `pibo mcp info <server>` or `pibo mcp call <server> <tool>` fails
- THEN the process exits with the network category
- AND the suggestion names the likely recovery path.

### Requirement: Suggestions are command-aware

The system MUST tailor suggestions to the command family and likely operator intent instead of printing only generic help.

#### Current

`src/mcp/errors.ts` maps common aliases and mistakes: `run`, `execute`, and `exec` suggest `call`; `show`, `list`, and `describe` suggest `info`; unknown options such as `--tool` or `--args` explain positional command syntax. Tool and config errors suggest the relevant `pibo mcp info`, `pibo mcp call`, or config command.

#### Acceptance

- Unknown MCP subcommands suggest a known subcommand when an alias is recognized.
- Ambiguous `pibo mcp <server> <tool>` input suggests either `call` or `info` syntax.
- Missing arguments show an example for that command family.
- Curated-tools errors point to `pibo tools list`, `show`, `env`, `guides`, or a specific guide when useful.

#### Scenario: Ambiguous MCP command

- GIVEN a configured server named `github`
- WHEN an operator runs `pibo mcp github search_repos`
- THEN Pibo reports `AMBIGUOUS_COMMAND`
- AND suggests `pibo mcp call github search_repos` or `pibo mcp info github search_repos`.

### Requirement: Diagnostic details are bounded

The system MUST keep error details short enough for agent context while preserving the information needed for recovery.

#### Current

Invalid JSON argument details truncate long input. Tool-not-found errors list only the first few tools and report the remaining count. Config search errors list known search paths. Browser-use lease and runtime errors include the relevant lease, runtime, or tool name instead of dumping full state.

#### Acceptance

- User-provided JSON or command input in an error is truncated before it can dominate output.
- Available resource lists are bounded or summarized.
- Secrets, tokens, cookies, and full environment dumps are not included in suggestions or details.
- Error details contain enough context to choose the next command without reading source code.

#### Scenario: Tool list is large

- GIVEN an MCP server exposes more than five tools
- WHEN an operator requests a missing tool
- THEN details show a bounded list and a remaining count
- AND the suggestion tells the operator how to inspect all tools.

### Requirement: Structured error behavior coexists with progressive discovery

The system MUST keep normal `--help`, `list`, `show`, `info`, `doctor`, and `guide` discovery output separate from error recovery output.

#### Current

The root CLI and nested command families print compact discovery text for normal help paths. Error handlers print a recovery block only after invalid input or failed operations.

#### Acceptance

- Running a help or discovery command succeeds without an error prefix.
- Invalid input prints an error block and may point to the next discovery command.
- Suggestions do not embed long-form documentation that belongs behind `guide`, `schema`, `doctor`, `info`, or `show`.

#### Scenario: Unknown option points to discovery

- GIVEN an operator passes an unknown option to `pibo mcp`
- WHEN the parser rejects the option
- THEN Pibo prints `UNKNOWN_OPTION`
- AND the suggestion names valid options or a discovery command without dumping full help.

## Edge Cases

- Commands that support JSON output should keep machine-readable success output separate from human-readable stderr errors.
- Errors thrown from third-party packages may not have a `CliError` shape; command boundaries should wrap expected cases where practical.
- Suggestions must not include unsafe shell expansions with untrusted values.
- If no available resources exist, details should say `(none)` or an equivalent explicit empty state.

## Constraints

- **Compatibility:** Existing command names and normal help output must not change solely to satisfy this spec.
- **Security / Privacy:** Error details and suggestions must not leak credentials, browser profile paths beyond intended diagnostics, or full environment values.
- **Performance:** Error construction must not start network connections or expensive discovery only to improve wording.
- **Agent usability:** Messages must remain concise and actionable; detailed docs belong behind explicit discovery commands.

## Success Criteria

- [ ] SC-001: A test can call `formatCliError()` and verify the stable first line plus optional details and suggestion lines.
- [ ] SC-002: MCP tests cover invalid JSON, missing arguments, unknown subcommands, ambiguous commands, server-not-found, and tool-not-found errors with expected types and exit categories.
- [ ] SC-003: Curated-tools tests cover missing tool, missing guide, and browser-use lease validation errors with shared formatted output.
- [ ] SC-004: Long user input and large available-tool lists remain bounded in error output.
- [ ] SC-005: Normal help and discovery commands do not use the error formatter.

## Assumptions and Open Questions

### Assumptions

- `ErrorCode.AUTH_ERROR` is reserved for command paths that can reliably distinguish authentication failures from generic server failures.
- The first line of `formatCliError()` is the stable parsing surface; details and suggestions can evolve as command families improve.

### Open Questions

- Should every top-level CLI family standardize on this error shape, or should some domain commands keep custom output for compatibility?
- Should future JSON-mode errors expose the same fields as JSON while retaining the current stderr text for non-JSON mode?

## Traceability

| Requirement | Scenario / Story | Plan / Task | Status |
|---|---|---|---|
| Expected CLI failures use the shared error shape | Missing curated CLI tool | Add/maintain command validation tests | Pending |
| Formatted errors are compact and line-oriented | Invalid JSON arguments | Unit-test `formatCliError()` and MCP invalid JSON | Pending |
| Exit categories distinguish failure stewardship | MCP server cannot be reached | Assert MCP command exit codes | Pending |
| Suggestions are command-aware | Ambiguous MCP command | Assert recovery suggestions for common aliases | Pending |
| Diagnostic details are bounded | Tool list is large | Assert truncation and summary counts | Pending |
| Structured error behavior coexists with progressive discovery | Unknown option points to discovery | Assert help remains non-error output | Pending |

## Verification Basis

This spec is based on the current workspace code in `src/cli-errors.ts`, `src/mcp/errors.ts`, `src/mcp/index.ts`, `src/mcp/commands/call.ts`, `src/mcp/commands/info.ts`, `src/mcp/config-command.ts`, `src/mcp/config.ts`, `src/tools/index.ts`, `src/tools/python-runtime.ts`, and `src/tools/browser-use-leases.ts`. Existing related tests include `test/mcp-cli.test.mjs` and `test/tools-cli.test.mjs`.
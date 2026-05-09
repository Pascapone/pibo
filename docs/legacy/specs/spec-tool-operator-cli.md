---
title: Pibo Operator CLI Specification
version: 1.1
date_created: 2026-04-28
last_updated: 2026-05-01
owner: Pibo maintainers
tags: [tool, cli, mcp, external-tools, config, debug]
---

# Introduction

This specification defines the current operator CLI behavior for Pibo. Pibo is primarily operated by agents, so command discovery is progressive and compact.

## 1. Purpose & Scope

This specification covers:

- Top-level `pibo` discovery behavior.
- `pibo config`.
- `pibo mcp`.
- `pibo tools`.
- `pibo debug`.
- Runtime expectations for profile, TUI, gateway, and client commands.

This specification does not define internal runtime event contracts.

## 2. Definitions

- **Operator CLI**: The command surface exposed through `src/bin/pibo.ts` and `src/cli.ts`.
- **Progressive discovery**: CLI output style where each level shows only immediate commands and next useful commands.
- **MCP CLI**: The `pibo mcp` helper for configured Model Context Protocol servers.
- **Curated CLI tool**: An external command-line tool managed by `pibo tools`.
- **Pibo config**: Local JSON config stored at `.pibo/config.json`.
- **Debug CLI**: The `pibo debug` helper for read-only diagnostics against Pibo-owned SQLite stores and Chat Web projections.
- **Chat Web trace view**: The read-time projection produced by Chat Web trace reconstruction and returned by `/api/chat/trace`.

## 3. Requirements, Constraints & Guidelines

- **REQ-001**: Top-level `pibo` with no arguments MUST print compact discovery output.
- **REQ-002**: Top-level `pibo --help` and `pibo -h` MUST print compact discovery output, not a full Commander help dump.
- **REQ-003**: Each CLI level MUST provide only immediate commands and a next-step hint.
- **REQ-004**: Long guides, schemas, environment details, and detailed operational instructions MUST live behind explicit deeper commands.
- **REQ-005**: `pibo config` with no action or help flags MUST print config discovery output.
- **REQ-006**: `pibo config keys` MUST list supported config keys with key, type, visibility, and description.
- **REQ-007**: `pibo config show` MUST redact secret values.
- **REQ-008**: `pibo config get <secret-key>` MUST return the redacted display value, not the raw secret.
- **REQ-009**: `pibo config set auth.secret <value>` MUST reject secrets shorter than 32 characters.
- **REQ-010**: `auth.allowedEmails` MUST accept comma-separated strings or JSON string arrays.
- **REQ-011**: `pibo mcp` MUST use `mcp_servers.json` as the default project config file when no higher-priority config path exists.
- **REQ-012**: MCP config lookup order MUST be explicit `-c/--config`, `MCP_CONFIG_PATH`, `./mcp_servers.json`, `~/.mcp_servers.json`, then `~/.config/mcp/mcp_servers.json`.
- **REQ-013**: `pibo mcp` MUST support stdio servers with `command`, `args`, `env`, and `cwd`.
- **REQ-014**: `pibo mcp` MUST support HTTP servers with `url`, optional `headers`, and optional `timeout`.
- **REQ-015**: MCP tool filtering MUST apply `disabledTools` before `allowedTools`.
- **REQ-016**: MCP glob filters MUST support `*` and `?`, case-insensitively.
- **REQ-017**: `MCP_NO_DAEMON=1` MUST disable daemon connection reuse.
- **REQ-018**: `pibo tools` with no arguments MUST list curated tools.
- **REQ-019**: `pibo tools --help` MUST print compact tools discovery output.
- **REQ-020**: `pibo tools guide <name> [guide]` MUST print one guide only.
- **REQ-021**: Curated tool guides MUST NOT be loaded automatically into Pibo agent profiles.
- **REQ-022**: `browser-use` MUST be pinned to `browser-use[cli]==0.12.6` in the curated tool registry.
- **REQ-023**: Curated tools MUST install into isolated runtimes under `~/.pibo/tools/<name>`.
- **REQ-024**: `pibo tools browser-use targets` MUST list Chrome CDP targets without launching a new browser, and MUST include Chat Web auth and composer hints when probing is enabled.
- **REQ-025**: `pibo tools browser-use targets --json` MUST print machine-readable target data.
- **REQ-026**: `pibo tools browser-use attach-chat` MUST select an existing authenticated Chat Web target with a composer textarea and print shell exports for `PIBO_CDP_URL`, `PIBO_CDP_TARGET_ID`, `PIBO_CDP_TARGET_WS`, and `PIBO_CHAT_URL`.
- **REQ-027**: `pibo tools browser-use attach-chat` MUST fail with a clear suggestion instead of starting a new browser when no usable Chat Web target exists.
- **REQ-028**: Runtime commands MUST remain available: `profile`, `tui`, `tui:routed`, `gateway`, `gateway:web`, and `client`.
- **REQ-029**: `pibo debug` with no action or help flags MUST print compact debug discovery output.
- **REQ-030**: `pibo debug db` MUST list known local SQLite stores and expose schema, table, and read-only query subcommands.
- **REQ-031**: `pibo debug db query <store> <sql>` MUST open the target store read-only, reject mutating statements, accept one SQL statement, and apply a bounded default row limit when no explicit SQL `limit` is present.
- **REQ-032**: `pibo debug session <url-or-pibo-session-id>` MUST summarize Pibo Session metadata, child sessions, Chat Web read-model state, and optional event headers without dumping full event payloads or Pi JSONL transcripts.
- **REQ-033**: `pibo debug session` MUST warn when a canonical Chat URL room id does not match the selected Pibo Session's `metadata.chatRoomId`.
- **REQ-034**: `pibo debug trace <pibo-session-id>` MUST rebuild the Chat Web trace view using the same reconstruction logic as `/api/chat/trace`.
- **REQ-035**: `pibo debug trace --running-only` MUST filter output to trace nodes whose status is `running`.
- **REQ-036**: `pibo debug trace --check` MUST report trace consistency diagnostics for duplicate ids, missing parents, missing source/stable-key/order metadata, and stable-order regressions.
- **REQ-037**: `pibo debug events <pibo-session-id>` MUST inspect compact Chat Web event rows and MUST support selecting event types and payload field paths.
- **REQ-038**: `pibo debug events --fields` MUST extract only the requested payload fields and MUST NOT dump the complete stored payload by default.
- **REQ-039**: `pibo debug events stats` MUST report grouped counts for retained events and MUST support filtering by topic, session key, and retention class.
- **REQ-040**: `pibo debug events prune` MUST require explicit `--topic`, `--retention`, and `--before` filters and MUST preserve rows still needed by named consumers unless `--destructive` is passed.
- **CON-001**: The CLI is agent-facing; avoid large all-in-one help text.
- **CON-002**: Optional external tools and MCP servers are configured on demand and are not bundled into the core runtime.
- **CON-003**: The Debug CLI is local operator tooling. It MUST NOT become a profile tool or expose runtime capabilities to agents.

## 4. Interfaces & Data Contracts

### Top-Level Commands

| Command | Purpose |
| --- | --- |
| `config` | Manage local Pibo config |
| `mcp` | Discover and call configured MCP servers |
| `tools` | Install and inspect curated external CLI tools |
| `debug` | Inspect local Pibo SQLite stores and Chat Web projections |
| `profile` | Inspect a Pibo profile |
| `tui` | Start direct Pi TUI |
| `tui:routed` | Start local routed Pibo TUI |
| `gateway` | Start local gateway daemon |
| `gateway:web` | Start authenticated web gateway |
| `client` | Start console gateway client |

### Pibo Config Keys

| Key | Type | Secret | Meaning |
| --- | --- | --- | --- |
| `auth.baseURL` | string | no | Better Auth base URL |
| `auth.secret` | string | yes | Better Auth secret, at least 32 characters |
| `auth.googleClientId` | string | no | Google OAuth client id |
| `auth.googleClientSecret` | string | yes | Google OAuth client secret |
| `auth.allowedEmails` | string[] | no | Allowed Google account emails |
| `auth.databasePath` | string | no | SQLite path for Better Auth data |

### MCP Server Config

```ts
type StdioServerConfig = {
  command: string;
  args?: string[];
  env?: Record<string, string>;
  cwd?: string;
  allowedTools?: string[];
  disabledTools?: string[];
};

type HttpServerConfig = {
  url: string;
  headers?: Record<string, string>;
  timeout?: number;
  allowedTools?: string[];
  disabledTools?: string[];
};
```

### Curated Tool Entry

```ts
type CliToolEntry = {
  name: string;
  description: string;
  runtime: {
    packageName: string;
    executableName: string;
    pythonVersion: string;
    homeEnvVar?: string;
  };
  guides: readonly ToolGuide[];
  notes: readonly string[];
};
```

### Debug Stores

| Store | Default path | Purpose |
| --- | --- | --- |
| `sessions` | `.pibo/pibo-sessions.sqlite` | Canonical Pibo Session metadata |
| `chat` | `.pibo/web-chat.sqlite` | Chat Web read model, raw Pibo events, rooms, durable chat events |
| `agents` | `.pibo/chat-agents.sqlite` | Agent Designer profiles |
| `auth` | `.pibo/auth.sqlite` | Better Auth local auth data |
| `bindings` | `.pibo/session-bindings.sqlite` | Local session binding data when present |

### Debug Commands

| Command | Purpose |
| --- | --- |
| `pibo debug db stores` | List known stores and resolved paths |
| `pibo debug db schema <store>` | List tables and columns for one store |
| `pibo debug db tables <store>` | List table names for one store |
| `pibo debug db query <store> <sql>` | Run one bounded read-only SQL query |
| `pibo debug session <url-or-pibo-session-id>` | Summarize one Pibo Session and Chat Web read-model state |
| `pibo debug trace <pibo-session-id>` | Rebuild one Chat Web trace view; `--check` adds consistency diagnostics |
| `pibo debug events <pibo-session-id>` | Inspect compact event headers and selected payload fields |
| `pibo debug events stats` | Count retained events by topic, session key, and retention class |
| `pibo debug events prune` | Prune retained events before a cutoff, with non-destructive consumer protection by default |

## 5. Acceptance Criteria

- **AC-001**: Given `pibo`, When executed without args, Then output includes immediate commands and `Next: pibo <command> --help`.
- **AC-002**: Given `pibo config`, When executed without action, Then output includes config commands and `Next: pibo config keys`.
- **AC-003**: Given `pibo config set auth.secret short`, When executed, Then it fails.
- **AC-004**: Given a saved secret, When `pibo config show` runs, Then the secret is masked.
- **AC-005**: Given `pibo mcp --help`, When executed, Then help remains progressive.
- **AC-006**: Given `pibo tools guide browser-use browser-use`, When executed, Then one browser-use guide is printed.
- **AC-007**: Given `pibo tools install browser-use --no-setup`, When executed, Then it prints the install target without installing runtime setup.
- **AC-008**: Given a Chrome CDP `/json/list` endpoint, When `pibo tools browser-use targets --cdp-url <url> --no-probe` runs, Then it prints a compact target table without launching a browser.
- **AC-009**: Given multiple Chat Web targets, When `pibo tools browser-use attach-chat` runs, Then it selects the authenticated target with a composer textarea instead of the first target.
- **AC-010**: Given `pibo debug --help`, When executed, Then output lists only the immediate debug command groups and next-step hints.
- **AC-011**: Given `pibo debug db query sessions "select id from pibo_sessions"`, When executed, Then it returns bounded rows from the read-only sessions store.
- **AC-012**: Given a Chat URL whose room id differs from session metadata, When `pibo debug session <url> --json` runs, Then the JSON output contains a mismatch warning.
- **AC-013**: Given a Chat Web session with running trace nodes, When `pibo debug trace <id> --running-only` runs, Then output includes only running trace nodes.
- **AC-014**: Given a Chat Web session, When `pibo debug trace <id> --check --json` runs, Then the JSON output contains a `checks` object with a status and issue list.
- **AC-015**: Given stored Chat Web events, When `pibo debug events <id> --type tool_execution_finished --fields toolName,toolCallId,result.details.status` runs, Then output includes those fields and omits full payload dumps.
- **AC-016**: Given retained `pibo.output` events, When `pibo debug events stats --topic pibo.output --session ps_... --retention live_delta` runs, Then output includes a grouped count row for that session and retention class.
- **AC-017**: Given retained `pibo.output` `live_delta` rows older than a cutoff, When `pibo debug events prune --topic pibo.output --retention live_delta --before <iso-date>` runs, Then output reports the bounded prune result and does not require `--destructive` for consumer-safe cleanup.

## 6. Test Automation Strategy

- **Test Levels**: CLI integration tests with built assets.
- **Frameworks**: Node.js built-in test runner.
- **Primary Command**: `npm test`.
- **Focused Commands**: `node --test test/mcp-cli.test.mjs`, `node --test test/tools-cli.test.mjs`, `node --test test/config.test.mjs`, `node --test test/debug-cli.test.mjs`.
- **Manual Smoke Checks**: `npm run dev -- config keys`, `npm run dev -- tools list`, `npm run dev -- mcp`, `npm run dev -- debug trace ps_... --running-only`, `npm run dev -- debug trace ps_... --check`, `npm run dev -- debug events stats --topic pibo.output --session ps_... --retention live_delta`.

## 7. Rationale & Context

Pibo command output is optimized for agents discovering an unfamiliar CLI. Compact command surfaces reduce context waste and encourage stepwise exploration. Optional integrations remain outside default profile context to keep agent prompts small.

## 8. Dependencies & External Integrations

### External Systems

- **EXT-001**: MCP servers launched as local stdio processes or reached through HTTP.
- **EXT-002**: Curated CLI tools installed on demand.

### Infrastructure Dependencies

- **INF-001**: Project-local `.pibo/config.json`.
- **INF-002**: Project-local or user-level MCP config files.
- **INF-003**: Tool runtime directories under `~/.pibo/tools`.
- **INF-004**: Local Pibo SQLite stores under `.pibo/` for debug inspection.

### Technology Platform Dependencies

- **PLT-001**: Node.js `>=24`.
- **PLT-002**: Python runtime installation support for curated Python CLI tools.

## 9. Examples & Edge Cases

### Progressive Discovery Flow

```bash
pibo
pibo tools
pibo tools show browser-use
pibo tools guides browser-use
pibo tools guide browser-use browser-use
pibo tools browser-use targets
pibo tools browser-use attach-chat
```

### Debug Discovery Flow

```bash
pibo debug
pibo debug db
pibo debug db schema sessions
pibo debug session /apps/chat/rooms/<room-id>/sessions/<pibo-session-id>
pibo debug trace <pibo-session-id> --running-only
pibo debug trace <pibo-session-id> --check
pibo debug events <pibo-session-id> --type tool_execution_finished --fields toolName,toolCallId,result.details.status
pibo debug events stats --topic pibo.output --session <pibo-session-id> --retention live_delta
pibo debug events prune --topic pibo.output --retention live_delta --before 2026-05-01T00:00:00.000Z
```

### Config List Values

Both values are valid inputs for `auth.allowedEmails`:

```bash
pibo config set auth.allowedEmails alice@example.com,bob@example.com
pibo config set auth.allowedEmails '["alice@example.com","bob@example.com"]'
```

## 10. Validation Criteria

- CLI tests pass.
- `RULES.md` progressive discovery rule is preserved.
- New CLI help text does not duplicate long guides across levels.
- Debug output remains bounded by default and does not dump full Pi transcripts or full Chat Web event payloads.

## 11. Related Specifications / Further Reading

- [RULES.md](../RULES.md)
- [docs/mcp.md](../docs/mcp.md)
- [docs/tools.md](../docs/tools.md)
- [docs/architecture.md](../docs/architecture.md)

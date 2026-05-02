# Pibo MCP

`pibo mcp` is the local operator CLI for external MCP servers. It is intentionally separate from the pibo plugin runtime: MCP servers are configured in `mcp_servers.json`, started as external stdio or HTTP servers, and called from the shell.

This keeps pibo small. Optional tools can be added when needed without becoming npm dependencies of the core package.

## Commands

The MCP CLI is intentionally progressive:

- `pibo mcp --help` shows only the top-level MCP commands.
- `pibo mcp config help` shows only config actions.
- `pibo mcp config schema` prints server JSON examples.
- `pibo mcp config paths` prints config lookup order.
- `pibo mcp registry help` shows only registry actions.

```bash
npm run dev -- mcp
npm run dev -- mcp info <server>
npm run dev -- mcp info <server> <tool>
npm run dev -- mcp grep "<pattern>"
npm run dev -- mcp call <server> <tool> '<json>'
```

The CLI accepts both space-separated and slash-separated server/tool targets:

```bash
npm run dev -- mcp info filesystem read_file
npm run dev -- mcp info filesystem/read_file
```

## Config

MCP server definitions live in `mcp_servers.json`. The file is local and ignored by git because it can contain absolute paths and machine-specific environment variables.

Lookup order:

1. `-c/--config <path>`
2. `MCP_CONFIG_PATH`
3. `./mcp_servers.json`
4. `~/.mcp_servers.json`
5. `~/.config/mcp/mcp_servers.json`

Manage the file with:

```bash
npm run dev -- mcp config init
npm run dev -- mcp config path
npm run dev -- mcp config paths
npm run dev -- mcp config show
npm run dev -- mcp config schema
npm run dev -- mcp config add filesystem '{"command":"npx","args":["-y","@modelcontextprotocol/server-filesystem","."]}'
npm run dev -- mcp config describe filesystem "Access project files through the configured filesystem MCP server."
npm run dev -- mcp config remove filesystem
```

### Agent-facing descriptions

Custom agents can opt into MCP server hints, but only described servers produce useful model-visible context. Add a short description with:

```bash
npm run dev -- mcp config describe <server> "<description>"
```

This preserves the existing server entry and writes only Pibo-owned metadata:

```json
{
  "mcpServers": {
    "filesystem": {
      "command": "npx",
      "args": ["-y", "@modelcontextprotocol/server-filesystem", "."],
      "pibo": {
        "description": "Access project files through the configured filesystem MCP server.",
        "descriptionSource": "user"
      }
    }
  }
}
```

Descriptions are capped at 480 characters. Registry-provided descriptions use `descriptionSource: "registry"` and are read-only in the Chat Web Context area's `MCP Tools` view.

## Agent Designer Context

The Chat Web Agent Designer lists configured MCP servers in the `MCP Servers` section below `Subagents`.

- Servers without `pibo.description` are visible with a missing-description state and cannot be selected.
- The Agent Designer only selects MCP servers for a custom agent; it does not inline-edit descriptions.
- Each MCP server row has an edit action that opens Context > MCP Tools.
- User-owned descriptions can be edited from Context > MCP Tools or the CLI.
- Registry descriptions are visible in Context > MCP Tools but not editable.
- Selected MCP server names are stored on custom agents separately from native tools, skills, context files, packages, and subagents.

At runtime, selected described servers are injected as a generated context document:

```text
.pibo/context/enabled-mcp-servers.md
```

The generated document contains only the server name, short description, and compact discovery commands such as:

```bash
npm run dev -- mcp info <server>
npm run dev -- mcp call <server> <tool> '<json>'
```

Pibo does not inject MCP tool schemas, headers, environment variables, command paths, or full config JSON into model context. The Agent Designer catalog is built from local config metadata and does not start stdio MCP servers or make HTTP MCP requests.

## Chrome DevTools MCP

`browser-use` is a Pibo CLI tool, not an MCP server. It is installed and managed through `pibo tools`, so it does not appear in the Agent Designer `MCP Servers` section.

For Chat UI debugging, use Browser Use and DevTools together: open or reuse the target app in Browser Use first, then attach Chrome DevTools MCP to that same Chrome with `--browserUrl`. Do not use standalone `--headless` for this workflow unless an isolated unauthenticated browser is intentional.

To expose Chrome DevTools through MCP, add a real MCP server entry using the Browser Use CDP port:

```bash
npm run dev -- mcp config add chrome-devtools '{"command":"npx","args":["-y","chrome-devtools-mcp@latest","--browserUrl","http://127.0.0.1:<cdp-port>"]}'
npm run dev -- mcp config describe chrome-devtools "Use with Pibo Browser Use: open the target app there first, then inspect that same Chrome through DevTools MCP via --browserUrl. Avoid standalone --headless for Chat UI debugging."
npm run dev -- mcp info chrome-devtools
```

The final `info` command starts the MCP server and lists its available tools, such as page navigation, screenshots, console inspection, network inspection, script evaluation, and performance tracing. Refresh the Chat Web Agent Designer after adding the config entry.

If Codex cannot see MCP resources, treat direct CDP as the recovery path rather than starting a fresh unauthenticated browser:

```bash
npm run dev -- tools browser-use targets
npm run dev -- tools browser-use attach-chat
curl -s http://127.0.0.1:<cdp-port>/json/version
curl -s http://127.0.0.1:<cdp-port>/json/list
```

Pick the Chat Web target that is authenticated and has a composer textarea, then connect directly to its `webSocketDebuggerUrl`. MCP Tool Context for DevTools should stay short: name the server, say it attaches to the Browser Use CDP port with `--browserUrl`, and point agents to `npm run dev -- mcp info chrome-devtools` for discovery.

## Registry

The registry is a curated list of optional MCP server presets. Presets are not active by default. Installing one writes a normal `mcpServers` entry, so the runtime path is the same as a manually added server.

```bash
npm run dev -- mcp registry list
npm run dev -- mcp registry show <name>
npm run dev -- mcp registry doctor <name>
npm run dev -- mcp registry install <name>
npm run dev -- mcp registry remove <name>
```

Python-based presets are installed into isolated virtual environments:

```text
~/.pibo/mcp-tools/<name>/.venv
```

Pibo does not install Python tools during `npm install`. Runtime setup happens only when a registry preset is installed.

## Requirements

Registry installation requires `uv` on `PATH`. The doctor command reports missing prerequisites:

```bash
npm run dev -- mcp registry doctor <name>
```

If `uv` is missing:

```bash
# macOS/Linux
curl -LsSf https://astral.sh/uv/install.sh | sh

# Windows PowerShell
irm https://astral.sh/uv/install.ps1 | iex
```

If Python is missing:

```bash
# Ubuntu/Debian
sudo apt update && sudo apt install -y python3 python3-venv

# macOS
brew install python

# Windows PowerShell
winget install Python.Python.3.12
```

## Daemon

The MCP CLI keeps stdio connections warm through a local daemon for faster repeated calls. Disable it with:

```bash
MCP_NO_DAEMON=1 npm run dev -- mcp call <server> <tool> '{}'
```

Useful environment variables:

```text
MCP_NO_DAEMON=1
MCP_DAEMON_TIMEOUT=60
MCP_DAEMON_REQUEST_TIMEOUT=60
MCP_TIMEOUT=1800
```

The daemon is a local cache for MCP connections. It does not make MCP servers part of the pibo plugin runtime.

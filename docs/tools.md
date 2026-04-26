# Pibo Tools

`pibo tools` manages curated external CLI tools. It is separate from the pibo profile skill system and from MCP servers.

The tool registry answers three questions:

- which CLI tools does pibo know?
- which of them are installed locally?
- which usage guides can an agent request on demand?

Guides are printed by the CLI. They are not loaded into every agent profile.

## Commands

```bash
npm run dev -- tools list
npm run dev -- tools installed
npm run dev -- tools show browser-use
npm run dev -- tools doctor browser-use
npm run dev -- tools install browser-use
npm run dev -- tools remove browser-use
npm run dev -- tools guides browser-use
npm run dev -- tools guide browser-use browser-use
npm run dev -- tools guide browser-use remote-browser
npm run dev -- tools path browser-use
npm run dev -- tools env browser-use
```

## Browser Use

The first curated tool is `browser-use`, a browser automation CLI.

Pibo installs it on demand into:

```text
~/.pibo/tools/browser-use/.venv
```

Browser Use state is isolated under:

```text
~/.pibo/tools/browser-use/home
```

The installer uses `uv` to create the virtual environment and install `browser-use[cli]`. Browser Use system setup stays visible through `pibo tools doctor browser-use`; if Browser Use reports missing optional components, install them explicitly for the workflow that needs them.

## Requirements

`pibo tools doctor browser-use` checks:

- whether `uv` is available
- whether Python is available through `uv`
- whether the virtual environment exists
- whether the `browser-use` executable exists
- whether `browser-use doctor` succeeds

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

## Usage Guides

Agents can discover available guides:

```bash
npm run dev -- tools guides browser-use
```

Then print one guide:

```bash
npm run dev -- tools guide browser-use browser-use
```

The default browser-use guide describes local browser automation. The `remote-browser` guide describes remote or sandboxed browser workflows.

## Shell Environment

Use `path` to print the executable path:

```bash
npm run dev -- tools path browser-use
```

Use `env` to print shell exports:

```bash
npm run dev -- tools env browser-use
```

On Linux/macOS this prints:

```bash
export PATH=".../.venv/bin:$PATH"
export BROWSER_USE_HOME=".../home"
```

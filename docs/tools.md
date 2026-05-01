# Pibo Tools

`pibo tools` manages curated external CLI tools. It is separate from the pibo profile skill system and from MCP servers.

The tool registry answers three questions:

- which CLI tools does pibo know?
- which of them are installed locally?
- which usage guides can an agent request on demand?

Guides are printed by the CLI. They are not loaded into every agent profile.

List-style commands use compact line output so agents can discover the next step without reading full guides. Detailed instructions stay behind explicit `show`, `doctor`, and `guide` commands.

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
npm run dev -- tools browser-use
npm run dev -- tools browser-use lease acquire
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

By default, the Pibo Browser Use wrapper starts a Pibo-managed persistent Chrome profile through CDP:

```text
~/.pibo/tools/browser-use/home/chrome-profiles/PIBo
```

This is intentionally different from upstream `browser-use --profile`, which can copy Chrome profiles into a temporary user-data directory. Sign-ins made through the default Pibo wrapper path persist across Browser Use daemon restarts and shell sessions. Use `--fresh-profile` only when a disposable temporary browser profile is wanted.

For authenticated Chat Web App testing, use isolated Browser Use leases instead of sharing one long-lived browser-use session between agents:

```bash
eval "$(npm run --silent dev -- tools browser-use lease acquire --app pibo-chat --owner "$USER")"
browser-use state
```

The lease prints shell exports for a cloned authenticated Chrome user-data directory and a dedicated `PIBO_BROWSER_USE_SESSION`. In that shell, later `browser-use` commands use the leased session by default. Prepare or refresh the authenticated template with `npm run dev -- tools browser-use auth-template env` when lease acquisition reports that no template profile exists.

Additional lease helper commands:

```bash
npm run dev -- tools browser-use
npm run dev -- tools browser-use auth-template path
npm run dev -- tools browser-use auth-template env
npm run dev -- tools browser-use lease list
npm run dev -- tools browser-use lease release <lease-id>
npm run dev -- tools browser-use lease reap-stale
```

Use `pibo tools browser-use` as the compact discovery entrypoint. `auth-template` helps prepare or locate the authenticated Chrome user-data-dir template. `lease list`, `lease release`, and `lease reap-stale` are the operator surface for inspecting and cleaning up isolated authenticated browser slots.

The installer uses `uv` to create the virtual environment and install the pinned package `browser-use[cli]==0.12.6`. The version is pinned so the Browser Use CLI surface stays aligned with the bundled guides. Browser Use system setup stays visible through `pibo tools doctor browser-use`; if Browser Use reports missing optional components, install them explicitly for the workflow that needs them.

## Requirements

`pibo tools doctor browser-use` checks:

- whether `uv` is available
- whether Python is available through `uv`
- whether the virtual environment exists
- whether the `browser-use` executable exists
- whether a local Linux desktop display can be detected
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
export PATH=".../home/bin:.../.venv/bin:$PATH"
export BROWSER_USE_HOME=".../home"
```

On Linux desktops, `env` also prints detected browser display variables when available:

```bash
export DISPLAY=":0"
export WAYLAND_DISPLAY="wayland-0"
export XAUTHORITY="/run/user/1000/.mutter-Xwaylandauth..."
export XDG_RUNTIME_DIR="/run/user/1000"
export DBUS_SESSION_BUS_ADDRESS="unix:path=/run/user/1000/bus"
```

Apply these exports once in a persistent Browser Use shell, then keep using that same shell for later `browser-use` commands:

```bash
eval "$(npm run --silent dev -- tools env browser-use)"
browser-use doctor
browser-use --headed --session debug open https://example.com
```

If you start a new shell, apply the exports once again before running Browser Use. The exports are shell-local and are not written system-wide.

If no desktop display is detected, `pibo tools install browser-use` and `pibo tools doctor browser-use` warn that headed mode is unavailable. Headless Browser Use still works:

```bash
browser-use --session debug open https://example.com
```

To intentionally use a real local Chrome user data directory instead of the Pibo-managed one, set `PIBO_BROWSER_USE_CHROME_USER_DATA_DIR` before starting the Browser Use session.

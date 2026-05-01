export interface ToolGuide {
  name: string;
  description: string;
  content: string;
}

export const BROWSER_USE_GUIDE: ToolGuide = {
  name: 'browser-use',
  description: 'Local browser automation with the browser-use CLI.',
  content: `---
name: browser-use
description: Automates browser interactions for web testing, form filling, screenshots, and data extraction. Use when the user needs to navigate websites, interact with web pages, fill forms, take screenshots, or extract information from web pages.
allowed-tools: Bash(browser-use:*)
---

# Browser Automation with browser-use CLI

The browser-use command provides persistent browser automation. A background daemon keeps the browser open across commands, so repeated commands are fast.

## Prerequisites

Initialize one persistent browser-use shell by applying the Pibo tool environment once:

\`\`\`bash
eval "$(pibo tools env browser-use)"
browser-use doctor
\`\`\`

Inside the Pibo source repo, use \`eval "$(npm run --silent dev -- tools env browser-use)"\` instead. Keep running later \`browser-use\` commands in that same shell; a new shell needs the one-time initialization again. If command substitution is not available, run the env command and apply the printed exports manually. On Linux, it includes detected desktop variables such as \`DISPLAY\`, \`WAYLAND_DISPLAY\`, and \`XAUTHORITY\` when a local desktop is available.

The Pibo tool environment wraps \`browser-use\`: when a new browser daemon session is started, it starts a Pibo-managed persistent Chrome profile named \`PIBo\` with CDP and connects Browser Use to it. This avoids Browser Use's normal temporary profile copy, so sign-ins made in that profile stay on disk. Pass \`--fresh-profile\` to start a fresh temporary browser profile instead.

## Core Workflow

1. Navigate: \`browser-use --headed --session NAME open <url>\` when a desktop is available; otherwise use \`browser-use --session NAME open <url>\`
2. Inspect: \`browser-use state\`
3. Interact with indices from state: \`browser-use click 5\`, \`browser-use input 3 "text"\`
4. Verify: \`browser-use state\`, \`browser-use get value <index>\`, \`browser-use eval "js"\`, or \`browser-use screenshot\`
5. Repeat while the browser stays open

Run browser-mutating commands one at a time per session. Do not issue parallel \`click\`, \`input\`, \`open\`, \`eval\`, or \`screenshot\` calls against the same session.

If a command fails, run \`browser-use close\` first to clear the session, then retry.

After navigation, submit, keypress navigation, major DOM changes, or scroll on complex pages, run \`state\` again before reusing element indices.

## Browser Modes

\`\`\`bash
browser-use --headed open <url>                # Starts Pibo-managed persistent PIBo Chrome via CDP
browser-use --fresh-profile open <url>         # Starts a fresh temporary browser profile
browser-use connect                            # Connect to local Chrome via CDP
browser-use --profile "Default" open <url>     # Upstream profile mode; Browser Use may copy it to a temp dir
\`\`\`

## Commands

\`\`\`bash
# Navigation
browser-use open <url>
browser-use back
browser-use scroll down
browser-use scroll up
browser-use switch <index>
browser-use close-tab [index]

# Page state
browser-use state
browser-use screenshot [path.png]
browser-use screenshot --full path.png

# Interactions
browser-use click <index>
browser-use click <x> <y>
browser-use type "text"
browser-use input <index> "text"
browser-use input <index> ""
browser-use keys "Enter"
browser-use keys "Control+a"
browser-use select <index> "option"
browser-use upload <index> <path>
browser-use hover <index>
browser-use dblclick <index>
browser-use rightclick <index>

# Data extraction
browser-use eval "js code"
browser-use get title
browser-use get html
browser-use get html --selector "h1"
browser-use get text <index>
browser-use get value <index>
browser-use get attributes <index>
browser-use get bbox <index>

# Wait
browser-use wait selector "css"
browser-use wait text "Success"

# Cookies
browser-use cookies get
browser-use cookies get --url <url>
browser-use cookies set <name> <value>
browser-use cookies clear
browser-use cookies export <file>
browser-use cookies import <file>

# Session
browser-use close
browser-use sessions
browser-use close --all
\`\`\`

## Authenticated Browsing

For the Pibo Chat Web App, prefer an isolated authenticated lease when multiple agents may use the browser at the same time:

\`\`\`bash
eval "$(pibo tools browser-use lease acquire --app pibo-chat --owner "$USER")"
browser-use state
\`\`\`

The lease exports \`BROWSER_USE_HOME\`, \`PIBO_BROWSER_USE_SESSION\`, \`PIBO_BROWSER_USE_CHROME_USER_DATA_DIR\`, and \`PIBO_BROWSER_USE_DEFAULT_PROFILE\`. The Pibo browser-use wrapper uses \`PIBO_BROWSER_USE_SESSION\` as the default session, so later commands can omit \`--session\` in that shell.

Before acquiring leases, prepare one authenticated template profile:

\`\`\`bash
eval "$(pibo tools browser-use auth-template env)"
browser-use --headed open http://4788.192.168.0.204.sslip.io/apps/chat
\`\`\`

Sign in once in that template browser, then close it before agents acquire leases. Inspect and clean up leases with:

\`\`\`bash
pibo tools browser-use lease list
pibo tools browser-use lease release <lease-id>
pibo tools browser-use lease reap-stale
\`\`\`

If a shared legacy session is already available, inspect it before navigating:

\`\`\`bash
browser-use --session pibo-auth state
\`\`\`

If \`pibo-auth\` is unavailable and must be recreated, the default wrapper behavior is enough:

\`\`\`bash
browser-use --headed --session pibo-auth open http://4788.192.168.0.204.sslip.io/apps/chat
\`\`\`

For authenticated sites, the default Pibo wrapper path is the persistent path. Use \`profile list\` only to inspect available Chrome profiles:

\`\`\`bash
browser-use profile list
\`\`\`

To intentionally use a real local Chrome user data directory instead of the Pibo-managed one, set \`PIBO_BROWSER_USE_CHROME_USER_DATA_DIR\` before starting the session.

If \`browser-use connect\` cannot find Chrome, ask the user whether they want to relaunch Chrome with remote debugging or use a managed Chromium profile.

## Tips

1. Apply \`eval "$(pibo tools env browser-use)"\` once per persistent shell before using the CLI from Pibo, then reuse that shell.
2. Always run \`state\` before using element indices.
3. Re-run \`state\` after navigation or large DOM changes because element indices can change.
4. For forms, verify inputs with \`get value <index>\`; \`state\` does not always show current text values.
5. For large pages, prefer \`get html --selector\`, \`get text <index>\`, or \`eval\` over dumping the full page with \`state\`.
6. Use \`--headed\` when debugging browser behavior if the env output includes a display.
7. Sessions persist until \`browser-use close\`.
8. Use \`--session NAME\` for separate browser sessions.
9. Wrap long waits or JavaScript-heavy mutations with an external timeout, for example \`timeout 30s browser-use --session NAME wait text "Success"\`.
10. Prefer \`--json\` for machine-readable \`get\` and \`sessions\` results.
11. \`select\` confirms the visible option text, while \`get value\` returns the underlying option value.
12. Avoid \`browser-use --version\`; this CLI does not support it.
13. Avoid \`extract\`; it is listed by the CLI but is not implemented in this version.
`,
};

export const REMOTE_BROWSER_GUIDE: ToolGuide = {
  name: 'remote-browser',
  description: 'Browser automation workflow for sandboxed or remote agents.',
  content: `---
name: remote-browser
description: Controls a browser from a sandboxed or remote machine. Use when the agent has no local GUI and needs to navigate websites, interact with web pages, take screenshots, or expose local dev servers via tunnels.
allowed-tools: Bash(browser-use:*)
---

# Browser Automation for Sandboxed Agents

This guide is for agents running in a sandbox, CI, cloud VM, or remote coding environment.

## Prerequisites

Initialize one persistent browser-use shell by applying the Pibo tool environment once:

\`\`\`bash
eval "$(pibo tools env browser-use)"
browser-use doctor
\`\`\`

Inside the Pibo source repo, use \`eval "$(npm run --silent dev -- tools env browser-use)"\` instead. Keep running later \`browser-use\` commands in that same shell; a new shell needs the one-time initialization again. If command substitution is not available, run the env command and apply the printed exports manually. On Linux, this lets Browser Use see a local desktop session when one exists.

## Core Workflow

1. Navigate: \`browser-use --headed --session NAME open <url>\` when a desktop is available; otherwise use \`browser-use --session NAME open <url>\`
2. Inspect: \`browser-use state\`
3. Interact with indices from state: \`browser-use click 5\`, \`browser-use input 3 "text"\`
4. Verify: \`browser-use state\`, \`browser-use get value <index>\`, \`browser-use eval "js"\`, or \`browser-use screenshot\`
5. Cleanup: \`browser-use close\`

Run browser-mutating commands one at a time per session. Use separate session names for parallel workflows.
After navigation, submit, keypress navigation, major DOM changes, or scroll on complex pages, run \`state\` again before reusing element indices.

## Browser Modes

\`\`\`bash
browser-use open <url>
browser-use --headed open <url>
browser-use connect
browser-use --cdp-url ws://localhost:9222/devtools/browser/... open <url>
\`\`\`

## Commands

\`\`\`bash
browser-use open <url>
browser-use back
browser-use state
browser-use screenshot [path.png]
browser-use click <index>
browser-use input <index> "text"
browser-use keys "Enter"
browser-use wait selector "css"
browser-use wait text "Success"
browser-use get html
browser-use eval "document.title"
browser-use switch <index>
browser-use close-tab [index]
browser-use close
\`\`\`

## Exposing Local Dev Servers

\`\`\`bash
browser-use tunnel <port>
browser-use tunnel list
browser-use open <tunnel-url>
browser-use tunnel stop <port>
\`\`\`

Tunnels are independent from browser sessions and can persist after \`browser-use close\`.

## Multiple Sessions

\`\`\`bash
browser-use --session agent-a open https://example.com
browser-use --session agent-b open https://example.org
\`\`\`

Use named sessions when multiple agents or workflows need separate browsers.

## Troubleshooting

- Browser will not start: run \`browser-use close\`, then retry.
- Element not found: run \`browser-use scroll down\`, then \`browser-use state\`.
- Form value unclear: use \`browser-use get value <index>\`.
- Large page state is noisy: use \`get html --selector\`, \`get text <index>\`, or \`eval\`.
- Need to debug visually: use \`--headed\`.
- Long wait hangs: wrap the command with \`timeout 30s\`.
- Tunnel not working: run \`browser-use tunnel list\`.
`,
};

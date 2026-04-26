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

\`\`\`bash
browser-use doctor
\`\`\`

If browser-use is not on PATH, run:

\`\`\`bash
pibo tools path browser-use
pibo tools env browser-use
\`\`\`

Use the printed executable path directly, or apply the printed environment before running browser-use.

## Core Workflow

1. Navigate: \`browser-use open <url>\`
2. Inspect: \`browser-use state\`
3. Interact with indices from state: \`browser-use click 5\`, \`browser-use input 3 "text"\`
4. Verify: \`browser-use state\` or \`browser-use screenshot\`
5. Repeat while the browser stays open

If a command fails, run \`browser-use close\` first to clear the session, then retry.

## Browser Modes

\`\`\`bash
browser-use open <url>                         # Default headless browser
browser-use --headed open <url>                # Visible browser for debugging
browser-use connect                            # Connect to local Chrome via CDP
browser-use --profile "Default" open <url>     # Use a real Chrome profile
\`\`\`

## Commands

\`\`\`bash
# Navigation
browser-use open <url>
browser-use back
browser-use scroll down
browser-use scroll up
browser-use tab list
browser-use tab new [url]
browser-use tab switch <index>
browser-use tab close <index>

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
browser-use wait selector ".loading" --state hidden
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

For authenticated sites, prefer a real Chrome profile:

\`\`\`bash
browser-use profile list
browser-use --profile "Default" open https://github.com
\`\`\`

If \`browser-use connect\` cannot find Chrome, ask the user whether they want to relaunch Chrome with remote debugging or use a managed Chromium profile.

## Tips

1. Always run \`state\` before using element indices.
2. Use \`--headed\` when debugging browser behavior.
3. Sessions persist until \`browser-use close\`.
4. Use \`--session NAME\` for separate browser sessions.
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

\`\`\`bash
browser-use doctor
\`\`\`

If browser-use is not on PATH, run:

\`\`\`bash
pibo tools path browser-use
pibo tools env browser-use
\`\`\`

## Core Workflow

1. Navigate: \`browser-use open <url>\`
2. Inspect: \`browser-use state\`
3. Interact with indices from state: \`browser-use click 5\`, \`browser-use input 3 "text"\`
4. Verify: \`browser-use state\` or \`browser-use screenshot\`
5. Cleanup: \`browser-use close\`

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
browser-use tab list
browser-use tab new [url]
browser-use tab switch <index>
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
- Need to debug visually: use \`--headed\`.
- Tunnel not working: run \`browser-use tunnel list\`.
`,
};

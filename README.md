# pibo

Pibo is a thin product boundary around Pi Coding Agent. Pi remains the inner engine for model turns, tools, streaming, sessions, and compaction. Pibo adds profiles, plugins, channels, local gateways, web auth, and operator tooling.

The default posture is intentionally powerful: Pibo is built for agentic coding and server operation, not for a restrictive sandbox. Install and run it as the Linux user that should own its state and credentials.

## Install

Pibo is distributed as an npm package:

```bash
npm install -g @pasko70/pibo
pibo --help
```

The current package declares Node.js 24+. Some Linux distributions still ship Node 22 through `apt`, so install a recent Node release first when needed. A user-local Node/npm setup through `nvm`, `fnm`, or a user-writable npm prefix works well.

For a user-local global npm prefix:

```bash
mkdir -p ~/.local
npm config set prefix ~/.local
export PATH="$HOME/.local/bin:$PATH"
npm install -g @pasko70/pibo
```

## State and user paths

Pibo stores product-wide state under:

```text
${PIBO_HOME:-~/.pibo}
```

That means the executing Linux user owns the installation state:

```text
alice -> /home/alice/.pibo
pibo  -> /home/pibo/.pibo
root  -> /root/.pibo
```

There is no requirement to run as `root`. If you SSH as root and run Pibo, state naturally lands in `/root/.pibo`. If you create or use a dedicated user, state lands in that user's home. This is the preferred way to keep SSH keys, config, logs, and sessions separated.

Workspace-scoped files are separate and live under the active workspace:

```text
<workspace>/.pibo
```

Examples include custom prompts and Pi package registrations.

## Server notes

A fresh server install usually needs only three decisions:

1. Choose the Linux user that should own Pibo.
2. Install Node.js 24+ for that user or system-wide.
3. Install Pibo through npm.

Use the setup planner to keep the first run simple:

```bash
pibo setup doctor
pibo setup user-host --domain pibo.example.com --print-files
```

This is the normal user path: one gateway, one `PIBO_HOME`, no required Docker, no dev gateway, and no GitHub App setup.

Developer hosts are opt-in and add production/dev separation plus Docker compute workers:

```bash
pibo setup developer-host \
  --origin git@github.com:<your-fork>/pibo.git \
  --prod-domain pibo.example.com \
  --dev-domain dev.pibo.example.com \
  --print-files
```

See `docs/ops/install-user-host.md`, `docs/ops/install-developer-host.md`, and `docs/ops/upgrade-user-to-developer-host.md`.

If the agent should be able to perform server administration, give that Linux user the required sudo or Docker permissions explicitly. Pibo does not need a special onboarding user to work correctly; normal Unix ownership is enough.

## Docker notes

Docker is optional. If you run Pibo in a container, avoid hard-coding `/root` unless the container is intentionally root-owned. Prefer mapping the host user's state into the container user's home:

```text
$HOME/.pibo -> /home/pibo/.pibo
$HOME/code  -> /workspace/code
```

Set `HOME` and `PIBO_HOME` consistently inside the container so the same path rule applies:

```text
HOME=/home/pibo
PIBO_HOME=/home/pibo/.pibo
```

## Web gateway auth

`pibo gateway:web` starts the authenticated web runtime. It requires Better Auth configuration before production use:

```bash
pibo config set auth.baseURL https://your-host.example
pibo config set auth.secret <at-least-32-characters>
pibo config set auth.googleClientId <google-client-id>
pibo config set auth.googleClientSecret <google-client-secret>
pibo config set auth.allowedEmails you@example.com
```

For local loopback testing, `auth.baseURL` can be `http://localhost:4788`.

## Development from source

Use source installs for development, not normal usage:

```bash
git clone git@github.com:Pascapone-server/pibo.git
cd pibo
npm install
npm run build
npm run start -- --help
```

Useful scripts:

```bash
npm run dev -- --help
npm run profile -- codex
npm run tui:routed -- codex
npm run gateway
npm run gateway:web
npm test
npm run typecheck
```

## Main CLI areas

```bash
pibo config       # local config under ${PIBO_HOME:-~/.pibo}/config.json
pibo mcp          # discover and call configured MCP servers
pibo tools        # install and inspect curated external CLI tools
pibo pi-packages  # register Pi Coding Agent packages
pibo debug        # inspect local Pibo data stores
pibo setup        # plan user-host installs and developer-host upgrades
pibo profile      # inspect runtime profiles
pibo tui          # start the direct Pi TUI
pibo tui:routed   # start the routed Pibo TUI
pibo gateway      # local gateway runtime
pibo gateway:web  # authenticated web gateway runtime
```

## Further docs

- `docs/architecture.md` describes runtime architecture and boundaries.
- `docs/mcp.md` documents MCP configuration and commands.
- `docs/tools.md` documents curated external CLI tools.
- `docs/pi-packages.md` documents Pi package registration.
- `docs/chat-rooms-event-log.md` documents Chat Web rooms and durable event storage.
- `docs/progress.md` is the short implementation status snapshot.

## Philosophy

Keep Pibo thin. Pi Coding Agent should remain the inner engine; Pibo owns only the product boundary: profiles, plugins, channels, routing, auth, policy, and operator tooling.

Optional integrations should stay outside the core package until installed. MCP servers, Python virtual environments, external CLIs, and user skills are configured on demand rather than bundled into every runtime.

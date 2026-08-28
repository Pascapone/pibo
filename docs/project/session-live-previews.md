# Session Live Previews

Session Live Previews expose an explicitly selected loopback development port through an isolated, authenticated browser origin and attach it to the Pibo Session doing the work.

## Dormant operator setup

The feature remains inactive until an operator configures a dedicated preview base hostname:

```bash
pibo config set preview.baseURL https://preview.example.com
```

For a preview id such as `pv-abcd`, Pibo serves `https://pv-abcd.preview.example.com/`. A public deployment therefore requires wildcard DNS and TLS for `*.preview.example.com`, routing to the same Pibo Web Gateway as Chat Web, including HTTP upgrade forwarding. Do not route preview hosts directly to development ports: Pibo must remain in the path for authentication, expiration, exact-target validation, concurrency admission, and credential stripping.

This repository change does not configure wildcard DNS/TLS or activate preview infrastructure on production or controller gateways.

## Agent and operator workflow

Let Preview own development-server processes instead of starting them as yielded runs:

```bash
pibo preview expose 5173 \
  --session ps_... \
  --workspace /path/to/project \
  --name "Website" \
  --command 'npm run dev'
```

The command is stored locally, launched under an exact generation-bound Preview owner, and separated from agent-turn delivery state. The CLI waits for the loopback listener and then exits. Pibo provider and authentication credentials are not deliberately forwarded to the command.

An already-running external loopback server remains supported:

```bash
pibo preview expose 5173 --session ps_... --name "External website"
```

Discover and manage previews progressively:

```bash
pibo preview
pibo preview list
pibo preview show pv-...
pibo preview start pv-...
pibo preview stop pv-...
pibo preview doctor pv-...
pibo preview remove pv-...
```

`close` remains an alias for `remove`. Stop preserves a managed Preview definition and saved command so it can be restarted; remove stops it, revokes browser access, and removes it from active lists.

Chat Web Session and Project session surfaces show a Preview tab while an authoritative session-specific response contains a Preview. Managed previews can be started, stopped, and removed there. Loading, error, unconfigured, empty, starting, stopping, online, offline, stopped, and error states never reuse another session's iframe or lifecycle state. Browser APIs omit commands, workspaces, ports, process identities, owner tokens, and internal diagnostics.

## Managed server limits

Managed starts use an instance-wide pool. Defaults are:

- maximum **3** simultaneously starting or running Preview servers;
- automatic stop **10 minutes** after each successful start attempt begins.

Change both under **Settings > Previews**. Automatic stop is a fixed runtime lease, not an inactivity timeout: HTTP, SSE, WebSocket, and HMR traffic do not extend it. Starting a stopped Preview grants a fresh lease. Gateway reconciliation handles every persisted lifecycle state and retries exact-owner cleanup when a stop fails.

## Access and security model

Any account accepted by the Pibo instance may open any active preview. Preview visibility is not partitioned by login identity.

The canonical Pibo auth cookie is never forwarded to the development application. Chat Web creates a short-lived one-time ticket, the unique preview hostname exchanges it for a hashed preview-only browser session, and that session grants access only to the fixed Preview generation until the preview or browser session expires.

- Targets are loopback-only, exact-listener pinned, and created only through the local CLI.
- Privileged and known sensitive service ports are rejected.
- Managed launch reserves capacity, generation, and exact owner before a process can start.
- Linux owner tokens plus PID/start ticks prevent PID reuse, process-group substitution, and listener replacement from authorizing cleanup or proxying.
- Preview JavaScript runs in a sandboxed iframe on a unique origin with no referrer.
- Pibo, Better Auth, machine-session, preview-auth, authorization, and forwarding credentials are stripped before upstream proxying.
- Redirects, cookies, framing policy, HTTP, streaming responses, SSE, and WebSockets are sanitized and bounded by per-preview and global connection admission.

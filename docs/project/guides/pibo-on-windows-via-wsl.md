---
type: "Guide"
title: "Pibo on Windows via WSL"
description: "Guides Windows users through installing and running Pibo inside WSL2."
tags: ["installation", "windows", "wsl"]
status: "draft"
authority: "directive"
generated:
  by: "openai/codex"
  at: "2026-09-12T13:40:00Z"
sources:
  - id: "foundation-relocation-source"
    resource: "https://github.com/Pascapone/pibo/blob/2aef244301f5d181624662fdad53e18e83e80bd9/docs/guides/pibo-on-windows-via-wsl.md"
    title: "Original Pibo on Windows via WSL guide"
    commit: "2aef244301f5d181624662fdad53e18e83e80bd9"
    path: "docs/guides/pibo-on-windows-via-wsl.md"
    sha256: "132f00469edcfa8915525bff4d0c9d82573ae53868a74db81d5224d354ce1d25"
    relation: "Rewritten for the current Linux-first gateway and Chat Web product surface."
---
# Pibo on Windows via WSL

Pibo is Linux-first. Native Windows is not supported, but Pibo runs inside WSL2 with normal Linux filesystem, process, symlink, and Docker semantics.

## Prerequisites

- Windows 10 version 2004 or later, or Windows 11.
- Administrator access for the WSL installation.
- At least 5 GB of free disk space.

Keep Pibo data and active workspaces in the WSL filesystem rather than under `/mnt/c`; Linux-native paths are faster and preserve expected file semantics.

## 1. Install and verify WSL2

Open PowerShell as Administrator:

```powershell
wsl --install
```

Reboot if prompted, complete the Linux user setup, then verify:

```powershell
wsl --status
```

The distribution must use WSL version 2. Convert an existing Ubuntu distribution when necessary:

```powershell
wsl --set-version Ubuntu 2
```

## 2. Install Node.js 24 or later inside WSL

For Ubuntu:

```bash
sudo apt update
sudo apt install -y ca-certificates curl gnupg build-essential
curl -fsSL https://deb.nodesource.com/setup_24.x | sudo -E bash -
sudo apt install -y nodejs
node --version
npm --version
```

## 3. Install Pibo

```bash
npm install -g @pasko70/pibo
pibo --version
```

Pibo Home defaults to `~/.pibo` inside WSL.

## 4. Configure authentication

For a local gateway, configure the required authentication values before startup. For example:

```bash
pibo config set auth.baseURL http://127.0.0.1:4788
pibo config set auth.secret "$(openssl rand -hex 32)"
pibo config set auth.googleClientId <google-oauth-client-id>
pibo config set auth.googleClientSecret <google-oauth-client-secret>
pibo config set auth.allowedEmails you@example.com
```

Use `http://127.0.0.1:4788/api/auth/callback/google` as the local Google OAuth redirect URI. Do not expose local-auth mode through a public proxy.

## 5. Start and verify Chat Web

Manage the gateway through the Pibo CLI:

```bash
pibo gateway web start
pibo gateway web status
```

Open `http://127.0.0.1:4788/apps/chat` in the Windows browser. WSL2 normally forwards Windows localhost to the Linux VM.

## 6. Optional Docker workers

Install Docker Desktop for Windows, enable WSL Integration for the distribution, and verify from WSL:

```bash
docker run --rm hello-world
```

Use Pibo's compute commands and Docker workflow after this check. Keep worktrees and build outputs inside WSL.

## 7. Optional browser tools

Windows 11 normally provides WSLg. Install curated browser tools through Pibo:

```bash
pibo tools install browser-use
pibo tools install agent-browser
pibo tools show browser-use
```

On systems without WSLg, configure a trusted Windows X server and `DISPLAY` before launching a headful browser.

## Troubleshooting

### Windows cannot reach the gateway

1. Confirm WSL version 2 with `wsl --status`.
2. Confirm the gateway with `pibo gateway web status` inside WSL.
3. Check Windows Firewall rules for the WSL virtual adapter.
4. As a temporary diagnostic, use the address reported by `hostname -I` inside WSL. That address can change after restart.

### `pibo setup` rejects the host

Run the command inside the WSL shell, not PowerShell or `cmd.exe`. Host apply requires Linux, systemd, root, and a supported package manager.

### Browser automation opens no visible window

Check `echo $DISPLAY`, WSLg status, and the selected browser-tool environment. Use a headful Browser Use target when validating layout, focus, keyboard, or screenshots.

## Data locations

| Path inside WSL | Purpose |
|---|---|
| `~/.pibo/config.json` | Pibo configuration |
| `~/.pibo/pibo.sqlite` | Product data |
| `~/.pibo/agent-runtimes/` | Generated runtime state |
| `~/.pibo/tools/` | Curated tool installations and browser profiles |

Back up Pibo Home before destructive host maintenance. Setup uninstall preserves Pibo Home and workspaces unless an operator removes them separately.

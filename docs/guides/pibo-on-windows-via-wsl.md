# Pibo on Windows via WSL

Pibo is a Linux-first tool. Native Windows is **not** supported, but Pibo runs unmodified inside **WSL2** because WSL2 is a real Linux kernel with full filesystem, symlink, and process semantics. This guide walks a Windows user from a fresh machine to a working `pibo` install, including the Pibo VSCode extension.

Total setup time: **15–25 minutes** on Windows 11 with WSLg enabled.

## Why WSL and not native Windows?

| | Native Windows | WSL2 |
|---|---|---|
| **Code changes** | 12+ POSIX assumptions would need workarounds | 0 — Pibo already runs on Linux |
| **Docker workers** | Docker Desktop only, paths are awkward | Docker Desktop integrates with WSL2, no friction |
| **Browser-Use / Agent-Browser** | Need WSL or WSLg anyway | Works directly under WSLg |
| **`pibo setup` (systemd, caddy)** | Would need a Windows port | Works as on Linux |
| **Symlinks, file modes, line endings** | Pain | Native |
| **Long-term maintenance** | Two code paths | One code path |

Microsoft itself recommends WSL for Linux-style development on Windows. The VSCode "WSL" extension, Docker Desktop's WSL2 backend, and Windows 11's WSLg GUI integration make WSL a first-class dev environment.

## Prerequisites

- **Windows 10 version 2004+** or **Windows 11** (any edition)
- Administrator access for the WSL install
- About 5 GB free disk space (WSL image + Pibo + node_modules)

## Step 1 — Install WSL (5 min, one-time)

Open **PowerShell as Administrator** and run:

```powershell
wsl --install
```

Default settings install Ubuntu. Reboot when prompted. On first boot, Ubuntu sets a username and password.

Verify the install:

```powershell
wsl --status
# Default Distribution: Ubuntu
# Default Version: 2
```

> **Tip:** If you want a different distro (Debian, openSUSE, Alpine…), run `wsl --install -d <DistroName>`. The rest of this guide works for any of them.

## Step 2 — Verify the WSL version (1 min)

Inside the WSL shell (run `wsl` in PowerShell to enter it), confirm WSL2:

```bash
cat /proc/sys/kernel/osrelease
# Look for "microsoft-standard-WSL2" or "WSL2" in the output.
```

If you see "Microsoft" without the WSL2 marker, your distro is on WSL1. Convert it:

```powershell
# PowerShell
wsl --set-version Ubuntu 2
```

WSL1 cannot run Docker well and lacks the full Linux kernel Pibo expects. Use WSL2.

## Step 3 — Install Node.js 24+ inside WSL (3 min)

The Ubuntu default Node is often too old. Use NodeSource:

```bash
# Inside WSL
sudo apt update
sudo apt install -y ca-certificates curl gnupg
curl -fsSL https://deb.nodesource.com/setup_24.x | sudo -E bash -
sudo apt install -y nodejs build-essential
node --version    # must print v24.x.x or higher
npm --version
```

## Step 4 — Install Pibo inside WSL (1 min)

```bash
# Inside WSL
npm install -g @pasko70/pibo
pibo --version
```

Pibo's data lives in `~/.pibo` inside the WSL filesystem. This is intentional: WSL-native paths are fast, while `/mnt/c/...` mounts are slow. Keep Pibo's working data inside WSL.

## Step 5 — Install VSCode and the WSL extension (3 min)

1. Install **VSCode for Windows** from <https://code.visualstudio.com/> (the standard Windows .exe, not the .deb).
2. In VSCode, open the **Extensions** panel (Ctrl+Shift+X) and install **WSL** by Microsoft.
3. **Open your project folder inside WSL.** In the WSL terminal:
   ```bash
   cd ~/projects/my-app    # or wherever your project lives
   code .
   ```
   VSCode opens a second VSCode window. Title bar shows the distro name in green (`[WSL: Ubuntu]`). File editing, terminal, and extensions all run inside WSL.

> **Why this step matters:** when you run `code .` from inside WSL, VSCode installs its Linux server binary inside the WSL distro, the integrated terminal becomes a WSL bash, and `code` is added to WSL's `PATH`. That is what makes `pibo vscode install` work seamlessly.

## Step 6 — Configure Pibo auth (3 min)

Pibo uses [Better Auth](https://www.better-auth.com/) with Google OAuth. Set the keys once:

```bash
# Inside WSL
pibo config set auth.baseURL http://127.0.0.1:4788
pibo config set auth.secret "$(openssl rand -hex 32)"
pibo config set auth.googleClientId <your-google-oauth-client-id>
pibo config set auth.googleClientSecret <your-google-oauth-client-secret>
pibo config set auth.allowedEmails you@example.com
```

To get Google OAuth credentials, create a Web Application client at <https://console.cloud.google.com/apis/credentials>. The redirect URI is `http://127.0.0.1:4788/api/auth/callback/google`. See the [Quick Start Guide](./pibo-vscode-quickstart.md) for the full walkthrough.

## Step 7 — Start the Pibo gateway (1 min)

```bash
# Inside WSL, leave this running in a terminal
pibo gateway:web
```

The gateway listens on `127.0.0.1:4788` **inside WSL**. Windows can reach this URL because WSL2 forwards localhost from Windows to the WSL2 VM by default.

Open a **second** WSL terminal and verify:

```bash
curl -s http://127.0.0.1:4788/api/health
# or open in your Windows browser:
# http://127.0.0.1:4788/apps/chat
```

> **If localhost does not work in the Windows browser:** the WSL2 localhost forwarder is disabled or blocked. See [Troubleshooting](#localhost-forwarding-not-working) below.

## Step 8 — Install the Pibo VSCode extension (2 min)

### Option A — from the WSL terminal (recommended)

```bash
# Inside the WSL VSCode terminal (Ctrl+`)
pibo vscode install
```

This downloads the latest VSIX from GitHub Releases and runs `code --install-extension` against the WSL `code` binary.

### Option B — from the Marketplace

Search **Pibo** by publisher `pibo` in the Extensions panel. Install the one named **Pibo** by `pibo`.

### Verify

```bash
pibo vscode status
# Should print the installed extension ID and the gateway URL.
```

Click the **Pibo** icon in the VSCode sidebar (left rail). A web view opens. Sign in with Google. The status bar at the bottom should show the room you are in.

## Step 9 — Optional — Docker workers

Pibo's compute workers run as Docker containers. To enable them on WSL:

1. Install **Docker Desktop for Windows**: <https://www.docker.com/products/docker-desktop/>
2. Open Docker Desktop → **Settings** → **Resources** → **WSL Integration**.
3. Enable the toggle for **Ubuntu** (or whichever distro you use).
4. Click **Apply & Restart**.

Test from WSL:

```bash
docker run --rm hello-world
# Should print "Hello from Docker!"
```

Pibo will detect Docker automatically. `pibo compute dev spawn --worktree <name>` now works.

## Step 10 — Optional — Browser-Use and Agent-Browser

Both tools need a graphical browser under the hood.

- **Windows 11 with WSLg** (default on fresh installs): no extra setup. Browser windows appear as regular Windows windows.
- **Windows 10 or older Windows 11 without WSLg**: install an X server in Windows (e.g. [VcXsrv](https://sourceforge.net/projects/vcxsrv/)) and export the display in WSL:
  ```bash
  # Inside WSL ~/.bashrc
  export DISPLAY=$(cat /etc/resolv.conf | grep nameserver | awk '{print $2}'):0
  ```
  Launch VcXsrv in Windows with "Disable access control" ticked.

To install the tools:

```bash
pibo tools install browser-use
pibo tools install agent-browser
pibo tools env browser-use
```

## Where Pibo stores things on WSL

| Path (inside WSL) | What |
|---|---|
| `~/.pibo/config.json` | Pibo configuration (auth, ports, etc.) |
| `~/.pibo/pibo.sqlite` | Sessions, rooms, signals |
| `~/.pibo/vscode/cache/` | VSIX cache for `pibo vscode install` |
| `<workspace>/.pibo/` | Per-workspace room state |

> Keep these inside the WSL filesystem (not under `/mnt/c/...`). Cross-FS access is slow and breaks symlinks.

## Troubleshooting

### Localhost forwarding not working

WSL2 forwards `localhost` from Windows to the WSL VM by default. If the gateway at `http://127.0.0.1:4788` is unreachable from a Windows browser:

1. **Check Windows version.** Localhost forwarding works on Windows 11 and on Windows 10 22H2+. Older builds had bugs.
2. **Check the WSL version.** Run `wsl --status` — `Default Version: 2`.
3. **Check Windows Firewall.** Allow inbound to WSL. Run in PowerShell as Admin:
   ```powershell
   New-NetFirewallRule -DisplayName "WSL" -Direction Inbound -InterfaceAlias "vEthernet (WSL)" -Action Allow
   ```
4. **Fallback:** use the WSL2 VM's IP. Inside WSL run:
   ```bash
   hostname -I
   # e.g. prints 172.21.123.45
   ```
   Then in your Windows browser use `http://172.21.123.45:4788`. The IP changes on each WSL boot, so this is a workaround, not a permanent solution.
5. **Last resort:** set up `netsh interface portproxy`:
   ```powershell
   # PowerShell as Admin
   $wslIp = wsl hostname -I
   netsh interface portproxy add v4tov4 listenport=4788 listenaddress=0.0.0.0 connectport=4788 connectaddress=$wslIp
   ```

### `pibo setup doctor` warns about native Windows

You are running Pibo from a Windows PowerShell or `cmd.exe`, not from inside WSL. Open the **WSL** terminal (or run `wsl` from PowerShell) and try again.

### Browser-Use opens a blank window

The DISPLAY is not set or the X server is not running. On Windows 11 with WSLg, `echo $DISPLAY` should print something like `:0` or `wayland-0`. On Windows 10, start VcXsrv and export `DISPLAY` as shown above.

### `pibo vscode install` cannot find `code`

This means VSCode's WSL server is not active in the current VSCode window. Run `code .` from inside WSL once, restart VSCode, then try again. If you opened VSCode directly from the Start Menu (not via `code .` in WSL), you are in the Windows VSCode instance, not the WSL one.

### File edits are slow

You are editing files on `/mnt/c/...` (the Windows drive). Move the project into the WSL filesystem (`/home/<you>/projects/...`). NTFS access from WSL is slow because of `metadata` and `umask` differences.

### Docker commands fail inside WSL

Open Docker Desktop → Settings → Resources → WSL Integration → enable your distro → **Apply & Restart**. Verify with `docker run --rm hello-world`.

## Verifying everything works

Run the following inside WSL:

```bash
pibo --version                          # 1.3.0 or higher
pibo setup doctor                       # all checks should be OK or WARN
pibo vscode status                      # extension should be installed
pibo tools list                         # should list browser-use, agent-browser, etc.
```

Open the VSCode sidebar → Pibo icon → web view loads → sign in with Google → create a new session → send a message. The status bar at the bottom should show a green dot and your room name.

If all of that works, you are fully set up.

## What we deliberately do not support

- **Native Windows** (no WSL). Pibo will print a clear error pointing you back to this guide.
- **WSL1.** WSL1 lacks the full Linux kernel Pibo expects. Use WSL2.
- **Cygwin, MSYS2, Git Bash.** These are POSIX shims, not real Linux. Pibo will not work; use WSL2.
- **Windows Containers in Docker.** Pibo compute workers target Linux containers.

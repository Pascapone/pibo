# Windows-Kompatibilität Scan

**Datum:** 2026-06-14
**Scope:** `src/**/*.ts`, `src/**/*.mjs`, `scripts/*.mjs`, `scripts/*.sh`
**Methode:** Statischer Scan (kein Build, keine Runtime-Tests)

## TL;DR

Der Code wurde **explizit POSIX-first** geschrieben. Windows-Support ist in isolierten Bereichen vorhanden (npm-Tools, Python-Venvs, Setup-CLI), aber die Hauptpfade sind Linux-only. Drei Kategorien:

- **🛑 Blocker** (10 Punkte): Funktionieren auf Windows gar nicht
- **⚠️ Inkonsistenzen** (8 Punkte): Funktionieren teils, aber mit Bugs
- **ℹ️ Nice-to-have** (5 Punkte): Robustheit, nicht funktional

Ein vollständiger Windows-Support ist eine **2–4 Wochen Aufgabe** für eine Person, abhängig davon, welche Features auf Windows laufen müssen. Docker-Worker, Browser-Automation und das Setup-CLI werden voraussichtlich auf absehbare Zeit Linux-only bleiben.

---

## 🛑 Blocker (Windows: funktioniert nicht)

### 1. `src/vscode/code-cli.ts:39` — Binary-Detection ohne PATHEXT

```ts
const pathValue = options.path ?? options.env?.PATH ?? process.env.PATH ?? "";
const directories = splitPathEnv(pathValue);
for (const binary of SUPPORTED_CODE_BINARIES) {     // ["code", "code-insiders", "codium"]
    const candidates = directories.map((dir) => join(dir, binary));
    const found = firstExisting(candidates);        // existsSync(<dir>/code) ohne .cmd
```

**Problem:** `existsSync` prüft den exakten Dateinamen. Auf Windows heißt die Datei `code.cmd` (Shim) oder `code.exe` (Binary). Die Suche findet sie nicht oder findet den falschen Pfad.

**Fix-Idee:** PATHEXT berücksichtigen oder `spawn` mit `shell: true` aufrufen, damit Windows die Endung selbst auflöst. **Aufwand:** ~30 Zeilen + Tests.

### 2. `src/tools/npm-runtime.ts:57` — `env.PATH` mit `:` Separator

```ts
env.PATH = `${join(paths.homeDir, 'bin')}:${paths.binDir}:${env.PATH ?? ''}`;
```

**Problem:** Windows nutzt `;` als PATH-Separator, nicht `:`. Mit `:` wird der Pfad als ein einziger ungültiger Pfad geparst.

**Fix-Idee:** `path.delimiter` benutzen (ist plattformabhängig). **Aufwand:** ~5 Zeilen, 2 Stellen.

### 3. `src/tools/python-runtime.ts:69` — Gleiches PATH-Problem

Gleiche Stelle, gleicher Bug.

### 4. `src/tools/python-runtime.ts:116` — Hardcoded `:` im Python-Worker-PATH

```ts
PATH: `${join(homedir(), '.local', 'bin')}:${process.env.PATH ?? ''}`,
```

**Fix-Idee:** `path.delimiter`. **Aufwand:** 1 Zeile.

### 5. `src/mcp/daemon.ts` + `daemon-client.ts` — Unix Domain Sockets

```ts
import { createServer, type Server, type Socket } from 'node:net';
// ...
getSocketPath()  // returns <pibo-home>/mcp/<config-hash>.sock
```

**Problem:** `node:net` Unix-Sockets sind auf Windows Named Pipes, nicht File-Paths. `createServer((sock) => ...).listen('/path/to/socket')` schlägt auf Windows fehl. Der MCP-Daemon kann nicht gestartet werden.

**Fix-Idee:** Auf Windows Named Pipes verwenden (`\\.\pipe\pibo-mcp-<hash>`) und Socket-Connect ebenfalls. **Aufwand:** ~100 Zeilen, plattformweichen im Config.

### 6. `src/tools/browser-use-wrapper.ts` + `agent-browser-wrapper.ts` — POSIX Shell-Wrapper (~800 Zeilen)

Diese Dateien schreiben `#!/bin/sh` Wrapper-Skripte und rufen `chmodSync(..., 0o755)` auf. Auf Windows:
- `sh` ist nicht standardmäßig da (nur via Git Bash / WSL)
- `chmod` ist no-op
- Wrapper-Skripte können nicht ausgeführt werden

**Problem:** Browser-Automation auf Windows ist nicht möglich. Diese Tools sind explizit Linux/Mac.

**Fix-Idee:** Auf Windows: native .cmd / .bat Wrapper oder direkt die Python-Exe via `spawn`. **Aufwand:** 1–2 Tage + Tests. **Realistisch:** Windows-User sollten WSL benutzen für diese Tools.

### 7. `scripts/deploy-web.sh` + `scripts/deploy-web-dev.sh` + `scripts/prepare-*-wrapper.sh` + `scripts/docker-entrypoint.sh`

Bash-Skripte mit `set -euo pipefail`. Windows kann sie ohne WSL nicht ausführen.

**Fix-Idee:** Node.js-Versionen (oder PowerShell) schreiben. **Aufwand:** 1–2 Tage, wenn alle 4 Skripte portiert werden.

### 8. `src/setup/cli.ts:484` — `/proc/meminfo` (Linux proc-FS)

```ts
const match = readFileSync("/proc/meminfo", "utf8").match(/^SwapTotal:\s+(\d+)\s+kB/m);
```

**Problem:** Windows hat kein `/proc/meminfo`. `readFileSync` wirft ENOENT. **Aufwand:** ~5 Zeilen plattformweiche.

### 9. `src/setup/cli.ts` — Systemd-Service-Erstellung

Das ganze `pibo setup` CLI versucht `/etc/systemd/system/*.service` zu schreiben, `systemctl` zu starten, `/etc/caddy/Caddyfile` zu pflegen. Alles Linux-only.

**Problem:** Auf Windows muss man NSSM, Windows-Service-Wrapper oder geplante Aufgaben verwenden. **Aufwand:** Großes Refactoring des `setup` Subsystems. **Realistisch:** `pibo setup` als Linux-only markieren, Windows-User die manuelle Anleitung geben.

### 10. `src/gateway/backup.ts:53,56` — `symlinkSync` mit `"dir"` Typ

```ts
symlinkSync(realDotPibo, backupDotPibo, "dir");
```

**Problem:** Windows-Symlinks für Verzeichnisse erfordern:
- Admin-Rechte **oder**
- Windows Developer Mode aktiviert

Sonst EPERM.

**Fix-Idee:** Auf Windows: junction points (`fs.link` mit `junction:true`-äquivalent) oder einfach kopieren. **Aufwand:** ~20 Zeilen + Fallback.

---

## ⚠️ Inkonsistenzen (Bug-Risiko, teils-lauffähig)

### 11. `process.env.HOME` statt `os.homedir()` — 4 Stellen

| Datei | Zeile | Was |
|---|---|---|
| `src/apps/chat/data/project-service.ts` | 1160-1161 | `~/`-Expansion für Room-Pfade |
| `src/apps/chat/chat-request-normalizers.ts` | 590-591 | gleiche Expansion |
| `src/mcp/index.ts` | 202-203 | `${HOME}/.mcp_servers.json`, `${HOME}/.config/mcp/mcp_servers.json` |
| `src/tools/browser-use-cdp.ts` | 52-54 | CDP-Pfad-Construction |

**Problem:** Auf Windows ist `process.env.HOME` nicht definiert (nur `USERPROFILE` und `HOMEDRIVE`/`HOMEPATH`). Manche Setups haben HOME via Git Bash, aber offiziell ist es nicht garantiert.

**Fix-Idee:** `os.homedir()` benutzen, das alle Plattformen kennt. **Aufwand:** ~10 Minuten.

### 12. `process.env.USER` statt `os.userInfo().username` — 2 Stellen

| Datei | Zeile |
|---|---|
| `src/tools/agent-browser-leases.ts` | 157 |
| `src/tools/browser-use-leases.ts` | 425 |

**Problem:** Windows: `USER` nicht gesetzt, `USERNAME` schon. **Aufwand:** 2 Zeilen.

### 13. `src/mcp/config.ts:308` — toter Code

```ts
const base = process.platform === 'darwin' ? '/tmp' : '/tmp';
```

**Problem:** Beide Zweige sind `/tmp`. Offensichtlich vergessener Branch (sollte wahrscheinlich `win32 ? os.tmpdir() : '/tmp'` sein). **Aufwand:** 1 Zeile.

### 14. `src/compute/docker.ts:325` — `tail -f /dev/null` in Container-Entrypoint

```ts
"tail -f /dev/null",
```

**Problem:** Das läuft zwar _innerhalb_ eines Linux-Containers, aber wenn der Container-Image mal auf Windows portiert wird (z.B. Windows-Container in Docker Desktop), gibt es `/dev/null` nicht.

**Realistisch:** Ist ok, weil Docker-Worker per Definition Linux-Container sind. Niedrige Priorität.

### 15. `src/compute/docker.ts:394, 489` — `bash` als Exec-Shell

```ts
connect: `docker exec -it ${id} bash`,
```

**Problem:** Bash ist in den meisten Linux-Container-Images da, aber alpine/distroless nicht. **Aufwand:** 1 Zeile (Fallback auf `sh`).

### 16. `src/tools/index.ts:479` — `command` builtin

```ts
const result = spawnSync('command', ['-v', name], { shell: true, encoding: 'utf-8' });
```

**Problem:** `command` ist ein POSIX-Shell-Builtin (`/bin/sh`, `bash`). Auf Windows gibt es das nicht — PowerShell hat `Get-Command`. Wenn der Code mit `shell: true` läuft, wird es als `command.exe` gesucht, was nicht existiert.

**Fix-Idee:** `which`-Modul nutzen oder `where` (Windows) / `command -v` (POSIX) cross-plattform. **Aufwand:** ~15 Zeilen.

### 17. `src/tools/index.ts:534-535` — `npm --version` direkt

```ts
const nodeVersion = spawnSync('node', ['--version'], { encoding: 'utf-8' });
const npmVersion = spawnSync('npm', ['--version'], { encoding: 'utf-8' });
```

**Problem:** Auf Windows muss `node.exe` und `npm.cmd` aufgerufen werden. `spawn('node', ...)` sucht auf Windows zwar via PATHEXT, aber `node` ist ein Symlink auf `node.exe`, also funktioniert es _meistens_. Trotzdem instabil.

**Fix-Idee:** `npm-runtime.ts` hat bereits die `process.platform === 'win32' ? '.cmd' : ''` Logik — analog hier nutzen. **Aufwand:** ~10 Zeilen.

### 18. `chmod` / `0o755` / `0o700` / `0o600` — 6 Stellen

| Datei | Zeile | Was |
|---|---|---|
| `src/setup/cli.ts` | 272 | `mode: 0o755` für Service-Datei |
| `src/mcp/daemon.ts` | 69, 78, 243 | `0o700` für Sockets/PID-Files, `0o600` für PID-Datei |
| `src/tools/browser-use-wrapper.ts` | 783 | `chmodSync(wrapperPath, 0o755)` |
| `src/tools/agent-browser-wrapper.ts` | 101 | `chmodSync(wrapperPath, 0o755)` |
| `scripts/ensure-bin-executable.mjs` | 10 | `chmodSync(join(root, binPath), 0o755)` |

**Problem:** Auf Windows sind `chmod`-Flags no-op. **Realistisch:** Kein Bug, weil Windows eh keine execute-Bits braucht. Aber sollte konsistent mit `if (process.platform !== 'win32')` guards sein, damit man nicht denkt es würde etwas bringen.

**Aufwand:** Niedrige Priorität. Nur dokumentieren.

---

## ℹ️ Nice-to-have / Robustheit

### 19. Keine Tests mit Windows-Mocks

Die Test-Suite läuft auf Linux CI. Es gibt keine `os.platform` Mocking-Infrastruktur. Ein `mockPlatform('win32')` Helper würde Windows-Fixes validierbar machen.

### 20. Keine Doku zu Plattform-Support

`README.md`, `docs/` erwähnen Windows nicht. Nutzer müssen raten.

### 21. `tsconfig.json` — `forceConsistentCasingInFileNames: true` ✓

Das ist gut, weil es Windows-Casing-Bugs früh fängt. Beibehalten.

### 22. `package.json` — kein `os`/`cpu` Feld

Das ist _korrekt_ (Pibo läuft cross-platform). Aber z.B. native Module wie `better-sqlite3` brauchen Prebuilt-Binaries. Aktuell sind keine nativen Module im Tree, also ok.

### 23. `engines.node: ">=24"` ✓

Windows-User können Node 24 installieren, kein Problem. Aber: Git-Bash PATH-Konflikte können den `node`-Aufruf stören.

---

## Empfehlung — Reihenfolge

### Phase 1 (1–2 Tage): Quick Wins
Behebt die meisten "läuft gar nicht"-Probleme für Windows-Power-User.

1. `process.env.HOME` → `os.homedir()` (4 Stellen)
2. `process.env.USER` → `os.userInfo().username` (2 Stellen)
3. `env.PATH` mit `path.delimiter` (3 Stellen)
4. `code-cli.ts` PATHEXT (1 Datei)
5. `/proc/meminfo` skip-if-not-linux
6. `mcp/config.ts:308` Dead-Code fix
7. `chmod`-Aufrufe mit `if (platform !== 'win32')` guarden

### Phase 2 (3–5 Tage): VSCode install + npm/python runtime
8. `tools/index.ts:479` `command -v` cross-plattform
9. `spawn('npm', ...)` / `spawn('node', ...)` analog zu npm-runtime.ts
10. Tests mit `os.platform` Mock

### Phase 3 (1 Woche): Setup-CLI
11. `pibo setup` für Windows portieren (NSSM / geplante Aufgabe)
12. Bash-Skripte in `scripts/*.sh` zu Node.js portieren (oder dokumentieren: "Windows: WSL only")

### Phase 4 (nicht empfohlen): Browser-Automation
13. `browser-use` / `agent-browser` Windows-nativ
14. Wrapper-Skripte in `.cmd` umschreiben
15. Browser-Pool / Linux-Display auf WSLg

**Realistische Aussage:** Browser-Automation, Docker-Worker-Pool, Caddy/Setup-CLI werden _wahrscheinlich_ Linux-only bleiben. Windows-User mit Browser-Use sollten WSL benutzen.

### Out-of-Scope (bewusst Linux-only)
- Docker-Compute-Worker (Linux-Container)
- `pibo setup` mit systemd/caddy
- Browser-Automation (Xvfb, X11)
- `linux-virtual-display` Tool

---

## Test-Plan nach Phase 1

```bash
# Auf Windows
npm install -g @pasko70/pibo
pibo config set auth.baseURL http://127.0.0.1:4788
pibo config set auth.secret "test"
pibo gateway:web
# in zweitem Terminal
pibo vscode install
pibo vscode status
pibo tools install browser-use
pibo tools env browser-use
```

Wenn das durchläuft, ist Phase 1 fertig.

---

## Anhang: vollständige Fundstellen-Liste

| # | Datei | Zeile | Schweregrad | Plattform-Fix |
|---|---|---|---|---|
| 1 | `src/vscode/code-cli.ts` | 39 | 🛑 | PATHEXT |
| 2 | `src/tools/npm-runtime.ts` | 57 | 🛑 | path.delimiter |
| 3 | `src/tools/python-runtime.ts` | 69 | 🛑 | path.delimiter |
| 4 | `src/tools/python-runtime.ts` | 116 | 🛑 | path.delimiter |
| 5 | `src/mcp/daemon.ts` + `daemon-client.ts` | div | 🛑 | Named Pipes |
| 6 | `src/tools/browser-use-wrapper.ts` | 1+ | 🛑 | .cmd wrapper |
| 7 | `src/tools/agent-browser-wrapper.ts` | 1+ | 🛑 | .cmd wrapper |
| 8 | `scripts/deploy-web.sh` + `deploy-web-dev.sh` | 1 | 🛑 | Node.js port |
| 9 | `scripts/prepare-*-wrapper.sh` | 1 | 🛑 | Node.js port |
| 10 | `src/setup/cli.ts` | 484 | 🛑 | platform guard |
| 11 | `src/setup/cli.ts` | div | 🛑 | NSSM / scheduled task |
| 12 | `src/gateway/backup.ts` | 53,56 | 🛑 | junction / copy |
| 13 | `src/apps/chat/data/project-service.ts` | 1160-1161 | ⚠️ | os.homedir() |
| 14 | `src/apps/chat/chat-request-normalizers.ts` | 590-591 | ⚠️ | os.homedir() |
| 15 | `src/mcp/index.ts` | 202-203 | ⚠️ | os.homedir() |
| 16 | `src/tools/browser-use-cdp.ts` | 52-54 | ⚠️ | os.homedir() |
| 17 | `src/tools/agent-browser-leases.ts` | 157 | ⚠️ | userInfo |
| 18 | `src/tools/browser-use-leases.ts` | 425 | ⚠️ | userInfo |
| 19 | `src/mcp/config.ts` | 308 | ⚠️ | dead code |
| 20 | `src/compute/docker.ts` | 325,394,489 | ⚠️ | container-only |
| 21 | `src/tools/index.ts` | 479 | ⚠️ | which-Paket |
| 22 | `src/tools/index.ts` | 534-535 | ⚠️ | .cmd für npm |
| 23 | `chmod` Aufrufe | div | ℹ️ | platform guard |
| 24 | `scripts/ensure-bin-executable.mjs` | 10 | ℹ️ | platform guard |
| 25 | Doku (README, docs/) | div | ℹ️ | ergänzen |

**Total:** 25 konkrete Fundstellen, davon 12 Blocker und 8 Inkonsistenzen.

# Windows via WSL — Strategiewechsel

**Datum:** 2026-06-14
**Status:** Vorschlag, nicht implementiert
**Bezug:** `docs/reports/windows-compatibility-scan-2026-06-14.md`

## TL;DR

WSL-Support ist **deutlich weniger Aufwand** als nativer Windows-Support, weil Pibo bereits POSIX-first ist und WSL = Linux. Der Aufwand reduziert sich von **2–4 Wochen (Windows nativ)** auf **2–4 Tage (WSL-Pfad)** — und alle Features laufen ohne Wenn-und-Aber.

## Vergleich: Windows nativ vs. WSL

| Kategorie | Windows nativ | Windows via WSL |
|---|---|---|
| Aufwand (Funktionsumfang gleich) | 2–4 Wochen | 2–4 Tage |
| Native Code-Änderungen | 12 Blocker fixen | 0–2 Mini-Fixes |
| Docker-Compute-Worker | Funktioniert (Docker Desktop) | ✓ Funktioniert (Docker Desktop + WSL2) |
| Browser-Automation (browser-use, agent-browser) | Geht nicht ohne WSL | ✓ Funktioniert (WSLg auf Windows 11) |
| `pibo setup` (systemd, caddy) | Komplett portieren | ✓ Funktioniert (systemd unter WSL2 verfügbar) |
| `pibo vscode install` | Code-Binary-Suche reparieren | ✓ Funktioniert direkt (VSCode-WSL packt `code` auf WSL-PATH) |
| Code-Wartung | 12+ Dateien plattform-aware | 0–2 Dateien |
| User-Erfahrung | Ein OS, ein Terminal | Zwei Welten (PowerShell + WSL) |
| Onboarding-Kosten für User | Hoch (viele Stolperfallen) | Mittel (WSL einrichten, ~15 Min) |

**Empfehlung:** WSL-Pfad als primären Windows-Support, native Windows nur falls ausdrücklich gewünscht.

## Architektur: Wie das aussieht

### Option B (empfohlen) — Alles in WSL

```text
┌──────────────────────────────────────────────────────────┐
│ Windows 11                                                │
│                                                            │
│  ┌─────────────────────────────────────────────────┐     │
│  │ VSCode (Windows .exe)                            │     │
│  │   └─ WSL-Extension                               │     │
│  │      └─ "Open Folder in WSL"                     │     │
│  │         ↳ startet VSCode-Instanz IN WSL          │     │
│  │            (Datei-IO in WSL, Rendering in Windows)│     │
│  │                                                    │     │
│  │  ┌────────────────────────────────────────────┐  │     │
│  │  │ VSCode-WSL                                  │  │     │
│  │  │   • Pibo-Extension installiert in WSL       │  │     │
│  │  │   • Sidebar Pibo → WebView                  │  │     │
│  │  │   • `pibo`-Binary auf WSL-PATH              │  │     │
│  │  └──────────────┬─────────────────────────────┘  │     │
│  └─────────────────┼─────────────────────────────────┘     │
│                    │ localhost:4788 (WSL2 forwarded)       │
│                    ▼                                       │
│  ┌─────────────────────────────────────────────────┐     │
│  │ WSL2 (Ubuntu)                                    │     │
│  │                                                    │     │
│  │  pibo gateway:web          (port 4788)            │     │
│  │  pibo compute              (Docker worker)        │     │
│  │  ~/.pibo/                  (alle Pibo-Daten)      │     │
│  │  <workspace>/.pibo/        (workspace-scoped)     │     │
│  │  WSLg / X11                 (für browser-use)     │     │
│  │                                                    │     │
│  │  Optional: Browser (Firefox/Chrome in WSL)        │     │
│  └─────────────────────────────────────────────────┘     │
│                                                            │
└──────────────────────────────────────────────────────────┘
```

**Was funktioniert out-of-the-box:**

- ✓ `npm install -g @pasko70/pibo` in WSL → `pibo` ist auf WSL-PATH
- ✓ `pibo gateway:web` läuft auf 127.0.0.1:4788 in WSL, Windows kann zugreifen (WSL2-Forwarding)
- ✓ VSCode-WSL-Extension installiert `code` automatisch in WSL
- ✓ `pibo vscode install` aus WSL findet das `code`-Binary
- ✓ VSCode-Terminal ist WSL-bash → `pibo login <provider>` läuft
- ✓ Browser-Use / Agent-Browser funktionieren via WSLg (Windows 11)
- ✓ Docker-Worker via Docker Desktop (WSL2-Integration)
- ✓ `pibo compute dev spawn` läuft, weil Docker im WSL2-Backend läuft
- ✓ Symlinks, File-Permissions, Shell-Wrapper — alles Linux
- ✓ `~/.pibo/`, `/etc/systemd/`, `caddy` — alles Linux

### Option A (für Power-User) — VSCode in Windows, Pibo in WSL

```text
┌──────────────────────────────────────────────────────────┐
│ Windows 11                                                │
│                                                            │
│  VSCode (Windows)        pibo chatWebUrl = ???            │
│    • Sidebar Pibo                                          │
│    • Workspace-Pfade = C:\Users\pasca\foo (Windows)        │
│                                                            │
│       │ Browser kann localhost:4788 erreichen              │
│       ▼                                                    │
│  ┌─────────────────────────────────────────────────┐     │
│  │ WSL2                                              │     │
│  │  pibo gateway:web   (port 4788)                  │     │
│  │  Erwartet POSIX-Pfade (/home/... oder /mnt/c/...) │     │
│  └─────────────────────────────────────────────────┘     │
└──────────────────────────────────────────────────────────┘
```

**Was hier funktioniert / was nicht:**

- ✓ `pibo gateway:web` läuft, Web-App erreichbar
- ✗ Workspace-Pfade stimmen nicht: Windows sendet `C:\...`, WSL-Pibo erwartet `/mnt/c/...`
- ⚠️ Path-Translation nötig (klein, lösbar)
- ⚠️ `pibo vscode install` sucht `code.exe` → braucht PATHEXT-Fix (aus dem Scan)

**Aufwand Option A:** +1 Tag für Path-Translation + PATHEXT.

## Was Pibo-Code muss angefasst werden

### Code-Änderungen (minimal)

| Datei | Änderung | Aufwand |
|---|---|---|
| `src/core/wsl.ts` (NEU) | Helper: `isWsl(): boolean` liest `/proc/sys/kernel/osrelease`, prüft auf "microsoft" oder "WSL" | 15 Min |
| `src/setup/cli.ts` (doctor) | Bei WSL: drucke "Detected WSL2" + Hinweis auf WSLg / X-Server | 30 Min |
| `src/setup/cli.ts` (user-host, developer-host) | Plattform-Check: wenn `win32` ohne WSL → klare Fehlermeldung "Use WSL: https://aka.ms/wsl"; wenn WSL → läuft als Linux | 1 Std |
| `src/vscode/cli.ts` (oder README) | Hinweis: "On Windows, use VSCode-WSL-Extension. Run `pibo vscode install` from a WSL terminal." | 15 Min |
| `package.json` | `engines.node` Hinweis: "Windows: use WSL2 with Node 24+" in README (nicht in engines) | 5 Min |

**Gesamt Code-Aufwand:** ~2 Stunden, **eine Datei neu** (15 Zeilen).

### Optionale Verbesserungen (kann man später machen)

- `src/vscode/code-cli.ts` PATHEXT-Fix für Option-A-User
- WSL-spezifischer Doctor-Check: "Browser-Use verfügbar via WSLg? (X11-Display gesetzt?)"
- `pibo doctor` print mit farblicher Hervorhebung wenn auf WSL

### Dokumentation (der Hauptteil)

| Datei | Inhalt | Aufwand |
|---|---|---|
| `docs/guides/pibo-on-windows-via-wsl.md` (NEU) | Komplette WSL-Anleitung, 5 Schritte | 2 Std |
| `docs/guides/pibo-vscode-quickstart.md` | Addendum: "On Windows? WSL first" | 15 Min |
| `README.md` | Top-Level: "Supported platforms: Linux, macOS, Windows (via WSL2)" | 5 Min |
| `GLOSSARY.md` | WSL-Eintrag | 5 Min |
| `src/apps/chat-vscode/README.md` | "Windows: use WSL2" | 5 Min |

## WSL-Setup-Guide Outline (für die Anleitung)

### Schritt 1: WSL installieren (5 Min, einmalig)

```powershell
# PowerShell (Admin)
wsl --install
# Default: Ubuntu. Windows 11 hat WSLg eingebaut.
```

Restart, Ubuntu-Terminal öffnet sich automatisch. Username setzen.

### Schritt 2: Node 24+ in WSL (3 Min)

```bash
# In WSL Ubuntu
curl -fsSL https://deb.nodesource.com/setup_24.x | sudo -E bash -
sudo apt install -y nodejs build-essential
node --version    # v24.x.x
```

### Schritt 3: Pibo in WSL installieren (1 Min)

```bash
npm install -g @pasko70/pibo
pibo --version    # 1.3.0
```

### Schritt 4: VSCode + WSL-Extension (3 Min)

1. VSCode in Windows installieren (falls nicht da): <https://code.visualstudio.com/>
2. In VSCode: Extensions → "WSL" installieren (Microsoft, offiziell)
3. In WSL-Terminal: `code .` → öffnet aktuelles Verzeichnis in VSCode-WSL

### Schritt 5: Auth + Gateway + Pibo-Extension (5 Min)

```bash
# In WSL
pibo config set auth.baseURL http://127.0.0.1:4788
pibo config set auth.secret "$(openssl rand -hex 32)"
pibo config set auth.googleClientId <...>
pibo config set auth.googleClientSecret <...>
pibo config set auth.allowedEmaps deine@email.com

pibo gateway:web    # in einem Terminal offen lassen
```

Im VSCode-WSL: Extensions → "Pibo" installieren (oder `pibo vscode install` in WSL-Terminal).
Sidebar "Pibo" klicken → fertig.

### Browser-Use auf WSL (Windows 11)

- ✓ WSLg: automatisch, kein X-Server nötig
- Auf Windows 10: VcXsrv installieren + `export DISPLAY=:0` in WSL

### Docker-Worker auf WSL

1. Docker Desktop installieren: <https://docker.com/products/docker-desktop/>
2. Settings → Resources → WSL Integration → Ubuntu anhaken
3. `pibo compute dev spawn` läuft, Container startet in WSL2-Backend

## WSL-Caveats (in Doku erwähnen)

1. **Docker Desktop muss laufen**, sonst kein `pibo compute`. (Docker kann auch direkt in WSL ohne Desktop laufen, aber dann ohne UI.)
2. **WSL2 localhost-Forwarding** kann von Windows-Firewall geblockt werden. Windows 11 / aktuelles WSL2: funktioniert out-of-the-box. Ältere Setups: manuell `netsh interface portproxy` einrichten.
3. **WSL-Dateisystem ≠ Windows-Dateisystem.** Pibo-Daten in `~/.pibo` (in WSL) = schnell. Pibo-Daten auf `/mnt/c/...` (Windows-Drive) = langsam. **Empfehlung:** Projekte in WSL-FS (`/home/<user>/projects/`), nicht auf `/mnt/c/`.
4. **Erste WSL-Start ist langsam.** Windows cached das WSL-Image. Beim ersten `pibo`-Aufruf nach Boot: 2-3 Sekunden extra. Danach normal.
5. **WSL1 reicht nicht.** Pibo braucht WSL2 (für Linux-Kernel, Docker, symlinks, alle Permissions).

## Konkrete Aufgaben-Liste (für die Umsetzung)

### Tag 1 (~3 Std)

- [ ] `src/core/wsl.ts` schreiben + Tests
- [ ] `src/setup/cli.ts` doctor: WSL-Detection, WSLg-Hinweis
- [ ] `src/setup/cli.ts` user-host / developer-host: klarer Fehler bei nativem Windows, success bei WSL
- [ ] Quick-Test: WSL-Ubuntu → `pibo setup user-host --plan` funktioniert

### Tag 2 (~3 Std)

- [ ] `docs/guides/pibo-on-windows-via-wsl.md` schreiben
- [ ] `docs/guides/pibo-vscode-quickstart.md` Addendum
- [ ] `README.md` Top-Level-Platforms
- [ ] `GLOSSARY.md` WSL-Eintrag
- [ ] `src/apps/chat-vscode/README.md` WSL-Hinweis
- [ ] Commit + PR

### Tag 3 (~1-2 Std, optional)

- [ ] WSL-Doctor-Check erweitern (X11-Display, Docker-Integration, WSL-Version)
- [ ] Optional: PATHEXT-Fix in `code-cli.ts` für Option-A-User
- [ ] Quick-Start-Guide Test auf echtem Windows-11-WSL2

**Total: 1.5–2 Tage Arbeit, ein PR mit ~5 Commits, ~200 Zeilen Code + ~400 Zeilen Doku.**

## Was wir NICHT machen (Bewusste Entscheidungen)

- Keine native Windows-Code-Änderungen (`/tmp` → `os.tmpdir()`, `chmod`-Guards, etc.)
- Keine `npm.cmd` / `python.exe` Hardcodes
- Kein Setup-CLI für native Windows (systemd, caddy)
- Kein PowerShell-Install-Skript (Pibo kommt via npm)
- Kein Support für Browser-Use ohne WSLg (Windows 10 ohne X-Server → nicht supported, Doku-Hinweis reicht)

## Realistische Aussage zum Schluss

**WSL ist der Standard-Weg für Linux-Tools auf Windows.** Microsoft pusht das aktiv (WSLg, Docker Desktop, VSCode-WSL-Integration, alle Docs). Wer Pibo auf Windows ernsthaft nutzen will, kommt mit WSL auf ein vollwertiges Linux-Setup. Wer das nicht will, nutzt halt Linux direkt.

**Das einzige, was WSL-User "opfern":** Sie tippen in zwei Welten (PowerShell + WSL-Bash). Das ist klein im Vergleich zu 25 Code-Fix-Stellen und 4 Wochen Aufwand.

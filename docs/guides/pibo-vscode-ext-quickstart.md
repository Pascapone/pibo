# Pibo Quick Start — CLI + VS Code Extension

Diese Anleitung bringt dich in ungefähr 15 Minuten vom frischen Laptop zur
laufenden Pibo-VSCode-Extension.

## Was du am Ende hast

- `pibo` CLI global installiert
- Ein laufendes `pibo gateway:web` (Auth-Gateway) auf `http://127.0.0.1:4788`
- Die Pibo VS Code Extension in deinem Editor
- Eine erste Session in deinem aktuellen Projekt-Workspace

## 0. Voraussetzungen

| Was | Warum | Wie prüfen |
|---|---|---|
| **Node.js 24+** | Pibo läuft auf Node 24 (steht so in `package.json#engines`) | `node --version` |
| **VS Code** (oder Insiders / VSCodium) | Ziel der Extension | `code --version` |
| **Internet** | npm + GitHub Releases | ping `registry.npmjs.org` |
| Optional: **Google OAuth Client** | Echter Login via Google | Console holen: <https://console.cloud.google.com/apis/credentials> |

Falls dein `apt`-Node zu alt ist: <https://nodejs.org/en/download> oder `fnm`/`nvm` benutzen.

## 1. Pibo CLI installieren

```bash
npm install -g @pasko70/pibo
pibo --version        # soll 1.3.0 (oder neuer) zeigen
pibo --help           # zeigt die Top-Level-Commands
```

Falls du eine Permission-Fehlermeldung bekommst (Linux/macOS):

```bash
mkdir -p ~/.local
npm config set prefix ~/.local
export PATH="$HOME/.local/bin:$PATH"
npm install -g @pasko70/pibo
```

Diese PATH-Zeile am besten in deine `~/.bashrc` / `~/.zshrc` schreiben.

## 2. Auth einrichten (einmalig)

Pibo nutzt Better Auth + Google OAuth. Die Werte landen in `~/.pibo/config.json`.

```bash
pibo config set auth.baseURL http://127.0.0.1:4788
pibo config set auth.secret "$(openssl rand -hex 32)"   # beliebiger 32+ Zeichen-String
pibo config set auth.googleClientId     <aus-google-console>
pibo config set auth.googleClientSecret <aus-google-console>
pibo config set auth.allowedEmails      deine@email.com
```

**Woher bekomme ich die Google-Werte?**
1. <https://console.cloud.google.com/apis/credentials> öffnen
2. "OAuth 2.0 Client IDs" → "Create OAuth client ID" → Typ "Web application"
3. Authorized redirect URIs: `http://127.0.0.1:4788/api/auth/callback/google` eintragen
4. Client ID und Client Secret in die Config setzen
5. In deiner Google-Console unter "OAuth consent screen" die gewünschten Test-User hinzufügen

**Lokal ohne Google testen?** Setze `auth.baseURL=http://localhost:4788` und melde dich ohne externe Auth an (Pibo akzeptiert auf Loopback auch direkten Zugriff). Für die VSCode-Extension reicht das zum Ausprobieren.

Verify:

```bash
pibo config show
```

## 3. Gateway starten

In einem Terminal (das Terminal offen lassen):

```bash
pibo gateway:web
```

Erwartete Ausgabe (ungefähr):

```text
[gateway:web] listening on http://127.0.0.1:4788
[gateway:web] auth baseURL = http://127.0.0.1:4788
```

Im Browser öffnen: <http://127.0.0.1:4788>. Du solltest die Pibo-Web-Oberfläche sehen und dich einloggen können.

> Tipp: Wenn du das Gateway dauerhaft laufen lassen willst (z.B. auf einem
> Server), schau dir `pibo gateway web status/start/restart` an — das ist
> der produktive Pfad mit `pibo-web.service` dahinter.

## 4. VS Code Extension installieren

Du hast zwei Wege.

### Weg A: Über die CLI (empfohlen)

```bash
pibo vscode install
```

Das Script:

1. Findet deine `code` (oder `code-insiders` / `codium`) Binary im PATH
2. Lädt die neueste VSIX aus dem GitHub Release von `Pascapone/pibo`
3. Installiert sie via `code --install-extension <vsix>`
4. Verifiziert mit `code --list-extensions --show-versions`

Verify:

```bash
pibo vscode status
```

Erwartete Ausgabe:

```text
extension:   pibo.pibo-vscode@1.3.0 installed
binary:      code (at /usr/bin/code)
latest:      v1.3.0
cache:       /home/<du>/.pibo/vscode/cache/v1.3.0/pibo.vsix
```

### Weg B: Über den VS Code Marketplace

1. VS Code öffnen
2. Sidebar → Extensions (`Ctrl+Shift+X` / `Cmd+Shift+X`)
3. Suchen nach "Pibo" (Publisher: `pibo`)
4. "Install" klicken

Falls die Extension noch nicht im Marketplace sichtbar ist, nimm Weg A — der lädt direkt aus dem GitHub Release.

## 5. Erste Session in VS Code

1. **VS Code öffnen**, einen Projektordner als Workspace laden
   (z.B. `File → Open Folder` → irgendein Repo)
2. **Pibo-Sidebar** öffnen: Klick auf das Pibo-Icon in der linken
   Activity Bar (es heißt einfach "Pibo")
3. Beim ersten Öffnen passiert automatisch:
   - Die Extension mappt deinen Workspace-Folder auf einen Pibo-Room
   - Falls noch kein Room existiert: einer wird angelegt
   - Falls genau ein Room existiert: direkt rein
   - Falls mehrere existieren: ein Room-Picker erscheint
4. **Neue Session starten**: in der Sidebar auf "New Session" klicken
   (oder Command Palette → `Pibo: New Session`)
5. **Chatten**: im Composer Loss tippen, Enter

Die Session erscheint automatisch auch in der Web App unter
<http://127.0.0.1:4788> — und umgekehrt.

## 6. Nützliche Kommandos

In der **Command Palette** (`Ctrl+Shift+P` / `Cmd+Shift+P`):

| Kommando | Was es tut |
|---|---|
| `Pibo: New Session` | Neue Session im aktuellen Room |
| `Pibo: Delete Current Session` | Aktuelle Session löschen |
| `Pibo: Rename Current Session` | Session umbenennen |
| `Pibo: Open in Chat Web` | Springt zur aktuellen Session im Browser |
| `Pibo: Sign In` | Login mit openai/anthropic/google Provider |

In der **CLI**:

| Kommando | Was es tut |
|---|---|
| `pibo vscode install` | Extension installieren / upgraden |
| `pibo vscode status` | Installations-Status prüfen |
| `pibo vscode uninstall` | Extension entfernen |
| `pibo vscode install --vsix <pfad>` | Lokale VSIX installieren (z.B. selbst gebaute) |
| `pibo vscode install --from-url <url>` | VSIX von beliebiger URL (z.B. internem Mirror) |
| `pibo vscode install --version v1.4.0` | Bestimmte Version installieren |
| `pibo config show` | Config anzeigen (Werte sind redacted) |
| `pibo data rooms` | Rooms / Workspaces anzeigen |
| `pibo debug session <id>` | Session-Details inspizieren |

## 7. Konfiguration

Die Extension kennt eine Einstellung:

- **`pibo.chatWebUrl`** (default: `http://127.0.0.1:4788`)
  → URL des laufenden Gateway. Anpassen, wenn dein Gateway woanders läuft
  (anderer Port, LAN-IP, Tunnel, etc.). Per-Workspace oder global setzen.

Ändern via:

- VS Code: Settings → "Pibo Chat Web Url"
- JSON: `"pibo.chatWebUrl": "http://192.168.1.50:4788"` in `.vscode/settings.json`
- Env: `PIBO_CHAT_WEB_URL=http://...` (überschreibt alles)

## 8. Troubleshooting

**"Gateway not available" / Sidebar zeigt Fehler**
→ Ist `pibo gateway:web` gestartet? Auf `curl http://127.0.0.1:4788/api/chat/bootstrap` testen.

**Login funktioniert nicht**
→ Google OAuth Client korrekt? Redirect-URI `http://127.0.0.1:4788/api/auth/callback/google` eingetragen? `pibo config show` zeigt deine Werte (redacted)?

**Extension findet das Gateway nicht**
→ Andere URL? `pibo.chatWebUrl` Setting prüfen. Für andere Maschine: `--web-host 0.0.0.0` beim Start, dann `pibo.chatWebUrl=http://<lan-ip>:4788` setzen.

**Sidebar bleibt leer nach Workspace-Öffnen**
→ In der Output-Panel → "Pibo" schauen. Steht dort der Grund? Meist: fehlender `code`-Binary auf PATH (Extension kann sich dann nicht installieren) oder Auth-Bridge-Problem.

**Updates installieren**
→ `pibo vscode install` zieht die neueste GitHub-Release-VSIX. So upgrade-st du.

**Komplett zurücksetzen**
```bash
pibo vscode uninstall
pibo vscode install
```
Plus VS Code: `Developer: Reload Window`.

## 9. Wo die Daten liegen

```text
~/.pibo/                                    Pibo-User-State
├── config.json                             deine `pibo config set` Werte
├── pibo.sqlite                             Sessions, Rooms, Events (geteilt mit Web)
└── vscode/cache/                           VSIX-Cache pro Release-Tag
    ├── v1.3.0/pibo.vsix
    └── last-installed.json

<dein-workspace>/.pibo/                     Workspace-scoped State
├── PROMPTS.md                              Custom Prompts
└── pi-package.json                         Pi-Package-Registrierung
```

Mehr Details: <https://github.com/Pascapone/pibo>

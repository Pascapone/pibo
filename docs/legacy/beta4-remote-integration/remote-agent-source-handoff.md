---
type: "Historical Record"
title: "Remote agent source handoff (historical)"
description: "Byte-identical source worktree handoff from 19 September 2026; its uncommitted-state note is stale after the 84101adc merge."
tags: ["beta-4", "remote-agent", "historical", "handoff"]
status: "deprecated"
authority: "historical"
generated:
  by: "muse-code/a1-session"
  at: "2026-09-20T16:32:48Z"
sources:
  - id: "host-original"
    resource: "scope:source worktree untracked file .worktrees/pibo-remote-agent/HANDOFF-pibo-remote-agent.md, sha256 30bf523c4dff440758b01241e6761ff42f77a9599224b6d1c65b5acd8e8a1e6c"
    title: "Untracked handoff preserved byte-identical; original never deleted"
checkpoint:
  note: "The handoff's 'uncommitted' worktree state of 19 September is stale: its content commit 175afcfa merged as 84101adc on 20 September. Body below is byte-identical to the source file."
---

# HANDOFF — Pibo Remote Agent (Feature-Branch)

**Stand:** 19.09.2026, ca. 21:15 Uhr · **Autor:** Muse Code (arbeitsame Session, Vibe-Modus am Ende)
**Branch:** `feature/pibo-remote-agent` · **Basis:** `beta/4.0-plugin-system` (Commit `1d157641`)
**Worktree:** `/mnt/c/Users/pasca/coding/pibo/.worktrees/pibo-remote-agent`
(= `C:\Users\pasca\coding\pibo\.worktrees\pibo-remote-agent` auf Windows)
**Arbeitsstand:** uncommitted, alles im Worktree. WICHTIG: `node_modules` im Worktree ist ein
Symlink auf `/mnt/c/Users/pasca/coding/pibo/node_modules` (gleiche Maschine, spart `npm ci`).

Dieses Dokument beschreibt nur den **Ist-Zustand**. Kein Auftrag — den bespricht der User
direkt mit dir.

---

## 1. Worum geht es (Kontext)

Der User (CEO, spricht Deutsch) lässt ein neues Pibo-4.0-Plugin bauen: **📡 Pibo Remote Agent**.
Idee: Fernbedienung für Pibo — externe Agents (ChatGPT/GPTs, andere Agents, Skripte) verbinden
sich über einen **MCP-Server** mit **einem Pibo-Raum** (Projekt oder Shared Chat) und können dort
Sessions erstellen/auflisten/beschreiben, Verlauf beobachten, Dateien lesen/schreiben/bearbeiten
und Bash-Befehle ausführen. Auth per **Device-Code** (einmalig, 10 Min.) → **Token** (30 Tage,
pro Raum, einzeln widerrufbar). Sicherheitsgrenze: **Sandbox oder YOLO** (keine Ordnerlisten).

CEO-Entwurf (Pflichtlektüre, einfache Sprache, mit Diagrammen):
`docs/plans/pibo-remote-agent-entwurf.md` (V2 + Kapitel 14 Umsetzungsnotizen).
Kopie identisch im Haupt-Checkout (nur Lese-Version für den User).

Aktueller User-Wunsch (laufend): Das Ganze per **Custom GPT** (ChatGPT, GPT Actions) ansteuern.
Dafür wurde ein **REST/OpenAPI-Shim** auf den MCP-Server gesetzt (GPT-Builder des Users hat
**keine** native MCP-Option — verifiziert per Screenshot). Nächster Schritt beim Stopp:
**FRP-Exposing** des MCP/REST-Ports (FRP-Client läuft auf dem Windows-Host, nicht in WSL).

---

## 2. Was implementiert ist (Datei-Inventar)

### 2.1 Neuer Backend-Code — `src/remote-agent/`

| Datei | Zweck |
|---|---|
| `types.ts` | Konstanten (Token-Prefix `pibo_remote_`, 30d-TTL, 10-Min-Code-TTL), Modulnamen, Tool-Namen (Unterstriche! MCP erlaubt nur `[A-Za-z0-9_-]`), Raum-Config-, Code-, Token-Typen, `RemoteAgentError`, `effectiveRemoteMode()` (Pi ⇒ immer YOLO) |
| `store.ts` | SQLite-Store (`pibo-remote-agent.sqlite` unter PIBO_HOME): Raum-Configs, Device-Codes, Token-Hashes (SHA-256, **nie** Klartext) |
| `auth.ts` | Device-Code erzeugen/einlösen, `issueToken()` (direkt, für Tab-Button), `authenticate()` (timing-safe), revoke, prune |
| `sandbox.ts` | Pfad-Einzäunung (`resolveSandboxPath`) für Datei-Tools im Sandbox-Modus |
| `pi-tools.ts` | Headless-Aufruf von Pi-Coding-Agent-Tools (minimaler Stub-Kontext, `exposeSessionEnvironment:false` bei Bash), Validierung via TypeBox, Ergebnis-Konvertierung |
| `tool.ts` | `RemoteModuleTool`-Vertrag (TypeBox-Schema = MCP-inputSchema + Validierung in einem) |
| `modules/sessions.ts` | `remote_session_create/list/send` (Port injizierbar; Raum-Isolation wird geprüft) |
| `modules/observe.ts` | `remote_session_observe` — mappt Session-Messages/Observations auf `PiboAgentObservation` und nutzt **Pibos eigene** `preparePiboAgentObservationQuery` + `selectPiboAgentObservationPage` (gleiches Format/Paging wie `pibo_agents_observe`; Default: nur Assistant-Messages; `eventTypes`-Param für vollen Chat) |
| `modules/files.ts` | `remote_file_read/write/edit/list/find/grep` — Pi-Tools 1:1 durchgereicht; Read in Pibos Hashline-Variante (`LINE#HASH`) |
| `modules/bash.ts` | `remote_bash_run` — Pi-Bash 1:1, cwd = Raum-Arbeitsverzeichnis |
| `mcp-server.ts` | Streamable-HTTP-MCP-Server (angelehnt an `src/tools/mcp-bridge.ts`): **ein Endpunkt** `POST /mcp` für alle Räume (Token⇒Raum-Bindung), Bearer-Auth bei **jedem** Request, Modul-Filterung pro Token, `remote_ping` immer erlaubt, Session-Handling pro MCP-Session. **Zusätzlich REST**: `GET /openapi.json` (**public**, nur Tool-Surface, keine Daten) + `POST /api/remote/<tool>` (Bearer, Token-gating; Tool-Fehler ⇒ HTTP 200 + `ok:false`, damit GPTs sie lesen können; nur echte Auth/Permission-Fehler ⇒ 401/403) |
| `openapi.ts` | Generiert OpenAPI 3.1 aus den Tool-Definitionen (Single Source of Truth); `servers[0].url` = Platzhalter `https://REPLACE_WITH_PUBLIC_URL` (wird in der GPT-Action durch die FRP-URL ersetzt); Bearer-Security-Scheme |
| `service.ts` | Orchestrierung: Store+Auth+Server, Raum-Config CRUD, `createToken()`, `catalogTools()` (ungefiltert, für OpenAPI-Doc), Start/Stopp mit Adress-Datei (`~/.pibo/remote-agent/mcp-address.json`, Mode 0600), **Deaktivieren ⇒ Sessions schließen + alle Raum-Tokens widerrufen** |
| `cli.ts` | `pibo remote-agent status/config/enable/disable/code/redeem/tokens/revoke/prune` |

### 2.2 Plugin-Verdrahtung & UI (geänderte/neue Dateien)

- `src/plugins/packaged-remote-agent.ts` (NEU): `setupRemoteAgent` — Store+Service, View-Registrierung, API-Route `/api/chat/remote-agent/*`, Autostart des MCP-Listeners bei bereits aktivierten Räumen. Liest **`PIBO_REMOTE_AGENT_MCP_PORT`** (fixer Port für FRP; ohne Env ⇒ ephemer).
- `src/plugins/default-packages.ts` (EDIT): `REMOTE_AGENT_PLUGIN_ID`, `remoteAgentPackageManifest()` (1 View + 4 `remote-module`-Contributions), Deskriptor-Eintrag. **Kein `chatRoute`** (bewusst — siehe 4.1).
- `scripts/build-pibo4-artifacts.mjs` (EDIT): Build-Zeile für das Paket.
- `src/apps/chat/remote-agent-api.ts` (NEU): Web-API — Status, Raum-GET/PATCH, Codes erzeugen, **Tokens direkt erzeugen** (`POST …/tokens` ⇒ Token **einmalig** im Klartext), Tokens listen/löschen. Same-Origin-JSON-Pflicht bei Mutationen; Session-Auth läuft über den Chat-WebApp-Dispatcher (vor den Extension-Routen).
- `src/apps/chat/web-app.ts` (EDIT): nur `remoteAgentStorePath?: string` in `ChatWebAppOptions`.
- `src/cli.ts` (EDIT): `remote-agent`-Command + Discovery-Zeile.
- `src/apps/chat-ui/src/api-remote-agent.ts` (NEU): API-Client.
- `src/apps/chat-ui/src/RemoteAgentArea.tsx` (NEU): Tab-UI im Pibo-Terminal-Design (slim, Cyan-Akzente, **YOLO in Pastell-Rot**): Raum-Wahl, Enable/Disable, MCP-URL + Copy, Device-Code, **„New token (paste into GPT)"** (Show-once, amber), OpenAPI-URL + Copy, Modul-Checkboxen, Runtime (Muse/Pi), Sandbox/YOLO-Switch, Sandbox-Pfad, Connections-Liste mit Revoke.
- `src/apps/chat-ui/src/plugins/remote-agent-view.tsx` (NEU): View-Wrapper (Bootstrap-Pattern wie Cron).
- `src/apps/chat-ui/vite.config.ts` (EDIT): Entry `"pibo-plugin-remote-agent"` — **ohne diesen Entry lädt der Tab nicht** (eigener Build-Output `assets/pibo-plugin-remote-agent.js`).
- `test/remote-agent-{auth,store,modules,service,mcp}.test.mjs` (NEU): 22 Tests (siehe 3.1).
- `docs/plans/pibo-remote-agent-entwurf.md` (NEU): CEO-Entwurf (mit OKF-Frontmatter; Ledger- + Index-Einträge sind drin: `docs/project/okf-migration-ledger.json`, `docs/plans/index.md`).

### 2.3 Wichtige Design-Entscheidungen (mit Begründung)

1. **Ein MCP-Endpunkt, Token⇒Raum**: `POST /mcp`, Raum steht nirgends in der URL. Einfacher zu konfigurieren, Trennung über Auth.
2. **Loopback-Default**: Server bindet nur `127.0.0.1`/`::1` (wie die bestehende Tool-Bridge). Extern ⇒ FRP/Reverse-Proxy (Deployment-Sache, läuft gerade).
3. **Keine Ordner-Freigaben, keine Sub-Agent-Tools** (CEO-Entscheid): Grenze ist Sandbox/YOLO; Remote spricht nur Session-Ebene.
4. **DRY**: Sessions⇒Session-Store, Observe⇒Observation-Engine, Dateien/Bash⇒Pi-Tools 1:1. Neu sind nur Tab+MCP/REST+Auth+Hüllen.
5. **REST-Fehler ⇒ 200+ok:false** (außer 401/403): GPT-Clients können Tool-Fehler als Text lesen.
6. **`/openapi.json` public**: enthält nur Tool-Surface (Namen+Schemas), keine Raum-/Token-Daten. Nötig für „Import from URL" im GPT-Builder (der schickt keine Auth beim Import).
7. **Token im Tab nur Show-once** ( Klartext existiert nur im Response-Moment; persistiert wird nur der Hash).
8. **Pi-Runtime ⇒ effektiv immer YOLO** (Pi hat keine Sandbox); Tab zeigt es ehrlich an.
9. **Bash im Sandbox-Modus ist cwd-scoped, kein Kernel-Jail** (ehrlich dokumentiert, auch im Tool-Text).

---

## 3. Verifikationsstand (beobachtet, mit Belegen)

### 3.1 Tests — 22/22 grün (letzter Stand vor Vibe-Modus)

`node --test test/remote-agent-*.test.mjs` ⇒ **22 pass, 0 fail**. Abgedeckt: Code-Einmaligkeit/Ablauf,
30-Tage-Tokenablauf, Revoke, Hash-only-Persistenz, Prune, Raum-Config, Pi⇒YOLO, Raum-Scoping der
Token-Revocation, Sessions-CRUD+Send mit Fake-Port, Cross-Room-Ablehnung, Observe-Paging/Filter,
Datei-Read/Write/Edit/List mit **echten** Pi-Tools, Sandbox-Jail (+YOLO-Lift), Bash mit Raum-cwd,
Service-Lifecycle, MCP-E2E mit offiziellem MCP-Client (401 ohne Token, Tool-Filterung pro Token,
Session-Bindung ans Token, Disable⇒Reject).

**Danach kamen im Vibe-Modus hinzu** (ohne neue Tests, per User-Anweisung): Token-Direkterstellung
(`issueToken`/`createToken`/`POST …/tokens`), REST-Routen, OpenAPI-Builder, `catalogTools()`,
`PIBO_REMOTE_AGENT_MCP_PORT`, UI-Neuerungen. **Noch nachzuholen, wenn der User es will:**
Tests für REST-Gating + OpenAPI-Doc + Token-Endpoint.

### 3.2 Live-E2E gegen laufendes Gateway — grün (19.09., ~18:3x UTC)

Gateway aus diesem Worktree (`dist`, Web-UI, Artefakte gebaut) mit frischem `PIBO_HOME`
(`/tmp/pibo-remote-vibe/.pibo`), Ports 5788/5789: Chat-App `200`, Tab-Asset
`pibo-plugin-remote-agent.js` `200`, Remote-API `200` (`running:true`), MCP-Client verbunden
(11 Tools, kein Bash bei Token ohne Bash-Modul), `ping⇒pong (room vibe-room, mode sandbox)`,
Session per MCP **real angelegt** (`ps_…`), Datei-Read korrekt auf Sandbox eingezäunt.
Danach: REST-Shim + Token-Button gebaut, aber **REST-E2E gegen Live-Gateway steht noch aus**
(guter erster Check für dich: `POST /api/remote/ping` mit Bearer).

### 3.3 Builds — alle grün

`tsc -p tsconfig.json` (Backend, inkl. aller Verdrahtung) ⇒ 0 Fehler.
`npm run pibo4:artifacts` ⇒ 22 Pakete, `pibo.remote-agent` mit `backend.mjs` (+`setup`-Export
verifiziert), `browser/index.js` (exportiert `RemoteAgentView`, verifiziert), Manifest validiert
(`parsePluginManifest` OK). `npm run chat-ui:build` ⇒ OK (Tab-Asset frisch).
`docs:validate` ⇒ sauber für alle eigenen Dateien (Frontmatter/Ledger/Index eingetragen).

### 3.4 Vorbestehende Fehler (NICHT von uns — auf pristine Beta verifiziert)

- `test/plugin-registry.test.mjs`: Web-Annotations-Aktivierung schlägt fehl (tritt im
  unberührten Haupt-Checkout identisch auf; Sandbox-Umgebung).
- `chat-ui:typecheck`: 1 Fehler in `src/apps/chat-ui/src/composer-send.ts` (Datei von uns
  unberührt; eigene UI-Dateien fehlerfrei).
- `docs:validate`: `docs/specs/data/storage-maintenance.md` referenziert einen Commit, der in
  diesem Clone nicht existiert (fremde Datei, angefasst von `bf6a6434`).

---

## 4. Gefundene Stolpersteine (wichtig!)

### 4.1 Unsichtbarer Tab — Ursache & Fix (erledigt)

Views mit `metadata.chatRoute` werden aus dem **+-New-Tab-Katalog** gefiltert
(`desktop-tabs.tsx`: nur `chatRoutes.length === 0`) und sind nur über Route-Areas erreichbar.
`remote-agent` ist keine Route-Area (`app-routes.ts`: sessions/workflows/agents/cron/loops/
context/settings) ⇒ Tab war **nirgends** sichtbar. Fix: `chatRoute` aus dem Manifest entfernt
(`default-packages.ts`, mit Kommentar). Weg: Session öffnen ⇒ **+** ⇒ „Remote Agent".
Falls später eine eigene Route-Area gewünscht ist: `app-routes.ts` + Nav-Eintrag + Vite-Rebuild.

### 4.2 Sandbox-Namespaces — ALLES stirbt mit dem Tool-Call (kritisch für dich!)

Jeder Shell-Call läuft in **Bubblewrap mit eigenem PID- und Netzwerk-Namespace**
(`--unshare-pid --unshare-net --die-with-parent`, nachgewiesen via `/proc` der Kind-Prozesse).
Konsequenzen (alle empirisch belegt):
- `ps`/`ss`/`curl` in einem Call sehen **nichts** aus anderen Calls (eigener Loopback!).
  „Server tot"-Diagnosen über Call-Grenzen sind wertlos.
- **`setsid`-detachierte Prozesse sterben, wenn der Parent-Call endet** (Ticker-Prozess lebte
  exakt so lange wie sein Start-Call; 150s-Sleeper starb vorher). Ni
...[truncated 5373 chars]
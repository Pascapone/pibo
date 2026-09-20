---
type: "Research"
title: "Beta 4.0 baseline and legacy-confusion review"
description: "Independent read-only baseline and legacy-confusion check at ece5f18, archived with an OKF envelope."
tags: ["beta-4", "baseline", "legacy", "review"]
status: "draft"
authority: "informative"
generated:
  by: "muse-code/a1-session"
  at: "2026-09-20T17:30:00Z"
sources:
  - id: "host-original"
    resource: "scope:beta4-phase2 host planning archive at commit time"
    title: "Unchanged host original; see checkpoint provenance for path and hash"
checkpoint:
  origin_path: ".tmp/beta4-baseline-legacy-review.md"
  origin_sha256: "f84d4ca8560573288ab7fae3e73848b5e40ae5814d7f604ef7b0007cb0f6a974"
  origin_bytes: 22961
  archive: "docs/reports/artifacts/beta4-phase2/beta4-phase2-originals-20260920.zip"
  archive_path: "tmp/beta4-baseline-legacy-review.md"
  transformations:
    - "Added this OKF frontmatter envelope; body bytes after frontmatter are unchanged from the origin."
---
# Beta-4.0 Baseline + Legacy-Verwechslungsrisiken — unabhängige Gegenprüfung

Scope: NUR Baseline und Legacy-Verwechslungsrisiken. Keine Implementierung, keine Governance-Arbeiten.
Gelesen: `AGENTS.md`, `GLOSSARY.md`, Root-`package.json` (files-Ausschlüsse).
Methoden-Limit: nur Lesen + diese Datei schreiben. Keine Installationen/Builds/Deploys/Restarts/Commits/Branchwechsel, keine fremden Änderungen. Shell/Git waren verfügbar; keine Runtime-Kommandos nötig.

Übergabe: temporär, gitignoriert (`.gitignore:4` = `.tmp/`). Nicht in `docs/`.

---

## 1) Baseline-Identität

- Zeitpunkt (UTC): `2026-09-20T11:55:43Z` (`date -u`)
- Branch: `beta/4.0-plugin-system` (`git branch --show-current`)
- HEAD: `ece5f18cffe3f96f8f5dd8c241aac1d439c67b9a` (`git rev-parse HEAD`)
  - `git log --oneline -5`: `ece5f18c Merge branch 'feature/pibo-remote-agent' into beta/4.0-plugin-system`, `a3472458 feat(remote-agent): ...`, `0a44e35b Merge ... fix-muse-recovery ...`, `24b6d022 fix(muse-native): ...`, `be84f259 Merge ... fix/muse-skills-context-designer ...`
- Status: `git status --short` = leer (clean, keine Secrets ausgegeben).
- `.tmp/` existiert und ist ignoriert (`git check-ignore` sinngemäß via `.gitignore:4`).

## 2) Legacy-Pfade: Working Tree vs. HEAD vs. Löschcommit

Geprüft: `test -e <pfad>` (Worktree) + `git ls-files <pfad> | wc -l` (Index/getrackt; `git ls-files` liest den Index, nicht allgemein HEAD — bei cleanem Worktree zum Messzeitpunkt identisch, s. Nachtrag K2).

| Pfad | Worktree heute | Index/getrackt heute | Letzter Lösch-Nachweis (klein, kein Deep-Dive) |
|---|---|---|---|
| `src/vscode` | ABSENT | ABSENT (0 Dateien) | `42f117bf` D, 2026-09-13 (7 Dateien: `cli.ts`, `code-cli.ts`, `install.ts`, `status.ts`, `types.ts`, `uninstall.ts`, `vsix-fetcher.ts`) — KORREKTUR Nachtrag: erst „6 Dateien" bei 7 aufgezählten genannt; Summe 30×D bleibt (10+4+3+6+7) |
| `src/local` | ABSENT | ABSENT (0) | `42f117bf` D (3: `client.ts`, `extension.ts`, `tui.ts`) |
| `src/cli-session` | ABSENT | ABSENT (0) | `42f117bf` D (4: `fakeSessionSource.ts`, `index.ts`, `localSessionSource.ts`, `sessionSource.ts`) |
| `src/apps/cli-ui` | ABSENT | ABSENT (0) | `42f117bf` D (10: `InkSessionApp.ts`, `InkTerminalLine.ts`, `InkTerminalRow.ts`, `InkTerminalView.ts`, `cliSessionsCommand.ts`, `index.ts`, `inkColors.ts`, `inkJson.ts`, `inkMarkdown.ts`, `inkSyntaxHighlighter.ts`) |
| `src/apps/chat-vscode-web` | ABSENT | ABSENT (0) | In geprüfter Historie NICHT gefunden: `git log --oneline -- src/apps/chat-vscode-web` leer, `git log --diff-filter=D` leer. Kein Löschcommit nachweisbar (nur `dist/apps/chat-vscode-web/**` Build-Output + entferntes Plugin `src/plugins/chat-vscode-web.ts`, s.u.). KORREKTUR Nachtrag: kein „nie existiert"-Schluss aus unvollständiger Historie. |
| `src/pi-packages` | ABSENT | ABSENT (0) | `42f117bf` D (6: `cli.ts`, `installer.ts`, `metadata.ts`, `runtime.ts`, `store.ts`, `types.ts`) |
| `packages/vscode-extension` | ABSENT | ABSENT (0) | In geprüfter Historie NICHT gefunden: `git log` leer. `package.json workspaces` enthält nur `packages/workflows`. Kein Löschcommit nachweisbar. KORREKTUR Nachtrag: kein „nie existiert"-Schluss aus unvollständiger Historie. |

Löschcommit gesamt: `42f117bf2727f5957cd6b585b14e3b4e7e2ca990 2026-09-13 feat(plugins): checkpoint integrated rebuild for Pibo2 testing`. In den 5 realen Prefixen: 30× `D` (Nachweis via `git show --name-status --oneline 42f117bf | grep -E "^D (src/vscode|src/local|src/cli-session|src/apps/cli-ui|src/pi-packages)/"`).

Zusatz, direkt relevant für Verwechslung (gleicher Commit, ohne große Historienrecherche):
- `D src/plugins/chat-vscode-web.ts` (altes WebApp-Plugin `pibo.chat-vscode-web`, Mount `/apps/chat-vscode`; Header via `git show 42f117bf~1:src/plugins/chat-vscode-web.ts` belegt).
- `D scripts/vscode-build.mjs`, `D scripts/vscode-package.mjs`, `D src/apps/chat-ui/src/VscodeArea.tsx`, `D test/chat-vscode/*` (9 Testdateien).
- `D src/apps/chat-vscode/*` (23 Dateien, s. Abschnitt 3). `git log --oneline --diff-filter=D -- src/apps/chat-vscode` = `42f117bf`.

## 3) Aktiv vs. entfernt: `chat-vscode` / `packaged-vscode-web` / `vscode-view`

### 3a) `src/apps/chat-vscode` — ENTFERNT (Quelle), nur ignorierte Build-Reste

- Heute getrackt: `git ls-files src/apps/chat-vscode | wc -l` = `0`.
- Worktree: nur `src/apps/chat-vscode/dist/chat-vscode-web/{index.html,assets/index-B5QK07zO.css,assets/index-CjOC7zYy.js}` + `dist/extension/extension.cjs`.
- Ignoriert: `git check-ignore -v ...` = `.gitignore:2:dist/`; `git status --ignored src/apps/chat-vscode` = `!! src/apps/chat-vscode/`.
- Vorher/Nachher: `git ls-tree -r --name-only 42f117bf~1 -- src/apps/chat-vscode` = 23 Dateien (`README.md`, `package.json`, `extension/src/*.ts`, `extension/webview/*`, `extension/tsconfig.json`, `extension/vscode-shim/*`); `42f117bf -- src/apps/chat-vscode` = leer.
- Risiko: Wer `ls` ohne Git-Filter zählt, hält `dist/` für aktive Extension. Baseline-Zählung muss `git ls-files` + `dist/`-Ausschluss nutzen (s. Abschnitt 5).

### 3b) `src/plugins/packaged-vscode-web.ts` — AKTIV (Backend, Browser-IDE-Konfig)

- Getrackt: `git ls-files` = 1 Treffer; Worktree vorhanden (44 Zeilen).
- Inhalt (`src/plugins/packaged-vscode-web.ts:8,28-44`): `VSCODE_WEB_INTEGRATION_API = "/api/chat/vscode-web"`; `setupVscodeWeb()` registriert `view` + GET-Route, liest `PIBO_VSCODE_WEB_URL` (nur same-origin absolute Pfade, sonst Throw in `resolveVscodeWebUrl`, Zeilen 15-26) und `PIBO_VSCODE_WEB_WORKSPACE_ROOT`, antwortet `{ integration: { url, workspaceRoot? } | null }`.
- Registry (`src/plugins/default-packages.ts:20,72-83,491`): `VSCODE_WEB_PLUGIN_ID = "pibo.vscode-web"`, Manifest Name `"Pibo VS Code Web"`, Contribution `productView("view", "VS Code", "VscodeView")`, Descriptor `{ backendExport: "setupVscodeWeb", backendModule: "vscode-web", webOnly: true, browserModules: [{ exports: "VscodeView", asset: "pibo-plugin-vscode-web.js" }] }`.

### 3c) `src/apps/chat-ui/src/plugins/vscode-view.tsx` — AKTIV (Frontend, Browser-IDE-Einbettung)

- Getrackt: `git ls-files` = 1 Treffer; Worktree vorhanden (135 Zeilen). Verzeichnis `src/apps/chat-ui/src/plugins/` enthält u.a. `vscode-view.tsx` neben 18 weiteren Views.
- Inhalt: `VscodeView()` (Zeile 28) fetcht `/api/chat/vscode-web` (Zeile 47), baut `frameUrl` via `vscodeWebUrl()` (Zeilen 20-26, same-origin enforced), probt `text/html`, bettet `<iframe src={frameUrl}>` ein (Zeile 131), wartet auf `.monaco-workbench` + Theme-Selektoren via `vscodeWorkbenchReady()` (Zeilen 13-18, 102-125). Fehlertext verweist auf `PIBO_VSCODE_WEB_URL` (Zeile 132).

### 3d) Extension vs. Browser-IDE — klare Trennung mit Belegen

- Extension = ENTFERNTER Thin Client IM VS Code Extension Host:
  - Beleg Alt-Header `42f117bf~1:src/apps/chat-vscode/extension/src/extension.ts:1-30`: `import * as vscode from "vscode"`, `activate(context: vscode.ExtensionContext)`, `vscode.window.registerWebviewViewProvider("pibo.sessionPanel", ...)`, `createSidecarAuthBridge`, `createWorkspaceFolderWatcher`.
  - Beleg Alt-README `42f117bf~1:src/apps/chat-vscode/README.md:1-36`: „thin client", „renders only the Session View inside a VS Code WebView", Room-Resolver auf `~/.pibo/pibo.sqlite`, Install via `pibo vscode install` / `code --install-extension`, VSIX-Cache unter `~/.pibo/vscode/cache/`.
  - Zugehörige entfernte CLI: `src/vscode/{cli,install,uninstall,status,code-cli,vsix-fetcher}.ts` (s. Abschnitt 2).
- Browser-IDE = AKTIVE Einbettung von externem VS Code Web (code-server-/openvscode-artig) IN Pibo Chat Web:
  - Kein `vscode`-Import, keine Extension-Host-API; nur Fetch + iframe + DOM-Probe auf `.monaco-workbench`.
  - Backend liefert nur Konfig-URL; Frontend rendert fremdes Same-Origin-Workbench unter Pibo-Origin.
- Verwechslungsrisiken (konkret):
  1. Namensähnlichkeit: `chat-vscode` (Extension, entfernt) vs. `chat-vscode-web` (in geprüfter Historie nicht als `src/`-Pfad gefunden, nur `dist/` + altes Plugin `src/plugins/chat-vscode-web.ts`, entfernt) vs. `vscode-web` (aktives Plugin `pibo.vscode-web`) vs. `VscodeArea.tsx` (entfernt) vs. `vscode-view.tsx` (aktiv).
  2. Stale `src/apps/chat-vscode/dist/` suggeriert aktive Extension; ist aber ignoriert und ungetrackt.
  3. `package.json files`-Negationen nennen `dist/apps/chat-vscode-web/**` etc., obwohl Quellen entfernt (s. Abschnitt 4) — Audit muss Index/Worktree, nicht `files`-Liste, als Existenzbeweis nutzen.

## 4) `src/ralph` + Root-`package.json`-Ausschlüsse

### 4a) `src/ralph` — Bestand vorhanden, aber INSEL ohne aktive Verdrahtung (KORREKTUR, s. Nachtrag N1)

- Bestand (getrackt, 7 Dateien): `src/ralph/{channel,cli,service,stopping,store,templates,types}.ts` (Zählung s. Abschnitt 5: 7 Dateien / 1254 physische Zeilen). KORREKTUR: Die Erstfassung („vorhanden und verdrahtet, kein Legacy-Rest") ist WIDERLEGT — `src/ralph` hat genau einen `src`-Importeur (`src/apps/chat/ralph-api.ts`), und dieser hat selbst null `src`-Importeure. Insel, nur intern + via Tests erreichbar. Details/Belege: Nachtrag N1.
- Backend: `src/apps/chat/ralph-api.ts:3-9` importiert `../../ralph/{channel,service,templates,types,store}.js` (Routen `/api/chat/ralph/*`, Zeilen 35-42) — aber `handleChatRalphApiRequest` wird in `src/` nirgends importiert/registriert; `/api/chat/ralph*` bedient stattdessen `handleChatLoopApiRequest` via `src/plugins/packaged-goal-loops.ts:50-57`. `src/ralph/cli.ts` (`runRalphCli`) hat null Importeure; `pibo ralph` ist Alias auf `src/loops/cli.ts` (`src/cli.ts:237-239,396-404`). `src/loops/*`-Ralph-Modus/IDs sind NICHT der `src/ralph`-Baum (getrennte Implementierung, alte Daten/Loop-Ralph-Funktion separat bewahren).
- Frontend: `RalphArea.tsx` + `api-ralph.ts` sind Insel (einzige `src`-Referenzen untereinander + Re-Export in `api.ts:26`, dessen `src`-Konsumenten nur `SaveState`/`ProductEvent`/Provider-Funktionen nutzen). Aktive UI: `/loops` + Legacy-Route `/ralph` → Area `loops` (`app-routes.ts:65`) → `LoopsView` → `LoopArea.tsx` (nutzt `api-loops`, nicht `api-ralph`). `App.tsx` enthält null `ralph`-Treffer.
- Tests (separat, test-only): `test/ralph-*.test.mjs` (`resource-cleanup`, `resource-metadata`, `resource-visibility`, `run-timeout`, `runtime-overrides`, `stop-conditions`, `templates`) importieren `dist/ralph/*` bzw. `dist/apps/chat/ralph-api.js`; `test/chat-ui-ralph-area.test.mjs` importiert `RalphArea.tsx`; `test/loop-api.test.mjs:51` liest `ralph-api.ts` nur als Text; `test/ralph-cli-profile-default.test.mjs` ruft `dist/bin/pibo.js ralph` (= Loops-CLI-Alias); `test/loop-max-iterations-admission.test.mjs`, `test/app-context-fresh-*.test.mjs` nutzen `dist/ralph/store.js`.
- Glossar-Einordnung (`GLOSSARY.md:87`): „Goal mode continues turns in one Pibo Session; legacy Ralph mode creates a fresh Pibo Session for each run." Das beschreibt die Loop-Semantik (`src/loops`-Modi), nicht die Verdrahtung des `src/ralph`-Baums.

### 4b) Root-`package.json` `files`-Ausschlüsse — 7× stale, 1× noch wirksam

Aktuelle Liste (`package.json:35-64`, via `node -e` verifiziert):
`dist`, `!dist/apps/chat-vscode-web/**`, `!dist/apps/cli-ui/**`, `!dist/cli-session/**`, `!dist/local/**`, `!dist/pi-packages/**`, `!dist/plugins/chat-vscode-web.*`, `!dist/vscode/**`, ...

- Alle 7 `!dist/...`-Negationen zeigen auf NICHT-getrackte `src/`-Gegenstücke (je `git ls-files "src/<pfad>*"` leer): `src/vscode`, `src/local`, `src/cli-session`, `src/pi-packages`, `src/apps/chat-vscode-web`, `src/apps/cli-ui`, `src/plugins/chat-vscode-web`. Lösch-/Historienstand s. Abschnitt 2 (KORREKTUR: keine „nie existiert"-Aussage).
- Bewertung: technisch harmlos (Negation zu Nichtexistentem), aber irreführend: suggeriert, diese Bäume seien noch Build-Output-Kandidaten. Kein Handlungsauftrag in dieser Review (nur Befund).
- Gegenprobe noch wirksam: `!docs/project/operations/vscode-extension-release.md` — Datei ist weiterhin getrackt (`git ls-files` = 1 Treffer, Worktree 9971 Bytes). Diese Negation filtert also real beim Packen; nicht mit „Quelle entfernt" verwechseln.

## 5) First-party Quell-Bestand (`git ls-files` + Zählung)

Messmethode (ohne Build/Runtime, nur Lesen):
- Grundmenge: `git ls-files` (= Index; respektiert `.gitignore`, daher `node_modules/`, `dist/`, ignorierte `src/apps/chat-vscode/dist/` automatisch draußen). Total: `3024` Pfade. KORREKTUR: Index, nicht allgemein HEAD (bei cleanem Worktree zum Messzeitpunkt identisch).
- Filter: nur `src/**` + `packages/**`; Pfade mit `node_modules`, `/dist/`, `/generated/`, `/__generated__/` zusätzlich ausgeschlossen; nur Quell-Endungen `.ts/.tsx/.mts/.cts/.js/.mjs/.cjs/.jsx/.py`.
- Zeilen: physische Zeilen = Byte-Zeilen (`open(rb)` Zeilenzahl, entspricht `wc -l`), inkl. Leer-/Kommentarzeilen, keine SLOC-Bereinigung.
- Repro-Skript (temporär, gitignoriert): `.tmp/beta4-source-inventory.py` — `python3 .tmp/beta4-source-inventory.py` (nur `git ls-files` + Dateilesen, kein `npm`, kein Build). Zahlen unten sind das Ergebnis dieses Laufs.

Ergebnis gesamt: `844` Quelldateien, `231878` physische Zeilen (`src` + `packages`).

Separat-Ausweis (Nachtrag, gleiche Methode):
- Generiert (`*.gen.*`, `*.generated.*`, `routeTree*`, `__generated__`) in `src`+`packages` (Index): `0` Dateien / `0` Zeilen. `src/apps/chat-ui/src/routeTree.gen.ts` weder getrackt (`git ls-files`-Treffer 0) noch im Worktree vorhanden (`ls` negativ, kein `find`-Treffer für `*.gen.*`/`routeTree*`) — TanStack-Router-Artefakt fällt hier nicht an.
- Colocated Tests (`*.test.*`) in `src`+`packages` (Index): `25` Dateien / `7209` Zeilen, alle unter `packages/workflows/src/testing/` (keine unter `src/`). Größte: `validation.test.ts` 835, `runtime-one-node-agent.test.ts` 756, `runtime-agent-node.test.ts` 529 Zeilen.
- Netto ohne colocated Tests: `819` Dateien / `224669` Zeilen.

Nach `src`-Hauptbereichen + `packages` (Dateien / Zeilen):

| Bereich | Dateien | Zeilen |
|---|---:|---:|
| `src/apps` | 270 | 70024 |
| `src/plugins` | 66 | 7814 |
| `src/agent-runtimes` | 57 | 23495 |
| `src/core` | 46 | 14072 |
| `src/debug` | 42 | 14866 |
| `src/tools` | 37 | 11747 |
| `src/data` | 34 | 7145 |
| `src/agent-runtime` | 22 | 7086 |
| `src/shared` | 21 | 5239 |
| `src/mcp` | 17 | 5927 |
| `src/remote-agent` | 15 | 3402 |
| `src/previews` | 13 | 3619 |
| `src/compute` | 12 | 4238 |
| `src/loops` | 11 | 2773 |
| `src/gateway` | 10 | 3140 |
| `src/session-ui` | 10 | 3049 |
| `src/auth` | 8 | 1670 |
| `src/web-annotations` | 8 | 3270 |
| `src/ralph` | 7 | 1254 |
| `src/signals` | 7 | 1293 |
| `src/subagents` | 7 | 1470 |
| `src/cron` | 6 | 1159 |
| `src/sessions` | 6 | 2223 |
| `src/providers` | 5 | 798 |
| `src/runs` | 5 | 1781 |
| `src/resources` | 4 | 1055 |
| `src/user-skills` | 4 | 749 |
| `src/web` | 4 | 988 |
| `src/speech` | 3 | 753 |
| `src/transcription` | 3 | 327 |
| `src/bin` | 2 | 25 |
| `src/setup` | 2 | 1573 |
| `src/api` | 1 | 178 |
| `src/channels` | 1 | 133 |
| `src/config` | 1 | 287 |
| `src/reliability` | 1 | 1622 |
| `src/skills` | 1 | 174 |
| `src/app-context.ts` (Root-Datei) | 1 | 13 |
| `src/cli-errors.ts` (Root-Datei) | 1 | 30 |
| `src/cli.ts` (Root-Datei) | 1 | 597 |
| `src/index.ts` (Root-Datei) | 1 | 408 |
| `packages/workflows` | 71 | 20412 |

`src/apps`-Feinaufteilung (Quelldateien / Zeilen; getrackt gesamt unter `src/apps`: 393 inkl. 112× `.png`, 4× `.css`, 3× `.json`, 2× `.html` u.a.):
- `src/apps/chat`: 63 / 22306
- `src/apps/chat-ui`: 201 / 46467
- `src/apps/context-files-ui`: 5 / 771
- `src/apps/shared`: 1 / 480
- `src/apps/chat-vscode`: 0 / 0 (nur ignoriertes `dist/`, s. Abschnitt 3a)
- `src/apps/chat-vscode-web`, `src/apps/cli-ui`: 0 / 0 (nicht getrackt, s. Abschnitt 2)

`packages`-Feinaufteilung: nur `packages/workflows` getrackt (86 Pfade gesamt, davon 71 Quelldateien / 20412 Zeilen). `packages/vscode-extension`: 0.

Grenzen/Ehrlichkeit: Zählung = getrackter Stand (HEAD-nah, Worktree clean). Ungetrackte/ignorierte Dateien (z.B. `src/apps/chat-vscode/dist/`) sind absichtlich NICHT enthalten. Keine Test-/Docs-Zählung hier (Scope: `src` + `packages`); Gesamttotal `git ls-files` = 3024 enthält zusätzlich u.a. `docs/*`, `test/*`, `skills/*`, `scripts/*`.

---

## Kurz-Fazit für Gesamtplan-Prüfer

1. Die 5 echten Legacy-Bäume sind seit `42f117bf` (2026-09-13) aus dem Index entfernt; 2 der 7 Audit-Pfade (`src/apps/chat-vscode-web`, `packages/vscode-extension`) sind in der geprüften Historie nicht als Quellen gefunden (kein Löschcommit nachweisbar; keine „nie existiert"-Aussage) — Plan darf sie nicht als „noch zu löschen" führen.
2. Aktiv sind NUR Browser-IDE (`packaged-vscode-web.ts` + `vscode-view.tsx`, Plugin `pibo.vscode-web`); Extension (`src/apps/chat-vscode/extension/*`, `src/vscode/*`, `src/plugins/chat-vscode-web.ts`) ist entfernt. Größtes Restrisiko ist Namensverwechslung + stale `dist/` + stale `package.json`-Negationen.
3. KORREKTUR (s. Nachtrag N1): `src/ralph` ist eine INSEL (Bestand ja, aktive Verdrahtung nein) — nur via `ralph-api.ts`→Tests erreichbar, Backend/UI/CLI laufen über `src/loops`. Davon getrennt: alte Daten (`pibo-ralph.sqlite`-Default) und Loop-Ralph-Modus-Funktion müssen erhalten bleiben; kein Rückschluss „Ralph kann weg".

---

## Nachtrag (präzise Gegenprüfung, nur Nachtrag/Korrektur, keine Builds)

- Zeitpunkt (UTC): `2026-09-20T12:04:42Z`; Branch: `beta/4.0-plugin-system`; HEAD: `ece5f18cffe3f96f8f5dd8c241aac1d439c67b9a` (unverändert, re-verifiziert).
- `git status --short` jetzt: `M docs/log.md`, `M docs/project/okf-migration-ledger.json`, `M docs/reports/index.md`, `?? docs/reports/beta-4-0-core-plugin-bloat-audit-2026-09-20*.md` — fremde parallele Änderungen (Gesamtplan-Agent), nicht von dieser Review; unberührt gelassen. Baseline-Messung erfolgte bei cleanem Status (Abschnitt 1).
- `git rev-parse --is-shallow-repository` = `false`. Trotzdem: Klon-/Rewrite-Historie kann unvollständig sein → Korrekturen K2/K3 unten.

### N1) `src/ralph`: Insel-Beweis (Erst-Aussage widerlegt)

Methode: statische `grep`-Importpfade über `src/` (`from`/`import()`/`require()`), Router-/Plugin-Registrierung, UI-Routen, CLI-Dispatch; Tests separat. Keine Builds, kein Runtime-Start.

1. Einziger `src`-Importeur des `src/ralph`-Baums ist `src/apps/chat/ralph-api.ts:3-9` (`channel`/`service`/`templates`/`types`/`store`). Intern ist die Insel selbstkonsistent (`channel.ts`→`service.js`+`store.js`, `service.ts`→`store.js`+`stopping.js`, `cli.ts`→`store.js`+`stopping.js`+`templates.js`, `store/stopping/templates`→`types.js`).
2. `ralph-api.ts` selbst hat NULL `src`-Importeure: `grep -rn "ralph-api" src` = leer; `grep -rn "handleChatRalphApiRequest" src` = nur Definition `ralph-api.ts:35`. Keine `import()`/`require()`-Treffer mit `ralph` in `src/`. Einzige Referenzen: `test/loop-api.test.mjs:51` (liest Datei als Text) + `test/ralph-resource-visibility.test.mjs:8` (importiert `dist/`-Build).
3. Router: `/api/chat/ralph*` wird AKTIV von `handleChatLoopApiRequest` bedient, nicht von `handleChatRalphApiRequest`: `src/plugins/packaged-goal-loops.ts:50-57` registriert `registerApiRoute` für `/api/chat/loops|loop|ralph` → `loop-api.ts:43-45` (Legacy-Rewrite `ralph|loop`→`loops`, Default-Modus `ralph` bei Alt-Pfad). `src/apps/chat/web-app.ts` importiert weder `loop-api` noch `ralph-api` direkt (Verdrahtung läuft über Plugin-Registrierung). Kein `packaged-ralph`-Plugin (`ls src/plugins` + `grep -rli ralph src/plugins` = nur `packaged-goal-loops.ts`, `standard-skills.ts`, `types.ts`).
4. UI: `RalphArea.tsx` (nutzt `api-ralph.ts`) hat NULL `src`-Importeure (nur `test/chat-ui-ralph-area.test.mjs`). `api-ralph.ts` wird in `src/` nur von `RalphArea.tsx` + Re-Export `api.ts:26` referenziert; `api.ts`-Konsumenten (`AgentsView`, `BasePromptView`, `CompactionPromptView`, `ContextFilesView`, `ProviderSettingsView`, `WorkflowPromptAssetEditor`) nutzen nur `SaveState`/`ProductEvent`/Provider-Funktionen, nie `getRalph*`. Aktive Route: `/loops` + Legacy `/ralph` → beide Area `loops` (`app-routes.ts:65`, `main.tsx:69-76`) → `LoopsView` (`loops-view.tsx:1-7` → `LoopArea`) → `LoopArea.tsx:3` nutzt `api-loops`. `App.tsx`: null `ralph`-Treffer. `builtin-browser-entry.tsx` exportiert nur `LoopsView`.
5. CLI: `src/ralph/cli.ts:87` (`runRalphCli`) hat NULL Importeure (`grep -rn "ralph/cli" src test scripts` = leer). `pibo ralph` ist in `src/cli.ts:237-239,396-404` ein Alias auf `runLoopCli` aus `src/loops/cli.js` (Modus `ralph`). `src/loops/*`-Ralph-Modus/IDs/Events sind eine GETRENNTE Implementierung, kein Verbraucher des `src/ralph`-Baums.
6. Test-only-Konsumenten (bauen auf `dist/`, kein Aktiv-Beweis): `dist/ralph/{store,service,stopping,templates}.js` in `test/ralph-{resource-cleanup,resource-metadata,resource-visibility,run-timeout,runtime-overrides,stop-conditions,templates}.test.mjs`, `test/loop-max-iterations-admission.test.mjs`, `test/app-context-fresh-{runtime-regression,schema}.test.mjs`; `dist/apps/chat/ralph-api.js` in `test/ralph-resource-visibility.test.mjs`; `dist/bin/pibo.js ralph` (= Loops-Alias) in `test/ralph-cli-profile-default.test.mjs`.
7. Getrennt bewahren (kein Löschvotum): alte Daten + Loop-Ralph-Funktion — `src/loops/store.ts:227` Default-DB `pibo-ralph.sqlite`, `:250` `ralph_`-IDs, `service.ts:572,608-611` Ralph-Kompat-Events/IDs, `loop-api.ts:43-58` Legacy-Pfad-Kompat, `prompts.ts:7-13` Ralph-Turn-Prompt. Diese hängen NICHT am `src/ralph`-Baum, müssen aber bei jeder `src/ralph`-Entscheidung erhalten bleiben.

Fazit N1: `src/ralph` + `ralph-api.ts` + `RalphArea.tsx`/`api-ralph.ts` bilden eine ungenutzte Insel im aktiven Produktpfad (Backend/UI/CLI laufen über `src/loops`). Ob Insel + zugehörige `dist`-pfadigen Tests bleiben oder entfallen, entscheidet der Gesamtplan — hier nur Befund.

### N2) Korrekturen K1–K4

- K1 (Zählfehler): Abschnitt 2 `src/vscode` „6 Dateien" bei 7 aufgezählten → korrigiert auf 7; 30×D-Summe bleibt (10+4+3+6+7). Betroffene Liste: `cli.ts`, `code-cli.ts`, `install.ts`, `status.ts`, `types.ts`, `uninstall.ts`, `vsix-fetcher.ts`.
- K2 (`git ls-files` = Index): Formulierungen „HEAD/getrackt" → „Index/getrackt" korrigiert (Abschnitte 2, 4b, 5, Fazit). Zum Messzeitpunkt war der Worktree clean, daher Index = HEAD-Stand; bei den jetzt sichtbaren fremden `docs/`-Änderungen gilt das nur für den Messzeitpunkt.
- K3 (kein „nie existiert"): „NIE getrackt / nie existierte" → „in geprüfter Historie nicht gefunden, kein Löschcommit nachweisbar" (Abschnitte 2, 3d, 4b, Fazit). `git log` leer beweist bei möglicherweise unvollständiger Historie keine Nichtexistenz.
- K4 (Inventar-Trennung): Abschnitt 5 ergänzt — generiert `0/0`, colocated `*.test.*` `25/7209` (alle `packages/workflows/src/testing/`, keine unter `src/`), netto `819/224669`; Repro-Skript `.tmp/beta4-source-inventory.py` (verifiziert: reproduziert `844/231878`). `routeTree.gen.ts`: weder getrackt noch im Worktree vorhanden.

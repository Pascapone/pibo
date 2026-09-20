---
type: "Research"
title: "Beta 4.0 phase-2 C1 contract draft (archived research)"
description: "Worker C1 contract draft from the analysis-only round, archived as non-approved research with an OKF envelope."
tags: ["beta-4", "phase-2", "c1", "contracts"]
status: "draft"
authority: "informative"
generated:
  by: "muse-code/a1-session"
  at: "2026-09-20T15:54:34Z"
sources:
  - id: "host-original"
    resource: "scope:beta4-phase2 host planning archive at commit time"
    title: "Unchanged host original; see checkpoint provenance for path and hash"
checkpoint:
  origin_path: ".pibo/planning/beta4-phase2-20260920/results/C1/contracts.md"
  origin_sha256: "3b452239abc1d08655b06debc1c93556a5f62d6a8ff83045363b97535a5a4022"
  origin_bytes: 18015
  archive: "docs/reports/artifacts/beta4-phase2/beta4-phase2-originals-20260920.zip"
  archive_path: "results/C1/contracts.md"
  transformations:
    - "Added this OKF frontmatter envelope; body bytes after frontmatter are unchanged from the origin."
---
# C1 – Verträge: Verbraucheranforderungen, Pilot- und Anbieterentwürfe

Markierung: `[BESTEHEND]` = heutiger Quellbeleg (Pfad genannt);
`[VORSCHLAG]` = C1-Entwurf, nicht implementiert, G1-pflichtig. Es wird kein
SDK-v1-Stand als umgesetzt behauptet. Widersprüche zu B/D sind Reviewfragen
(RQ) am Abschnittsende, keine Blocker dieser Analyse.

## 1. K02 – Tools und Ressourcen (C als häufigster Aufrufer)

### 1.1 Heutige Seams `[BESTEHEND]`

- `definePluginSessionToolProvider({phase?, includeNativeTools?, serviceMessages?,
  createSession(ctx): PluginSessionToolSet})` (`src/plugins/runtime.ts`).
- `PluginSessionToolProviderContext`: generation-gepinnter Kontext (Session, Runtime,
  Adapter, cwd, Plugin-Identität + Konfiguration, `selectedTools`, `availableTools`
  nur für Augment, `services`-Accessor).
- `registrationsForSelectedTools(ctx, definitions)` (`packaged-session-tool-helpers.ts`):
  matcht Selektion gegen Definitionen, wirft bei fehlender Definition.
  7 aktive Nutzer (s. `analysis.md` C1-08); der Helper wird in jedes Bundle einkompiliert.
- `PiboToolDefinition.execute(toolCallId, input, signal, onUpdate, context)` mit
  `PiboToolResult` (`content[]`, `isError?`, `payloadRefs?`, `metadata?` mit
  `piboTerminalStatus: timed_out`, `piboTimeoutPhase`) (`src/tools/contract.ts`).
- Nebenwege: `ToolProfile`/`providerTool` (web-search, `core/profiles.ts`),
  `normalizePiboToolDefinition` (Pi-Legacy → `portable: false`, braucht
  `nativeContext`), `definePluginSystemPromptTransformer` (codex-compat).

### 1.2 Kandidat: Einstieg für den häufigsten Aufrufer `[VORSCHLAG]`

Status (R-C1-04, korrigiert): Dies ist genau ein Kandidat aus C-Sicht
(DESIGN-IT-TWICE-Rolle: häufigsten Aufrufer optimieren), kein verpflichtender
Zusatzwrapper. G1 wählt zwischen den B/C/D-Kandidaten; verliert dieser, entfällt
er ersatzlos (kein Wrapper-auf-Wrapper). Schranke: Pi-exklusive Features
(`providerTool`-Ausführung, Pi-native Lese-/Trunkierungssemantik,
`replacesBuiltinTools`, `adapterIds`/`portable`-Grenzen) werden durch keinen
K02-Einstieg als Nebenwirkung portabel; Portabilitätsgrenzen bleiben explizit.

Form: Statt Provider-Hülle + Helper-Import pro Plugin ein Einstieg;
Selektions-Matching wandert in den Host (heute N-fach gebündelter Helper →
einmalige Host-Logik):

```ts
// [VORSCHLAG] K02-C: ein Einstieg für „N Tools materialisieren“
setupSessionTools(context, {
  tools: [hashlineDefinition],                 // statisch …
  // oder: tools: (ctx) => [createHashlineToolDefinition(ctx.cwd)], // … kontextabhängig
  dispose?: (ctx) => Promise<void> | void,      // nur bei Generations-State (code-runtime, browser-tools)
  serviceMessages?: [...],                     // nur wer sie braucht (run-control)
  augment?: { includeNativeTools: true },      // nur Augment-Anbieter (run-control)
});
```

Verhalten: Host filtert `selectedTools` gegen übergebene Definitionen (Fehler bei
fehlender Definition wie heute), erzeugt `PluginSessionToolSet`, ruft `dispose`
am Generationsende awaited auf. `phase`, `direct`/`yieldable` bleiben reine
Manifest-/Selektionsdaten, keine Aufruferlogik.

Beispiel File Editing (Entwurf gegen heutigen Code):

```ts
// heute: setupFileEditing = Provider-Hülle + registrationsForSelectedTools + normalize
// [VORSCHLAG]:
setupSessionTools(context, {
  tools: (ctx) => [normalizePiboToolDefinition(createHashlineToolDefinition(ctx.cwd))],
});
```

Beispiel Web Search (bleibt Deklaration, kein Session-Tool): `context.register(
"web_search", createWebSearchToolProfile())` `[BESTEHEND]`; keine Änderung, aber
K02 muss `providerTool`-Ausführung (Pi-Extension) als dauerhaft Pi-exklusiv
bestätigen oder neutralisieren (RQ-B1).

### 1.3 Fehler-/Abbruchverhalten `[VORSCHLAG]` (heutige Bausteine `[BESTEHEND]`)

- `execute` erhält `AbortSignal | undefined`; Abbruch → Tool wirft/bricht ab,
  Host wertet als abgebrochen, nicht als Fehler-Ergebnis (bestehende
  `signal`-Threading-Praxis bleibt; Transkription bekommt optionalen Signal-
  Durchreichungs-Slot, RQ-B2).
- Ergebnisfehler: `isError: true` + Text/Structured-Content (bestehend);
  Timeouts: `metadata.piboTerminalStatus: "timed_out"` + Phase (bestehend).
- Direkte vs. yieldbare Ausführung werden nicht vermischt (bestehende Regel);
  späte Callbacks nach Abschluss überschreiben kein Ergebnis (Host-Ownership).
- `dispose`-Fehler bleiben für Drain/Rollback sichtbar (bestehende
  `PluginSessionToolSet`-Regel); `remove()` bei aktiven Session-Children wirft
  (bestehend, `host.ts`).

### 1.4 Depth-/Locality-Begründung (Skill-Vokabular)

Depth: 6 von 7 Aufrufern schrumpfen auf ein Datenliteral (Tools + optional
`dispose`); gelernte Oberfläche: ein Funktionsname + Manifest-Selektion statt
Provider-Typ + Context-Typ + Helper-Vertrag. Locality: Matching-, Fehler- und
Dispose-Regeln konzentrieren sich im Host; der heute pro Bundle duplizierte
Helper entfällt (Deletion-Test: Löschen des Helpers ohne Host-Änderung würde
heute 7 Aufrufer brechen — nachher 0). Seam: zwischen Selektion (Host) und
Definition (Plugin); kein neuer Port ohne zweite Adapter-Seite (DEEPENING:
ein Adapter = hypothetischer Seam) — `tools(ctx)`-Fabrik deckt cwd-/Session-
Varianten ohne Port ab. RQ an B: B minimiert parallel die Lernfläche — bei
Divergenz entscheidet G1 nach Depth/Locality/Seam, nicht per Kombination (R-C1-04).

RQ-B1 Provider-Tool-Zusage? RQ-B2 Signal-Slot für Provider-Operationen?
RQ-B3 Übernimmt B den C-Einstieg oder bleibt Provider+Helper (dann: Helper
zentral statt gebündelt)?

## 2. K03 – Begrenzter Credential-Zugriff (Transkription als Erstverbraucher)

### 2.1 Heutige Form `[BESTEHEND]`

- Fabrik-Injektion: `OpenAiTranscriptionProviderOptions`
  (`model/url/fetch/getApiKey|getAuth/isConfigured`) — Form gut, Defaults
  Pi-gekoppelt (`resolvePiProviderAuth`/`readPiCredential` aus
  `src/agent-runtimes/pi/credentials.ts`, transitiv `ModelRuntime`).
- Fehlerform: `PiboTranscriptionError(code: not_configured | invalid_audio |
  provider_error)` — übernehmen.
- Verbraucherkette: Chat-UI → `POST /api/chat/transcription*` →
  `channelContext.transcribe(providerId, audio)` → Capability-Projektion
  `transcription-provider`; Auswahl per User-Setting. Abgrenzung: `Tool
  Capability Credential` (MCP-Bridge-Bearer) ist ein anderer Mechanismus und
  wird hier nicht wiederverwendet.

### 2.2 Aufrufzusage `[VORSCHLAG]` (R-C1-03 korrigiert: kein General-Fetch)

Korrigiert: `fetchWithAuth(need, url, init)` als allgemeine Schicht wird NICHT
empfohlen — ohne eng gebundenen echten Credential-Owner, Ziel-/Redirect-Policy
und Parametergrenzen wäre das ein Credential-Proxy mit Exfiltrationsrisiko.
Keine neue allgemeine authentifizierte Fetch-Schicht nur zur Entkopplung. Kein
freier String-`scope` gewährt Autorität; Autorität kommt ausschließlich aus der
Owner-Bindung. Zwei Optionen im Vergleich, Entscheid bei B (+ Security-Review):

- Option 1 (bevorzugt zu prüfen): bestehende Injektionen behalten, Owner
  wechseln. Die `getApiKey`/`getAuth`/`isConfigured`/`fetch`-Slots bleiben;
  API-Key- UND bestehende OAuth/`undefined`/Fehlersemantik bleiben erhalten
  (inkl. `not_configured`-Leittexte); B-besessene Defaults ersetzen die
  Pi-Defaults (Speicherorte, OAuth-Typen, JWT-/Account-Ableitung,
  `ChatGPT-Account-Id`-Header, UA-Regel wandern in den B-Adapter). Das Plugin
  behält Form-/URL-/Fehlerverhalten und importiert keine Pi-Pfade mehr.
  Kleinstmögliche Entkopplung, keine neue Schicht.
- Option 2 (nur eng gebunden): authentifizierte Operation mit fixem Owner,
  allowlisteten Zielen, Redirect-Policy, Größen-/Timeout-Grenzen und
  B-Security-Review — Entwurf und Freigabe nur gemeinsam mit B.

Gemeinsame Regeln (beide Optionen): Fehlerabbildung `not_configured`/`expired`/
`denied` → `PiboTranscriptionError(…, "not_configured")`, Transport-/HTTP-Fehler
→ `"provider_error"`, leeres Audio → `"invalid_audio"`; kein Fallback auf andere
Accounts/Runtimes; Auflösung pro Aufruf, kein Plugin-Token-Caching; keine
Secret-Werte in Logs, Payloads oder Produkthistorie. Depth-Begründung: Ein
Aufrufer lernt Status + eine owner-gebundene Operation statt Pi-Speicherorten,
OAuth-Typen und Header-Konventionen; B konzentriert Auth-Änderungen an einer
Stelle.

RQ-B4 Option 1 oder gebundene Option 2 (kein General-Fetch)? RQ-B5 Wer besitzt
Codex-OAuth-Refresh und Account-Ableitung (Antwort erwartet: B-Adapter)?
RQ-B6 Gilt die Zusage pro Aufruf oder pro Generation (Empfehlung: pro Aufruf)?

## 3. K05 – Gemeinsames Web-Interface (C-Verbrauchersicht)

### 3.1 Heutige Seams `[BESTEHEND]`

- View-Contribution + `browser.mjs` + Host-React-Bridge (`react`, `react-dom`,
  `jsx-runtime`, `@tanstack/react-query` als Shims) + `PluginViewProps`
  (`tab`, `piboSessionId`, `active`, `signal`, `state`/`updateState`,
  `request`, `openView`, …) + `PluginBrowserSetup` (Renderer/Hook/Shell).
- Backend-Webfläche: `PIBO_CHAT_EXTENSION_SERVICE.registerApiRoute` (vscode-web,
  remote-agent), `registerMessageAugmenter` (annotations, Kette mit
  Payload-Key-Konfliktfehler), `PiboWebApp` (`name`, `mountPath`, `apiPrefix`,
  `handleRequest`, `drain`/`dispose`, …) als `web-app`-Contribution
  (annotations, preview) und Channel-Registrierungen (cron, goal-loops).

### 3.2 Verbraucheranforderungen `[VORSCHLAG]`

- VS Code Web: friert `GET /api/chat/vscode-web` (200/405-Form, same-origin-Regel)
  und `PluginViewProps`-Vertrag ein; braucht keine weiteren UI-Helfer.
  Referenzmuster für Abbruch: `AbortSignal.any([signal, controller.signal])`
  (heute in `vscode-view.tsx`).
- Tool-Familien + Annotations: Entscheidung über geteilte View-Shell
  (`ResponsiveTabSidebarPanel`, `FirstPartySubviewNavigation`, Annotations-Hooks):
  (a) Host-Bridge-Import (K05-Export, versioniert) oder (b) dokumentierte
  Duplikation pro Bundle mit Budget. Empfehlung: (a) für Shell/Navigation,
  (b) nur für fachliche Screens. RQ-D1.
- Backend: `PiboWebApp`-Vertrag + Mounts/Präfixe (`/api/web-annotations/**`,
  `/apps/web-annotations`, Preview-, Cron-Pfade) versionieren; Augmenter-Reihen-
  folge und Key-Namespace dokumentieren (heute: Registrierungsreihenfolge,
  Konflikt wirft). RQ-D2.
- Verhalten: Subview-ID/Deep-Link/Fokus/Editor-State/Session-Ownership,
  Fehler-/Leerzustände und Erreichbarkeit bleiben (D-Nachweis im sichtbaren
  Browser); keine doppelte React-Instanz; kein Pflicht-Plugin durch Importweg.

## 4. K06 – Paket- und Buildvertrag (C-Verbrauchersicht)

### 4.1 Heutige Form `[BESTEHEND]`

- `pibo.plugin.json`: `schemaVersion: 1`, `sdk: ^1.0.0`, `entrypoints.backend/
  browser`, `contributions[]`, `services.requires/provides`, `config.scopes`.
- Artefakt-Layout: `pibo.plugin.json`, `backend.mjs` (esbuild, `packages:
  "bundle"`), `browser/index.js` (Browser-Bridge), optional `skills/`,
  `context/`, `vendor/`, `package.json` (`@pasko70/pibo-plugin-<suffix>`).
- Komposition: `standard-package-set.json`, 21-Gates (s. `analysis.md` C1-01),
  `materializeDefaultPackage` (id/version-Prüfung, Kopie nach
  `default-sources/<id>/<version>`).

### 4.2 Anforderungen `[VORSCHLAG]`

- I entscheidet 21 vs 22 (Builder + `pibo4-standard-cutover`-Test + Compute-Gate
  gemeinsam) für den Kompositionspfad. Korrigiert (R-C1-01): Das Gate blockiert
  logisch nicht jeden isolierten Pilot-Artefaktbau; Pilotnachweise brauchen
  eine prüfbare SDK-/Paketbasis von I, die unabhängige Vorbereitung läuft
  weiter. In C1 keine Builds ausgeführt.
- Versionierung (R-C1-05, korrigiert): Zwei unabhängige Versionierungen bleiben
  getrennt — npm-Release-Version (`releaseVersion`, Default `4.0.0-beta.1`, aus
  Builder-Umgebung) vs. Pluginmanifest-Version (`DEFAULT_PACKAGE_VERSION =
  "1.0.0"`) — plus bestehende Artefaktprüfungen (id/version-Match in
  `materializeDefaultPackage`, contentHash, Cutover-Bindings). Diese Analyse
  schreibt keine Werte vor und gleicht nichts frei an; konkrete Werte liefert
  der I-Paketkatalog nach Review:

```jsonc
// [VORSCHLAG] Hülle @pasko70/pibo-plugin-web-search (Werte: I-Katalog)
{ "name": "@pasko70/pibo-plugin-web-search", "version": "<I-Paketkatalog>",
  "type": "module",
  "files": ["pibo.plugin.json", "backend.mjs", "browser"],
  "dependencies": {}, "peerDependencies": { "@pasko70/pibo": "<I-Katalog>" } }
// [VORSCHLAG] @pasko70/pibo-plugin-vscode-web — identische Hülle;
// Backend-Quelltext: nur SDK + node:*; Browser: React-Bridge + SDK-Typen.
```

- Regeln: keine privaten `src/`-Querimporte im Paketquelltext — das ist das
  Grenzziel ab erstem C1-Pilotpaket. `web/http`, `tools/contract`,
  `core/events` brauchen eine B/I-Quellgrenz-Entscheidung (SDK-Export oder
  deklarierte Dependency); dokumentiertes Bundling ist nur Übergang mit Owner +
  Bedarf + Verfallsbedingung und schmuggelt keine dauerhafte Ausnahme an der
  Quellgrenze vorbei (R-C1-05). Bewertung je Dependency nach (a) Source-
  Unabhängigkeit, (b) enthaltenen Bytes, (c) externer Auflösung, (d) Lizenz-/
  Ownernachweis (R-C1-02); `vendor/` nur mit Owner + Bedarfsnachweis
  (Präzedenz: browser-tools-Acorn, runtime-pi-Auth-Storage);
  Browser-Duplikation nur bis K05-Entscheidung.
- Isolierte Tests (geplant, nicht ausgeführt): frisches Temp-Profil +
  `npm pack` → Install → Manifest-Parse + `setup()`-Import + Aktivierung im
  Host → Deinstallation ohne Datenverlust; Browser-Bundle lädt mit
  Bridge-Stub (vscode: Fallback-Pfad; ToolFamily: Settings/Context-Subviews).
  RQ-I1 (Testumgebung), RQ-I2 (Musterübernahme in Builder).

### 4.3 Pilotmanifest-Entwürfe (Delta zum Ist markiert)

Beide `[VORSCHLAG]`, Basis = heutige Manifestfunktionen:

- `pibo.web-search@1.0.0`, `sdk ^1.0.0`, Entrypoints wie heute; Tool
  `web_search` unverändert (pi-exklusiv bis RQ-B1); Settings-View unverändert;
  NEU: `services: {}` (explizit: keine Hostdienste nötig).
- `pibo.vscode-web@1.0.0`, `sdk ^1.0.0`, Entrypoints wie heute;
  `services.requires: [pibo.chat.extensions@1.0.0]`; View `VscodeView`
  unverändert; NEU (Doku, kein Verhalten): dokumentierte Route
  `GET /api/chat/vscode-web` als eingefrorene K05-Fläche.

## 5. K07 – Web Annotations als Anbieter (C-Anforderung an Ds Core-Draft)

### 5.1 Anbieterentwurf `[VORSCHLAG]`

- Typ: `pibo.web-annotations/selection`, `schemaVersion: 1` (eigene
  Anbieter-Version, unabhängig von Core-`formatVersion`).
- Payload (Snapshot beim Anhängen; JSON, keine Funktionen/DOM/zyklisch/
  `undefined`/`BigInt`/nicht-endlich):

```jsonc
// [VORSCHLAG] payload-Beispiel (gekürzt)
{ "annotationId": "wa_7f3a", "capturedAt": "2026-09-20T14:00:00Z",
  "title": "Header überlappt", "text": "Ausgewählter Text …",
  "url": "https://…", "targetKind": "text",
  "selector": "main h1", "boundingBox": {"x": 8, "y": 8, "width": 320, "height": 40},
  "sourceHints": ["App.tsx:120 · high · jsx-source"],
  "note": "Bitte prüfen", "includeDetails": true,
  "screenshot": { "kind": "core-resource-ref", "ref": "draft-res:…", "mimeType": "image/png" } }
```

- Fachliche Toggle: `includeDetails` (Detailkontext in Modellbeitrag),
  optional `includeScreenshot` (nur wenn Byte-Pfad verfügbar, sonst ablehnen
  mit Diagnose — kein stilles Weglassen).
- UI-State (nicht im Payload): Vorschau auf/zu, Reiter, Scroll, Auswahl-/
  Kopiermarkierung, gewünschte Kachelgröße.
- Größenpräferenz: schmal `3×1`, Standard `4×2`, breit `6×2`; Host klemmt auf
  Grid (12×3 / 6×3 / 3×3) und weist ungültige Registrierung ab.
- Preview/Fallback: Host-Vorschaurahmen (Fokus/Escape/Fokus-Restore);
  Fallback bei fehlendem/deaktiviertem/defektem Plugin oder unbekannter
  Schemaversion: Titel, Typ/Herkunft, gespeichertes JSON, Diagnose; Entfernen
  bleibt möglich; Versand ohne Validierung/Materialisierung blockiert.
- Validierung: Anbieter prüft fachlich (IDs ≤160, Limit 5 — Übernahme bis D1
  Limits bestätigt), Core prüft Umfang/JSON, Server wiederholt prüfend
  (Browser ≠ Berechtigungsnachweis); Payload wählt keine Rolle/Systemrechte.

### 5.2 Lifecycle-/Copy-Regeln `[VORSCHLAG]`

- `add` (snapshot) → `update(id, expectedRevision, next)` (nur fachliche
  JSON-Änderung + neue Revision) → `remove(id)`; Core-Ownership für Draft,
  Persistenz, Grid, X-/Toggle-Overlays, Copy-Ablage, Sende-Snapshot,
  Materialisierung, Receipt-Abgleich.
- Commit-Benachrichtigung (Pflicht-Anforderung, heute `commit()` → Status
  `attached`): K07 meldet verbrauchte `(id, revision)`-Paare an den Anbieter
  (sonst verliert das Plugin seine Statusmaschine). RQ-D3 (Form: Hook/Callback).
- Copy: neue Ziel-IDs, Payload-Kopie, Herkunft nur Metadaten; Tokens/Handles/
  Rechte nie kopieren; nicht-portable Inhalte lehnen die Operation als Ganzes
  ab (heutige Ablehnungspräzedenz: `resolved`/`dismissed`).
- K07-Rahmen aus V3 §12 (Grid, X-, Copy-, Receipt-, Persistenz-Regeln,
  Materialisierung erst beim Senden, bestehende Bild-/Dateifähigkeit) wird
  vollständig übernommen; der Zukunftsvertrag nutzt Ds Core-Draft + öffentliche
  Registrierung — kein eigener Attachment-Store/Sendepfad in C.

### 5.3 Offene Anbieter-Entscheidungen (sichtbar, nicht geraten)

Screenshot-Byte-Ablage (Draft-Blob-Store bei D?); Umgang `resolved`/`dismissed`
beim Senden (Block vs Warnung); Limit 5 vs Grid-Kapazität; Terminal-Card-
Renderer-Migration; Altentwurfs-Übernahme (`webAnnotationIds`-Historie lesbar).

## 6. Regel-Zusammenfassung

Owner: K02/K03-Exporte B; K04/K05/K07-Core D; K06-Artefakte I; C1-Piloten und
Annotations-Anbieter C; Gegenprüfung A. Fehler: Tool-`isError`/Timeout-Metadaten,
Transkriptions-Codes, K07-Fehlerklassen (JSON/Schema, Revision, Provider,
Zugriff, Referenz, Bytes, Storage, Materialisierung, Annahmestatus) — alle
unterscheidbar, keine stillen Drops. Lifecycle: Aktivierung validiert Graph vor
Setup (bestehend); Deinstallation stoppt Feature, löscht keine Benutzerdaten;
Reinstallation nutzt vorhandene Daten. Copy: nur K07-Copy (neue IDs, Quelle und
Zielbestand erhalten). Kein SDK-v1 als umgesetzt behauptet; alle `[VORSCHLAG]`-
Stellen brauchen G1.
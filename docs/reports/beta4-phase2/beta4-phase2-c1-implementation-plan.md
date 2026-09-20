---
type: "Research"
title: "Beta 4.0 phase-2 C1 implementation-plan draft (archived research)"
description: "Worker C1 implementation-plan draft from the analysis-only round, archived as non-approved research with an OKF envelope."
tags: ["beta-4", "phase-2", "c1", "implementation-plan"]
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
  origin_path: ".pibo/planning/beta4-phase2-20260920/results/C1/implementation-plan.md"
  origin_sha256: "8dfc0b7a7e6675305a2210cec59717e8a0b673af18215d612596b117f77b6a48"
  origin_bytes: 10039
  archive: "docs/reports/artifacts/beta4-phase2/beta4-phase2-originals-20260920.zip"
  archive_path: "results/C1/implementation-plan.md"
  transformations:
    - "Added this OKF frontmatter envelope; body bytes after frontmatter are unchanged from the origin."
---
# C1 – Umsetzungsplan: wenige große Bündel (kein Bauauftrag)

Phasen (R-C1-06, korrigiert): Analysenreview → I0/echte A1/B1/C1/D1-
Implementierungspiloten → G1 → B2/C2/D2. Bündel P und T sind C1-Piloten
(Bau nach Analysenreview + I0-Basis + Folgeauftrag); F/R/W/K sind C2
(nach G1). Kein Agent pro Plugin; Quelle/Bundle/Installgewicht werden
unterschieden. Alle Byte-/Einsparungsaussagen sind Hypothesen ohne neue
Metafiles (keine Messung in C1 ausgeführt).

## Bündelübersicht (Reihenfolge = Abhängigkeitsfolge)

| Bündel | Phase | Inhalt (Plugins) | Kern-Dateien | Wartet auf |
|---|---|---|---|---|
| P – Leichte Piloten | C1 | `pibo.web-search`, `pibo.vscode-web` | `packaged-web-search.ts`, `tools/web-search.ts`, `packaged-vscode-web.ts`, `vscode-view.tsx`, Manifestfns. | Analysenreview + I0-Basis (prüfbare SDK-/Paketbasis; 21/22 nur Kompositionspfad); D: K05-Einfrierung Route/Props |
| T – Session-Tool-Durchstiche | C1 | `pibo.transcription.*` (2), `pibo.file-editing` | `transcription/*`, `tools/hashline.ts`, `packaged-*`, Capability-/Chat-Verbraucher | B: pilotfähiger K02/K03-Zwischenstand (I0-Basis, integriert); v1 erst G1 |
| F – Tool-Familien | C2 | code-runtime, gateway-tools, run-control, codex-compat, browser-tools, mcp-cli, goal-loops | `tools/*`, `gateway/tool.ts`, `runs/*`, `loops/*`, `mcp-adapter.ts`, `*-view.tsx` (ToolFamily/Loops) | T-Muster + K02-v1 (G1) + K05-Shell-Entscheid (D) |
| R – Nicht-Pi-Runtimes | C2 | runtime-omp, runtime-codex-native, runtime-muse-native (+ builtin-profiles nach Besitzentscheid) | `agent-runtimes/{omp,codex-native,muse-native}/*`, `speech/openai-codex.ts`, `core/profiles.ts`-Anteile | B: K01 v1; I: npm-Dep-Regel (`@openai/codex`) |
| W – Web/Produkt-Flächen | C2 | preview, cron, remote-agent (+ workflows-Paketmuster mit D) | `previews/*`, `cron/*`, `remote-agent/*`, `apps/chat/*-api.ts`, Views | D: `PiboWebApp`-Versionierung; I: webOnly-Kompositionsregel |
| K – Annotations→K07 | C2 | `pibo.web-annotations` | `web-annotations/*`, Skill, Views, Augmenter→Provider | D1-Pilot → I-Integration → C1-E2E → G1; danach C2-Umstellung |

Ausgeschlossen: `pibo.agent-delegation` (retired, A-Entscheid), `web-product`
(transitional, kein Paket), `pibo.runtime-pi` (B), `packages/workflows`-Kern (D).

## P – Leichte Piloten (C1, zuerst, unabhängig)

- Arbeiten: Quellpaket-Layout je Pilot (Backend, Manifest, Browser, Tests);
  `services: {}`-Explizitheit (web-search); Routen-Doku (vscode-web); keine
  Verhaltensänderung; `PIBO_VSCODE_WEB_URL`-Fallback erhalten.
- Abhängigkeiten (R-C1-01): Analysenreview + I0-Basis (prüfbare SDK-/
  Paketbasis); 21/22-Gate betrifft den Kompositionspfad, blockiert die
  P-Vorbereitung nicht künstlich; D bestätigt `PluginViewProps` + Route als
  eingefroren.
- Geplante isolierte Tests (nicht ausgeführt): `npm pack` je Pilot →
  frisches Temp-Profil → Install → Host-Aktivierung → `setup()`-Verhalten
  (web-search: ToolProfile-Registrierung; vscode: Route 200/405 + Fallback) →
  Deinstallation; Bridge-Stub-Ladung nur als Rauchtest. Korrigiert (R-C1-06):
  HTML-/Bridge-Mocks ersetzen nicht die echte headful VS-Code-Web-Abnahme
  (sichtbarer Browser, echter same-origin Server, Fallback- UND
  Bereitschaftspfad) — sie bleibt Pflicht, D weist Browser-Seite gegenprüfend.
- Bestehende Prüfungen (Namen): `web-search-lifecycle-adversarial`,
  `web-search-trace-semantics`, `plugin-system-preview-vscode-tabs`,
  `plugin-system-{manifest,lifecycle,install,backend-loader}`,
  `pibo4-standard-cutover` (nach I-Nachzug), Spec `embedded-vscode-area.md`.
- Rücknahme: Quell-Revert pro Pilot; installierte Assembly → vorherige
  Gesamt-Assembly (kein Einzel-Tarball-Mix); keine Benutzerdaten im Pfad
  (env-konfiguriert, zustandslos).

## T – Session-Tool-Durchstiche (C1; K02/K03 beweisen)

- Arbeiten T1 (Transkription, primär; R-C1-03): Fabriken auf B-besessene
  Injektions-Defaults umstellen (Option 1 prüfen, Form + API-Key-/OAuth-/
  Fehlersemantik erhalten); Pi-Credential-Importe aus Plugin-Quelltext und
  -Bundle entfernen; Fehlercodes erhalten; `channelContext.transcribe`-
  Verdrahtung unverändert; kein General-Fetch ohne B-Security-Review.
  T2 (File Editing, sekundär): `createHashlineToolDefinition` auf
  K02-Lesezusage umstellen, `formatHashlineReadText` lokal behalten;
  `replacesBuiltinTools`/Adapterbindung erhalten (nichts wird nebenbei portabel).
- Abhängigkeiten: B liefert pilotfähigen K02/K03-Zwischenstand (I0-Basis, von I
  integriert) + Contract-Tests; v1-Entscheid erst G1. C sticht mit realer
  Verdrahtung + kontrollierter Gegenstelle (fetch-Stub, kein echter Provider).
- Geplante Tests: Transkription erlaubt/fehlend/abgelehnt (je Provider),
  Providerfehler-Textdeckelung, leeres Audio; Hashline: Ankerformat,
  Trunkierungs-Nachsatz, Bild-Passthrough, Offset/Fehler, Abort; je Bundle
  Output-Byte-Zählung Backend (Hypothesen-Baseline).
- Bestehende Prüfungen: `transcription-provider`, `transcription-plugin-manifest`,
  `chat-transcription-web`, `chat-ui-composer-transcription`, `hashline-tool`,
  `chat-ui-hashline-tool`.
- Rücknahme: Quell-Revert; Credentials nie in Snapshots; Transkriptions-
  Auswahl (User-Setting) bleibt gültig (Provider-IDs stabil).

## F – Tool-Familien (C2, nach T-Muster, ein Bündel)

- Arbeiten: restliche Session-Tool-Anbieter auf K02-v1 umstellen (welcher
  Kandidat auch gewinnt — R-C1-04, kein Zusatzwrapper; Helper-Importe
  entfallen nur, wenn v1 sie erübrigt); `codex-compat`-Base-Prompt-Transformer
  erhalten;
  `run-control`-Augment (`includeNativeTools`, Service-Messages) als
  K02-Sonderfall abnehmen; `browser-tools`-Vendor (`acorn`, Native-Tooling-
  Kontext) mit Bedarfsnachweis weiterführen; `goal-loops`-Dienste (Loop-Service,
  Stop-Conditions, Channel, Gateway-Action) als Paket geschlossen halten;
  beide Loop-Modi unangetastet (Verhaltensschutz, A-Gegenprüfung).
- Abhängigkeiten: T-Muster + B-K02-v1; D-K05-Shell-Entscheid (9× ToolFamilyView).
- Geplante Tests: je Familie Aktivierung/Ausführung/Abbruch/Wiederinstallation
  isoliert; Run-Control-Yield-Matrix; Loop-Modi-Regression (bestehende Suite,
  keine Abschwächung).
- Bestehende Prüfungen: `plugin-system-first-party-tools`,
  `plugin-system-runtime`, Loop-/Run-Suites (Namen je Familie im C2-Auftrag).
- Rücknahme: familienweise Quell-Reverts; Laufzeit-State (Runs, Loops) liegt
  in Core-Stores — Deinstallation stoppt nur Feature-Nutzung.

## R – Nicht-Pi-Runtimes (C2, nach K01 v1)

- Arbeiten: omp/codex-native/muse-native als Runtimepakete schließen
  (Treiber, Instanz, Profile, Speech-/Approval-Flächen bei codex-native);
  `runtime-pi` bleibt B; `builtin-profiles` (10 Skills, base/gateway-producer)
  nach Besitzentscheid C oder B.
- Abhängigkeiten: B-K01-v1 + Contract-Tests mit Nicht-Pi-Adaptern; I-npm-Dep-
  Regel für `@openai/codex` + Plattformpaket.
- Geplante Tests: Adapter-Contract-Suite je Runtime (Annahme/Abschluss,
  Fehler/Abort/Resume, Cleanup ohne Credential-Reste); Capability-Lücken
  explizit (kein Verschweigen).
- Bestehende Prüfungen: Adapter-Specs (`docs/specs/runtime/*-adapter.md`) +
  zugeordnete Tests; Runtime-Lifecycle-Suite.
- Rücknahme: Runtime-Paketwechsel ohne Session-Verlust (Binding bleibt);
  keine Silo-IDs ändern.

## W – Web/Produkt-Flächen (C2, mit D verzahnt)

- Arbeiten: preview/cron/remote-agent auf versionierten `PiboWebApp`-/
  Channel-Vertrag; `web-app.ts`-Querimporte (`cron-api`, `remote-agent-api`,
  `loop-api`) durch K04/K05-Zusagen ersetzen; `workflows`-Paketmuster mit D
  (Stub → echtes Paket, Kern bei D); `webOnly`-Kompositionsregel mit I klären
  (heute: preview/vscode-web/cron/remote-agent webOnly-geflaggt, aber alle 22
  im Artefakt-Set).
- Abhängigkeiten: D-K04/K05; I-Kompositionsregel.
- Geplante Tests: Kanal-Lifecycle, API-Routen-Statusmatrix, View-Mount/Unmount,
  Deinstallation ohne Datenverlust (Cron-/Preview-Stores bleiben).
- Bestehende Prüfungen: Cron-/Preview-/Remote-Agent-Suites, Gateway-Integration.
- Rücknahme: Feature-Deinstallation stoppt Routen/Channels; Stores bleiben
  für Reinstallation erhalten.

## K – Annotations→K07 (C2, zuletzt, nach D-integriert)

- Arbeiten (erst nach D1-Pilot→I→C1-E2E→G1): Anbieter auf K07 umstellen
  (Snapshot-Payload `schemaVersion: 1`, Toggles, Renderer, Ressourcen-Refs);
  danach annotationsspezifischen Sonderweg (Augmenter + Live-Read) entfernen;
  Backend-Regeln (Limits, Validierung, Tools, Skill, API, Store) erhalten.
- Abhängigkeiten: D-K07-v1 + Commit-Benachrichtigung + Ressourcen-/Receipt-
  Semantik; B-Medienprojektion; I-Assembly mit/ohne Annotations-Plugin.
- Geplante Tests: AT-01–AT-22-Zuordnung (C-Anteil: AT-01/02 Snapshot/Toggle,
  AT-09–11 Copy, AT-12–14 Sende-Races aus Anbietersicht, AT-16 Parität,
  AT-17 Fallback, AT-19 JSON-/Zugriffsverweigerung); Paritätsnachweis
  XML-Vorgänger → JSON-Nachfolger an gespeicherten Fixtures.
- Bestehende Prüfungen: `web-annotations-{attachments,store,tools,cdp-api}`,
  `chat-ui-web-annotation-*`, Spec `docs/specs/web/web-annotations.md`.
- Rücknahme: Anbieter-Revert stellt Augmenter wieder her; Draft-/Payload-
  Snapshots konsistent halten; Altentwürfe/Historie lesbar.

## Reihenfolge/Review/Integration

C1: P + T (parallel nach Analysenreview + I0) → G1 → C2: F/R/W
(weitgehend parallel) → K. Review nach
V3 §5: B prüft Vertragsnutzung, D Web-Anschluss, I Paketweg, A
Funktionsschutz; kein Selbst-Abnehmen. Integration: grüne Zwischenstände je
Bündel, I führt früh zusammen (kein Big-Bang); neue K07-Funktion als
beauftragte Erweiterung getrennt nachweisen.

## Messung (Hypothesen, keine Behauptungen)

Pro Backend: `backend.mjs`-Bytes + Browser-Bytes an frischen Pilot-Artefakten
messen (kein Gate nötig; Kompositionsmessung erst nach I-Entscheid). Methode:
frische Artefakte, Bytezählung statt Manifest-Zählen, je Dependency
(a)–(d)-Nachweis nach R-C1-02. Per-Plugin-Einsparung erst nach Messung
beziffern; bis dahin Hypothese.
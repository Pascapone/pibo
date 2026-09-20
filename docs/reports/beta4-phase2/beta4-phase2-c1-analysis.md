---
type: "Research"
title: "Beta 4.0 phase-2 C1 analysis (archived research)"
description: "Worker C1 analysis from the analysis-only round, archived as non-approved research with an OKF envelope."
tags: ["beta-4", "phase-2", "c1", "analysis"]
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
  origin_path: ".pibo/planning/beta4-phase2-20260920/results/C1/analysis.md"
  origin_sha256: "3c40c01df1beb6044f1ec489fe2dba551e631cfa1dba3bd2613190d2d35bcd7d"
  origin_bytes: 27184
  archive: "docs/reports/artifacts/beta4-phase2/beta4-phase2-originals-20260920.zip"
  archive_path: "results/C1/analysis.md"
  transformations:
    - "Added this OKF frontmatter envelope; body bytes after frontmatter are unchanged from the origin."
---
# C1 – Analyse: Plugin-Piloten, Abhängigkeiten, Annotations-Anbieter

Status: Analyse, keine Implementierung. G1-Freigabe steht aus.

## 0. Baseline und Methode

- Branch (Anfang/Ende): `beta/4.0-plugin-system`; HEAD (Anfang/Ende):
  `ece5f18cffe3f96f8f5dd8c241aac1d439c67b9a` (entspricht Dispatch-Erwartung).
- UTC Anfang: 2026-09-20T14:48:30Z; UTC Ende: 2026-09-20T14:54:52Z (Baseline),
  Dateien danach geschrieben, keine Produktänderung.
- Workspace: `/mnt/c/Users/pasca/Coding/pibo`.
- `git status --short` (Anfang = Ende, fremd, nicht korrigiert):
  `M docs/log.md`, `M docs/project/okf-migration-ledger.json`,
  `M docs/reports/index.md`,
  `?? docs/reports/beta-4-0-core-plugin-bloat-audit-2026-09-20-inventory.md`,
  `?? docs/reports/beta-4-0-core-plugin-bloat-audit-2026-09-20.md`.
- Hashprüfung der V3-Eingaben (eigene `sha256sum`-Prüfung, alle Treffer gegen
  `inputs/source-verification.json`): `pibo-beta4-arbeitsplan-v3.md` =
  `1d8f923b…3d18`, `.html` = `6d4e0a8d…879`, `pibo-codebase-design-quellen.md` =
  `6ed340fa…e680`, `SKILL.md` = `2c20617f…6d1e2`, `DEEPENING.md` = `f3dd099c…53c1`,
  `DESIGN-IT-TWICE.md` = `8e740bf9…f16bd`. Gelesene Basis: vollständiges V3-MD
  (§1–§12), SKILL/DEEPENING/DESIGN-IT-TWICE, `AGENTS.md`, `GLOSSARY.md`,
  `DESIGN.md`, Specs `docs/specs/web/{web-annotations,composer-delivery-files-and-media,embedded-vscode-area}.md`.
- Methode: nur lesend; statische Import-/Manifest-/Test-Auswertung per
  Einzeldatei-Lektüre und `grep`/Zählung. Tatsächlich ausgeführt: Hashprüfung,
  Paketregel-Zählung, Importkanten-Auszug, `git log/show` (Read-only-Historie).
  Nicht ausgeführt (verboten/nicht beauftragt): Builds, Tests, Installs,
  Provider-/Gatewayaufrufe. `dist/` wurde nicht als Quelle verwendet. I0/G1
  werden nicht als bestanden angenommen.

## C1-01 Paketbau: 22 Regeln gegen drei 21-Gates (aktuell widersprüchlich)

Quellbelege (alle HEAD-Stand):

- `src/plugins/packaged-*.ts`: 25 Dateien. Davon versandfähig: 22 (identisch in
  beiden Listen unten). Rest: `packaged-agent-delegation.ts` (retired, s. u.),
  `packaged-session-tool-helpers.ts` ( geteilter Helper, kein Setup),
  `packaged-web-product.ts` (transitional Bundle, kein Manifest).
- `src/plugins/default-packages.ts`: 22 `DEFAULT_PACKAGES`-Deskriptoren
  (Manifest + Backend-Export + Backend-Modul + optionale Browser-Module) plus
  eine ungenutzte Manifestfunktion `agentDelegationPackageManifest()`.
- `scripts/build-pibo4-artifacts.mjs`: 22 Paketregeln (Zeilen 15–36), schreibt
  `standard-package-set.json` mit allen 22 Einträgen ungefiltert.
- Dagegen verlangen exakt 21: `scripts/build-pibo4-standard.mjs` (Gate plus
  Eindeutigkeits-Gate plus Infotext „with 21 plugin packages“),
  `scripts/build-pibo4-candidate-assembly.mjs` (21 Plugins / 26 Artefakte),
  `src/compute/pool/artifacts.ts` (21/26) sowie `test/pibo4-standard-cutover.test.mjs`
  (drei `assert.equal(..., 21)`-Stellen). Statischer Befund ohne Build:
  `packages.length` ist 22, die Gates werfen bei `!== 21`.
- Ursache per Historie: Commit `a3472458` („feat(remote-agent)…“) fügte
  `remote-agent` als 22. Artefaktregel hinzu (21→22, per `git show` belegt),
  ohne die 21-Gates nachzuziehen. Die Spec `docs/specs/web/embedded-vscode-area.md`
  bestätigt 21 als Stand von `c6e39430`. Der historische „22 vs 21“-Befund ist
  damit aktuell und erklärt: **22 ist der Artefaktstand, 21 die veraltete
  Standard-/Cutover-Annahme.** Owner der Entscheidung und der Builder: I.
  Folge (R-C1-01, korrigiert): Die Gates blockieren den vollständigen
  Standard-/Candidate-/Compute-Pfad; sie blockieren logisch nicht jeden
  isolierten Pilot-Artefaktbau (Regel + `backend.mjs`/`browser`-Bundle +
  Manifestprüfung pro Paket). Isolierte Pilotnachweise brauchen eine prüfbare
  SDK-/Paketbasis von I; die unabhängige Pilotvorbereitung wird dadurch nicht
  künstlich blockiert. In C1 wurden keine Builds ausgeführt. Paketkatalog
  (= 22 Deskriptoren), Standard-Auswahl (= Gate) und Zahlengates (=
  21-Annahmen) sind drei verschiedene Dinge und werden hier nicht vermischt.

## C1-02 Plugin-/Dependency-Ownermatrix (First-Party, Quellbelege)

Legende: Manifest = Funktion in `default-packages.ts`; Backend = `packaged-*`-Setup;
laufzeitkritische Zweitordnung in Klammern. Browser-Exporte aus der Artefaktregel
(`src/apps/chat-ui/src/plugins/*.tsx`). Owner: C = diese Analyse,
(B)/(D)/(I) = Fremdbesitz nach V3 §7.

| Plugin-ID | Manifest / Backend-Setup | Backend-Quellen (direkt) | Browser-Export(e) | Ressourcen | Owner |
|---|---|---|---|---|---|
| `pibo.web-search` | `webSearchPackageManifest` / `setupWebSearch` | `src/tools/web-search.ts` (nur Typ-Imports: `core/profiles`, Pi-`ExtensionFactory`) | `ToolFamilyView` | – | C |
| `pibo.vscode-web` | `vscodeWebPackageManifest` / `setupVscodeWeb` | `src/web/http.ts` (`responseJson`), `product-services` (Typen) | `VscodeView` | – | C |
| `pibo.web-annotations` | `webAnnotationsPackageManifest` / `setup` | `src/web-annotations/{api,attachments,store,tools}.ts` → `cdp.ts`, `tools/{cdp-client,contract,schema}.ts`, `core/{events,pibo-home,profiles(Typ)}.ts`, `web/{http,types}.ts`, `node:sqlite`, `typebox` | `WebAnnotationsView`, `BuildContextView` | `skills/builtin/web-annotations/SKILL.md` (98 Z.) | C (Anbieter); D (K07-Core) |
| `pibo.file-editing` | `fileEditingPackageManifest` / `setupFileEditing` | `src/tools/hashline.ts` → **laufzeitlich** `createReadToolDefinition` aus `@earendil-works/pi-coding-agent` | `ToolFamilyView` | – | C; K02: B |
| `pibo.transcription.openai` | `openAiTranscriptionPackageManifest` / `setupOpenAiTranscription` | `src/transcription/openai.ts` → **laufzeitlich** `agent-runtimes/pi/credentials.ts` → `ModelRuntime` aus Pi-Core | – | – | C; K03: B |
| `pibo.transcription.openai-chatgpt` | dito / `setupOpenAiChatGptTranscription` | `src/transcription/openai-chatgpt.ts` → dito Pi-Credentials + JWT/Account-Ableitung | – | – | C; K03: B |
| `pibo.code-runtime` | `codeRuntimePackageManifest` / `setupCodeRuntime` | `src/tools/runtime/{registry,tool}.ts` | `ToolFamilyView` | – | C |
| `pibo.gateway-tools` | `gatewayToolsPackageManifest` / `setupGatewayTools` | `src/gateway/tool.ts` | `ToolFamilyView` | – | C |
| `pibo.run-control` | `runControlPackageManifest` / `setupRunControl` | `src/runs/{registry,reminders,tools}.ts` + Session-Service `pibo.session.yielded-runs` | `ToolFamilyView` | – | C |
| `pibo.codex-compat` | `codexCompatPackageManifest` / `setupCodexCompat` | `src/core/codex-compat.ts`, `src/tools/{codex-compat,codex-image-generation}.ts` | `ToolFamilyView` | – | C |
| `pibo.browser-tools` | `browserToolsPackageManifest` / `setupBrowserTools` | `src/tools/codex-browser.ts` | `ToolFamilyView` | `context/pibo-native-tooling.md`, `vendor/{acorn,acorn-walk}.cjs` | C |
| `pibo.mcp-cli` | `mcpCliPackageManifest` / `setupMcpCli` | `./mcp-adapter.ts` (kein `../`-Import) | `ToolFamilyView` | – | C |
| `pibo.goal-control` | `goalControlPackageManifest` / `setupGoalControl` | `src/loops/{channel,plugin,stopping,store,tools}.ts`, `src/apps/chat/loop-api.ts` | `ToolFamilyView`, `LoopsView` | – | C |
| `pibo.preview` | `previewPackageManifest` / `setupPreview` | `src/previews/web-app.ts` | `PreviewView` | – | C |
| `pibo.cron` | `cronPackageManifest` / `setupCron` | `src/cron/{channel,store}.ts`, `src/apps/chat/{cron-api,web-app}.ts` | `CronView` | – | C |
| `pibo.remote-agent` | `remoteAgentPackageManifest` / `setupRemoteAgent` | `src/remote-agent/{service,store}.ts`, `src/apps/chat/{remote-agent-api,web-app}.ts` | `RemoteAgentView` | – | C |
| `pibo.workflows` | `workflowsPackageManifest` / `setupWorkflows` | (Stub: nur `view`-Registrierung; echtes Paket `packages/workflows`) | `WorkflowsView` | – | D (Workflow), C (Paketmuster) |
| `pibo.runtime-pi` | `piRuntimePackageManifest` / `setupPiRuntime` | `src/agent-runtimes/pi/{adapter,credentials}.ts` + OAuth-Bootstrap + `vendor/pi-auth-storage.mjs` | – | `vendor/` | B |
| `pibo.runtime-codex-native` | `codexNativeRuntimePackageManifest` / `setupCodexNativeRuntime` | `agent-runtimes/codex-native/{adapter,gateway-actions}.ts`, `speech/openai-codex.ts` | `RuntimeRequestsView` | npm-Dep `@openai/codex@0.153.2` | C (Paket), B (K01) |
| `pibo.runtime-muse-native` | dito / `setupMuseNativeRuntime` | `agent-runtimes/muse-native/adapter.ts` | `RuntimeRequestsView` | – | C (Paket), B (K01) |
| `pibo.runtime-omp` | `ompRuntimePackageManifest` / `setupOmpRuntime` | `agent-runtimes/omp/adapter.ts` | – | – | C (Paket), B (K01) |
| `pibo.builtin-profiles` | `builtinProfilesPackageManifest` / `setupBuiltinProfiles` | `src/core/profiles.ts` (`InitialSessionContextBuilder`, `PIBO_STANDARD_SKILL_NAMES` = 10 Skills) | – | 10 Skills aus `skills/builtin/` | C/B-Grenze (Reviewfrage) |
| `pibo.agent-delegation` | Manifestfn. vorhanden, **nicht** in `DEFAULT_PACKAGES`/Artefakten | `src/subagents/{controller,tool}.ts` | – | – | retired: `agent-store.ts` filtert die ID aktiv heraus; Dateien/Manifestfn. sind Restbestand (A-Sicht nötig) |
| (transitional) | – / `setupWebProduct` | `apps/chat/web-app.ts`, `cron/channel.ts`, `previews/web-app.ts` | – | – | nicht versandfähig; kein C2-Paket |

Externe Plugins: `PluginSource` (`manifest.ts`) kennt `builtin`/`local`/`package`;
Backend-Loader, Install/Lifecycle und Management-Tests existieren
(`plugin-system-{install,lifecycle,backend-loader,…}.test.mjs`). Externe
Pluginquellen wurden auftragsgemäß nicht bewertet.

## C1-03 Root-Arbeitsraum vs. installierte Pakete

- Root ist privater Build-Arbeitsraum: `package.json` (`private: true`,
  Workspaces nur `packages/workflows`), `src/**`, `scripts/build-pibo4-*`,
  `dist/` (nicht als Quelle verwendet). Installiert wird daraus: Core-Paket
  (`dist/pibo4-core-package`), 22 Plugin-Artefakte (`dist/pibo4-artifacts/<suffix>/`
  mit `pibo.plugin.json`, `backend.mjs`, optional `browser/`, `skills/`,
  `context/`, `vendor/`), Standard (`dist/pibo4-standard-package`) und
  Kandidaten-Assembly (Tarballs + `assembly-manifest.json`).
- `materializeDefaultPackage()` kopiert gebaute Artefakte aus `dist/` nach
  `<artifactRoot>/default-sources/<id>/<version>` und prüft id/version; Fehlen
  eines Artefakts wirft („Build or install @pasko70/pibo-standard“). Laufzeit
  lädt also Kopien, nie den Root-Checkout direkt.
- `backend.mjs` wird per esbuild mit `packages: "bundle"` gebündelt: heutige
  implizite Regel ist „alles einkompilieren“, d. h. Pi-SDK- und Core-Module
  landen unsichtbar im Plugin-Bundle. Bewertung (R-C1-02, korrigiert):
  Gebündelt ist nicht automatisch ein Verstoß gegen unabhängige Installation.
  Getrennt zu bewerten sind (a) Source-Unabhängigkeit (keine privaten
  `src/`-Querimporte im Paketquelltext), (b) tatsächlich enthaltene Bytes
  (Bundle messen, nicht Manifest zählen), (c) externe Auflösung (nichts löst
  zur Laufzeit zufällig aus Root-`node_modules` auf), (d) Lizenz-/Owner-
  nachweise je Dependency. Zufällige Laufzeit-Auflösung aus Root-`node_modules`
  ist etwas anderes als dokumentiertes Buildzeit-Bundling; K06 muss pro
  Dependency festlegen: bündeln vs. deklarieren vs. verbieten (s. `contracts.md`).
- Browser-Bundles nutzen Host-Bridges für `react`, `react-dom`,
  `jsx-runtime`, `@tanstack/react-query` (Shim-Präzedenz im Artefakt-Skript);
  alle übrigen relativen Core-UI-Importe werden pro Plugin dupliziert (C1-10).

## C1-04 Pilotpfad Web Search (heute)

- Manifest (`webSearchPackageManifest`): `backend.mjs` + `browser.mjs`, ein
  Tool-`web_search` (`yieldable: false`, `runtime.adapterIds: ["pi"]`,
  Kontext `stage: provider-tools`), generische `settings`-View.
- Backend (`packaged-web-search.ts`, 7 Zeilen): registriert `web_search` mit
  `createWebSearchToolProfile()` (reines `ToolProfile`-Objekt, keine
  `PiboToolDefinition`) plus `settings`. Keine Hostdienste (`services.require`
  kommt nicht vor). `src/tools/web-search.ts` (187 Z.) ist laufzeitlich
  dependenzfrei (nur Typ-Imports); Kern: `normalizeOpenAiWebSearchConfig`,
  `addOpenAiWebSearchProviderTool` (hängt `type: "web_search"` + Sources-Include
  an Responses-Payloads), `createWebSearchProviderExtension` (Pi-`ExtensionFactory`
  auf `before_agent_start`/`before_provider_request`).
- Tatsächliche Ausführung liegt beim Pi-Adapter (`agent-runtimes/pi/*`,
  `core/profiles.ts`, `agent-runtime/*` konsumieren `providerTool`): Das Plugin
  liefert nur Deklaration + Extension-Fabrik; der schwere Teil (Provider-Request-
  Mutation) läuft im B-besessenen Pi-Laufzeitpfad. Entkopplungsfolge: Das
  Pilotpaket ist leicht verpackbar, aber semantisch Pi-exklusiv (`adapterIds:
  ["pi"]`, OpenAI-Responses-Form). Eine neutrale K02-Zusage für Provider-Tools
  fehlt (Reviewfrage an B).
- Bestehende Prüfungen (Namen, nicht ausgeführt):
  `test/web-search-lifecycle-adversarial.test.mjs`,
  `test/web-search-trace-semantics.test.mjs`, Manifest-/Lifecycle-Suite.

## C1-05 Pilotpfad `pibo.vscode-web` (heute, zu erhalten)

- Manifest: `backend.mjs` + `browser.mjs`, erfordert `pibo.chat.extensions@1.0.0`,
  eine Produkt-View (`VscodeView`, workspace/singleton/unmount).
- Backend (`packaged-vscode-web.ts`, 44 Z.): registriert `view`, liest
  `PIBO_VSCODE_WEB_URL` (+ `PIBO_VSCODE_WEB_WORKSPACE_ROOT`), serviert
  `GET /api/chat/vscode-web` (`{integration: {url, workspaceRoot?} | null}`,
  405 sonst). `resolveVscodeWebUrl` erzwingt same-origin absolute Pfade.
  Einziger Hostdienst: `PIBO_CHAT_EXTENSION_SERVICE.registerApiRoute`.
- Browser (`vscode-view.tsx`, 135 Z.): lädt Integrations-Metadaten, prüft
  Workbench-HTML (`text/html`), bettet per `<iframe>` ein, pollt
  `.monaco-workbench` + Theme-Selektor (50 ms, 60 s Timeout), Retry-UI,
  `PluginViewProps`-Vertrag (`active`, `signal`, …) aus `plugins/sdk`.
  Imports: `react`, `lucide-react`, SDK-Typen — keine Core-UI-Module, damit der
  sauberste Browser-Pilot.
- Verhaltensschutz: Spec `docs/specs/web/embedded-vscode-area.md` (normativ),
  Tests `test/plugin-system-preview-vscode-tabs.test.mjs`, Loop-/Produkt-Suites
  bleiben unberührt (kein Loop-/Session-Code im Pfad).
- Umwelt-Erkenntnis: Ohne `PIBO_VSCODE_WEB_URL` ist „unavailable“ der
  Normalfall; der konfigurierte Pfad braucht einen echten same-origin
  VS-Code-Server (in Spec als Evidenzlücke benannt).

## C1-06 Schwieriger Fall A: Transkription = K03-Belastungsfall (gewählt)

- Zwei Plugins, je eine `transcription-provider`-Contribution, kein Browser:
  `pibo.transcription.openai` (`openai-api`, Modell `gpt-4o-mini-transcribe`,
  `https://api.openai.com/v1/audio/transcriptions`) und
  `pibo.transcription.openai-chatgpt` (`openai-chatgpt`, ChatGPT-Backend
  `…/backend-api/transcribe`, UA-Spoofing-Default, `ChatGPT-Account-Id`-Header).
- Heutiger schwerer Pfad: Beide Fabriken defaulten auf Pi-Credential-Zugriffe
  (`resolvePiProviderAuth`/`readPiCredential` aus
  `src/agent-runtimes/pi/credentials.ts`), das seinerseits `ModelRuntime` aus
  `@earendil-works/pi-coding-agent` importiert. Das Plugin-Bundle zieht damit
  transitiv Pi-Laufzeit in ein angebliches Ein-Datei-Backend. ChatGPT-Variante
  zusätzlich: OAuth-Typprüfung, Token-als-API-Key-Umdeutung, Account-ID aus
  JWT-Payload — tiefe Pi-Auth-Detailkenntnis im Plugin.
- Entkopplungs-Seam existiert bereits als Injektion: `OpenAiTranscriptionProviderOptions`
  (`model/url/fetch/getApiKey|getAuth/isConfigured`). Der schwere Default ist
  das Problem, nicht die Form. Offene K03-Frage (R-C1-03, korrigiert):
  owner-gebundener Ersatz der Pi-Defaults — bevorzugt zu prüfen sind
  B-besessene Defaults hinter den bestehenden Injektionen (Form bleibt, Owner
  wechselt); eine authentifizierte Operation kommt nur eng gebunden (echter
  Owner, Ziel-/Redirect-Policy, Parametergrenzen, Security-Review) infrage.
  Keine allgemeine Fetch-Schicht nur zur Entkopplung (s. `contracts.md` §2).
- Verbraucherseite (belegt): Chat-UI → `POST /api/chat/transcription*`
  (`chat-transcription.ts`) → `channelContext.transcribe(providerId, audio)` →
  `capability-host.ts`-Projektion `transcription-provider`; Providerauswahl per
  User-Settings (`sanitizeTranscriptionProviderId`). Fehlerform heute:
  `PiboTranscriptionError` mit `not_configured`/`invalid_audio`/`provider_error`
  (gute K03-Ausgangsbasis). Bestehende Prüfungen:
  `test/transcription-provider.test.mjs`, `test/transcription-plugin-manifest.test.mjs`,
  `test/chat-transcription-web.test.mjs`, `test/chat-ui-composer-transcription.test.mjs`.
- Abgrenzung: `speech/openai-codex*.ts` + `speech-provider`-Contribution
  (Realtime-Call-Proxy, codex-native) ist ein anderer Pfad als diese beiden
  Transkriptions-Provider und gehört nicht in diesen Durchstich.

## C1-07 Schwieriger Fall B: File Editing = K02-Belastungsfall (gewählt, zweiter)

- Ein Tool `hashline` (`yieldable: false`, `runtime.adapterIds: ["pi"]`,
  `metadata.replacesBuiltinTools: ["read"]`): `createHashlineToolDefinition(cwd)`
  wrapt Pi-`createReadToolDefinition(cwd)` und präfixt `LINE#HASH:`-Anker
  (`formatHashlineReadText`, reine Funktion, gut testbar).
- Heutiger schwerer Pfad: direkter Laufzeit-Import aus
  `@earendil-works/pi-coding-agent` im Plugin-Backend; `normalizePiboToolDefinition`
  stuft die Pi-Form als `portable: false` ein (braucht `nativeContext`, kein
  portables MCP). Session-Tool-Provider mit `registrationsForSelectedTools`.
- Fehlende Aufrufzusage (K02): ein neutraler „Datei lesen mit
  Trunkierungssemantik“-Dienst oder eine deklarierte Pi-Read-Adapterstelle, die
  das Plugin ohne Pi-SDK-Import nutzen kann. Kleinstmögliche Entkopplung:
  Formatierung (`formatHashlineReadText`) bleibt Plugin-lokal (pure, In-process),
  Lesezugriff wird injiziert. Bestehende Prüfungen: `test/hashline-tool.test.mjs`,
  `test/chat-ui-hashline-tool.test.mjs`.
- Gewählt wurden beide schwierigen Fälle (Transkription UND File Editing), weil
  V3 C1 genau einen Durchstich durch „File Editing oder Transkription“ verlangt,
  beide aber verschiedene Verträge belasten (K03 vs K02); der primäre
  Durchstich ist Transkription (Auth-Seam mit B), File Editing ist sekundär
  vorbereitet. Kein Mehraufwand im Review: beide Entwürfe stehen in
  `contracts.md`, umgesetzt wird in C2 nur nach G1.

## C1-08 K02/K03 aus häufigster Aufrufersicht (Kurzbefund)

- Häufigstes Aufrufmuster (7 aktive `packaged-*`): `definePluginSessionToolProvider`
  + `createSession(providerContext)` + `registrationsForSelectedTools(...)`
  (browser-tools, code-runtime, codex-compat, file-editing, gateway-tools,
  goal-loops, run-control). Daneben: `ToolProfile`-Registrierung (web-search),
  Provider-Objekt-Registrierung (Transkription, `transcription-provider`),
  Treiber-/Instanz-Registrierung (Runtimes), System-Prompt-Transformer
  (codex-compat), View-/Web-App-/Channel-Registrierungen.
- Bewertung: Der Session-Tool-Pfad ist für den Normalfall („N Tools aus M
  Definitionen materialisieren“) zu explizit: Provider-Hülle, Context-Typ,
  Registrierungs-Helper und Manifest-`sessionToolProvider`-Verdrahtung müssen
  gemeinsam stimmen, obwohl 6 von 7 Aufrufern exakt dasselbe tun. Das ist eine
  flache Stelle (viel Interface, wenig je Aufrufer variierendes Verhalten).
  Ein konkreter Kandidat (auf häufigsten Aufrufer optimiert) samt Fehler-/
  Abbruchverhalten und Depth-/Locality-Begründung steht in `contracts.md`
  (K02-Vorschlag; R-C1-04: nur ein Kandidat, kein Pflicht-Wrapper;
  Pi-Exklusives wird dadurch nicht portabel). Widersprüche zu B/D sind dort
  als Reviewfragen markiert, nicht als Blocker dieser Analyse.

## C1-09 Web Annotations: Ist-Pfad Auswahl → Composer → Modell (K07-Basis)

Belegkette (alle Pfade HEAD-geprüft):

1. Auswahl (Browser): `use-session-web-annotations.ts` hält
   `selectedWebAnnotationIds` (React-State) + Toggle/Clear; Panel
   `WebAnnotationsSessionPanel`; kein Persistenz- oder Snapshot-Schritt.
2. Composer: `composer-send.ts` baut Sendeplan `{piboSessionId, text,
   webAnnotationIds, fileAttachmentPaths, clientTxnId, delivery}` + optimistisches
   Event; `rememberPendingMessageTransaction` persistiert in `sessionStorage`
   (Reload-Schutz des Sendevorhabens, kein Draft-Store);
   `api-chat-sessions.ts` sendet `webAnnotationIds` im Body.
3. Annahme (Server): `sendChatMessage` (`web-app.ts`, ab ~Z.4443): Text-/
   Delivery-/`clientTxnId`-Normalisierung → Session-/Room-Auflösung →
   Idempotenz via `findByClientTxn` (Duplikat-Antwort) →
   `chatExtensions.prepareMessage({piboSessionId, messageText, body})` →
   `prepareChatFileAttachments` → `appendEvent`/`admit` mit Receipt
   (`admission.receipt`, `message-receipts/<id>`). Der K07-wiederverwendbare
   `clientTxnId`-/Receipt-Weg existiert also bereits.
4. Plugin-Augmenter (`packaged-web-annotations.ts` `setup()`): registriert
   `registerMessageAugmenter` → `prepareWebAnnotationMessageAttachments`
   (liest **live** aus `WebAnnotationStore`, keine Snapshot-Trennung):
   ID-Normalisierung (Array, dedup, Limit 5 aus `WEB_ANNOTATION_LIMITS.attachments`,
   max 160 Zeichen), Ablehnung von `resolved`/`dismissed`, XML-Rendering
   `<attached-web-annotations>` (ID, targetKind, sourceSession/Room, URL, Label,
   primaryTarget, piboContext, selector, sourceHints, position, text, htmlHint,
   comment; Secret-Redaktion via `validation.ts`), Payload
   `{webAnnotationIds, webAnnotationAttachments, webAnnotationContext}`,
   `commit()` markiert `attached`. Fehler → 400 (404 bei fremder App).
5. Persistenz: `WebAnnotationStore` = `node:sqlite`, Default
   `piboHomePath("web-annotations.sqlite")`, WAL, Tabellen für Bindings,
   Annotations, Threads; Screenshot nur als `screenshotRef`-Metadaten
   (`artifactId/path/mimeType/…`), **keine** Screenshot-Bytes im Nachrichtenpfad
   (Medienlücke, s. C1-10). Tools (6, `web_annotations_*`, direkt + watch):
   list/get/watch/acknowledge/resolve/dismiss mit Session-Scope-Prüfung.
6. Honorare Oberflächen: Skill (progressive Anleitung inkl. CDP-Voraussetzung),
   API-Web-App (`/api/web-annotations/**`, `/apps/web-annotations`, Overlay-Script,
   CORS/same-origin-Regeln), Views (`WebAnnotationsView` mit
   Annotations/Settings/Context-Subviews; `BuildContextView`;
   `terminal-card`-Renderer `web-annotation` mit Fallback-Text).
7. Dateien-Verhalten daneben (Medien-Parität-Referenz): `chat-files.ts` —
   Upload in privates Verzeichnis (0700), Pfad-Validierung, XML
   `<attached-uploaded-files>` (name/path/bytes); Bildbytes laufen über
   Vorschau-/Trace-Pfade, Modell liest Dateien über Werkzeugzugriff auf Pfade.
   K07-Implikation: Snapshot-/Ressourcenmodell muss diesen Pfad-Lese-Vertrag
   erhalten (B/D-Besitz der Medienprojektion).

K07-Deltas zum Ist (Vollständigkeit in `contracts.md`): Snapshot beim Anhängen
(heute Live-Read beim Senden — beabsichtigte Verhaltensänderung), JSON-Payload
statt XML-Anhang im Text (heute XML in `messageText`), UI-State-Trennung (heute
nur React-State + `sessionStorage`-Sendevorhaben), Grid/Copy/Receipt-Semantik
(neu, beauftragt), Screenshot-Bytes (heute nur Ref-Metadaten).

## C1-10 Konkrete Entkopplungsblocker und Grenzen

Blocker (jede Zeile: Befund → benötigte Zusage → Owner):

1. `B-21GATE`: 22 Artefakte vs 21-Gates (C1-01) blockieren den vollständigen
   Standard-/Candidate-/Compute-Pfad (nicht logisch jeden isolierten
   Pilot-Artefaktbau) → I entscheidet 21/22 (Builder + Cutover-Test +
   Compute-Gate gemeinsam) und liefert eine prüfbare SDK-/Paketbasis;
   unabhängige Pilotvorbereitung läuft weiter (R-C1-01, korrigiert).
2. `B-UISHELL`: Plugin-Browser-Bundles kompilieren Core-UI-Module ein
   (`web-annotations-view` ← `responsive-pane-sidebar`, `use-session-web-annotations`,
   `web-annotations`; `tool-family-view` ← `responsive-pane-sidebar`,
   `first-party-subview-navigation`; 9× `ToolFamilyView`-Duplikation über
   Plugins) → D entscheidet K05-Shared-Import (Bridge-Erweiterung, Präzedenz:
   React/ReactDOM/jsx-runtime/React-Query-Shims) oder akzeptierte Duplikation.
3. `B-PITOOL`: `hashline` braucht Pi-`createReadToolDefinition` zur Laufzeit →
   B liefert K02-Lesezusage oder deklarierte Pi-Adapterstelle.
4. `B-PICRED`: Transkription braucht Pi-Credential-Defaults (`resolvePiProviderAuth`,
   `readPiCredential`, `ModelRuntime`-Transitivität) → B liefert K03-Accessor.
5. `B-PROVIDERTOOL`: `web_search`-Ausführung (`ExtensionFactory`,
   `before_provider_request`) lebt im Pi-Adapter; Plugin liefert nur
   `ToolProfile`-Deklaration → B klärt neutrale Provider-Tool-Zusage oder
   bestätigt Pi-exklusiv als dauerhafte K02-Grenze.
6. `B-WEBAPP`: `PiboWebApp`-Mount/API-Präfix-Vertrag (Annotations-API,
   Preview, Cron-Channel) ist Produkt-Service-Verhalten ohne SDK-Version →
   D versioniert/friert die K05-Backendfläche ein (Mounts, Routen, Auth).
7. `B-SMALLCORE`: Kleine Core-Module im Plugin-Bundle (`web/http.ts` 303 Z.,
   `tools/{contract,schema,cdp-client}.ts`, `core/{events,pibo-home}.ts`)
   sind logische SDK-Kandidaten → B/I entscheiden SDK-Export vs. deklarierte
   Dependency; Quelltext ohne private `src/`-Importe bleibt das Grenzziel.
   Dokumentiertes Bundling ist allenfalls Übergang mit Owner + Bedarf +
   Verfallsbedingung und ersetzt die Quellgrenz-Entscheidung nicht (R-C1-05).
8. `B-MEDIA`: Kein Screenshot-/Bild-Byte-Pfad Annotation→Modell; Datei→Modell
   läuft über Serverpfad + Werkzeug-Lesen → D/B definieren K07-Ressourcenreferenz
   und Medienprojektion; C liefert nur Payload + Ref-Anforderung.
9. `B-COMMIT`: Plugin erfährt Senden heute via Augmenter-`commit()` (markiert
   `attached`) → K07 braucht eine Commit-/Annahme-Benachrichtigung an Anbieter
   (D-Design, C-Anforderung in `contracts.md`).
10. `B-RETIRED`: `pibo.agent-delegation`-Dateien + Manifestfunktion existieren
    trotz Retirement (Filter in `agent-store.ts`) → A bestätigt Löschbarkeit;
    C plant kein Paket dafür.

Grenzen dieser Analyse: keine Build-/Test-/Byte-Messung (daher alle
Einsparungsaussagen Hypothesen); `dist/` nicht als Quelle; B1/D1-Vertragstände
unbekannt (Reviewfragen statt Annahmen); Bild-/Medien-Laufzeitprojektion bei
B/D; Workflow-Paket (`packages/workflows`) bei D; Pi-Runtime + Pi-TUI bei B/A→B.

## Reviewfragen (Schnittstellen, ohne Warten dokumentiert)

- An B: K02-Lesezusage für hashline? K03-Option (Injektions-Defaults vs.
  gebundene Operation, kein General-Fetch) + Codex-OAuth-Refresh-Besitz?
  Provider-Tool-Zusage oder Pi-exklusiv? SDK-Kandidaten (`tools/contract`,
  `web/http`, `core/events`)? `pibo.builtin-profiles`-Besitz (C-Paket vs
  B-Core)? Kleine Runtime-Bibs (`tools/schema`, `cdp-client`) behalten?
- An D: K05-Shared-UI-Import vs Duplikation? `PiboWebApp`-Vertrags-
  Versionierung? K07-Core-Draft-Stand + Commit-Benachrichtigung + Ressourcen-/
  Receipt-Semantik (Termine für D1-Pilot→I→C1)? Terminal-Card-Renderer-Weg?
- An I: 21-vs-22-Entscheidung + Gate-/Test-Nachzug? Paketmuster-
  Übernahme (`files`, Browser-Bridge, Vendor-Regeln)? Isolierte
  Install-Testumgebung für C2?
- An A: `agent-delegation`-Reste löschbar? Attachment-Verhaltensmatrix als
  Gegenprüfungsbasis verfügbar?

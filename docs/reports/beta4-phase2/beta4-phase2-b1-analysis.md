---
type: "Research"
title: "Beta 4.0 phase-2 B1 analysis (archived research)"
description: "Worker B1 analysis from the analysis-only round, archived as non-approved research with an OKF envelope."
tags: ["beta-4", "phase-2", "b1", "analysis"]
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
  origin_path: ".pibo/planning/beta4-phase2-20260920/results/B1/analysis.md"
  origin_sha256: "80d79b131b61be7bdfe7b7fe81c999c86786d00cff6729bda2d4ebbf3bbc3e36"
  origin_bytes: 21554
  archive: "docs/reports/artifacts/beta4-phase2/beta4-phase2-originals-20260920.zip"
  archive_path: "results/B1/analysis.md"
  transformations:
    - "Added this OKF frontmatter envelope; body bytes after frontmatter are unchanged from the origin."
---
# B1 – Analyse: Kernverträge und Runtimegrenzen

## 1. Baseline und Methode

- Branch: `beta/4.0-plugin-system`; HEAD Anfang/Ende: `ece5f18cffe3f96f8f5dd8c241aac1d439c67b9a` (entspricht Dispatch-HEAD).
- UTC (belegte Zeitpunkte dieser Analyse-Session): Beginn 2026-09-20T14:48:44Z
  (Baseline-Kommando), Ergebnisverzeichnis angelegt 14:51:38Z, Verifikation/Ende des
  Erstschriebs 14:55:11Z. Korrekturpass R-B1-01…06: 14:56:34Z–15:00:50Z.
  Zwischenliegende Minuten sind Schreib-/Lesezeit ohne eigene
  Zeitstempel und werden nicht als Messwerte behauptet.
- Workspace: `/mnt/c/Users/pasca/Coding/pibo`.
- `git status --short` (Beginn und Schreibzeitpunkt identisch): geändert `docs/log.md`,
  `docs/project/okf-migration-ledger.json`, `docs/reports/index.md`; untracked zwei
  `docs/reports/beta-4-0-core-plugin-bloat-audit-2026-09-20*.md`. Fremde Änderungen nicht angefasst.
- Methode: ausschließlich statische Leseanalyse (Quellbeleg = gelesen, mit Pfad:Zeile/Symbol).
  Keine Builds/Installs/Tests ausgeführt, keine Produktänderung. Gelesen: V3-Plan vollständig
  (`inputs/pibo-beta4-arbeitsplan-v3.md`, SHA-256 `1d8f923b…3d18` lt. `source-verification.json`),
  `SKILL.md`/`DEEPENING.md`/`DESIGN-IT-TWICE.md`, `AGENTS.md`, `GLOSSARY.md`, relevante heutige
  Specs (`docs/specs/runtime/*`, `docs/specs/resources/*`) und die unten genannten Quellen.
- Markierung: `[Quelle]` = am HEAD gelesener Quellbeleg; `[historisch]` = ältere Spec/Audit-Aussage,
  nicht neu verifiziert; `[Vorschlag]` = Vertragskandidat; `[Annahme, ungeprüft]` = offen.
- Bestehendes `dist/pibo4-core-executable.metafile.json` ist `[historisch]`, keine frisch geprüfte
  Baseline; `bytesInOutput`-Auswertung nur mit Herkunft, kein neuer Build (Auftrag Pkt. 4).

## 2. Aktuelle Export-/Verbraucherkarte (K01–K03)

### K01 – Runtime und Session

| ID | Export (CURRENT) | Ort | Owner | Heutige Aufrufer |
|---|---|---|---|---|
| B1-01 | `AgentRuntimeAdapter`, `AgentRuntimeDriver`, `OpenAgentRuntimeSessionInput` | `src/agent-runtime/types.ts:159,208,247` | B (neutrale Typen) | `AgentRuntimeAdapterRegistry` (`src/agent-runtime/registry.ts`), Pi/OMP/Codex/Muse-Adapter unter `src/agent-runtimes/`, `src/plugins/packaged-runtime-*.ts` |
| B1-02 | `AgentRuntimeSession` (`getBinding/subscribe/prompt/steer?/abort/dispose/getStatus`, `controls?`, `capabilities`) | `src/agent-runtime/types.ts:403` | B (Vertrag), Adapter (Implementation) | `RuntimeRoutedSession` (`src/agent-runtime/routed-session.ts:321`), Session-Router (`src/core/session-router.ts`) |
| B1-03 | `validateAgentRuntimeSessionContract` / `assertAgentRuntimeSessionContract` | `src/agent-runtime/contract.ts:13,97` | B | Registry beim Öffnen (vgl. Spec `docs/specs/runtime/adapter-contract.md`, RUN-SPI-002) |
| B1-04 | `AgentRuntimeSemanticEvent` (28 Varianten), `AgentRuntimeEventListener` | `src/agent-runtime/events.ts:53` | B | alle Adapter (Emission), `RuntimeRoutedSession.handleRuntimeEvent`, Trace-Projektionen |
| B1-05 | `RuntimeRoutedSession` (`enqueueMessage/steerMessage/abort/dispose`, Queue-Limits, Preflight, Capacity, Fallbacks) | `src/agent-runtime/routed-session.ts:290` | B (Core-Orchestrierung) | `src/core/session-router.ts`, Gateway/Channel-Schicht |
| B1-06 | `RuntimeSessionBinding`, `AgentRuntimeBindingPersistence.compareAndSet` | `src/sessions/runtime-binding.ts`, `src/agent-runtime/types.ts:142` | B (Persistenzvertrag), Adapter (Revision) | Adapter-`openSession`, `resolveBinding?` |
| B1-07 | Fehler: `AgentRuntimeContractError`, `AgentRuntimeCapabilityUnavailableError`, `AgentRuntimeBindingMissingError`, `RuntimeQueueCapacityError` | `src/agent-runtime/errors.ts`, `src/agent-runtime/routed-session.ts:70` | B | Router, UI-Fehlerpfade |

Annahme vs. Abschluss `[Quelle]`, korrigiert (R-B1-02): `enqueueMessage`
(`routed-session.ts:337`) validiert Kapazität (1 MiB/Nachricht, 64 Nachrichten, 4 MiB Queue,
10 Min. älteste Wartezeit), ruft `onAccepted()` auf, stellt die Nachricht in die Queue und
emittiert sofort `message_queued` (= Annahme in die Router-Queue). Der Abschluss ist NICHT
allein eventseitig: `processQueuedMessage` wartet auf die `prompt()`-Promise
(`:1099` in `promptWithinCapacity`, via `promptWithModelFallbacks :1201`) und emittiert bei
deren Erfolg `message_finished` (`:1203–1211`) — aber nur, wenn kein Fehler markiert wurde.
`turn_failed`/`error`-Events rufen `handleRuntimeFailure` (`:1019`), das
`activeMessageFailed=true` setzt und `session_error` emittiert (`:1048–1057`); dadurch
entfällt `message_finished`, und der `catch`-Pfad (`:1212`) unterdrückt Doppel-Fehler.
Bei Modell-Fallbacks werden Providerfehler stattdessen als `pendingProviderFailure`
zwischengespeichert (`:1041`) und treiben den Retry mit dem nächsten Modell (`:1146`);
nur der letzte Fehlschlag wird emittiert. Was genau die Auflösung der `prompt()`-Promise
pro Adapter bedeutet (Turn vollständig vs. übergeben), ist im neutralen Vertrag heute nicht
festgeschrieben — das schließt K01-P3 (Terminal-Invariante) als Vorschlag.
Run-Reminder-Nachrichten werden koalesziert (`:342`) und über `RunReminderTurnGuard`
begrenzt (64 Tool-/Provider-Runden, 15 Min.).
Capabilitykontrollen: fehlende Controls werfen `AgentRuntimeCapabilityUnavailableError`
(`:208`); Testbeleg `runtime-routed-session.test.mjs` „generic routed controls reject
unadvertised adapter capabilities explicitly“.
Steuerung/Resume: `steer?` nur bei `capabilities.input.steering` + aktivem Streaming, sonst
`PiboSteeringUnavailableError` (`:382`); fork/clone/tree/compact nur als capability-gebundene
`controls`; `resolveBinding?` darf nur `missing` autoritativ melden, alles andere muss werfen
(`types.ts:231`); fehlende native Daten → `AgentRuntimeBindingMissingError`.
Dispose/Cleanup: `dispose()` idempotent erwartet (Test „fake adapter covers abort, failure,
missing binding, and idempotent cleanup“); verspätete Events nach Dispose sind Adapterpflicht
(kein Überschreiben abgeschlossener Ergebnisse — Lücke: nicht zentral im Vertragstext, siehe B1-20).

### K02 – Tools und Ressourcen

| ID | Export (CURRENT) | Ort | Owner | Heutige Aufrufer |
|---|---|---|---|---|
| B1-08 | `PiboToolDefinition`, `definePiboTool`, `PiboToolResult`, `PiboToolExecutionContext` | `src/tools/contract.ts:88,121,28,69` | B | alle packaged Tool-Provider, `compilePiboToolForPi`, MCP-Bridge |
| B1-09 | `PluginSessionToolProvider`, `PluginSessionToolProviderContext`, `PluginSessionToolSet` | `src/plugins/runtime.ts:196,145,187` | B (Vertrag), Plugin (Implementation) | `packaged-file-editing.ts`, `packaged-remote-agent.ts` (Module), Session-Tool-Auswahl |
| B1-10 | `PiboRuntimeResourceSession` (Kontext/Skills/MCP-Pfad/Env/Inspektion/`dispose`) | `src/agent-runtime/resources.ts:117` | B | Adapter-`openSession` via `AgentRuntimeOpenServices.resources` |
| B1-11 | `PiboRuntimeResourceService` (Generations-Verzeichnisse, Scoped-MCP, Cleanup) | `src/agent-runtime/resource-service.ts:932` | B | Router/Lifecycle; Test `agent-runtime-resource-service.test.mjs` |
| B1-12 | Tool-Credential-Registry + Session-Tool-MCP-Bridge (Hash, Scope, Loopback) | `src/tools/credential-registry.ts`, `src/tools/mcp-bridge.ts` | B | externe Harnesses; Tests `pibo-tool-mcp-bridge.test.mjs` |
| B1-13 | `PluginYieldedRunControl`, `PluginChildSessionOrchestration` | `src/plugins/runtime.ts:39,98` | B (Core-Scheduling/Delegation) | Run-Control-/Delegations-Tools |

Wesentliche Invarianten `[Quelle]`: `PiboToolExecutionContext.cwd` ist Pflicht, `nativeContext`
ist adapter-privat und für portable Tools verboten (`contract.ts:77`); `portable:false` schließt
MCP-Delivery aus (`normalizePiboToolDefinition`, `:189` — Legacy-Pi-Form wird `portable:false`);
Provider-Kontext ist generation-gepinnt und unveränderlich (`runtime.ts:145`); Tool-Namen müssen
dem Manifest entsprechen (`host.ts:214`); MCP-Bridge bindet nur Loopback, Allowlist exakt,
Bearer nur als Hash (Spec RUN-RES-004/005).
Direkt vs. yieldbar: `yieldedRunId` nur innerhalb `pibo_run_start` gesetzt (`contract.ts:75`);
keine Vermischung im Vertragstext — Lücke B1-21 (nur implizit).

### K03 – Begrenzter Credential-Zugriff

| ID | Export (CURRENT) | Ort | Owner | Heutige Aufrufer |
|---|---|---|---|---|
| B1-14 | `AgentRuntimeAuthStatus/Catalog/Target`, `Start/Complete/Cancel/Logout…Input`, `AgentRuntimeAuthOperationResult` | `src/agent-runtime/auth.ts:41,103,52` | B (produktsichere Typen, keine Secrets) | Adapter (`getAuthStatus/startAuth/…` in `types.ts:220`), Router-Optionen (`routed-session.ts:172`), UI |
| B1-15 | `resolvePiProviderAuth`, `getPiProviderAuthStatus`, `PiboFileCredentialStore`, `deriveStoredOAuthAuthResult` | `src/agent-runtimes/pi/credentials.ts:162,175,54,151` | Pi-Adapter (Credential-Owner) | Transkription (`src/transcription/openai.ts:26`, `openai-chatgpt.ts:115`), `src/tools/codex-image-generation.ts:100`, `src/auth/openai-codex-usage.ts:190` |
| B1-16 | Transkriptions-Provider mit injizierbarem Zugang (`getApiKey?`, `isConfigured?`, `getAuth?`, `fetch?`) | `src/transcription/openai.ts:12`, `src/transcription/openai-chatgpt.ts:23` | C (Feature), B (Vertragsvorschlag) | `packaged-transcription-openai*.ts`, Chat-Speech-Web |

Vertragslage `[Quelle]`: Produktsichten enthalten keine Credentials (`auth.ts:40` „details
intentionally exclude account identifiers“); der *Default*-Zugang der Transkription ist dagegen
ein direkter Pi-Querimport (`transcription/openai.ts:1,26`) mit hartem Provider-String `"openai"`.
Injizierbarkeit existiert (Optionen), aber kein neutraler benannter K03-Export. Scope
(`runtime-instance` vs `adapter-shared`, `auth.ts:9`) wird bei Auth-Mutationen beachtet
(Test „adapter-shared auth mutations recycle every affected configured runtime session“).
Kein `getAllSecrets`; keine Secret-Werte in Logs/History (Redaktion `redactAgentRuntimeAuthText`).

### Plugin-Host (K04-/K07-Anschlüsse, B-Anteil)

| ID | Export (CURRENT) | Ort | Owner |
|---|---|---|---|
| B1-17 | `PluginHost` (start/add/remove/stop, `createSessionScope`, Aktivierungs-Planung, Rollback) | `src/plugins/host.ts:119` | B |
| B1-18 | `PluginSetupContext` (deklarationsgebundene `services`/`register*`, kein Host-Passthrough) | `src/plugins/host.ts:7` | B |
| B1-19 | `PiboChatExtensionService` (`registerApiRoute`, `registerMessageAugmenter` mit Payload-Key-Konfliktfehler) | `src/plugins/product-services.ts:41,72` | B (neutraler Anschluss), D (Web-Anwendung) |

`sdk.ts` (`src/plugins/sdk.ts:1`) ist bewusst schmal: Manifest/Contributions/Browser-Typen/Scope;
Backend-APIs leben in `host.js`. Kein Mega-Host-Objekt an Tools — Vorgabe bereits erfüllt.

## 3. Pi-Wertimporte und Paketgrenzen

- Echte Laufzeitabhängigkeiten aus neutralen Corepfaden `[Quelle]`:
  - `src/core/compaction-prompt.ts:6-17`: **Wertimporte** `completeSimple`,
    `buildSessionContext`, `convertToLlm`, `serializeConversation` (+ Typen) aus
    `@earendil-works/pi-ai[/compat]`, `@earendil-works/pi-coding-agent`.
  - `src/core/provider-recovery.ts:1`: **Wertimport** `isRetryableAssistantError` aus
    `@earendil-works/pi-ai` (reine Klassifikationslogik + generische Retry-Steuerung).
- Type-only (keine Laufzeitabhängigkeit) `[Quelle]`: `src/core/context-build.ts:3`,
  `context-guard.ts:7`, `thinking.ts:1`, `skill-expansion.ts:2`, `system-prompt-template.ts:1`,
  `provider-capacity.ts:1`, `provider-telemetry.ts:1`, `codex-compat.ts:1`,
  `src/plugins/types.ts:17-18`, `src/apps/chat/pi-trace-compat.ts:1`, `trace.ts:2`.
- Schwere Default-Verbraucher `[Quelle]`: `src/tools/hashline.ts:6` (Wertimport aus
  `pi-coding-agent`, via `packaged-file-editing.ts` Standardpfad); `src/remote-agent/modules/*`
  (`bash.ts:1`, `files.ts:7` bauen auf Pi-Tool-Definitionen); `src/providers/*` (ModelRegistry).
- Breite Re-exports `[Quelle]`: `src/index.ts` (408 Zeilen) re-exportiert u. a. Pi-Adapter-Driver,
  `compilePiboToolForPi`, Transkription und `OPENAI_API_CREDENTIAL_PROVIDER_ID` — Einfallstor für
  unbeabsichtigte Pi-Bytes in neutralen SDK-Importen; esbuild-Inputs ≠ ausgelieferte Bytes.
- Metafile `[historisch]`: nur `dist/pibo4-core-executable.metafile.json` vorhanden; Herkunft
  (Commit/Builder) unbekannt → nicht als Baseline verwendbar; `bytesInOutput`-Regel für B2/I2
  vormerken. **Keine neuen Builds ausgeführt** (Auftrag).
- `[Vorschlag]` Aufteilung: allgemeine Konfiguration (Retry-/Compaction-Einstellungen,
  reine Text-/Prompt-Spezifikation) bleibt neutral; Pi-spezifische Durchführung (Pi-SDK-Aufrufe,
  `ModelRuntime`, `SettingsManager`-Deutung) wandert zum Pi-Runtime-Owner. Details in
  `contracts.md` (B1-CFG-01) und `implementation-plan.md`.
- TUI-Dateibereich (`src/agent-runtimes/pi/runtime.ts`, A-Arbeitsbereich) nicht betreten —
  als gesperrt respektiert, keine Aussage über dessen Interna.

## 4. Kritischer Verbraucher: Transkription auf K03 (gewählt)

Warum Transkription statt File Editing/Remote Agent: einziger heutiger Verbraucher mit
echtem Credential-Seam (K03-relevant), bereits injizierbar, kleiner Durchstich.
- Heute `[Quelle]`: `createOpenAiTranscriptionProvider({getApiKey?, isConfigured?, fetch?})`
  defaultet auf `resolvePiProviderAuth("openai")` (`openai.ts:26-27`, API-Key-Verbraucher:
  `getApiKey: () => Promise<string|undefined>`); ChatGPT-Variante auf OAuth-Pfad
  (`openai-chatgpt.ts:112-120`: `readPiCredential("openai-codex")`-Typprüfung +
  `resolvePiProviderAuth`, OAuth-Verbraucher: `getAuth: () => Promise<{accessToken,
  accountId?}|undefined>`, `openai-chatgpt.ts:23`). Semantik: `resolvePiProviderAuth` liefert
  `AuthResult|undefined` (`credentials.ts:162`; `undefined` = nicht konfiguriert, mit
  direkter Gültig-Token-Ableitung `deriveStoredOAuthAuthResult :151`), wirft bei echten
  Fehlern; `getPiProviderAuthStatus` meldet `{configured, source?, label?}` (`:175`).
  Transkriptions-Fehlerformen: `PiboTranscriptionError` mit
  `invalid_audio | not_configured | provider_error`; geworfene Auth-Ladefehler → `not_configured`
  (`openai-chatgpt.ts:46-54`), fehlender Key/Token → `not_configured`, HTTP-Fehler → `provider_error`.
- Abbildung `[Vorschlag]`, korrigiert (R-B1-01): KEINE neue globale API mit selbstgewähltem
  Scope-String (`providerId` + `scope:"transcription"` gewährt nichts — kein Aufrufer kann
  sich per String Zugriff wählen). Stattdessen bleibt der bereits vorhandene injizierte Seam
  (`getApiKey`/`getAuth`/`isConfigured`-Optionen) der Vertrag; der echte Owner (Pi-Adapter/
  Composition) bindet die Default-Zugangsfunktionen bereits mit der nachgewiesenen
  Autorität/Runtime-Zuordnung und injiziert sie. Erhalten bleiben: `runtime-instance`- vs.
  `adapter-shared`-Scope (`auth.ts:9`), beide Verbrauchertypen (API-Key UND OAuth/`getAuth`)
  und die `AuthResult`/`undefined`/Fehler-Semantik. Aus dem fehlenden neutralen Export wird
  keine neue verpflichtende globale Credential-Schicht abgeleitet (Details `contracts.md` §3.2, §7).
- File Editing (`hashline`) und Remote Agent (eigene OAuth/token-Welt,
  `remote-agent-auth.test.mjs`, Pi-Tool-Module) bleiben K02-Verbraucher ohne K03-Bedarf;
  ihre schweren statischen Pi-Imports sind B2-Entkopplung, kein K03-Thema.

## 5. Drei-Entwurfs-Vergleich (kritische Seam: K03 Provider-Zugang)

Kurzfassung, korrigiert (R-B1-01); vollständig in `contracts.md` §7. Seam: injizierbarer
Provider-Credential-Zugang für Transkription (True-external-Dependency nach DEEPENING.md).
- Entwurf A „kleinste owner-gebundene API“ (B-Sicht, empfohlen): der vorhandene injizierte
  Seam (`getApiKey`/`getAuth`/`isConfigured`) bleibt der Vertrag; der echte Owner bindet die
  Default-Zugangsfunktionen bereits mit nachgewiesener Autorität/Runtime-Zuordnung und
  injiziert sie. Kein selbstgewählter Scope-String, keine neue globale Schicht.
- Entwurf B „globale Convenience-API“ (verworfen): `resolveProviderApiKey({providerId,
  scope:"transcription"})` als globale Funktion — ein Aufrufer-gewählter String gewährt keine
  Autorität; Scope-/Runtime-Zuordnung unbelegt; würde eine neue verpflichtende globale
  Credential-Schicht einführen. (Der frühere B-Vorschlag „fertige `transcribe()`-Fähigkeit“
  ist darin als noch stärkere Seam-Verschmelzung mitverworfen.)
- Entwurf C „Workflow-/Erweiterungssicht“ (D-nahe Sicht, verworfen): kurzlebiges
  Capability-Objekt (`acquireProviderCapability(…)` → `{apiKey, dispose}`).
  Explizite Lebensdauer, aber größtes Interface und Dispose-Protokoll für einen Einmal-Key.
- `[Vorschlag]` Empfehlung: **Entwurf A**. Begründung: Depth (ganze Pi-Auth-Welt hinter den
  bestehenden Injektionspunkten verborgen), Locality (Refresh/Pfade/Tokens bleiben in
  `pi/credentials.ts`), Autorität (Bindung beim Owner, nicht beim Aufrufer), reale
  Austauschbarkeit (Produktions-Default + injizierter Testadapter). B/C als verworfene
  Alternativen dokumentiert. C/D verfassen eigene Sicht unabhängig; Abweichungen
  → Reviewfragen RQ-01… in `handoff.md`.

## 6. K07: Bild-/Dateipfad bis zur Modellzustellung (B-Anteil)

Verfolgte Pfade `[Quelle]`:
1. **Dateianhänge**: `Composer` (`composer-send.ts:117` `fileAttachmentPaths`) → Upload nach
   `$PIBO_HOME/uploads` (`chat-files.ts:47`, 0600, max. 10) → `prepareChatFileAttachments`
   (`:25`) rendert `<attached-uploaded-files>` mit **Name/Pfad/Bytes als Text** (`:248`) und
   hängt ihn an `messageText` an → `web-app.ts:4488` → `enqueueMessage` → Adapter-`prompt({text})`.
   **Dateien erreichen das Modell heute ausschließlich als Text-Pfadreferenz**, nicht als
   native Bytes/Blöcke. Vorschau/Limits/TOCTOU-Schutz: `responseChatImagePreview`,
   `readBoundedImageFile`, `assertOpenedImagePathAuthority` (`chat-files.ts:80,111`), Tests
   `chat-image-file-boundary.test.mjs`.
2. **Tool-Bilder**: `PiboToolImageContent {data?, payloadRef?}` (`tools/contract.ts:12`) →
   MCP-Bridge ersetzt fehlende Inline-Daten durch Textplatzhalter
   (`mcp-bridge.ts:225`), Pi-Compiler ebenso (`tool-compiler.ts:48`). PayloadRefs sind
   durable Referenzen, kein Ersatz für native Prompt-Bilder.
3. **Feststellung (R-B1-03)**: `AgentRuntimePromptInput` (`types.ts:256`) kennt nur `{text,
   source, capabilityScope}` — **kein Bild-/Ressourcen-Kanal**, obwohl Pi `input.images:true`
   deklariert (`pi/adapter.ts:119`). Die heutige Upload-Pfadreferenz (Text-Pfad, s. o.) ist die
   **bestätigte Baseline** und bleibt erhalten; vorhandene konsumierbare Medien-/Datei-
   referenzen werden nicht entfernt und sind pro Adapter zu prüfen. Ein nativer
   Prompt-Ressourcen-Kanal ist eine **OPTION mit eigener Scopeentscheidung** (K01-P1 in
   `contracts.md`), keine zwingende K07-Voraussetzung allein aus der
   Nicht-Degradationsforderung — neue Fähigkeiten werden Adaptern nicht nebenbei aufgezwungen.
   Sessionbindung: Uploads sind `$PIBO_HOME`-weit, nicht sessiongebunden — K07-Draftbindung
   ist D-Aufgabe; B fordert für Neues sessiongebundene, nicht erratbare Referenzen
   (Anforderungen in `contracts.md` §8).

## 7. Lücken und Risiken

| ID | Befund | Schwere |
|---|---|---|
| B1-20 | Keine zentrale Regel für verspätete Events nach Abort/Dispose im neutralen Vertrag (nur Adapterpraxis + `pi-late-tool-update.test.mjs`) | mittel |
| B1-21 | Direkt/yieldbar-Ausführung nur implizit getrennt (`yieldedRunId`-Präsenz); keine Vertragsinvariante | niedrig |
| B1-22 | `AgentRuntimePromptInput` ohne Bild-/Ressourcen-Kanal trotz `input.images`-Capability; heutige Text-Pfad-Referenz ist bestätigte Baseline (kein Defekt) — nativer Kanal nur als OPTION mit Scopeentscheidung | mittel (Option, R-B1-03) |
| B1-23 | Transkriptions-Defaults sind direkte Pi-Querimporte (`transcription/openai.ts:1`, `openai-chatgpt.ts:1`); injizierter Seam existiert, aber Default-Bindung liegt nicht beim Owner — KEIN neuer globaler Export als Lösung (R-B1-01) | **hoch** (K03-Kernlücke: Owner-Bindung fehlt) |
| B1-24 | `src/core/compaction-prompt.ts` + `provider-recovery.ts` enthalten Pi-Wertimporte in neutralen Pfaden | **hoch** (B2-Kern) |
| B1-25 | `src/tools/hashline.ts` + `src/remote-agent/modules/*` statisch an Pi-Tools gekoppelt | mittel |
| B1-26 | `src/index.ts` breiter Re-export (Pi-Driver, Tool-Compiler, Credential-IDs) → unbeabsichtigte Mitlieferung | mittel |
| B1-27 | Upload-Referenzen `$PIBO_HOME`-weit statt sessiongebunden; Pfad-Strings im Modelltext | mittel (K07-Anforderung an D/C) |
| B1-28 | TUI-Datei (`pi/runtime.ts`) bis A1-Übergabe gesperrt → B2-Terminrisiko, kein Analyseblocker | niedrig |

## 8. Schnittstellen an A/C/D/I (eigene geprüfte Sicht)

- An C: K02-Nutzung File Editing/Remote Agent (registrierte Provider-Namen, `nativeContext`-Verbot),
  K03-Transkriptions-Signaturvorschlag, Web-Annotations-Anbieter nur über öffentlichen K07-Anschluss.
- An D: K01-Prompt-Ressourcenfrage (Bilder pro Prompt), K04-Session-Anschluss bleibt bei B-Typen,
  K05 kein B-Bedarf außer neutralen Typen; K07-Anforderungen/Testfälle in `contracts.md` §8.
- An A: Verhaltensschutz-Matrix für B2 (genannte Testdateien in `implementation-plan.md`).
- An I: Root-/Lock-/Builder-Änderungen, `src/index.ts`-Schnitt, Paketmuster K06, Metafile-Herkunft.
- Reviewfragen bei Schnittstellenunterschieden: RQ-01…RQ-05 in `handoff.md`. Nicht auf C/D
  gewartet; eigene Sicht ist geprüft und eigenständig lesbar.
- Ablauf (R-B1-06, in allen vier Dateien konsistent): Analyse-Review → **I0 erfüllen** →
  **A1/B1/C1/D1 tatsächlich in Worktrees implementieren und Piloten testen** → erst dann
  **G1** → danach B2/C2/D2. Diese Analyse führt NICHT direkt zu G1/B2.

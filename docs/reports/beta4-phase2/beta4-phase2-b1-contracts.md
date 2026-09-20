---
type: "Research"
title: "Beta 4.0 phase-2 B1 contract draft (archived research)"
description: "Worker B1 contract draft from the analysis-only round, archived as non-approved research with an OKF envelope."
tags: ["beta-4", "phase-2", "b1", "contracts"]
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
  origin_path: ".pibo/planning/beta4-phase2-20260920/results/B1/contracts.md"
  origin_sha256: "d0332d56567d08f5307f91513f655e3f44d6dfc5189d923c931544c4b9f69380"
  origin_bytes: 20572
  archive: "docs/reports/artifacts/beta4-phase2/beta4-phase2-originals-20260920.zip"
  archive_path: "results/B1/contracts.md"
  transformations:
    - "Added this OKF frontmatter envelope; body bytes after frontmatter are unchanged from the origin."
---
# B1 – Vertragskandidaten K01–K03 (+ B-Anschlüsse K04/K07)

Stand: Analysevorbereitung, **kein freigegebenes v1** (G1 ausstehend). Markierung:
`CURRENT` = heute im HEAD vorhandener Export (mit Beleg); `PROPOSED` = Kandidat.
`SKIZZE` = illustratives, nicht ausgeführtes Beispiel (R-B1-04).
Bestehende öffentliche Namen bleiben erhalten. Keine `any`-Mega-Objekte, kein Host-Passthrough.
Ablauf (R-B1-06): Analyse-Review → I0 erfüllen → A1/B1/C1/D1 in Worktrees implementieren und
Piloten testen → erst dann G1 → danach B2/C2/D2.

## 1. K01 – Runtime und Session (Owner B)

Zweck: Einen Auftrag an eine passende Runtime geben, ohne deren nativen Ablauf zu kennen.
Nicht-Ziele: keine Harness-SDK-Typen im neutralen Export; keine stillen Änderungen an
Session-IDs, Protokollen oder gespeicherten Bindings.

### 1.1 CURRENT-Vertrag (belegt)

```typescript
// CURRENT – src/agent-runtime/types.ts:208 (AgentRuntimeAdapter)
interface AgentRuntimeAdapter {
  readonly instanceId: AgentRuntimeInstanceId;
  readonly descriptor: AgentRuntimeAdapterDescriptor; // id, displayName, transport, configSchema, capabilities
  readonly config: PiboJsonObject;
  readonly displayName: string;
  readonly enabled: boolean;
  diagnose(): Promise<readonly AgentRuntimeDiagnostic[]>;
  validateProfile(input: ValidateAgentRuntimeProfileInput): readonly AgentRuntimeDiagnostic[] | Promise<...>;
  openSession(input: OpenAgentRuntimeSessionInput): Promise<AgentRuntimeSession>;
  inspectProfile?(...): Promise<AgentRuntimeAssemblyInspection>;
  listModels?(): Promise<AgentRuntimeModelCatalog>;
  getAuthStatus?/startAuth?/completeAuth?/cancelAuth?/logoutAuth?/disposeAuth?(...);
  inspectHistory?/readHistory?/isHistoryReconciliationProof?/readForkCandidates?/resolveBinding?(...);
}

// CURRENT – src/agent-runtime/types.ts:403 (AgentRuntimeSession)
interface AgentRuntimeSession {
  readonly adapterId: AgentRuntimeAdapterId;
  readonly runtimeInstanceId: AgentRuntimeInstanceId;
  readonly cwd: string;
  readonly capabilities: AgentRuntimeSessionCapabilities;
  readonly controls?: AgentRuntimeControls; // nur capability-gedeckt, vgl. contract.ts:36-59
  getBinding(): RuntimeSessionBinding;
  subscribe(listener: AgentRuntimeEventListener): () => void;
  prompt(input: AgentRuntimePromptInput): Promise<void>; // types.ts:256 {text, source, capabilityScope?}
  steer?(input: AgentRuntimePromptInput): Promise<void>;
  abort(): Promise<void>;
  dispose(): Promise<void>;
  getStatus(): AgentRuntimeStatus;
}

// CURRENT – src/agent-runtime/routed-session.ts:290 (RuntimeRoutedSession, Core-Orchestrierung)
enqueueMessage(event, onAccepted?): PiboOutputEvent; // wirft RuntimeQueueCapacityError
steerMessage(event): Promise<PiboOutputEvent>;        // wirft PiboSteeringUnavailableError
// + abort/dispose/getStatus/fork/clone/tree/model/reasoning/auth-Weiterleitungen (capability-geprüft)
```

Semantische Ereignisse: `AgentRuntimeSemanticEvent` (`src/agent-runtime/events.ts:53`), 28
Varianten inkl. `turn_started/completed/failed`, Deltas, Tool-Lifecycle, `usage`,
`compaction_start/end`, Approvals/User-Input, `warning/error`, `native_event`.
Fehler: `AgentRuntimeContractError`, `AgentRuntimeCapabilityUnavailableError`,
`AgentRuntimeBindingMissingError` (`src/agent-runtime/errors.ts`), `RuntimeQueueCapacityError`
(`routed-session.ts:70`, Dimensionen `message_bytes|queue_count|queue_bytes|oldest_wait_age`).

### 1.2 PROPOSED-Veränderungen (klein, begründet)

1. **K01-P1 (PROPOSED, OPTION mit eigener Scopeentscheidung — R-B1-03).**
   Optionaler Prompt-Ressourcen-Kanal: `AgentRuntimePromptInput` erhielte optional
   `attachments?: readonly PromptResourceRef[]` mit neutraler Referenz (ID + Typ + Hash,
   keine Pfade/URLs vom Plugin wählbar). Feststellung: heute existiert kein
   Bild-/Ressourcen-Kanal (`types.ts:256` nur Text), obwohl `input.images:true` deklariert
   wird; Dateien laufen als Text-Pfad (Beleg `analysis.md` §6). Diese heutige
   Upload-Pfadreferenz ist die **bestätigte Baseline** und bleibt erhalten; vorhandene
   konsumierbare Medien-/Dateireferenzen werden pro Adapter geprüft, nicht ersetzt.
   Der native Kanal ist daher KEINE zwingende K07-Voraussetzung allein aus der
   Nicht-Degradationsforderung; seine Aufnahme braucht eine eigene Scopeentscheidung
   (Reviewfrage RQ-02 an D). Falls aufgenommen: Adapter ohne Fähigkeit melden
   `unsupported` im Delivery-Report statt still zu degradieren; keine neue Fähigkeit
   wird Adaptern nebenbei aufgezwungen.
2. **K01-P2 (PROPOSED): Spät-Event-Invariante festschreiben.** Nach `abort()`/`dispose()`
   dürfen keine neuen terminalen Ergebnisse oder Ergebnis-Überschreibungen mehr emittiert
   werden; verspätete Deltas werden verworfen. Heute nur Adapterpraxis (Lücke B1-20).
3. **K01-P3 (PROPOSED): Terminal-Invariante.** Höchstens ein terminales Ergebnis pro
   angenommenem Turn (`turn_completed` xor `turn_failed` nach `turn_started`).

Unverändert: IDs/Bindings/Revisions-/CompareAndSet-Semantik, Capability-Gating,
Queue-Limits, Preflight/Capacity/Fallback-Zuständigkeit beim Router.

### 1.3 Aufruf-SKIZZE (illustrativ, NICHT ausgeführt — R-B1-04)

```typescript
// SKIZZE: zeigt nur die CURRENT-Aufrufform; Variablen sind Platzhalter,
// Pflichtfeld-Vollständigkeit und Ausführbarkeit sind NICHT geprüft.
const session: AgentRuntimeSession = await adapter.openSession({
  piboSession, profile, workspace, productContext, services: { resources },
});
assertAgentRuntimeSessionContract(session, adapter.instanceId); // CURRENT contract.ts:97
const off = session.subscribe((e) => { if (e.type === "turn_failed") fail(e.message); });
await session.prompt({ text: "…", source: "interactive" }); // Router wartet auf diese
// Promise (routed-session.ts:1099) und emittiert bei Erfolg message_finished (:1205),
// sofern kein turn_failed/error die Nachricht als fehlgeschlagen markiert hat.
await session.abort(); off(); await session.dispose();
```

### 1.4 Lifecycle-/Fehler-/Scope-Tabelle K01

| Aspekt | Regel |
|---|---|
| Annahme | `enqueueMessage` validiert + `onAccepted()` + `message_queued`; Router-Queue-Eintritt, noch keine Harness-Übergabe |
| Abschluss (R-B1-02) | Router wartet auf `prompt()`-Promise (`:1099`); bei Erfolg `message_finished` (`:1205`), außer `turn_failed`/`error` markierte `activeMessageFailed` → dann `session_error` statt `message_finished`; Fallbacks via `pendingProviderFailure`-Retry; P3 pinnt zusätzlich höchstens ein terminales Event |
| Reihenfolge | Queue FIFO; Identitäts-Ops blockieren Annahme; `steer` nur im Streaming |
| Abbruch | `abort()` bricht aktiven Turn ab; Kapazitäts-Waits abbrechen ohne Slot-Eintritt (Testbeleg) |
| Dispose | idempotent; Generation-Ressourcen via `PiboRuntimeResourceSession.dispose()`; keine Credentials zurücklassen |
| Fehler | Capability → `AgentRuntimeCapabilityUnavailableError`; nativ fehlend → `AgentRuntimeBindingMissingError`; Queue → `RuntimeQueueCapacityError` |
| Scope | `piboSessionId` (Produktroute), `generation` (live), `nativeSessionId` (nur Harness-Resume) |
| Nebenläufigkeit | ein aktiver Turn pro Routed Session; parallele Adapter-Instanzen isoliert |
| Imports | neutral: kein `@earendil-works/pi-*`-Wertimport (B2-Regel; Ausnahmen heute: B1-24) |

## 2. K02 – Tools und Ressourcen (Owner B)

Zweck: Ein ausgewähltes Tool benutzen, ohne Auswahlregeln oder Ressourcenverwaltung
nachzubauen. Nicht-Ziele: keine neue Toolwelt, keine umbenannten Tools, kein Toolkit-Sammelobjekt.

### 2.1 CURRENT-Vertrag (belegt)

```typescript
// CURRENT – src/tools/contract.ts:88,56,69
interface PiboToolDefinition<TInputSchema = PiboToolInputSchema, TDetails = unknown> {
  name: string; title: string; description: string;
  inputSchema: TInputSchema; outputSchema?: TInputSchema;
  executionMode?: "sequential" | "parallel";
  annotations?: PiboToolAnnotations; portable?: boolean; // default true; false = nicht MCP-fähig
  prepareInput?: (input: unknown) => Static<TInputSchema>;
  execute(toolCallId, input, signal, onUpdate, context: PiboToolExecutionContext): Promise<PiboToolResult<TDetails>>;
}
type PiboToolExecutionContext = { cwd: string; /* Pflicht */ runtimeInstanceId?; adapterId?;
  sessionGeneration?; yieldedRunId?; nativeContext?: unknown /* adapter-privat, portable verboten */ }
  & Omit<PiboToolDefinitionContext, "cwd">;

// CURRENT – src/plugins/runtime.ts:196,145,187
type PluginSessionToolProvider = { phase?: "base"|"augment"; includeNativeTools?;
  serviceMessages?; createSession(context: PluginSessionToolProviderContext): PluginSessionToolSet; };
// ProviderContext: generation-gepinnt, unveränderlich, selectedTools exakt validiert.
// ToolSet: { tools: [{contributionId, definition}], serviceMessages?, dispose?() }

// CURRENT – src/agent-runtime/resources.ts:117
interface PiboRuntimeResourceSession { /* getContextContributions/getSkillPaths/getMcpConfigPath/
  getAdapterEnvironment (niemals loggen)/getExternalMcpServerConfigs/getInspection/dispose */ }
```

### 2.2 PROPOSED-Veränderungen

1. **K02-P1 (PROPOSED): Yield-Invariante.** Direkt-Ausführung und yieldbare Ausführung
   bleiben getrennt: `yieldedRunId` ausschließlich innerhalb `pibo_run_start`-Kontext;
   ein später Callback darf kein verbrauchtes Ergebnis überschreiben (schließt B1-21).
2. **K02-P2 (PROPOSED): Kontext-Minimalität festschreiben.** `PiboToolExecutionContext`
   ist die einzige Ausführungsumgebung; kein PluginHost-/Service-Passthrough an Tools
   (heute bereits Praxis via `PluginSetupContext`, `host.ts:7` — als Invariante
   festschreiben, damit C-Piloten keine Abkürzung einführen).
3. **K02-P3 (Vorschlag an C/B2, kein Vertragsbruch):** `hashline` (File Editing) und
   `remote-agent/modules` von statischen Pi-Tool-Wertimporten lösen; Verhalten
   (Trunkierung/Pagination, Fehler) bleibt im K02-Test gesichert.

### 2.3 Aufruf-SKIZZE (illustrativ, NICHT ausgeführt — R-B1-04)

```typescript
// SKIZZE nach CURRENT-Form (vgl. packaged-file-editing.ts:8); Platzhalter,
// keine geprüfte Pflichtfeld-Vollständigkeit, keine Ausführbarkeit behauptet.
// Plugin-Seite
context.register("session-tools", definePluginSessionToolProvider({
  createSession(ctx) {
    return { tools: registrationsForSelectedTools(ctx, [myDefinition]) };
  },
}));
// Tool-Seite
await definition.execute(callId, input, signal, onUpdate,
  { cwd, piboSessionId, runtimeInstanceId, adapterId, sessionGeneration });
```

Fehler/Lifecycle/Scope: `PiboToolResult {content[], structuredContent?, isError?, payloadRefs?,
metadata?}`; terminaler Timeout via `metadata.piboTerminalStatus/progress`-Helper
(`contract.ts:37`); Fortschritt über `onUpdate`; Abbruch über `AbortSignal`;
Scope = Workspace+Session+Generation; Owner für Cleanup = Provider-`dispose` +
`PiboRuntimeResourceService`; Limits: CHAT-/MCP-/Queue-Limits bleiben beim jeweiligen Owner,
keine neuen globalen Tool-Limits in K02.

## 3. K03 – Begrenzter Credential-Zugriff (Owner B)

Zweck: Ein Feature erhält genau den zulässigen Zugang für seinen Provider.
Nicht-Ziele: kein `getAllSecrets`, keine Kopie nativer Logins, keine universelle Auth-Schicht.

### 3.1 CURRENT-Vertrag (belegt, ungewöhnlich verteilt)

- Produktsichere Auth-Typen ohne Secrets: `AgentRuntimeAuthStatus/Catalog/Target`,
  `Start/Complete/Cancel/Logout…Input`, `AgentRuntimeAuthOperationResult`
  (`src/agent-runtime/auth.ts:41,103,52,71`); Adapter-Ops in `types.ts:220`.
- Pi-Credential-Owner: `resolvePiProviderAuth(providerId): Promise<AuthResult|undefined>`,
  `getPiProviderAuthStatus(providerId)`, `PiboFileCredentialStore`
  (`src/agent-runtimes/pi/credentials.ts:162,175,54`).
- Injizierbare Verbraucher-Defaults: `createOpenAiTranscriptionProvider({getApiKey?,
  isConfigured?, fetch?})` (`src/transcription/openai.ts:12,26`) und
  `createOpenAiChatGptTranscriptionProvider({getAuth?…})` (`openai-chatgpt.ts:23`).
- **Lücke B1-23**: kein neutraler benannter K03-Export; Default ist Pi-Querimport.

### 3.2 PROPOSED-Vertrag (Entwurf A, empfohlen — R-B1-01)

**Kein neuer globaler Export.** Der bereits vorhandene injizierte Seam ist der Vertrag;
der echte Owner (Pi-Adapter/Composition) bindet die Default-Zugangsfunktionen mit der
nachgewiesenen Autorität/Runtime-Zuordnung und injiziert sie. Ein selbstgewählter
Scope-String (`providerId` + `scope:"transcription"`) gewährt keinen Zugriff — die
globale API `resolveProviderApiKey({providerId, scope})` aus der Erstfassung ist damit
als unzureichend **verworfen** (siehe §7 Entwurf B).

```typescript
// PROPOSED – Vertrag = injizierte Zugangsfunktionen (Form bereits CURRENT in
// src/transcription/openai.ts:12 und openai-chatgpt.ts:20); neu ist nur, WER die
// Defaults bindet: der Credential-Owner, nicht der Verbraucher per Querimport.
export type InjectedApiKeyAccess = {
  getApiKey: () => Promise<string | undefined>;       // API-Key-Verbraucher
  isConfigured: () => boolean | Promise<boolean>;
};
export type InjectedOAuthAccess = {
  getAuth: () => Promise<{ accessToken: string; accountId?: string } | undefined>; // OAuth-Verbraucher
  isConfigured: () => boolean | Promise<boolean>;
};
// SKIZZE der Owner-Bindung (Form illustrativ, nicht ausgeführt):
// function bindTranscriptionAuth(provider: "openai" | "openai-codex"): InjectedApiKeyAccess | InjectedOAuthAccess;
// → implementiert beim Pi-Credential-Owner (src/agent-runtimes/pi/*), injiziert über die
// bestehenden Options-Felder; Verbraucher-Defaults ohne Querimport.

// Verbraucher-Seite (PROPOSED-Umbau, verhaltensgleich):
createOpenAiTranscriptionProvider({ getApiKey: ownerBound.getApiKey, … })
```

Erhalten (unverändert): `runtime-instance`- vs. `adapter-shared`-Scope (`auth.ts:9`);
beide Verbrauchertypen (API-Key UND OAuth/`getAuth`); `AuthResult`/`undefined`-Semantik
(`undefined` = nicht konfiguriert; Wurf nur bei echten Fehlern, `credentials.ts:162-173`);
Transkriptions-Fehlerformen `invalid_audio | not_configured | provider_error`
(Fehlermapping wie heute: Ladefehler/fehlender Key → `not_configured`, HTTP-Fehler →
`provider_error`); Speicherpfade/Tokens/Refresh beim Pi-Adapter; keine Secret-Werte in
Logs/Übergaben/Historie; kein Fallback auf fremde Accounts/Runtimes. Aus dem fehlenden
neutralen Export wird keine neue verpflichtende globale Credential-Schicht abgeleitet.

## 4. B-Anschlüsse K04 (Workflow/Session, Owner D)

- B stellt: `AgentRuntimeSession`, `RuntimeRoutedSession`, `PiboMessagePreflight`,
  `PluginChildSessionOrchestration`, `PluginYieldedRunControl` (alle CURRENT, s. o.).
  D besitzt fachliche Workflow-Operationen/Routen; keine zweite Sessionwelt.
- PROPOSED: keine neue B-Fläche für K04; einzige offene Frage ist die K01-P1-OPTION
  (Prompt-Ressourcen-Kanal mit eigener Scopeentscheidung), die Workflow-Anhänge mitbetrifft (RQ-02).

## 5. B-Anschlüsse K07 (Owner D; B: neutrale Exporte/Registrierung/Ressourcen/Runtime)

- B stellt (CURRENT): `PluginSetupContext.register*` + Manifest-Validierung (`host.ts`),
  `PiboChatExtensionService.prepareMessage` (Augmentierung Text+Payload, Key-Konfliktfehler),
  `PiboToolImageContent {data?, payloadRef?}` (`tools/contract.ts:12`),
  `PiboRuntimeResourceSession` (Generations-Scope, `dispose`), Adapter-`capabilities.input.images`.
- B-PROPOSED für K07 (R-B1-03): heutige Upload-Pfadreferenz als bestätigte Baseline
  erhalten; K01-P1 nur als OPTION mit Scopeentscheidung; für Neues Referenzregeln:
  sessiongebundene, nicht erratbare Ressourcen-IDs; keine Plugin-gewählten Pfade/URLs/Rollen;
  serverseitige Re-Validierung (JSON/Schema/Größe/Referenz) bei Nachrichtenannahme.
- D besitzt: JSON-/Draft-/Grid-/Copy-/Sendesemantik, Composer, State, Annahmepfad.
  Kein zweiter Attachmentkern in B-Dateien.

## 6. Konfiguration, Limits, erlaubte Imports (K01–K03)

| Bereich | Regel |
|---|---|
| K01 | Profile/Modelle via `InitialSessionContext` + Adapter-`configSchema`; Queue-Limits s. §1.4; Retry nur via Router-Fallbacks, kein Caller-Retry |
| K02 | Plugin-/Contribution-Konfiguration unveränderlich im Provider-Kontext; Tool-Limits beim Tool-Owner; MCP-Credentials gehasht/scopegebunden |
| K03 | Kein Scope-String vergibt Zugriff; Autorität nur via Owner-Bindung; keine Konfigurationswerte mit Secrets in neutralen Dateien |
| Imports (B2-Regel, PROPOSED) | neutrale Module: kein `@earendil-works/pi-*`-Wertimport; Type-only ok; heutige Ausnahmen B1-24 zur Beseitigung vorgemerkt |
| Re-exports | `src/index.ts`-Schnitt ist Auftrag an I (K06); keine neuen breiten Re-exports aus B-Dateien |

## 7. Drei Entwürfe für die K03-Seam + Entscheidung

Seam: Provider-Credential-Zugang für Transkription. Dependency-Kategorie: True external
(PROVIDER) + Adapter-private lokale Speicherung (Pi-`auth.json`). Zwei-Adapter-Regel erfüllt:
Produktionsadapter (Pi-Credential-Store, Owner-gebunden) + injizierter Testadapter (Optionen).
Korrigiert (R-B1-01): Gegenüberstellung owner-gebundene injizierte Zugangsfunktion (A) vs.
globale API mit Scope-String (B).

**Entwurf A – kleinste owner-gebundene API (B-Sicht, empfohlen).**
```typescript
// SKIZZE (Form illustrativ, nicht ausgeführt). Vertrag = bestehende Injektionspunkte:
// getApiKey/getAuth/isConfigured (CURRENT openai.ts:12, openai-chatgpt.ts:20).
// Neu: Owner bindet die Defaults mit nachgewiesener Autorität/Runtime-Zuordnung.
bindTranscriptionAuth(provider): InjectedApiKeyAccess | InjectedOAuthAccess; // beim Owner
```
Versteckt: Speicherpfade, OAuth-Refresh, `ModelRuntime`, Fallback-Regeln, Runtime-Zuordnung.
Erhalten: `runtime-instance`/`adapter-shared` (`auth.ts:9`), API-Key- UND OAuth-Verbraucher,
`AuthResult`/`undefined`/Fehler-Semantik (`credentials.ts:151-173`). Depth hoch (ganze
Auth-Welt hinter bestehenden Injektionspunkten), Locality beim Pi-Owner, Autorität beim
Owner statt beim Aufrufer, Austauschbarkeit via Injektion. Test: Owner-gebundene
Produktionsverdrahtung mit kontrollierten Credentials + injizierter Testadapter; keine
echten User-Tokens im Bericht.

**Entwurf B – globale Convenience-API (verworfen — R-B1-01).**
```typescript
// VERWORFEN: resolveProviderApiKey({ providerId, scope: "transcription" }): Promise<string>;
```
Ein Aufrufer-gewählter Scope-String gewährt keine Autorität; die Runtime-Zuordnung ist
unbelegt; würde eine neue verpflichtende globale Credential-Schicht einführen. (Die noch
bequemere Variante „fertige `transcribe()`-Fähigkeit inkl. Auth“ ist als stärkere
Seam-Verschmelzung mitverworfen: `isConfigured`-Vorabfrage, Fehlerunterscheidung und
alternative Verbraucher wie `codex-image-generation.ts:100` müssten dupliziert werden;
True-external nicht mehr am Seam ersetzbar.)

**Entwurf C – Workflow-/Erweiterungssicht (D-nahe Sicht, verworfen).**
```typescript
// VERWORFEN: acquireProviderCapability({ providerId, scope, signal }): Promise<{ apiKey, dispose(): void }>;
```
Explizite Lebensdauer (Dispose-Protokoll), gut für langlaufende Workflows; aber: größtes
Interface für einen Einmal-Key; Dispose-Semantik (Key-Ungültigkeit vs. No-op) neu zu
definieren; kein heutiger Verbraucher braucht Halte-Dauer. Over-Engineering am falschen Seam.

**Entscheidung:** Entwurf A. Kein Hybrid (gegen V3-Auweisung „nicht automatisch kombinieren“).
C/D-Sichten bleiben unabhängig; Abweichungen → RQ-01.

## 8. Konkrete Anforderungen und Testfälle an D/C (K07, B-Sicht)

An D (Core-Attachment-Semantik):
- B-K07-01 (R-B1-03): Heutige Text-Pfad-Anhänge (`chat-files.ts:248`) als bestätigte
  Baseline erhalten und pro Adapter prüfen; K01-P1 (nativer Kanal) nur als OPTION mit
  Scopeentscheidung weiterverfolgen — kein Ersatz-Zwang, keine nebenbei erzwungenen
  Adapter-Fähigkeiten (AT-15 im Rahmen der Baseline nachweisen, nativ nur falls optiert).
- B-K07-02: Ressourcenreferenzen sessiongebunden + nicht erratbar; serverseitige Re-Prüfung
  (Typ/Größe/Referenz/Session) bei Annahme; keine Rollen-/Rechte-Ableitung aus Plugin-Payload.
- B-K07-03: Testfälle: Bildprompt nativ vs. Fallback (Adapter mit/ohne `input.images`),
  Annahmesemantik `clientTxnId`/Receipt idempotent, Reload/Draft-Persistenz, Copy-Scope.
An C (Web Annotations + Verbraucher):
- B-K07-04: Anbieter ausschließlich über öffentlichen K07-Anschluss; Snapshot beim Anhängen;
  keine private Composer-/Store-Verdrahtung; Payload-JSON ohne Systemrollen.
- B-K07-05 (R-B1-01): Transkription auf owner-gebundene K03-Defaults umstellen, sobald die
  Owner-Bindung existiert (Default-Querimporte `transcription/openai.ts:1`,
  `openai-chatgpt.ts:1` entfernen); kein neuer globaler Export als Ersatz.

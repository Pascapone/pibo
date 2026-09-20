---
type: "Research"
title: "Beta 4.0 phase-2 D1 analysis (archived research)"
description: "Worker D1 analysis from the analysis-only round, archived as non-approved research with an OKF envelope."
tags: ["beta-4", "phase-2", "d1", "analysis"]
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
  origin_path: ".pibo/planning/beta4-phase2-20260920/results/D1/analysis.md"
  origin_sha256: "28d4a8f9633a762283fae777f9393e6bdc882378fa229b70cfe6d4d646b6fd87"
  origin_bytes: 27753
  archive: "docs/reports/artifacts/beta4-phase2/beta4-phase2-originals-20260920.zip"
  archive_path: "results/D1/analysis.md"
  transformations:
    - "Added this OKF frontmatter envelope; body bytes after frontmatter are unchanged from the origin."
---
# D1 – Analyse: Web, Workflows, Core-Attachments (nur Lesen)

## 0. Baseline und Methode

- Branch (Start/Ende geprüft): `beta/4.0-plugin-system`
- HEAD: `ece5f18cffe3f96f8f5dd8c241aac1d439c67b9a` (entspricht Dispatch-HEAD, unverändert)
- Initialrunde: Start 2026-09-20T14:48:52Z, Zwischenprüfung 14:58:04Z, danach B1/C1-Abgleich;
  Korrekturrunde (R-D1-01–R-D1-06): Start 2026-09-20T15:01:51Z, Ende s. Handoff-Zeile.
  Workspace: `/mnt/c/Users/pasca/Coding/pibo`.
- `git status --short` (alle Prüfungen identisch): `M docs/log.md`,
  `M docs/project/okf-migration-ledger.json`, `M docs/reports/index.md`,
  `?? docs/reports/beta-4-0-core-plugin-bloat-audit-2026-09-20*.md`
  (fremde/parallele Änderungen, nicht bearbeitet, nicht als eigene Evidenz verwendet).
- Methode: ausschließlich gelesen. Tatsächlich ausgeführt (alle read-only): `git branch/
  rev-parse/status`, `date -u`, `ls/find/grep` zur Testinventur, ripgrep-Suchen,
  Datei-Lektüre. Keine Builds, Testläufe, Installs, Produktänderungen,
  keine Provider-/Gateway-Aufrufe. V3-Hash nicht selbst nachgerechnet;
  `source-verification.json` (`verified`) übernommen. Alle Pfade relativ zum Repo-Root.
- Pflichtlektüre gelesen: `BASE/README.md`, `BASE/inputs/source-verification.json`
  (status `verified`), vollständiges `BASE/inputs/pibo-beta4-arbeitsplan-v3.md`
  inkl. Kap. 12 und AT-01–AT-22, `BASE/inputs/codebase-design/{SKILL,DEEPENING,DESIGN-IT-TWICE}.md`,
  `AGENTS.md`, `GLOSSARY.md`, `DESIGN.md`, relevante Specs unter `docs/specs/web/`.
- Status dieser Datei: **gegenwärtiges Verhalten** = am HEAD gelesener Code;
  **historisch** = Spec-/Test-Aussagen mit älterer Baseline, ausdrücklich markiert;
  **Vorschlag** = nur in `contracts.md` / `implementation-plan.md`.

## 1. Befund-IDs (Übersicht)

| ID | Gegenstand | Kurzbefund |
|---|---|---|
| D1-01 | Workflow-Routen/Owner (Backend) | Core-Implementierung in `src/apps/chat/`; Plugin nur Stub |
| D1-02 | Workflow-Persistenz | Draft/Published/Asset/Archive/Tombstone/Lifecycle + `pibo-workflows.sqlite` |
| D1-03 | Workflow↔Session-Link | Link-Modell, kein zweiter Sessiontyp |
| D1-04 | `packaged-workflows` | View-only-Stub, keine Logik |
| D1-05 | Feste Core-Ansichten | 3 Workspace-Areas + 2 Session-Tools = 5 (R-D1-01 korrigiert) |
| D1-06 | Plugin-Browservertrag | `PluginViewProps`/`PluginBrowserSetup`, Host-Services |
| D1-07 | Prism-Duplikat | Zwei identische `prism-client.ts`, je echte Verbraucher |
| D1-08 | Composer-Sendepfad | `ComposerSendPlan` + `clientTxnId`, kein K07-Grid |
| D1-09 | Upload-Anhänge | In-Memory pro Session, Limit 10, nicht reloadfest |
| D1-10 | Annotations-Auswahl | Globaler Key, nicht sessiongebunden, Limit 5 |
| D1-11 | Server-Annahmepfad | Normalizer → Augmenter → Dateien → durable Admission/Receipt |
| D1-12 | Annotations-Store | SQLite, `getAnnotationById` sessionsübergreifend lesbar |
| D1-13 | Medien/Limits | Uploads unter `PIBO_HOME/uploads`, Bildgrenzen 10/15 MiB, 20 Bilder |
| D1-14 | Draft-/State-Persistenz | Text-Draft pro Session (localStorage), pending-Txn (sessionStorage) |
| D1-15 | Risiken/Lücken für K07 | Snapshot fehlt, kein Copy-Puffer, kein Grid, keine Revisionen |

## 2. Untersuchung 1: Web und Workflows

### D1-01 — Workflow-Wege und heutige Owner (gegenwärtig)

Backend-Owner ist der Core in `src/apps/chat/`; UI-Owner ist `src/apps/chat-ui/src/`.
Routen-Parser (gegenwärtig):

- `src/apps/chat/chat-api-routes.ts:6-9` — Typen `WorkflowDraftActionResource`,
  `WorkflowDraftManualTriggerRunResource`, `WorkflowVersionResource`, `SessionWorkflowResource`.
- `src/apps/chat/chat-api-routes.ts:55-182` — `workflowPickerKind`, `workflowPromptAssetResourceId`,
  `workflowDraftResourceId`, `workflowDraftActionResource`, `workflowDraftManualTriggerRunResource`,
  `workflowDuplicateResourceId`, `workflowNextDraftResourceId`, `workflowArchiveResourceId`,
  `workflowVersionResource`, `workflowCatalogResourceId`.
- `src/apps/chat/chat-api-routes.ts:198` — `sessionWorkflowResource` (`:id/workflow`, `start`, `human-actions`).
- Verdrahtung in `src/apps/chat/web-app.ts:183-186,265,315,473` (Imports, `workflowDraftStore`
  in `ChatWebAppState`), Ablauf Entwurf→Publish→Run in `web-app.ts:2185-2420`
  (Draft speichern, Duplizieren, Next-Version; genaue Handler im selben Modul).
- Fachmodule: `workflow-catalog.ts`, `workflow-persistence.ts`, `workflow-persistence-model.ts`,
  `workflow-sessions.ts`, `workflow-human-actions.ts`, `workflow-manual-trigger-runtime.ts`,
  `workflow-v2-security-validation.ts`, `workflow-json-schema-validation.ts`,
  `workflow-validation-helpers.ts`, `workflow-registered-ref-*`, `data/workflow-session-service.ts`,
  `data/workflow-session-model.ts`.

UI-Verbraucher (gegenwärtig):

- `src/apps/chat-ui/src/WorkflowsArea.tsx`, `MinimalWorkflowsArea.tsx`,
  `session-views/WorkflowXStateSessionView.tsx`, `desktop-workflow-version-panel.tsx`,
  `api-workflows.ts`, `workflows/*` (Graph/Canvas/Inspector/Picker).
- Session-Ansicht Workflow: `session-views/registry.tsx:23-28`.

Lebenslauf heute: Entwurf anlegen/validieren/publizieren (Draft-Store) → Version publizieren
(Published-Store) → Session-Link/Run (`workflow-sessions.ts`, `data/workflow-session-service.ts`)
→ Benutzeraktionen (`workflow-human-actions.ts`) → Abbruch/Cleanup über Session-/Run-Status.
Kein Hinweis auf zweite Sessionwelt: Link-Modell verbindet Run mit normaler Pibo Session
(vgl. Glossar „Workflow Definition / Workflow Run“).

Zugeordnete vorhandene Tests (gelesen, nicht ausgeführt): `test/workflow-session-service.test.mjs`,
`test/workflow-session-kind.test.mjs`, `test/workflow-session-header.test.mjs`,
`test/workflow-manual-trigger-recovery.test.mjs`, `test/workflow-v2-*.test.mjs` (u. a.
`security-boundary`, `lifecycle-checklist`, `run-inspection-human-actions`, `publish-gating-ui`),
`test/chat-ui-workflow-*.test.mjs`, `test/chat-ui-desktop-workflow-viewer.test.mjs`.

### D1-02 — Workflow-Persistenz (gegenwärtig)

- `src/apps/chat/workflow-persistence.ts:147` `ChatWorkflowDraftStore`,
  `:288` `ChatWorkflowPublishedVersionStore`, `:415` `ChatWorkflowPromptAssetStore`,
  `:569` `ChatWorkflowArchiveStore`, `:651` `ChatWorkflowTombstoneStore`,
  `:750` `ChatWorkflowLifecycleEventStore`.
- `src/apps/chat/data/workflow-session-service.ts:24` `ChatWorkflowSessionService`,
  `:29` Default `piboHomePath("pibo-workflows.sqlite")`.
- Keine neuen Tabellenformate in D1; D2 darf Formate/Routen nicht beiläufig ändern (Vertrag).

### D1-03 — Workflow↔Session (gegenwärtig)

- `src/apps/chat/workflow-sessions.ts:68` `normalizeWorkflowSessionConfiguration`,
  `:92` `createWorkflowSessionSnapshot`, `:146` `workflowVersionFromSnapshot`,
  `:158` `createWorkflowRunCurrent`.
- `src/sessions/workflow-session-kind.ts`, `src/apps/chat/data/workflow-session-model.ts`.
- `src/apps/chat/web-app.ts:1589-1613` Session+WorkflowLink-Erzeugung
  (`addWorkflowSession`).

### D1-04 — `packaged-workflows` ist View-only-Stub (gegenwärtig)

- `src/plugins/packaged-workflows.ts:3-5`: `setupWorkflows` registriert nur `context.register("view", {})`.
- Folgerung: K04-Logik liegt heute vollständig im Core; der „Umzug“ ist späterer D2-Stoff,
  in D1 nur Vertragskandidat. Keine parallele zweite Workflow-Implementierung gefunden.

### D1-05 — Feste Core-Ansichten, Tabs, Deep Links (gegenwärtig)

Gelesener Stand:

- Session-Views: `src/apps/chat-ui/src/session-views/types.ts:7`
  `chatSessionViewIds = ["terminal","workflow"]`, `:13` Default `"terminal"`;
  Registry `src/apps/chat-ui/src/session-views/registry.tsx:16-29` (aktiv: Terminal, Workflow;
  dormant: Trace als inaktives Plugin, `:7-14`).
- Core-Workspace: `src/apps/chat-ui/src/core-workspace-model.ts:14-18`
  `CORE_WORKSPACE_CATALOG` = agents („Agent Designer“)/context („Context“)/settings
  („Settings“); `:20-23` `CORE_SESSION_VIEW_CATALOG` = raw-events („Raw Events“)/
  session-inspector („Session Inspector“).
- Korrektur R-D1-01 (eigene Fehldeutung behoben, keine Produktfrage mehr): Die fünf
  festen Coreansichten sind 3 Workspace-Areas (Settings, Agent Designer, Kontext) +
  2 Session-Tools (Session Inspector, Raw Events) aus `core-workspace-model.ts`.
  Terminal/Workflow sind Session-Views (`session-views/registry.tsx`) und gehören
  nicht zu dieser Fünferzählung. R-01 ist damit aufgelöst.
- Tabs/Identität: `desktop-tabs-model.ts` (u. a. `activateDesktopTab`, `openDesktopTab`,
  `reconcileDesktopRoute`, `serializeDesktopTabState`), `desktop-tabs.tsx:98`
  `desktopTabCatalog`, `plugins/session-tab-controller.ts` (Session-Tab-Steuerung),
  `plugins/plugin-workspace.tsx` (`PluginWorkspaceProvider`, `PluginWorkspaceView`,
  `usePluginWorkspaceCatalogViews`).
- Deep Links/Routen: `app-routes.ts` (u. a. `workflows/drafts/:id`, `workflows/view/:id/:version`,
  Session-Routen mit `sessionViewId`/`toolCallNodeId`, `:21` `SessionViewSearch`).
- Sessionzustand: `app-storage.ts:4-17` Keys, `:26` `readStoredSelection`,
  `:133` `readStoredSessionView` (nur terminal/workflow, sonst Default).
- Fokus/Preview: Composer-Fokus via `focusSignal` (`Composer.tsx`), Bildvorschau via
  `TerminalImageDialog`, Drawer-Regeln aus `DESIGN.md:413-420` (Tab-Container, Escape,
  Fokus-Rückgabe).

Vorhandene Tests (gelesen, nicht ausgeführt): `test/chat-ui-desktop-tabs-*.test.mjs`,
`test/chat-ui-app-routes.test.mjs`, `test/chat-ui-app-storage.test.mjs`,
`test/chat-ui-app-route-selection.test.mjs`, VS-Code-Web-Fläche gehört C
(`src/plugins/packaged-vscode-web.ts`, `src/apps/chat-vscode/`, Spec
`docs/specs/web/embedded-vscode-area.md`) — von D nicht angefasst.

### D1-06 — Plugin-Browservertrag und gemeinsame Hostdienste (gegenwärtig)

- `src/plugins/browser.ts:13` `PluginViewProps` (tab, piboSessionId, active, signal,
  state/updateState, request, openView, createSession?, registerBeforeLeave).
- `src/plugins/browser.ts:40` `PluginBrowserSetup` (React/sdk/scope/piboSessionId,
  registerRenderer/registerHook/registerShell).
- `src/plugins/host.ts:7` `PluginSetupContext` (scope, services, register, registerResource),
  `:119` `PluginHost`, `:37` `planPluginActivation`.
- Gemeinsame Chat-Hostdienste: `src/plugins/product-services.ts:41`
  `PiboChatExtensionService` mit `registerApiRoute`/`dispatchApiRoute`,
  `registerMessageAugmenter`/`prepareMessage` (`:72-90`, Payload-Key-Konflikt wirft).
  Das ist der heutige K07-relevante Host-Seam (Annotation-Augmenter hängt hier).
- Browser-Host: `src/apps/chat-ui/src/plugins/browser-host.tsx`
  (`BrowserPluginContext`, `runPluginInputHooks`).

### D1-07 — Prism-Duplikat mit echten Verbrauchern (gegenwärtig, belegt)

- Zwei byte-identische Kopien (je 24 Zeilen, gleicher Inhalt):
  `src/apps/chat-ui/src/context/prism-client.ts:1-24` und
  `src/apps/context-files-ui/src/prism-client.ts:1-24`.
- Verbraucher Kopie 1: `src/apps/chat-ui/src/tracing/MarkdownRenderer.tsx:4,364,377`
  (`prism.highlight`), `src/apps/chat-ui/src/context/MarkdownEditor.tsx:1`.
- Verbraucher Kopie 2: `src/apps/context-files-ui/src/components/MarkdownEditor.tsx:1`.
- Grammatik-Imports nur in `MarkdownRenderer.tsx:6-12` (bash/css/javascript/json/markdown/
  typescript/yaml). Kein allgemeiner Helper-Katalog daneben erfunden (Auftrag).

## 3. Untersuchung 2: K07 — heutige Attachment-Pfade

### D1-08 — Composer-Sendepfad (gegenwärtig)

Client (`src/apps/chat-ui/src/composer-send.ts`):

- `:22` `ComposerSendPlan` = piboSessionId, text, webAnnotationIds, fileAttachmentPaths,
  clientTxnId, delivery, optimisticEvent.
- `:97` `createComposerSendPlan` (IDs/Pfade mappen, optimisticEvent mit `id=clientTxnId`).
- `:141` `withComposerSendDelivery`, `:162` `appendComposerOptimisticEvent`.
- `:42-95` Draft-Tracker (`create`/`begin`/`update`/`settle`/`restore`).
- `:174` `pendingTransactionKey="pibo.chat.pending-message-transaction.v2"` (sessionStorage),
  `:177` `readPendingMessageTransaction`, `:186` `rememberPendingMessageTransaction`,
  `:193` `samePendingMessageIntent` (Retry mit selber ID bei gleichem Intent).

Senden (`src/apps/chat-ui/src/session-trace-pane.tsx`):

- `:586` `handleComposerSend` (Plan bauen, `clientTxnId` wiederverwenden bei gleichem Intent),
  `:526` `deliverComposerSend` (optimistic Overlay, `rememberPending`, `onSend`, danach
  `rememberPending(null)`, Draft settle, Receipt-Refetch, `:551-552` Auswahl leeren,
  Trace-Refetch), `:561` `rollbackComposerSend` (Overlay entfernen, Draft restore).
- `api-chat-sessions.ts:168` `postMessage`: POST `/api/chat/message` mit `admissionVersion: 2`,
  Receipt-Pflicht (`:191-193` wirft ohne Receipt), `acceptanceUnknown`-Fehler (`:194-200`).
- `:270` `getMessageReceipts` (Abgleich unklarer ACKs; Poll alle 1s in `session-trace-pane.tsx:413-420`).

Composer-UI (`src/apps/chat-ui/src/composer/Composer.tsx`):

- `:36` `ComposerProps` (zwei getrennte Auswahl-Listen: `selectedWebAnnotations`,
  `selectedUploadAttachments`, je eigene detach/clear-Callbacks).
- `:734-743` Upload-Leiste „Attached uploads“ (Chips mit per-Item-X und Clear);
  Annotations-Chips in `web-annotations.tsx:68-76` (Attach/Detach-Toggle).
- Kein Grid, kein Core-X-Overlay, kein Auswahl-/Übernahmemodus, keine Revisionen.

Vorhandene Tests (gelesen, nicht ausgeführt): `test/chat-ui-composer-send.test.mjs`,
`test/chat-ui-pending-message-delivery.test.mjs`, `test/chat-web-app-sessions.test.mjs`,
`test/web-channel.test.mjs`, `test/message-command-store.test.mjs`.

### D1-09 — Upload-/Dateianhänge: In-Memory, nicht reloadfest (gegenwärtig)

- Auswahl-State: `src/apps/chat-ui/src/chat-upload-attachments.ts:62`
  `useSessionUploadAttachments` = reines React-`useState`, Key pro Session,
  keine Persistenz (Reload/Sessionwechsel-Verlust außer sichtbarer Session-State).
- `:11` `MAX_SELECTED_UPLOAD_ATTACHMENTS = 10`, `:13` `assertChatUploadCapacity`.
- Upload: `api-chat-files.ts` (`uploadChatFiles`, `chatImagePreviewUrls`, `downloadChatFile`);
  sofortiger Server-Upload beim Anhängen (kein lokales Draft-Staging, keine Blob-Persistenz).
- Server: `src/apps/chat/chat-files.ts:9` `CHAT_UPLOAD_DIR` (`PIBO_HOME/uploads`),
  `:10` Limit 10, `:47` `saveUploadedChatFiles`, `:25` `prepareChatFileAttachments`,
  `:212` `normalizeChatFileAttachmentPaths` (nur unter Upload-Dir, max 4096 Zeichen,
  Fehler sonst), `:232` `chatFileAttachmentForPath` (404/400), `:248` Modellkontext
  `<attached-uploaded-files>`.
- Vorschau/Download: `:76` `resolveImagePreviewPath` (Roots: Basis + Upload-Dir),
  `:80` `resolveImagePreviewPathWithinRoots` (realpath, 403/404/409/413/415),
  `:99` `responseChatFileDownload` (no-store), `:111` `responseChatImagePreview` (no-store,
  same-origin, nosniff).
- Einordnung (R-D1-02 korrigiert): Der Upload beim Anhängen ist **physisches Staging**
  (Datei unter `PIBO_HOME/uploads`), keine angenommene Nachricht — semantische
  Materialisierung (Bindung an Nachricht/Turn via `clientTxnId`/Receipt) erfolgt erst
  im Sendepfad (D1-11). Kein Produktbruch: Der vorhandene Upload-Store ist als
  Draft-Ressourcenlösung zu prüfen (Referenz + Lifecycle statt Pflicht-Neubau).
  Browserlokal (z. B. Draft-Blob-Store) vs. serverseitig (bestehender Upload-Store)
  sind begründete technische Alternativen im K07-Entwurf, keine Produktänderung.

### D1-10 — Web-Annotations-Auswahl: global, Live-Referenz, kein Snapshot (gegenwärtig)

- Auswahl-State: `use-session-web-annotations.ts:29` `useState<string[]>`,
  `:138-141` Toggle mit Cap 5 (`slice(0,5)`), `:130-136` Persistenz via
  `web-annotation-storage.ts`.
- Persistenz-Key ist **global**: `web-annotation-storage.ts:2`
  `pibo.chat.webAnnotations.selected` (ein Key für alle Sessions), `:122-136`
  liest/schreibt global; Legacy-Pro-Session-Key wird nach global migriert (`:126-132`).
  Beleg-Zitat UI: `web-annotations.tsx:58` „Selected attachments follow you when
  switching sessions.“ → Verstoß gegen künftige K07-Sessionbindung, heute Fakt.
- Anzeigenamen/Filter: `:41-63` Query scope `app`, Limit 100, resolved/dismissed
  ausgeblendet, Auswahl wird auf sichtbare IDs beschnitten (`:104-119`).
- Senden: Nur ID-Liste geht an Server (`ComposerSendPlan.webAnnotationIds`);
  Server liest **Live-Annotation** aus Store (`attachments.ts:93-100` `getAnnotationById`),
  serialisiert `:53` und rendert `:111` `<attached-web-annotations>`. Quellenänderung
  zwischen Auswahl und Senden fließt ein → kein Snapshot (Lücke L-01).
- Commit: `packaged-web-annotations.ts:60-64` markiert nach Annahme `status: "attached"`.
- Limits: `validation.ts:21-51` (`attachments: 5`, id 160, note/url/diverse Längen,
  threadMessages 100 u. a.).

### D1-11 — Server-Annahmepfad (gegenwärtig)

`src/apps/chat/web-app.ts:4443` `sendChatMessage`:

1. `:4458-4460` `admissionVersion` (nur 2 oder undefined; durable braucht asyncStorage sonst 503).
2. `:4461-4463` Normalizer (`normalizeMessageText`, `normalizeMessageDelivery`,
   `normalizeClientTxnId` — `chat-request-normalizers.ts:508-511`, max 160 Zeichen).
3. `:4466-4477` Session/Room-Auflösung, Archiv-Schutz (403), Room-Mismatch (404).
4. `:4480` Duplikat-Lookup `eventCommands.findByClientTxn` (nur non-asyncStorage-Pfad;
   durable-Pfad via `asyncStorage.admit` mit Idempotenz).
5. `:4483-4486` `chatExtensions.prepareMessage` (Augmenter-Kette; heute: Web Annotations).
6. `:4487-4490` `prepareChatFileAttachments` (Datei-Sonderpipeline, **nicht** über Augmenter).
7. `:4492-4517` Event-Append (`user.message.accepted`, Id `clientTxnId ?? randomUUID()`),
   `:4518` Duplikat-Antwort (202/200 mit Receipt/StatusPath),
   `:4535-4539` durable Receipt-Antwort (202, `message-receipts/:id`), `:4544-4551` sonst
   direkter Emit.
8. Fehler: `:4582-4594` command_conflict (409), command_too_large (413),
   command_reconciliation_required (409, non-retryable), command_overloaded (429),
   storage_* (503, `acceptanceUnknown` bei unknown/operation_failed), room-Fehler.

Idempotenz: `data/event-command-service.ts:9` `chatClientTransactionKey(room,actor,clientTxnId)`,
`:19` Idempotency-Key, `:46` `findByClientTxn`.

### D1-12 — Annotations-Persistenz (gegenwärtig)

- `src/web-annotations/store.ts:228` `WebAnnotationStore`, Default
  `piboHomePath("web-annotations.sqlite")` (`:232`), WAL + busy_timeout.
- Tabellen: `web_annotation_bindings`, `web_annotations` (`:498ff` Schema).
- Einordnung (R-D1-03 korrigiert): `:434` `getAnnotationById` filtert nicht nach Session
  (`:426` `getAnnotation` ist scoped). Das belegt allein **keine** Zugriffslücke: App Context
  ist laut Glossar der geteilte Produktdatenraum (Auth = Zugang, keine Mandanten-Partition).
  Zu trennen: (a) Autorisierung/Berechtigung beim Lesen und bei der **ausdrücklich
  berechtigten Kopie** (diese nicht versehentlich verbieten), (b) Sessionzugehörigkeit des
  **neuen** K07-Drafts (genau eine Session, V3-Regel). → Technische Reviewfrage R-04
  (wo die jeweilige Prüfung im K07-Seam sitzt, D/B-Owner beibehalten).
- API: `src/web-annotations/api.ts` (`createWebAnnotationsWebApp`), Tools `tools.ts`,
  Validierung `validation.ts`, CDP `cdp.ts`, Typen `types.ts`.

### D1-13 — Medienpfade und reale Code-Limits (gegenwärtig)

| Wert | Code |
|---|---|
| Max Upload-Auswahl 10 | `chat-upload-attachments.ts:11`, `chat-files.ts:10` |
| Max Annotations-Auswahl 5 | `validation.ts:50`, `attachments.ts:37`, UI-Cap `use-session-web-annotations.ts:141`, Storage-Cap `web-annotation-storage.ts:140,153` |
| `clientTxnId` max 160 | `chat-request-normalizers.ts:511`, Annotation-ID max 160 `attachments.ts:44` |
| Upload-Pfad max 4096, nur unter Upload-Dir | `chat-files.ts:220-223` |
| Bild-Preview max 10 MiB decode | `trace-v2.ts:27` (413 darüber, `chat-files.ts:158,168`) |
| Bild-Store max 15 MiB, max 20 Bilder | `trace-v2.ts:28-29` |
| Inline-Payload 8 KiB, Transcript 64 KiB, Payload-Limit default 64 KiB / max 1 MiB | `trace-v2.ts:19-23` |
| Timeline 50/240, Raw-Events 80/500 | `trace-v2.ts:15-16,24-25` |
| Composer-History 100 | `app-storage.ts:18` |
| Annotations-Query Limit 100 | `use-session-web-annotations.ts:45` |

Kein JSON-Bytes-Limit für K07-Payloads existiert heute (kein K07-Modell) — neue Budgets
gehören in `contracts.md` als Vorschlag markiert.

### D1-14 — Vorhandene Draft-/State-Persistenz (gegenwärtig)

- Composer-Text-Draft pro Session (localStorage): `app-storage.ts:6`
  `pibo.chat.composerDraft.<sessionId>`, `:86` read, `:94` write (löscht bei leer).
- Pending-Txn pro Tab (sessionStorage): `composer-send.ts:174` (überlebt Reload im selben
  Tab, nicht Sessionwechsel/Profilwechsel).
- Auswahl-Uploads: nur React-State (D1-09). Auswahl-Annotations: global localStorage (D1-10).
- Overlay-State pro Session: `web-annotation-storage.ts:4` Prefix `...overlay.<sessionId>`.
- Kein IndexedDB-Draft-Blob-Store, kein Copy-Puffer, keine Revisions-/Konfliktregel
  für Multi-Tab (Lücke: `storage`-Event nur für Overlay-State, `use-session-web-annotations.ts:86-89`).

### D1-15 — Lücken, Duplikate, Risiken (Analyse, keine Codeänderung)

Gegenwärtig belegt:

- L-01 Kein Snapshot: Annotations werden als Live-ID versendet (`attachments.ts:93-100`).
- L-02 Keine Sessionbindung der Auswahl: globaler Key (D1-10) bzw. flüchtiger State (D1-09).
- L-03 Kein Grid/kein Core-X/kein Übernahmemodus (D1-08).
- L-04 Keine Revisionen, keine Copy-Ablage, kein Sende-Snapshot an `clientTxnId`
  (nur Text+IDs/Pfade; `ComposerSendPlan:22-30`).
- L-05 Zwei Sonderpipelines: Dateien direkt in `sendChatMessage`, Annotations via
  Augmenter (D1-11) — K07 muss sie hinter einem Seam vereinen, ohne Medien zu brechen.
- L-06 `getAnnotationById` ohne Sessionfilter (D1-12, keine belegte Lücke — R-D1-03);
  Upload-Normalizer heute strikt gerootet (gut, beibehalten).
- L-07 Upload-Staging physisch vorhanden (D1-09), aber keine Draft-Bindung/kein Snapshot;
  semantische Materialisierung weiter erst beim Senden (R-D1-02, kein Bruch).
- Duplikat belegt: nur Prism-Client (D1-07). Kein weiteres doppeltes Web-Helper-Modul
  mit echten Verbrauchern gefunden (Negativbefund, Umfang: `src/apps/*/src`, `src/plugins`).

Historisch (nicht als frisch ausgegeben): Spec `docs/specs/web/composer-delivery-files-and-media.md`
(Baseline `39090b8…`, älter als HEAD `ece5f18…`) beschreibt Admission/Durable/Receipt —
am HEAD gegen `web-app.ts:4443-4596` gegengeprüft und im Kern bestätigt (D1-11);
Abweichungen in Details möglich, keine als Blockade gewertet.

Risiken für D2 (Vorschau, Details in `implementation-plan.md`):

- R-A Medienparität: Jede Vereinheitlichung muss Preview-/Download-/Modellkontext-Pfade
  nach aktuellem Adapter erhalten (heute textuelle Pfadprojektion, D1-09/D1-13, R-D1-04);
  sonst Regression gegen `chat-file-security`-Tests. Keine neuen nativen Kanäle ohne
  Scope-Entscheidung.
- R-B Sessionbindung: Copy-Puffer + globaler Auswahl-Key (D1-10) erfordern saubere
  Draft-Sessionbindung; Leseberechtigung im geteilten App Context davon getrennt
  halten (D1-12, R-D1-03).
- R-C Multi-Tab/Logout: heute keine Revisionsregel (D1-14); K07 braucht sie (AT-20).
- R-D Workflow-Umzug: Core-Implementierung groß (`web-app.ts` + 15 Workflow-Module);
  K04-Seam muss klein bleiben, sonst Mega-Fassade.

## 4. Reviewfragen an B/C/I (Schnittstellenunterschiede)

- R-01 AUFGELÖST (R-D1-01, keine Frage mehr): Fünf feste Coreansichten = 3 Workspace-Areas
  + 2 Session-Tools aus `core-workspace-model.ts` (D1-05). Terminal/Workflow sind
  Session-Views und zählen nicht mit.
- R-02 (an B): Neutrale Exporte für K07 (Envelope-/Ressourcen-Typen, Registry-Seam) —
  welche Datei (`sdk.ts` vs. neue Ressourcendatei) nimmt die abgestimmten Exporte auf?
  D liefert Semantik, B die Datei (V3 §12.7).
- R-03 (an C): Annotations-Anbieter liefert Schema/Payload/Renderer + Größenwünsche;
  akzeptiert C, dass Auswahl/Snapshot/Grid/X/Copy/Senden ausschließlich Core sind
  (kein eigener Store, keine eigene Sende-/State-Verdrahtung)?
- R-04 (an B, technisch; R-D1-03 korrigiert): Trennen — (a) Leseberechtigung im geteilten
  App Context inkl. ausdrücklich berechtigter Kopie, (b) Sessionzugehörigkeit des neuen
  K07-Drafts. Wo sitzt welche Prüfung im K07-Seam? Vorschlag D (Owner beibehalten):
  D prüft Draft-Sessionbindung im K07-Modul, B liefert Ressourcen-Autorität; berechtigte
  Kopie nicht verbieten.
- R-05 (an I): Paketgrenze für gemeinsamen Prism-Client: neuer kleiner Shared-Import vs.
  Einordnung unter bestehendem gemeinsamem Web-Modul? D schlägt „kleinstes vorhandenes
  Modul, keine neue Paketstruktur“ vor (Vertrag K05).
- R-06 (an B, R-D1-04 korrigiert): Bestätigt — heute textuelle Dateipfadprojektion
  (`chat-files.ts:248-258`, `AgentRuntimePromptInput` nur `text/source/capabilityScope`,
  `types.ts:256-260`). K07 bewahrt Medien-/Dateifunktion nach aktuellem Adapter; neue
  native Kanäle nur nach Scope-Entscheidung (B korrigiert dieselbe Stelle, kein D-Zwang).
- R-07 (an C, C1-Abgleich): C1-09 beschreibt die Annotations-Auswahl als reinen
  React-State ohne Persistenzschritt; D-Beleg zeigt zusätzlich den globalen
  localStorage-Key `pibo.chat.webAnnotations.selected` (D1-10). Kein Widerspruch im
  Kern (kein Snapshot, kein Session-Scope) — nur Persistenz-Nuancierung für C-Pilot.
- R-08 (an B, technisch; R-D1-06): K07-Entwurfstypen nutzen `unknown`/Platzhalter
  (`AttachmentInput`, `AttachmentEditableState`, `AttachmentTileProps`, Provider-`snapshot`).
  Offen: Schema-Sprache (JSON-Schema?), konkrete Typen, Validierungs- und
  Materialisierungsgrenze Provider↔Core. Keine freigegebene API — Entscheid vor D2,
  B/D-Owner beibehalten (D: Semantik, B: neutrale Exporte).

## 5. Abgleich mit B1/C1-Berichten (nach D-Eigenanalyse gelesen, 2026-09-20)

- B1 (`results/B1/handoff.md`): K01/K02 tragfähig, K03-Lücke, Pi-Querimporte, K07-Risiko
  Text-Pfad statt Bildkanal — Ist-Stand am HEAD bestätigt (R-06, R-D1-04: heutige
  textuelle Projektion ist die zu bewahrende Baseline, kein D-Zwang zu neuen Kanälen).
  Keine Widersprüche zu D1-01–D1-15; B-Anforderungen B-K07-01…05 und RQ-02/RQ-03
  betreffen K07-Medien und bleiben B-Entscheid mit Scope-Vorbehalt.
- C1 (`results/C1/analysis.md`, nur `analysis.md` vorhanden): C1-09 deckt sich mit
  D1-08–D1-12 (Live-Read, Limit 5/160, Receipt-Weg, `commit()`→attached, Screenshot nur
  Ref-Metadaten); C1-Implikation „Pfad-Lese-Vertrag erhalten“ stimmt mit D-Risiko R-A
  überein. Nuance: s. R-07. Eigene D-Sicht bleibt wie dokumentiert.

## 6. Quellenverzeichnis (gelesene Belege, Auszug)

Code: `src/apps/chat/web-app.ts` (Sendepfad, Workflow-Verdrahtung),
`src/apps/chat/chat-files.ts`, `src/apps/chat/chat-request-normalizers.ts`,
`src/apps/chat/chat-api-routes.ts`, `src/apps/chat/workflow-*.ts`,
`src/apps/chat/data/workflow-session-*.ts`, `src/apps/chat/trace-v2.ts`,
`src/apps/chat-ui/src/composer-send.ts`, `composer/Composer.tsx`,
`chat-upload-attachments.ts`, `api-chat-sessions.ts`, `api-chat-files.ts`,
`api-web-annotations.ts`, `session-trace-pane.tsx`, `use-session-web-annotations.ts`,
`web-annotation-storage.ts`, `web-annotations.tsx`, `app-storage.ts`, `app-routes.ts`,
`session-views/*`, `core-workspace-model.ts`, `desktop-tabs*.tsx/ts`,
`workflows/*`, `context/prism-client.ts`, `tracing/MarkdownRenderer.tsx`,
`plugins/{browser,host,sdk,product-services,packaged-workflows,packaged-web-annotations}.ts`,
`plugins/browser-host.tsx`, `web-annotations/{api,attachments,store,tools,types,validation}.ts`,
`apps/context-files-ui/src/prism-client.ts`, `sessions/workflow-session-kind.ts`.
Specs: `docs/specs/web/{composer-delivery-files-and-media,web-annotations,session-workspace-lifecycle,jobs-and-workflows-ui,app-shell-bootstrap-navigation-and-pwa}.md`.
Tests (nur gelesen): siehe D1-01/D1-08/D1-11-Abschnitte; keine Ausführung in D1.

---
type: "Research"
title: "Plugin-session interaction research (superseded; K07 is attachments-only)"
description: "Discarded MCP and WebMCP interaction draft kept for provenance; the accepted V3 plan defines K07 as attachments only."
tags: ["beta-4", "k07", "mcp", "superseded"]
status: "deprecated"
authority: "informative"
superseded_by: "/plans/beta4-phase2/beta4-arbeitsplan-v3.md"
generated:
  by: "muse-code/a1-session"
  at: "2026-09-20T17:30:00Z"
sources:
  - id: "host-original"
    resource: "scope:beta4-phase2 host planning archive at commit time"
    title: "Unchanged host original; see checkpoint provenance for path and hash"
checkpoint:
  origin_path: ".tmp/plugin-session-interaction-research.md"
  origin_sha256: "55dc10215c49453d5ed4ee7300df43c0e5035e4f80e2a17d1a779f6652316ed9"
  origin_bytes: 10185
  archive: "docs/reports/artifacts/beta4-phase2/beta4-phase2-originals-20260920.zip"
  archive_path: "tmp/plugin-session-interaction-research.md"
  transformations:
    - "Added this OKF frontmatter envelope; body bytes after frontmatter are unchanged from the origin."
---
# Plugin-Tab ↔ Pibo-Session: vorhandene Anschlüsse (Research)

Stand: Branch `beta/4.0-plugin-system`, HEAD `ece5f18c` (2026-09-20).
Methode: nur lesend im Checkout (grep + wenige Dateien); keine Builds, keine
Laufzeitprüfung. Behauptungen ohne Datei:Zeile sind als Lücke markiert.

## 1) Gewünscht (1): „Auswahl anhängen" als vorgemerkter Composer-Anhang

**Vorhanden – Send-Plan mit zwei Anhangsarten.** `composer-send.ts:22-30,97-139`
baut pro Sendung `ComposerSendPlan`: `text` + `webAnnotationIds` +
`fileAttachmentPaths` + `clientTxnId` + `delivery`, dazu ein optimistisches
Event (`id`/`eventId` = `clientTxnId`). Draft-Tracking mit Send-Ownership,
Clear-Revision und Restore-bei-Fehler: `:32-95`, benutzt von
`session-trace-pane.tsx:230,244,377,396`. Crash-feste Wiederaufnahme via
`sessionStorage`-Pending-Transaction v2 (`:174-195`, Intent-Vergleich `:193`).

**Vorhanden – Annotations als nächste-Verwandtschaft.** Web-Annotations werden
im Composer als entfernbare Auswahlchips dargestellt
(`Composer.tsx:757-775`, Uploads analog `:734-756`) und erst mit der nächsten
gesendeten Nachricht übertragen (`webAnnotationIds` im Plan). Backend:
`webAnnotationIds` normalisiert (`chat-request-normalizers.ts:123`),
validiert/serialisiert (`web-annotations/attachments.ts:36-43`,
`api.ts:178,208`); Store ist session- + raumgebunden
(`web-annotations/store.ts:45-46,84-101`). Uploads: `chat-upload-attachments.ts`
(87 Zeilen), Backend-Auflösung zu `fileAttachments` + `modelContext`
(`web-app.ts:4489-4513`).

**Vorhanden – Send-Pipeline atomar + erweiterbar.** Backend deduped per
`clientTxnId` (`web-app.ts:4480`, async-Pfad mit Receipt `:4515ff`;
Normalisierung `:508-511` in `chat-request-normalizers.ts`). Entscheidend:
`chatExtensions.prepareMessage({piboSessionId, messageText, body})`
(`web-app.ts:4485-4488`, Vertrag `product-services.ts:45,72`) lässt Plugins
Text/Payload zur Sendezeit augmentieren. Browser-seitig gibt es Composer-Hooks
mit Phasen `input|paste|drop|send` (`contributions.ts:132-139`); `send` läuft
in `Composer.tsx:451`, muss aber String zurückgeben (`:452-453`); `paste`
`:392`, `drop` in `terminal-file-drop-target.tsx:83`.

**Lücke vs. gewünscht:** Kein dritter, plugin-generischer „vorgemerkt"-Typ
(Text/JSON/Bild/Datei-Ref mit Version) existiert; kein „Auswahl anhängen"-
Einstieg aus Plugin-Tabs in den Composer-State; `send`-Hooks können Text
transformieren, aber keine Anhangs-Referenzen beisteuern. Das gewünschte
„erst an nächste Nachricht hängen, keine Modellrunde" entspricht exakt dem
Annotations-Muster und bräuchte dessen Verallgemeinerung (Ref-Typ + Backend-
Resolver wie `prepareChatFileAttachments`).

## 2) Gewünscht (2): optionale Agent-Tools auf Plugin-Daten

**Vorhanden – Tool-Provider-Vertrag.** `definePluginSessionToolProvider`
(`plugins/runtime.ts:196-227`): `selectedTools` + `createSession(context)` →
`PluginSessionToolSet`. Kontext (`:145-159`) trägt Session-/Auswahlbindung.

**Vorhanden – sessionsscharfe Ausführung.** `tools/session-service.ts` bindet
Tool-Sessions an die live Runtime-Generation (`:18-29`); Ausführung prüft
Generations-Match (`:263-264`) und wirft bei inaktiver Generation; Cleanup
revoked die Generation (`:308-315`); Renew/Authenticate `:369-405`.
Credential-Scope: Session + Instanz + Adapter + Generation + cwd + Allowlist
(`credential-registry.ts:69-88`), Secret als SHA-256-Hash (`:98`),
Zufalls-Secrets (`:146-147`). Bridge: `tools/mcp-bridge.ts` (656 Zeilen).

**Vorhanden – deklarierte SDK-Parität.** Gleiches Pibo-Tool, adapterabhängige
Zustellung: Pi `direct` (`agent-runtimes/pi/adapter.ts:134`, Compiler
`tool-compiler.ts:62`); Codex/Muse `mcp`/`streamable-http`
(`codex-native/adapter.ts:224,240`, `muse-native/adapter.ts:214,230`); OMP
`direct` (`omp/adapter.ts:138`); Vokabular in
`agent-runtime/capabilities.ts:14,196-212,415-432`. Nur Deklarationsebene
belegt; Laufzeitverhalten nicht geprüft. Backend-Plugin-APIs laufen über
`registerApiRoute` (`product-services.ts:42,54`), benutzt u.a. von Cron-,
Loops-, Remote-Agent-, vscode-web-Plugins.

**Lücke vs. gewünscht:** „UI und Agent arbeiten an derselben Quelle" ist
architektonisch abgedeckt (ein Provider, zwei Konsumenten), aber es gibt
kein belegtes Muster für Versions-/Konfliktregeln zwischen Tab-State und
Tool-Schreibzugriffen und keine Auswahlrechte jenseits der Profil-Tool-
Selektion.

## 3) Kontext, Lifecycle, Rechte, Credentials

**Tab/Session-Kontext existiert.** `PluginViewProps`
(`plugins/browser.ts:13-27`): `tab`, `piboSessionId`, `agentId?`, `roomId?`,
`active`, `signal`, `state`/`updateState`, `request`, `openView`,
`createSession?`, `registerBeforeLeave`. Tab-Instanz:
`PluginTabInstance` (`manifest.ts:119-130`, u.a. `instanceId`,
`piboSessionId`, `pluginRevision`, `state`, `subviewId?`, `instanceKey?`).
Montage zentral in `plugin-workspace.tsx:275` (Key
`instanceId:pluginRevision`, Abort pro Tab). Host verlangt fixe Session
(`browser-host.tsx:21`); Composer-Hooks erhalten `{piboSessionId, signal}`
(`browser.ts:34-37`).

**Tab-Lifecycle ≠ Generations-Lifecycle (belegt).** Tabs: persistiertes,
revisioniertes Tabset pro Session, 100-Tab-Limit, 1-MiB-Cap mit
Payload-Referenz-Gebot (`plugins/store.ts:164-185`), `tabs-read`/`tabs-write`
(`plugin-management-routes.ts:93-98`), Controller mit open/close/activate/
edit/retain/prune/Deep-Links (`session-tab-controller`, importiert in
`plugin-workspace.tsx:5`). Generation: Router-vergebene Live-ID pro
Plugin-Generation (`session-router.ts:1609,1789`, `randomUUID`), an der
Tool-Sessions/Credentials hängen und die bei Dispose revoked wird. Tabs
überleben Generationen; jede Anbindung muss definieren, ob ein Anhang an
den Tab-Stand oder den Generations-Stand bindet.

**Keine Browser-Credentials (belegt).** `request()` baut same-origin URLs
(`/api/chat/sessions/{id}/plugins/{pluginId}{path}`, Basic-Cookie-Auth,
`browser-host.tsx:100-103`, `pluginRequest` via `api-http.ts:1`).
Bridge-Credentials bleiben serverseitig, nie loggen/persistieren
(`session-service.ts:42`).

**Auswahlrechte-Lücke (wichtig).** Für die `request()`-URL fand sich KEIN
Backend-Matcher (nur `plugin-tabs|plugin-builds|plugin-recovery` in
`plugin-management-routes.ts:32` sowie `workflow|read|kill|…` in
`chat-api-routes.ts:198-239`); kein View ruft `props.request` aktuell auf.
Der sessionsscharfe Plugin-Datenkanal existiert als Vertrag + Host-
Verdrahtung, aber Auswahl-/Zugriffsrechte sind heute nur über bespoke
Routen + Web-Session-Auth abgedeckt — für (1) und (2) neu zu definieren.

## 4) State-Flüsse im Detail (Entwurfshinweise)

- Auswahl-State liegt in `session-trace-pane` (`:377,396`) und wird als
  Props in den Composer gereicht (`Composer.tsx:43-44,66-67`); ein dritter
  Ref-Typ bräuchte denselben Halter und dieselbe Chip-Darstellung.
- Tab-State: `updateState` → `controller.edit(updatePluginTab(...))`
  (`plugin-workspace.tsx:201,275`) → `tabs-write` mit `expectedRevision`
  (`plugin-management-routes.ts:98`) → Konflikt bei Revision-Mismatch
  (`store.ts:184`). Vorlage für Schreib-Konflikte aus (2).
- Kapazität: `assertChatUploadCapacity` (`Composer.tsx:426`,
  `session-trace-pane.tsx:492`) begrenzt Uploads; Muster für Limits neuer
  Anhangsarten vorhanden.
- Ref-Lifecycle-Vorbild: Annotations mit Status-Transitionen
  (`api.ts:9`, `patchWebAnnotation` in `api-web-annotations.ts:76-77`) —
  übertragbar auf vorgemerkt → gesendet/verworfen.

## 5) Vorhanden vs. gewünscht (kompakt)

| Gewünscht | Vorhanden | Lücke |
|---|---|---|
| Auswahl im Tab vormerken | Annotations-/Upload-Chips im Composer, Draft-Tracker, Pending-Txn | Kein plugin-generischer Ref-Typ, kein Tab→Composer-Einstieg |
| Erst an nächste Nachricht hängen | `webAnnotationIds`/`fileAttachmentPaths` im Send-Plan + Backend-Resolve | Resolver nur für zwei Typen; `send`-Hook liefert nur Text |
| Keine Modellrunde | Vormerkung ist rein clientseitig bis Send | `prepareMessage` läuft send-zeitig — Scope klären |
| Optionale Agent-Tools auf Plugin-Daten | Provider-Vertrag, Generationsbindung, MCP-Bridge, Adapter-Deklarationen | Keine Versions-/Konfliktregeln Tab↔Tool, keine Auswahlrechte |
| Session-/Tab-Kontext im Tab | Volle Props inkl. IDs, Signal, State | `request()`-Kanal ohne belegten Backend-Matcher |

## 6) Lesestellen (Priorität)

1. `src/apps/chat-ui/src/composer-send.ts:22-30,97-139,174-195` – Plan, Anhänge, Pending-Txn.
2. `src/apps/chat/web-app.ts:4480-4515` – Dedupe, `prepareMessage`, Attachment-Resolve.
3. `src/plugins/browser.ts:13-51` – View-/Hook-Verträge.
4. `src/apps/chat-ui/src/plugins/plugin-workspace.tsx:55-65,275` + `browser-host.tsx:21,77-103` – Lifecycle, Props, `request()`.
5. `src/plugins/runtime.ts:145-227` – Tool-Provider-Vertrag.
6. `src/tools/session-service.ts:18-29,263-315,369-405` + `credential-registry.ts:69-88,98,146-147` – Generationsbindung.
7. `src/plugins/store.ts:164-185` + `plugin-management-routes.ts:32,93-98` – Tabset-Persistenz.
8. `src/agent-runtimes/{pi,codex-native,muse-native}/adapter.ts` Tool-Support-Zeilen + `capabilities.ts:415-432` – Parität.

## 7) Offene Fragen

- Soll der generische Anhangs-Ref versioniert-persistent (neuer Store wie Annotations) oder Tab-State-ephemer sein, und wer löst ihn beim Senden auf?
- Bindet ein Anhang an Tab-Stand oder Generations-Stand (Stale-Regel bei Router-Neustart)?
- Wer definiert Auswahlrechte am `request()`-Kanal (Profil-, Tab-, Plugin-Scope), und braucht er einen Backend-Matcher?
- Brauchen Tool-Schreibzugriffe auf Plugin-Daten Optimistic-Concurrency (Tabset-Revision als Vorbild)?
- Gilt „keine Modellrunde" auch für `prepareMessage`-Augmentierungen (heute send-zeit aktiv)?

## 8) Limits

Stichprobe, keine Vollständigkeit: Success-/Fehler-Renderings der Anhänge,
`prepareMessage`-Implementierungen je Plugin, `session-tab-controller`-Details
und der exakte Upload-Speicherpfad wurden nicht gelesen. Audit-Annahmen wurden
neu geprüft: Bridge-Scope, Generationsbindung, Tabset-Cap und Adapter-
Deklarationen sind diesmal direkt belegt; die `request()`-Backendlücke war im
Audit nicht untersucht und ist der stärkste neue Befund.

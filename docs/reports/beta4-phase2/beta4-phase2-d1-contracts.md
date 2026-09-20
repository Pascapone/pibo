---
type: "Research"
title: "Beta 4.0 phase-2 D1 contract draft (archived research)"
description: "Worker D1 contract draft from the analysis-only round, archived as non-approved research with an OKF envelope."
tags: ["beta-4", "phase-2", "d1", "contracts"]
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
  origin_path: ".pibo/planning/beta4-phase2-20260920/results/D1/contracts.md"
  origin_sha256: "a1c421cc5f6c17994610abe8dd3e6c7d9a9bc0595f8375161dbf2e6ca8a44d1c"
  origin_bytes: 20932
  archive: "docs/reports/artifacts/beta4-phase2/beta4-phase2-originals-20260920.zip"
  archive_path: "results/D1/contracts.md"
  transformations:
    - "Added this OKF frontmatter envelope; body bytes after frontmatter are unchanged from the origin."
---
# D1 – Vertragskandidaten K04 / K05 / K07 (Entwurf, kein Code)

Status: Vorschlag v0 für G1-Review. Gegenwärtiges Verhalten steht in `analysis.md`;
hier nur Entwürfe. Design-Sprache nach `codebase-design/SKILL.md` (Module, Interface,
Seam, Adapter, Depth/Leverage/Locality) und `DESIGN-IT-TWICE.md` (Alternativenvergleich).

Regel aus V3: D besitzt K07-Semantik; B liefert nötige Exporte in seinen
SDK-/Ressourcendateien; C ist Annotations-Verbraucher (kein zweiter Attachment-Kern
im Plugin). K07 ist kein MCP/Tool-Protokoll, kein Pluginframework.

---

## K04 – Workflow-Modul und Host (Owner D)

### Zweck / Nicht-Ziele

- Zweck: Workflow-Verhalten (Entwurf, Veröffentlichung, Ausführung, Benutzeraktion,
  Sessionlink, Abbruch/Cleanup, gespeicherte Daten) hinter einer kleinen,
  fachlichen Oberfläche bündeln. Aufrufer formuliert Vorhaben, nicht Ablauf.
- Nicht-Ziele: kein eigenes Auth-System, keine neuen Tabellenformate als Nebeneffekt,
  keine zweite Sessionwelt, keine Umbenennung öffentlicher Routen, keine Loop-Modus-Änderung.

### Owner / Aufrufer

- Owner: D (Core-Workflowmodul heute in `src/apps/chat/`, später Workflow-Feature).
- Aufrufer: B (Session-Anschlüsse via K01), C (Paketmuster), Web-UI.
- Prüfer: B (Core-Anbindung), C (Paketmuster), A (Funktionsschutz).

### Exakter Einstieg (Entwurf, neu zu begründende Fassade — klein, keine Mega-Fassade)

Bestehende Routen/Parser bleiben (`chat-api-routes.ts`); der Vertrag fasst nur die
fachlichen Operationen. Zwei Einstiege (Backend-Service + Session-Link), kein Sammelsurium:

```ts
// K04-Entwurf v0 (Namen Vorschlag; bestehende Exporte behalten Vorrang in D2)
type WorkflowDraftId = string & { readonly brand: "WorkflowDraftId" };
type WorkflowVersionRef = { workflowId: string; version: string };

interface WorkflowModule {
  validateDraft(draftId: WorkflowDraftId): Promise<WorkflowValidationReport>;
  publishDraft(draftId: WorkflowDraftId): Promise<WorkflowVersionRef>;
  startSessionRun(input: {
    sessionId: string; version: WorkflowVersionRef; config?: unknown;
  }): Promise<WorkflowRunHandle>;
  listHumanActions(runId: string): Promise<WorkflowHumanAction[]>;
  answerHumanAction(runId: string, actionId: string, answer: unknown): Promise<void>;
  cancelRun(runId: string, reason?: string): Promise<void>;
}
```

Beispiel (üblicher Aufruf):

```ts
const report = await workflows.validateDraft(draftId);
if (!report.ok) return show(report.issues);
const version = await workflows.publishDraft(draftId);
const run = await workflows.startSessionRun({ sessionId, version });
```

Versteckte Arbeit: Routen-Parsing, Draft/Published/Asset/Archive/Tombstone/Lifecycle-Stores,
Session-Snapshot, manuelle Trigger-Runtime, Security-Validierung, Cleanup. Interne Teile
bleiben klein, aber privat (kein öffentlicher Export je Store).

### Beobachtbares Verhalten / Reihenfolge / Parallelität

- Zustände Draft: `editing → validating → valid | invalid → publishing → published`;
  Run: `starting → running → (awaiting-action)* → done | cancelled | failed`.
- `publishDraft` nur aus `valid`; `startSessionRun` nur auf publizierte Version;
  Antworten nur auf offene Aktionen; Doppel-Antwort → `WORKFLOW_ACTION_CLOSED`.
- Keine Idempotenz-Zusage im Kernvertrag (R-D1-05: `clientRequestId` aus v0 gestrichen —
  unbelegt, nicht Teil der verhaltensneutralen Trennung; s. optionale Erweiterung unten).

### Fehler / Retry / Abbruch / Ressourcen

- Fehler (Entwurf, Codes Vorschlag ohne HTTP-Abbild): `WORKFLOW_DRAFT_NOT_FOUND`,
  `WORKFLOW_VALIDATION_FAILED` (mit Report), `WORKFLOW_VERSION_NOT_PUBLISHED`,
  `WORKFLOW_RUN_NOT_FOUND`, `WORKFLOW_ACTION_CLOSED`, `WORKFLOW_CONFLICT`,
  `WORKFLOW_STORAGE_UNAVAILABLE` (retryable). R-D1-05: unbelegtes „427/409-Abbild“
  gestrichen; HTTP-Mapping bleibt offen bis zur D2-Zuordnung an heutige Handler.
- Retry: nur idempotente Lese- und `cancelRun`-Wiederholung durch Aufrufer; keine
  Request-Key-Zusage im Kernvertrag (s. optionale Erweiterung).
- Abbruch: `cancelRun` beendet Run und gibt Runtime-Ressourcen frei; verspätete Events
  werden ignoriert (kein Überschreiben terminaler Zustände).
- Deinstallation stoppt Feature, löscht keine Benutzerdaten; Reinstallation nutzt
  vorhandene Daten (`pibo-workflows.sqlite`, Draft-Stores).

### Daten / Berechtigungen / Kosten

- Scope: Session + Room wie heute; keine neuen Tenants. Auth bleibt beim vorhandenen Web-Auth.
- Persistenz: heutige Stores (D1-02), keine Formatänderung in D1/D2-Vertrag.
- Kosten: keine neuen Downloads/Starts; erlaubte Imports: heutige Core-Module, keine
  Plugin-Privaten.

### Adapter / Tests

- In-process: Workflow-Regeln (direkt testen). Local-substitutable: SQLite in isolierter
  Testumgebung. True external: nachgelagerter Provider (nur an vorhandener Seam ersetzen).
- Contract-Tests (Vorschlag): Start→Ergebnis, Start→Abbruch, Human-Action-Runde,
  Duplikat-Publish, Archiv-Raum-Schutz, Reinstall-Datenerhalt.

### Alternative kleine Schnittstelle (D-Sicht, Erweiterbarkeit)

Statt Methoden-Fassade: ereignisgeführter Host-Anschluss (eine Methode + Beobachter):

```ts
interface WorkflowHostPort {
  dispatch(command: WorkflowCommand): Promise<WorkflowEvent[]>; // command: discriminated union
  subscribe(runId: string, listener: (event: WorkflowEvent) => void): () => void;
}
```

- Beispiel: `dispatch({ kind: "draft.publish", draftId })` → `[{ kind: "version.published", … }]`.
- Fehler: unbekannter Command → `WORKFLOW_UNKNOWN_COMMAND`; Rowe: Commands sind
  validierte Einheiten, Events sind Fakten.
- Lifecycle: `subscribe` liefert Dispose; verspätete Events nach Cancel werden als
  `run.cancelled`-Folge markiert, nicht zugestellt.
- Depth: 1 Methode + Typ-Union statt N Methoden; Locality: alle Übergänge im Modul.
- Trade-off: Union wächst mit Features (Review: ab wann Fassade besser?).
  Empfehlung D: Fassade (oben) für G1, Port-Variante als dokumentierte Alternative.

### Optionale Erweiterung (separat, kein Kernvertrag; R-D1-05)

Idempotente `startSessionRun`-Wiederholung via `clientRequestId` (gleicher Key →
derselbe Run) ist eine **neue Zusage**, unbelegt und nicht Teil der verhaltensneutralen
Workflow-Trennung. Nur als ausdrücklich beauftragte Folgeerweiterung mit eigenem
Contract-Test (Doppel-Start, Key-Kollision, Scope) — kein G1-Gegenstand.

---

## K05 – Gemeinsames Web-Interface (Owner D)

### Zweck / Nicht-Ziele

- Zweck: Plugins nutzen vereinbarte Web-Umgebung (View-Registrierung, Tab-Lifecycle,
  Browser-Verträge), ohne private Router-/React-/Session-Details.
- Nicht-Ziele: kein Re-Design, kein UI-Framework, keine Entfernung der Browser-IDE,
  kein Entzug fremder Layoutkontrolle (Drittanbieter behalten eigenes Layout),
  keine Änderung an Cs VS-Code-Web-Pilot und As Ralph-Oberfläche.

### Owner / Aufrufer

- Owner: D (Shared Web UI, `web-app.ts`, `App.tsx`, gemeinsame Module).
- Aufrufer: C (VS Code Web + weitere Plugin-Views), B (neutrale Typen falls nötig).
- Prüfer: C (mind. zwei echte Aufrufer), B (Typen/Exporte).

### Exakter Einstieg (bestehende Verträge zuerst)

Bestehend (bleibt): `PluginViewProps` (`browser.ts:13`), `PluginBrowserSetup`
(`browser.ts:40`: registerRenderer/registerHook/registerShell), `PluginSetupContext`
(`host.ts:7`), Session-Tab-Steuerung, Routen/Deep-Links (D1-05).

Neu nur, wo mehrere echte Verbraucher dieselbe Aufgabe haben (belegt: Prism):

```ts
// K05-Entwurf v0: einziger neuer gemeinsamer Export in D1/D2 (Vorschlag)
import prism from "<shared-web>/prism-client"; // heute doppelt, künftig einmal
export function highlightCode(code: string, language: string): string; // dünn, mit Fallback
```

- `highlightCode`: Grammar-Lookup + `prism.highlight`; unbekannte Sprache → escaped
  Plain-Text (kein Throw im Renderer). Kein neuer Helper-Katalog.
- View-Registrierung/Subview-ID/Deep-Link/Fokus/Editorzustand/Session-Ownership:
  unverändert (D1-05). Feste Core-Ansichten (3 Workspace-Areas + 2 Session-Tools,
  R-01 aufgelöst) bleiben.

Beispiel (Aufrufer, unverändert + Highlight):

```tsx
function Doc({ code, lang }: { code: string; lang: string }) {
  return <pre dangerouslySetInnerHTML={{ __html: highlightCode(code, lang) }} />;
}
```

### Verhalten / Reihenfolge / Lifecycle

- Mount/Unmount: Renderer registrieren/deregistrieren via Dispose; Event-Abmeldung
  Pflicht; kein doppeltes React (Host liefert React, `PluginBrowserSetup.React`).
- Keine versteckte Pflicht-Plugin-Abhängigkeit durch Importweg (Bundle-Kontrolle via I).
- Fehler-/Leerzustände, Erreichbarkeit, Plugin-Auswahl: unverändert.

### Adapter / Tests

- In-process: Formatierung (direkt testen). Browser-Umgebung: echte DOM-/Layout-Prüfung
  für Fokus/Einbettung (Mock allein genügt nicht — V3 K05).
- Nachweis: D prüft `highlightCode` + Registrierungsvertrag; C prüft zwei echte Aufrufer
  (VS-Code-Web-Plugin + ein weiterer); sichtbarer Browser für Core-Ansichten + Einbettung.

---

## K07 – Einheitliches Attachment-System (Owner D, Semantik; B: neutrale Exporte)

### Zweck / Nicht-Ziele (fest, V3 §12 + D1-Auftrag Regeln 1–8)

- Zweck: Ein Core-Modul verwaltet sessiongebundene, persistente JSON-Entwurfsanhänge
  und ihren Versand. Anbieter liefern Schema/Payload/Renderer; Core besitzt Draft,
  Persistenz, Grid, X-/Auswahl-Overlays, Copy-Ablage, Sende-Snapshot, Materialisierung,
  Receipt-Abgleich, Ressourcenverwaltung.
- Bilder/Dateien sind Core-Anbieter; Medien-/Dateifunktion nach aktuellem Adapter
  bewahren (heute: textuelle Pfadprojektion + Vorschau/Download, D1-09/D1-13, R-D1-04).
  Neue native Kanäle nur nach Scope-Entscheidung (B), kein K07-Pflichtkanal.
- Nicht-Ziele: kein MCP-Server/Tool-Protokoll, kein Pluginframework, keine zweite
  Attachment-Pipeline im Plugin, keine Systemrollen/fremden Pfade/Rechte aus Plugin-JSON,
  keine geräteübergreifende Sync, keine dynamischen Code-Imports via Typname.

### Owner / Aufrufer / Prüfer

- Owner: D (K07-Typen, Semantik, Draft/State/Grid/Copy/Annahme).
- Vertragspartner: B (neutrale Exporte/Registry in seinen SDK-/Ressourcendateien),
  C (Web-Annotations-Anbieter), A (Gegenprüfung), I (Integration/Paket).
- Pilotfolge: D1-Pilot → I → C-Anschluss → G1 (V3 §12.13).

### Typen (Entwurf v0 — Abgleich mit bestehenden Exporten in D2, keine Umbenennung)

```ts
// K07-Entwurf v0 (Namen Vorschlag; bestehende Typen behalten Vorrang).
// R-D1-06: unknown/Platzhalter unten sind KEINE freigegebene API — s. offene Frage R-08.
type AttachmentId = string & { readonly brand: "AttachmentId" };
type AttachmentRevision = number & { readonly brand: "AttachmentRevision" };
type ClientTxnId = string & { readonly brand: "ClientTxnId" };

type AttachmentEnvelope = {
  formatVersion: 1;
  id: AttachmentId;
  sessionId: string;          // genau eine Session; nie via Plugin wechselbar
  type: string;               // z. B. "pibo.web-annotations/selection", "pibo.core/image", "pibo.core/file"
  schemaVersion: number;
  revision: AttachmentRevision;
  createdAt: string; updatedAt: string;
};

type AttachmentDraftRecord = {
  envelope: AttachmentEnvelope;
  payload: unknown;           // JSON, anbietervalidiert; Core prüft Umfang/Gültigkeit
  uiState?: unknown;          // reiner Präsentationszustand, nie Teil des Payloads
  sizeHint?: { wide?: { columns: number; rows: number }; narrow?: { columns: number; rows: number } };
  media?: { draftResourceId: string; mimeType: string; bytes: number }; // Core-Bilder/Dateien
  status: "saving" | "ready" | "error";
  error?: AttachmentError;
};

type AttachmentError =
  | { code: "ATT_INVALID_JSON" | "ATT_SCHEMA_MISMATCH" | "ATT_STALE_REVISION"
      | "ATT_PROVIDER_MISSING" | "ATT_ACCESS_DENIED" | "ATT_NOT_PORTABLE"
      | "ATT_BYTES_MISSING" | "ATT_STORAGE_FAILED" | "ATT_MATERIALIZE_FAILED"
      | "ATT_ACCEPTANCE_UNKNOWN" | "ATT_LIMIT_EXCEEDED"; message: string; retryable: boolean };

interface SessionAttachmentDraft { // an Session + Plugin-Owner gebundener Zugang (V3 §12.7)
  add(input: AttachmentInput): Promise<AttachmentId>;
  update(id: AttachmentId, expectedRevision: number, next: AttachmentEditableState): Promise<void>;
  remove(id: AttachmentId): Promise<void>;
}
```

Materialisierter Anhang (V3 §12.5, Illustration):

```json
{
  "formatVersion": 1,
  "id": "att_example",
  "type": "pibo.web-annotations/selection",
  "schemaVersion": 1,
  "payload": { "title": "Ausgewählte Annotation", "text": "Stand beim Anhängen.", "includeDetails": true }
}
```

### Anbieter-Vertrag (C-Seite, Entwurf)

```ts
type AttachmentProvider = {
  type: string;
  schemaVersion: number;
  validate(payload: unknown): void;                    // fachlich; wirft ATT_SCHEMA_MISMATCH
  snapshot(source: unknown, options?: unknown): unknown; // Quelle → festgehaltene JSON-Fassung, DOM-frei reproduzierbar
  render?: (props: AttachmentTileProps) => unknown;     // Widget; Core-X/Overlays unantastbar
  fallbackTitle(payload: unknown): string;
  sizeHint?: { wide: { columns: number; rows: number }; narrow: { columns: number; rows: number } };
};
```

- Renderer erhält nur eigenen Datensatz + begrenzte Funktionen (update/preview).
- Größenwünsche werden geclampt/abgewiesen (Host-Besitz Grid); keine CSS-Ausbrüche.

### Grid / Overlays (feste Produktregeln 2–3)

- Leiste über Chat-Input, volle Terminal-Containerbreite. Seite max 12×3, schmal 3×3,
  v0-Zwischengröße 6 (technischer Vorschlag). Containerbreite entscheidet (nicht Viewport).
- Overflow: weitere blätterbare Seiten mit Zähler; alle Seiten werden gesendet.
- Core-X oben rechts immer sichtbar; im Normalmodus bedienbar (auch bei defektem
  Renderer), im Übernahmemodus sichtbar aber deaktiviert wie alle Widget-Inhalte.
- Übernahmemodus: nur Core-Toggles + Bestätigen/Abbrechen bedienbar; Tastatur/Fokus/
  offene Vorschau einbezogen (nicht nur `pointer-events: none`).
- Vorschau via Host-Rahmen (Fokusführung, Escape, Fokus-Restore). Freihaltezone unterm X.

### Persistenz / Revisionen / Copy (Regeln 4–5)

- Draft-Record pro Session, persistent (vorhandene Persistenz zuerst; Versionierung Pflicht).
  `add` bestätigt erst nach sicherer Ablage, sonst Zustand `saving`/klarer Fehler.
- Text-Draft bleibt getrennt (bestehender Composer-Draft, D1-14).
- Draft-Ressourcen (R-D1-02): vorhandener Upload-Store zuerst prüfen (Referenz +
  Lifecycle auf `PIBO_HOME/uploads`); Alternative browserlokal (z. B. Draft-Blob-Store).
  Technische Alternativen mit Begründung, kein Pflicht-Neubau; `blob:`-URL/File-Handle
  allein genügt für Reload in keinem Fall.
- Multi-Tab: explizite Revisions-/Konfliktregel (Vorschlag: `expectedRevision`-CAS wie
  `update()`; Konflikt → `ATT_STALE_REVISION`, kein stilles Überschreiben).
- Logout/Kontowechsel: vorhandene Storage-/Zugriffsregeln; kein Leak fremder Drafts.
- Copy: Bestätigen erzeugt persistenten Snapshot in lokaler Ablage (mit eigenen
  Haltereferenzen); Ziel lädt ausdrücklich → neue IDs/Revisionen, Ursprung/Zielbestand
  unverändert; Default alles-oder-nichts (`ATT_NOT_PORTABLE`/`ATT_ACCESS_DENIED`
  stoppen gesamt); Retry derselben Ladeaktion idempotent (Lade-Op-ID);
  keine Tokens/Live-Handles kopieren; Scope/ACL/Portabilität am Ziel neu prüfen.

### Senden / Materialisierung / Receipt (Regel 7)

1. Einfrieren: Text + Session + geordnete (ID, Revision, JSON) + Medien an `clientTxnId`.
2. Prüfen/vorbereiten: JSON/Schema/Typen/Größen/Ressourcen; Draft-Bytes → temporäre
   Nachrichtenressourcen; Fehlen blockiert (kein stilles Kürzen).
3. Annehmen: über vorhandenen Nachrichtenannahmepfad (D1-11) binden; vorbereiteter
   Status + Wiederanlauf/Cleanup (keine behauptete globale Transaktion).
4. Quittieren: nur eindeutiger Annahmenachweis verbraucht passende Draftrevisionen;
   neue/geänderte Revisionen bleiben.
5. Wiederholen: bei unklarem Status Receipt-/Txn-Abgleich (`getMessageReceipts`,
   `findByClientTxn`); selbe ID nie mit geändertem Payload.

### Fehler / Validierung (Regel 8 + V3 §12.12)

- Unterscheidbar (s. `AttachmentError` oben); Nutzer kann beheben oder bewusst entfernen.
- Renderer-Fehler ≠ Payload-Verlust (Fallback: Titel/Typ/Herkunft/JSON/Diagnose).
- Fehlender Provider/Schema/Bytes: Payload erhalten, Core-Fallback/Entfernen verfügbar,
  Versand ohne nötige Validierung blockiert (kein Autoenable, kein stilles Weglassen).
- Serverseitig (Annahme): JSON/Medien-Limits, Schema, Session-/Ressourcen-Referenzen,
  keine Systemrolle/fremden Zugriff aus Payload. Alte Nachrichten lesbar (kompatible
  Leser erzeugen nur kanonisches Modell, keine zweite Pipeline).

### Ressourcen / Haltereferenzen / Cleanup (Entwurf)

- Halter: Source-Draft, Copy-Ablage, Zielkopien, Sende-Staging, angenommene Nachrichten.
- `remove` gibt nur eigene Referenz frei; GC nur bei null Referenzen (nie allein nach
  Ursprungs-Tab). Fehlgeschlagene Versuche räumen temporäre Nachrichtenressourcen auf.
- Vorschau-URLs aus gesicherten Daten neu erzeugen, bei Abbau freigeben.

### Limits: real vs. neu (Vorschlag)

- Real (D1-13, unverändert): Auswahl Uploads 10, Annotations 5, `clientTxnId` 160,
  Upload-Pfad 4096 + Root-Zwang, Bild 10/15 MiB + max 20, Payload-Limits trace-v2.
- Neu (Vorschlag, in D1/I0 gegen Code festzuziehen, keine versteckte Beschneidung):
  JSON-Bytes pro Anhang/Turn, Draft-Storage-Budget, Schema-Versionsfenster,
  Renderergrößen-Enum, Ablauf ungenutzter Draft-Ressourcen. Alle als `NEU` markiert,
  keine als bereits gültig ausgeben.

### Statusübergänge (Entwurf)

- Draft: `saving → ready | error → (update → saving → ready) → sending(frozen) → consumed | retained-on-failure`.
- Copy: `selecting → confirmed(stored) → loading → loaded | failed(atomic) → (ersetzt|geleert)`.
- Send: `frozen(clientTxnId) → prepared → accepted(receipt) | unknown(reconcile) | failed(blocking)`.

### Copy-/Materialisierungs-Szenarien (Entwurf, je AT-Abdeckung im Plan)

1. AT-09/10: Auswählen → bestätigen → Reload → Ziel öffnen → laden → neue IDs, keine
   Duplikate bei Retry, Ursprung/Ziel erhalten.
2. AT-11: Ziel ohne Typ/Recht → Gesamt-Abbruch mit konkretem Fehler, kein Teilladen.
3. AT-12/13: Senden mit eingefrorenem Stand; unklarer ACK → Receipt-Abgleich, kein
   Neu-Payload unter alter ID.
4. AT-14: Ändern während Senden → neue Revision bleibt, nur gefrorene verbraucht.
5. AT-17: Plugin fehlt/deaktiviert → Fallback + Entfernen + Datenerhalt, Versand blockiert.

### K07-Alternativen nach Design-Skill (drei Seams, Empfehlung)

Gemeinsame Zwänge: Snapshot, Sessionbindung, JSON/Umschlag, Medienparität, Persistenz,
Grid/X/Copy, idempotente Annahme; Abhängigkeiten: In-process (Reducer/Platzierung),
Local-substitutable (Storage/Blobs), Remote-but-owned (Pibo-Transport), True-external
(Provider — nicht hinter K07-Seam).

- **Entwurf 1 (minimal, 1–3 Einstiege — dieser Vertrag):** `SessionAttachmentDraft`
  (add/update/remove) + Provider-Registrierung + Host-Renderer. Maximale Leverage pro
  Einstieg; Host verbirgt Grid/Persistenz/Copy/Senden.
- **Entwurf 2 (flexibel, erweiterbar):** Event-Sourced-Draft (`append(event)` + Reducer +
  Projektionen für Grid/Copy/Send). Viele Anwendungsfälle (Undo, Sync-Vorbereitung),
  aber größere Lernfläche und Event-Versionierung als neue Last.
- **Entwurf 3 (bequemster Aufruf, C-Sicht):** `attachAnnotation(source)` / `attachFile(file)`
  als Convenience über Entwurf 1 (dünne Wrapper im Anbieter-SDK, kein eigener Store).
  Default trivial, Kern bleibt klein.

Vergleich: Depth (1 hoch, 2 mittel-hoch bei mehr Interface, 3 hoch für Default, dünn
daneben); Locality (1: alles im K07-Modul; 2: verteilt auf Reducer/Projektionen;
3: wie 1 + dünne Wrapper); Seam (1: Session-Draft-Seam; 2: Event-Log-Seam;
3: Convenience über 1, kein neuer Seam).
**Empfehlung D:** Entwurf 1 als Vertrag, Entwurf-3-Wrapper als optionale Dünnschicht
im Anbieter (C), Entwurf 2 verworfen (Over-Engineering ohne Sync-Auftrag).

### Offene B-Exporte (Anfrage, keine Vorwegnahme)

- Neutraler Umschlag-/Ressourcen-Typ + Registry-Seam in B-Owner-Datei (R-02).
- Ressourcen-Autorität (Root-Prüfung, Preview-Regeln) bleibt bei B-kompatiblen Regeln;
  D ruft sie auf, definiert sie nicht um.

### Offene technische Reviewfrage R-08 (R-D1-06, kein G1-Blocker der Analyse)

Die K07-Entwurfstypen sind Skizzen: `payload: unknown`, `uiState?: unknown`,
`AttachmentInput` / `AttachmentEditableState` / `AttachmentTileProps` undefiniert,
Provider-`snapshot(source: unknown, options?: unknown): unknown`. Offen vor D2:
(1) Schema-Sprache für Provider-Payloads (JSON-Schema? Versionierung?),
(2) konkrete Typen statt `unknown`/Platzhalter, (3) Validierungsgrenze
(Core: Umfang/JSON-Gültigkeit vs. Anbieter: fachlich — wo geprüft, wo Fehlercode her?),
(4) Materialisierungsgrenze (wer baut Nachrichtenbeitrag aus gefrorener Revision —
Core allein mit Anbieter-Serializer?). Owner beibehalten: D Semantik, B neutrale Exporte.

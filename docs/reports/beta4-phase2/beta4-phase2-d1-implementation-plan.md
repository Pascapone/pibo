---
type: "Research"
title: "Beta 4.0 phase-2 D1 implementation-plan draft (archived research)"
description: "Worker D1 implementation-plan draft from the analysis-only round, archived as non-approved research with an OKF envelope."
tags: ["beta-4", "phase-2", "d1", "implementation-plan"]
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
  origin_path: ".pibo/planning/beta4-phase2-20260920/results/D1/implementation-plan.md"
  origin_sha256: "a94e54ed5b2e018235f09f3c8d35c3cfdddd1a3f9c7fc1eda19d5d26a199126b"
  origin_bytes: 8562
  archive: "docs/reports/artifacts/beta4-phase2/beta4-phase2-originals-20260920.zip"
  archive_path: "results/D1/implementation-plan.md"
  transformations:
    - "Added this OKF frontmatter envelope; body bytes after frontmatter are unchanged from the origin."
---
# D1 – Implementierungsplan (Vorbereitung, keine Umsetzung)

Basis: HEAD `ece5f18cffe3f96f8f5dd8c241aac1d439c67b9a`, Branch `beta/4.0-plugin-system`.
G1-Freigabe steht aus; keine D2-Arbeit ohne Folgeauftrag. Dateirechte nach V3 §7:
D = `web-app.ts`, `App.tsx`, Workflow-Backend/-UI, gemeinsame Web-Module, K07-Core,
Composer, Draft-Storage, Copy-Ablage. Fremd: Cs VS-Code-Web-Pilot, As Ralph-Oberfläche/
TUI, B-SDK/Core/Pi, I-Root-Manifeste/Lockfile/Builder.

## 1. Schrittfolge (eine D-Spur, prüfbare Zwischenstände)

1. **K07-Pilot (klein, zuerst):** gemeinsamer Draftkern + schlanker Anbieteranschluss
   mit einem Core-Anhang (Bild/Datei): Add → Reload → JSON-Snapshot → kontrollierte
   Annahme. State/Reload, X-/Auswahl-Grundgerüst, Sende-Revisionen an `clientTxnId`.
   Übergabe: Pilotstand → I → C (Annotations-Anschluss) → G1.
2. **I-Integration + C-Anschluss:** C prüft Web-Annotations-Anbieter gegen integrierten
   Pilotstand; Rückmeldungen an D/B.
3. **G1:** K04/K05/K07-Verträge v1 + Pilotnachweise (Core-Anhang + Annotations-Pilot
   auf demselben Commit).
4. **D2a K07 vollständig:** Grid (12×3/6/3×3), Seiten, Overlays/X, Vorschau-Lifecycle,
   Copy-Ablage + Laden, Draft-Ressourcen (vorhandener Upload-Store zuerst prüfen,
   Alternative browserlokal — R-D1-02, kein Pflicht-Neubau), Sendepfad mit
   Receipt-Abgleich, Fehler/Limits, Altübernahme. Erst integrieren, dann Schritt 5.
5. **D2b Workflow-/Web-Umzüge (getrennt, danach):** K04-Fassade hinter heutige
   Core-Implementierung, Prism-Zusammenführung (D1-07), weitere gemeinsame
   Web-Darstellungen nur mit belegten Verbrauchern. Mechanik und Verhalten trennen.
6. **Alte Sonderwege entfernen:** nur nach grüner gemeinsamer Parität +
   Test-Ablösungsnachweis je Alttest (Verhalten→Nachfolger→grün→Review).

## 2. Dateizuständigkeiten (Entwurf)

| Bereich | Dateien (Owner D, Entwurf) | Partner |
|---|---|---|
| K07-Core (neu, klein) | neues Core-Attachment-Modul (Draft/State/Grid/Copy/Send-Koordination; interner Reducer/Storage-Adapter/Platzierung privat) | B: neutrale Exporte in B-SDK-/Registry-Dateien |
| Composer | `src/apps/chat-ui/src/composer/Composer.tsx`, `composer-send.ts` (K07-Snapshot statt ID-/Pfad-Listen), Auswahl-Helfer | C: nur Anbieter-Renderer |
| Draft-Storage | `app-storage.ts`, `web-annotation-storage.ts` (Sessionbindung statt Global-Key), Draft-Ressourcen: Upload-Store prüfen vs. browserlokale Alternative (R-D1-02) | — |
| Server-Annahme | `src/apps/chat/web-app.ts` (`sendChatMessage`), Normalizer, Augmenter→K07-Materialisierung, `chat-files.ts`-Parität | B: Ressourcen-/Runtime-Anschlüsse |
| Workflows | `src/apps/chat/workflow-*.ts`, `data/workflow-session-*`, `chat-api-routes.ts` (Workflow-Teil), UI `WorkflowsArea*`, `workflows/*`, Session-View | B: K01-Anschlüsse; C: Paketmuster |
| Shared Web | `web-app.ts`, `App.tsx`, gemeinsame Module, Prism-Zusammenführung (`context/prism-client.ts` ↔ `context-files-ui`) | C: zwei Aufrufer-Nachweise; I: Paketgrenze |

## 3. AT-01–AT-22 → Tests (Mapping: vorhanden vs. neu; keine Ausführung in D1)

Vorhanden (gelesen, unverändert weiter): `test/chat-ui-composer-send.test.mjs`,
`test/chat-ui-upload-attachments.test.mjs`, `test/chat-ui-pending-message-delivery.test.mjs`,
`test/chat-ui-web-annotation-storage.test.mjs`, `test/chat-ui-web-annotations-panel.test.mjs`,
`test/web-annotations-{attachments,store,tools,cdp-api}.test.mjs`,
`test/chat-file-security.test.mjs`, `test/chat-web-app-sessions.test.mjs`,
`test/web-channel.test.mjs`, `test/message-command-store.test.mjs`,
Workflow-Tests (s. `analysis.md` D1-01).

| AT | Nachweis | Vorhandene Basis (gelesen) | Neu nötig (Vorschlag) |
|---|---|---|---|
| AT-01 Snapshot | Quelle ändern → Draft-JSON/Medien unverändert | `web-annotations-attachments` (Live-Ser.) | K07-Snapshot-Fixture (Quelle/Draft/Senden) |
| AT-02 Toggle/Revision | Toggle→neue Revision; Vorschau≠Payload | — | Draft-Revisions-Test + UI-State-Trennung |
| AT-03 Grid | 12×3 breit, 3×3 schmal, keine Überläufe | — | Container-Layout-Tests (breit/geteilt/mobil) |
| AT-04 Overflow/Seiten | Seiten erreichbar; alle gesendet | — | Paging- + Sende-Vollständigkeits-Test |
| AT-05 Core-X | X bei Core/Plugin/Fehlerkachel; Entfernen ohne Renderer | — | X-Erreichbarkeits-/Entfernen-Tests |
| AT-06 Übernahmemodus | Nur Toggles; Maus/Touch/Tastatur/Vorschau | — | Modus-Interaktionsmatrix (inkl. Fokus) |
| AT-07 Session/Reload | Nur Ziel-Sessiondraft; JSON/Optionen/Medien wiederhergestellt | `app-storage`, `web-annotation-storage` (Teil) | Session-Scope- + Reload-Fixtures |
| AT-08 Storagefehler | Verständlich, kein falscher Erfolg, kein stiller Verlust | — | Storage-Fehlerinjektion (voll/verweigert/fehlende Bytes) |
| AT-09 Copy-Persistenz | Ablage überlebt Reload/Ursprungsänderung; Ressourcen verfügbar | — | Copy-Ablage-Fixtures + Haltereferenz-Test |
| AT-10 Copy-Laden | Neue IDs, keine Seiteneffekte, Retry ohne Duplikate | — | Lade-Idempotenz-Test (Doppelklick/Retry) |
| AT-11 Copy-Scope | Unportabel/unberechtigt → Gesamt-Stopp; berechtigte Kopie erlaubt, Scope/ACL am Ziel neu geprüft (R-D1-03) | — | Scope-/Portabilitäts-Matrix |
| AT-12 Materialisierung | Vor Senden keine Nachrichtenressourcen; exakter Stand | `web-channel`, `message-command-store` (Annahme) | Freeze-/Materialisierungs-Test |
| AT-13 Retry/ACK | Draft korrekt; Retry gleiche ID+Daten | `pending-message-delivery`, Receipt-Polling | Unklar-ACK-Reconciliation-Test |
| AT-14 Race | Nur verbrauchte Revisionen gelöscht; neue Arbeit bleibt | — | Sende-Race-Fixture |
| AT-15 Medienparität | Core-Bild/Datei ohne Plugin; nativ erhalten | `chat-file-security`, `chat-ui-upload-attachments` | Paritäts-Suite (Pfad/Preview/Kontext) |
| AT-16 Annotations-Parität | Inhalt/Herkunft/Vorschau/Verhalten erhalten | `web-annotations-*`, Panel-Tests | Anbieter-Paritäts-Test gegen K07 |
| AT-17 Provider fehlt | Fallback/Entfernen/Datenerhalt; kein Autoenable/stilles Senden | — | Degradations-Matrix |
| AT-18 Altlesbarkeit | Alte Anhänge/Nachrichten lesbar; nur kanonisches Modell | Store-Tests (Teil) | Kompat-Leser-Tests |
| AT-19 Servervalidierung | Limits/Schema/Referenzen serverseitig; keine Systemrolle | Normalizer-/Security-Tests (Teil) | Manipulations-Matrix (ID/Session/Ressource) |
| AT-20 Multi-Tab/Logout | Konflikte/Scope explizit; kein Draft-Mix | — | Tab-Konflikt-/Logout-/Korrupt-Tests |
| AT-21 Browser/Fokus | X/Auswahl/Vorschau sichtbar geprüft; Fokus-Restore | A11y-Panel-Tests (Teil) | Headful-Browser-Matrix (Breiten + Fokus) |
| AT-22 Pflichtsuite | Alle Pflichtprüfungen grün; Ablösungen benannt+geprüft | Gesamt-Suite (Pflicht) | Ablösungs-Matrix pro Alt-Test |

Konkrete Kommandos (bestehende Pflichtsuite, unverändert; in D1 nicht ausgeführt):
`npm run typecheck`, `node --test test/<datei>.test.mjs` je Datei,
Gesamtsuite via `scripts/run-test-suite.mjs` (Koordination mit I, isoliertes
HOME/PIBO_HOME, eigene Ports). Neue K07-Fixtures als Contract-Tests am K07-Interface
(keine internen Alttest-Dopplungen ohne Ablösungsnachweis).

## 4. Versionierung / Rollback

- Verträge v0 (diese Runde) → G1 v1 mit Exporten/Beispielen/Tests; danach keine stillen
  Interface-Änderungen (Änderungsanfrage mit scheiterndem Aufrufbeispiel, Owner passt
  Blatt+Code+Tests an, Verbraucher prüfen, I integriert neue Revision).
- K07-Formate versioniert (`formatVersion`, `schemaVersion`); Altentwürfe/Historie lesen
  bzw. bewusst überführen, nie ungefragt löschen; Downgrade beschädigt neue Drafts nicht
  still (Versionierung + ggf. lokale Sicherung).
- Quell-Rollback: getrennt rücknehmbare Zwischenstände (Pilot / K07-fundamental /
  Workflow-Umzüge separat); nach Installation: zusammengehörige vorherige Assembly +
  konsistente Daten-/Payload-Snapshots (V3 §8/I2).

## 5. Echte I0-Voraussetzungen (vor D2)

- G1-Commit (gemeinsamer Stand) + v1-Verträge K01/K04/K05/K07; B-Exporte integriert;
  C-Annotations-Pilot grün gegen D-Pilot.
- Exakte Limits aus bestehendem Verhalten festgeschrieben (D1-13); neue K07-Budgets
  als `NEU` getrennt ausgewiesen.
- Test-Matrix-Baseline grün bzw. Vorfehler benannt; schwere Läufe mit I koordiniert;
  Worktrees/Schreibrechte/Datei-Owner bestätigt.
- Reihenfolge bleibt: ausführbares I0 → A1–D1-Arbeitsstände → G1-Review → B2/C2/D2.
  Diese Analyse inkl. R-D1-Review ersetzt keine dieser Stufen und überspringt sie nicht;
  R-02/R-04/R-06/R-08-Entscheide fallen in I0/G1, nicht in diesem Bericht.

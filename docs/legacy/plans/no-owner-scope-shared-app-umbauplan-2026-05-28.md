# Umbauplan: Pibo ohne Owner Scope

**Status:** Draft  
**Created:** 2026-05-28  
**Source:** User request: allowed accounts only gate access; accounts must not partition data or behavior.

## Ziel

Pibo wird zu einer gemeinsamen App-Instanz. Eine Anmeldung beweist nur, dass eine E-Mail die App nutzen darf. Nach der Anmeldung sehen und bearbeiten alle erlaubten Accounts dieselben Räume, Sessions, Agenten, Workflows, Skills, Cron Jobs, Ralph Jobs, Settings, Provider, Dateien, Projekte und Diagnoseflächen.

`ownerScope` und `principalId` dürfen keine Produktgrenze mehr bilden. Authentifizierte Accounts dürfen nicht mehr bestimmen, welche Daten sichtbar sind, wo Sessions gespeichert werden, welche Profile geladen werden oder welche Jobs steuerbar sind.

## Nicht-Ziele

- Keine Rollen, Teams, Admin-Rechte oder granulare Berechtigungen einführen.
- Keine neue Multi-Tenant-Isolation einführen.
- Keine Sicherheitsprobleme beheben, die nichts mit Owner-/Principal-Trennung zu tun haben, z. B. Path Traversal, arbitrary file download, Gateway-Exposure oder Supply-Chain-Risiken.
- Keine Account-bezogene Audit-History als Produktfunktion einführen. Auth darf höchstens für Login/Logout, erlaubte E-Mail-Liste und technische Auth-Fehler genutzt werden.

## Leitentscheidung

Es gibt genau einen Produktkontext: **shared app**.

Während der Migration darf ein interner Kompatibilitätswert wie `shared:app` existieren, damit alte Stores und APIs schrittweise umgebaut werden können. Dieser Wert darf aber nicht als Nutzeridentität verstanden werden und nicht in UI, API-Verträgen oder Agent-Prompts als `ownerScope` sichtbar bleiben.

## Wichtige Sicherheitsregel während des laufenden Umbaus

Solange der Umbau nicht vollständig implementiert, deployt und verifiziert ist, dürfen keine weiteren produktiven Sessions, Rooms, Navigationseinträge oder Read-State-Datensätze pauschal auf `shared:app` migriert werden.

Begründung: Der aktuelle Live-Code filtert noch teilweise nach User-Owner-Scope. Wenn weitere Arbeits-, Recovery- oder Diagnose-Sessions vorzeitig auf `shared:app` umgestellt werden, können sie in der UI unsichtbar werden und der Zugriff auf die laufende Umbauarbeit geht verloren.

Bis ein kompatibler Zugriffspfad existiert, müssen Migrationen daher:

- zunächst nur als Backup + Dry-run + Konfliktbericht laufen;
- die aktive Umbau-/Recovery-Session erreichbar halten;
- entweder User-Scope- und Shared-Scope-Daten gemeinsam lesbar machen oder erst nach einem kompatiblen Hotfix/Deploy produktiv schreiben;
- reversibel sein und keine pauschalen `UPDATE ... SET owner_scope = 'shared:app'` gegen Live-Daten ausführen.

## Ist-Zustand

Der Code nutzt `ownerScope` und `principalId` als Sicherheits- und Filtergrenzen. Besonders betroffen sind:

- Auth/Web Session: `src/web/auth.ts`, `src/web/types.ts`
- Chat Web Routing: `src/apps/chat/web-app.ts`
- Rooms/Memberships: `src/apps/chat/data/room-service.ts`, `src/apps/chat/types/rooms.ts`, `src/data/schema.ts`
- Sessions: `src/sessions/*`, `src/data/session-store.ts`, `src/core/session-router.ts`
- Custom Agents: `src/apps/chat/agent-store.ts`
- Projects: `src/apps/chat/data/project-service.ts`
- Workflows: `src/apps/chat/workflow-persistence.ts`, `packages/workflows/src/runtime/*`
- Ralph/Cron: `src/ralph/*`, `src/cron/*`
- Web Annotations: `src/web-annotations/*`
- CLI Session UI: `src/cli-session/*`, `src/apps/cli-ui/*`
- Navigation/read state: `src/data/navigation-store.ts`, `principal_*_stats` tables
- Specs/docs: owner-scoped capability specs under `docs/specs/capabilities/`

## Zielverhalten

### Auth

- Auth prüft nur, ob eine erlaubte E-Mail eine gültige Session hat.
- `PiboWebSession` enthält Auth-Informationen für Anzeige und Logout, aber keinen produktrelevanten Owner Scope.
- Routen geben `401` zurück, wenn keine gültige Auth-Session existiert.
- Routen geben nicht `403/404` zurück, nur weil eine Ressource einem anderen Account gehört. Es gibt keine solchen Account-Eigentümer mehr.

### Datenmodell

- Produktdaten sind app-global.
- Neue Datensätze bekommen keinen Account-Owner mehr.
- Bestehende Datensätze aus unterschiedlichen Owner Scopes werden in den gemeinsamen App-Kontext migriert.
- Bestehende Tabellen dürfen Owner-Spalten temporär behalten, solange alle Zugriffe sie ignorieren oder auf den gemeinsamen Wert normalisieren. Die Endphase entfernt oder entwertet diese Spalten.

### Räume und Sessions

- Alle erlaubten Accounts sehen denselben Raumbaum und dieselbe Session-Historie.
- Es gibt keine `room_members`-Berechtigungsprüfung mehr.
- `Personal Chat` wird zu einem gemeinsamen Default-Raum, z. B. `Shared Chat` oder weiterhin `Personal Chat` nur als historischer Anzeigename.
- Session-Erstellung, Fork/Clone, Subagents, Cron und Ralph schreiben in die gemeinsame Historie.

### Custom Agents, Skills, Context Files, MCP, Pi Packages

- Alle Agenten und agentenbezogenen Ressourcen sind gemeinsam.
- Es gibt keine owner-spezifische Profilregistrierung.
- Profilnamen müssen nur global eindeutig bleiben.
- Context Files, Skills, MCP-Server und Pi Packages bleiben globale Ressourcen.

### Jobs und Automatisierung

- Ralph Jobs, Cron Jobs und Yielded Runs sind app-global sichtbar und steuerbar.
- CLI-Kommandos benötigen kein `--owner-scope` mehr.
- Alte `--owner-scope` Optionen werden für eine Übergangszeit akzeptiert, aber ignoriert oder mit Deprecation-Hinweis beantwortet.

### UI

- Die UI zeigt keine Nutzerumschaltung und keine owner-bezogenen Filter.
- Die UI darf die eingeloggte E-Mail nur für Loginstatus/Logout anzeigen.
- Begriffe wie `owner`, `owned`, `principal`, `personal target` verschwinden aus Nutzertexten, API-Dokumentation und Agent-Prompts, außer in Legacy-Migrationshinweisen.

## Phasenplan

### Phase 0: Produktentscheidung absichern

1. Einen kurzen Capability- oder Change-Spec-Entwurf anlegen, der das neue Shared-App-Modell als Produktvertrag festlegt.
2. Glossar aktualisieren:
   - `Owner Scope` als Legacy-Begriff markieren.
   - neuen Begriff einführen, z. B. `Shared App Context`.
3. Security-Findings klassifizieren:
   - Owner-/Cross-User-Findings als `accepted_risk` oder `not_applicable_by_design` markieren, falls das Findings-Schema dafür erweitert wird.
   - Nicht-owner-bezogene Findings unverändert offen lassen.

**Akzeptanz:** Ein Reviewer kann klar unterscheiden: Auth-Gate bleibt, Account-Isolation entfällt.

### Phase 1: Gemeinsame Runtime-Konstanten und Auth-Schnittstelle

1. Eine zentrale Shared-Konstante einführen, nur als Migrationshilfe:
   - `SHARED_APP_SCOPE = "shared:app"`
   - optional `SHARED_PRINCIPAL_ID = "shared:app"`
2. `requireWebSession` so umbauen, dass es keine nutzerbasierte Owner-Scope-Semantik mehr erzeugt.
3. `PiboWebSession` anpassen:
   - `authSession` bleibt.
   - `ownerScope` entfernen oder als deprecated internen Alias auf `SHARED_APP_SCOPE` begrenzen.
4. Agent Runtime Session Context bereinigen:
   - keine nutzerbasierte Owner-Zeile im Runtime-Kontext;
   - falls Kompatibilität nötig ist, nur `Shared app context` ausgeben.

**Akzeptanz:** Zwei erlaubte E-Mails erhalten denselben App-Kontext und keine getrennten Session-Listen.

### Phase 2: Read-Model und Chat Web auf app-globale Listen umstellen

1. `listOwnedSessions`, `requireOwnedSession`, `listOwnedProjects`, `requireOwnedProject`, `requireOwnedAgent` umbenennen und semantisch ändern:
   - `listSessions`, `requireSession`, `listProjects`, `requireProject`, `requireAgent`.
2. Owner-Filter in Chat Web entfernen:
   - Session-Liste;
   - Raum-Liste;
   - Projekt-Liste;
   - Agenten-Liste;
   - Workflow-Katalog;
   - Ralph/Cron-Listen;
   - Diagnose- und Statusflächen.
3. Room-Membership-Prüfungen ersetzen:
   - `requireRoomAccess` wird zu `requireRoomExistsAndMutable` oder entfällt.
   - Archivierte Räume bleiben schreibgeschützt.
4. Read/unread state festlegen:
   - entweder app-globaler Read-State;
   - oder rein browserlokaler Zustand, wenn Account keine Funktion haben soll.

**Akzeptanz:** Eine Session, die Account A erstellt, erscheint nach Login mit Account B in derselben Raum-/Sessionliste.

### Phase 3: Stores und APIs vereinfachen

1. Store-Methoden umstellen:
   - optionale `ownerScope` Filter entfernen;
   - `getOwned*` Methoden entfernen oder zu `get*` migrieren;
   - `create*` Inputs ohne `ownerScope` anbieten.
2. CLI-Kommandos anpassen:
   - `pibo ralph`, `pibo cron`, `pibo data repair`, Session UI und Debug-Kommandos ohne Owner-Scope-Zwang.
   - Alte Optionen zunächst akzeptieren, aber ignorieren.
3. API-Verträge bereinigen:
   - Request/Response-Felder mit `ownerScope`, `principalId`, `member`, `role` entfernen oder als deprecated markieren.
4. Tests auf app-globale Sichtbarkeit umstellen.

**Akzeptanz:** Neue Codepfade brauchen keinen Owner Scope, um Ressourcen zu erstellen, zu listen, zu lesen, zu ändern oder zu löschen.

### Phase 4: Datenmigration

1. Migrations-Gate für Live-Daten:
   - vor jeder produktiven Mutation ein Backup erstellen;
   - zuerst Dry-run mit Zählungen, betroffenen IDs und Konfliktbericht ausgeben;
   - keine weiteren produktiven Sessions/Rooms/Navigationseinträge auf `shared:app` umstellen, solange der Live-Zugriffspfad nicht beide Sichten lesen kann;
   - aktive Arbeits-, Umbau-, Diagnose- und Recovery-Sessions ausdrücklich vor Unsichtbarkeit schützen.
2. Migration für `pibo.sqlite` erst nach bestandenem Gate:
   - `sessions.owner_scope` auf gemeinsamen Wert normalisieren, solange Spalte existiert;
   - `rooms.owner_scope` normalisieren;
   - `room_members` ignorieren, zusammenführen oder entfernen;
   - `session_navigation.owner_scope` normalisieren oder durch app-globale Navigation ersetzen;
   - `principal_session_stats` und `principal_room_stats` konfliktfrei in app-globale Stats überführen oder entfernen.
3. Migration für separate Stores:
   - `pibo-ralph.sqlite`: Jobs, Runs, Facts normalisieren.
   - Cron Store normalisieren.
   - Custom Agent Store normalisieren.
   - Workflow Stores normalisieren.
   - Web Annotation Stores normalisieren.
4. Konflikte behandeln:
   - doppelte Default-Räume zusammenführen;
   - doppelte Custom-Agent-Profilnamen eindeutig machen oder bestehende globale Eindeutigkeit nutzen;
   - doppelte Navigation/Read-State-Einträge nach aktuellstem Stand zusammenführen;
   - doppelte `principal_*_stats`-Primärschlüssel vor der Normalisierung mergen, nicht durch blindes Update kollidieren lassen.
5. Migration idempotent und rollback-fähig machen.

**Akzeptanz:** Ein bestehender Host mit mehreren früheren Owner Scopes startet nach Migration mit einer gemeinsamen Historie ohne Datenverlust.

### Phase 5: Schema- und Typ-Bereinigung

1. `owner_scope`, `principal_id`, `room_members` und owner-bezogene Indizes aus neuen Schemas entfernen, wo möglich.
2. TypeScript-Typen bereinigen:
   - `ownerScope` aus Produktmodellen entfernen;
   - `principalId` nur dort behalten, wo es technisch keine Auth-Identität beschreibt;
   - `PiboRalphTarget.personal` entfernen oder zu app-globalem Ziel vereinfachen.
3. Tests und Fixtures aktualisieren.
4. Specs aktualisieren, besonders:
   - `web-auth-and-same-origin-host.md`
   - `chat-web-rooms-and-event-streams.md`
   - `pibo-session-routing.md`
   - `pibo-session-store.md`
   - `custom-agents.md`
   - `continuous-ralph-jobs.md`
   - `scheduled-pibo-jobs.md`
   - `local-store-ownership-and-canonical-data-boundaries.md`

**Akzeptanz:** `rg "ownerScope|owner_scope|principalId|principal_id|room_members|requireRoomAccess|getOwned|listOwned" src packages` findet keine aktiven Produktgrenzen mehr; verbleibende Treffer sind Migration, Legacy-Kompatibilität oder Tests mit klarer Markierung.

### Phase 6: Security-Findings und Dokumentation nachziehen

1. Findings schließen oder umklassifizieren, die nur Cross-Owner-Isolation betreffen.
2. Findings offen lassen, die trotz Shared-App-Modell relevant bleiben:
   - arbitrary filesystem access;
   - path traversal;
   - unauthenticated gateway exposure;
   - dev-auth exposure;
   - supply-chain execution;
   - local file permissions;
   - CSRF/clickjacking;
   - DoS;
   - terminal/control-character injection.
3. Operator-Dokumentation aktualisieren:
   - Pibo ist eine shared app für eine vertraute Benutzergruppe.
   - Erlaubte E-Mails sind eine Zugangsliste, keine Mandanten.
   - Wer Zugriff hat, hat Zugriff auf die ganze App-Instanz.

**Akzeptanz:** Docs und Findings sagen nicht mehr, dass Pibo mehrere Nutzer voneinander isoliert.

## Umsetzungsschnitt nach Modulen

### Auth / Web

- `src/web/auth.ts`: aus `user:<id>` keine Produktidentität mehr ableiten.
- `src/web/types.ts`: `PiboWebSession.ownerScope` entfernen oder deprecaten.
- `src/auth/better-auth.ts`: Allowed-Email-Check bleibt.
- UI: E-Mail nur für Sign-in-Status anzeigen.

### Chat Web

- `src/apps/chat/web-app.ts`: alle `Owned`-Hilfsfunktionen ersetzen.
- `src/apps/chat/data/room-service.ts`: Membership entfernen oder ignorieren.
- `src/apps/chat/types/rooms.ts`: Rollen/Memberships aus Zielmodell entfernen.
- `src/apps/chat/data/project-service.ts`: owner-spezifische Filter entfernen.
- `src/apps/chat/agent-store.ts`: owner-spezifische Listen/Checks entfernen.

### Sessions / Router / Runtime

- `src/sessions/*`: ownerScope aus Create/List/Update-Verträgen entfernen.
- `src/core/session-router.ts`: keine ownerbasierte Session-Auflösung mehr.
- `src/core/runtime.ts`: Runtime-Kontext nicht mehr als Nutzer-/Owner-Kontext formulieren.
- Subagents/Yielded Runs behalten Session-Beziehungen, aber keine Owner-Grenzen.

### Ralph / Cron

- `src/ralph/cli.ts`, `src/cron/cli.ts`: `--owner-scope` nicht mehr verlangen.
- Stores: Listen/Updates nach Job-ID statt Owner+Job-ID.
- APIs: Ziel `room` bleibt; `personal` entfällt.

### Workflows

- `packages/workflows/src/runtime/pibo-routing.ts`: `routing.ownerScope` entfernen.
- Workflow Run Owner durch App-Kontext ersetzen.
- Prompt-/Asset-Stores app-global machen.

### CLI Session UI

- Owner-Picker und ownerbezogene Filter entfernen.
- Default-Ansicht zeigt die gemeinsame Historie.

## Testplan

### Unit / Store

- Migration normalisiert mehrere Owner Scopes in einen gemeinsamen App-Kontext.
- Listenmethoden geben gemischte Legacy-Daten gemeinsam zurück.
- `getOwned*`-Nachfolger blockieren keine Ressourcen wegen altem Owner.

### API / Integration

- Account A erstellt Raum, Session, Agent, Workflow, Ralph Job.
- Account B sieht und bearbeitet dieselben Ressourcen.
- Logout/Login mit anderer erlaubter E-Mail ändert keine Ressourcenliste.
- Nicht erlaubte E-Mail bleibt geblockt.

### CLI

- `pibo ralph list`, `pibo ralph runs`, `pibo cron list`, Session UI und relevante Debug-Befehle funktionieren ohne `--owner-scope`.
- Alte `--owner-scope` Flags brechen Skripte nicht sofort, haben aber keine Filterwirkung.

### Browser

- Chat Web Bootstrap zeigt gemeinsame Räume/Sessions.
- Agent Designer zeigt gemeinsame Custom Agents.
- Settings zeigen gemeinsame Provider/Modelle.
- Ralph/Cron UI zeigt gemeinsame Jobs.

### Migration

- Vorher: Testdaten mit zwei Owner Scopes.
- Nachher: eine gemeinsame Raum-/Session-/Agenten-/Job-Sicht.
- Keine verlorenen Sessions, Nachrichten, Payloads, Agenten, Jobs oder Workflow-Drafts.

## Risiken

- **Großer Umbau:** `ownerScope` ist tief im Code verankert. Der Umbau sollte in Phasen mit Kompatibilitätsalias erfolgen.
- **Datenmigration:** Default-Räume, Read-State und Agent-Profilnamen können kollidieren.
- **Vorzeitige Live-Migration:** Wenn Live-Daten vor dem kompatiblen Codepfad pauschal auf `shared:app` gesetzt werden, können Arbeits- und Recovery-Sessions unsichtbar werden. Deshalb gilt bis zum Abschluss: keine weiteren pauschalen Live-Normalisierungen ohne Backup, Dry-run, Konfliktbericht und Zugriffspfad, der User- und Shared-Scope gemeinsam liest.
- **Sicherheitswahrnehmung:** Entfernte Isolation muss klar dokumentiert werden. Pibo ist danach keine Multi-User-Isolation mehr.
- **Tests:** Viele bestehende Tests prüfen Owner-Filter. Sie müssen auf Shared-App-Verhalten umgestellt werden, nicht gelöscht werden.
- **API-Kompatibilität:** Externe Skripte könnten `--owner-scope` oder ownerbezogene API-Felder nutzen.

## Empfohlene Reihenfolge für Implementierung

1. Spec/Docs für Shared-App-Modell erstellen.
2. Shared-Konstante und Auth-WebSession-Umbau vorbereiten.
3. Chat Web Listen/Require-Helfer umstellen.
4. Sessions, Rooms und Projects migrieren.
5. Agenten, Workflows, Ralph und Cron umstellen.
6. CLI und UI-Texte bereinigen.
7. Datenmigration finalisieren.
8. Owner-Spalten und Legacy-Typen entfernen.
9. Security-Findings neu klassifizieren.

## Erfolgskriterien

- Eine erlaubte E-Mail dient nur als Zugangskontrolle.
- Alle erlaubten Accounts sehen dieselbe App-Historie und dieselben Ressourcen.
- Kein produktiver Zugriffspfad filtert oder blockiert anhand eines Account-Owners.
- Neue Ressourcen tragen keine nutzerbezogene Eigentümersemantik.
- Alte Daten bleiben nach Migration sichtbar.
- Dokumentation beschreibt Pibo als shared app, nicht als Multi-Tenant-App.

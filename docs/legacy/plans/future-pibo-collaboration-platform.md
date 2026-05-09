# Zukunftsplan: Pibo Collaboration Platform

## Zielbild

Nach dem Umbau auf Rooms, Membership, Durable Event Log, Cursor-Sync, Idempotency und Retention kann Pibo Chat zu einer breiteren Collaboration Platform werden: Menschen, Agenten, Subagenten, Runs, Artefakte und Entscheidungen arbeiten in gemeinsamen Rooms mit verlaesslicher Historie, klaren Rechten und nachvollziehbarer Ausfuehrung.

Dieser Plan ist bewusst grober als `plans/implement-pibo-chat-rooms-event-log.md`. Er beschreibt die naechsten Architekturachsen, nicht die direkte Implementierungsreihenfolge fuer den ersten Umbau.

## Voraussetzung

Der erste Umbauplan ist weitgehend umgesetzt:

- Durable Chat Event Log mit monotonen `streamId`s.
- SSE Reconnect-Catch-up ueber `Last-Event-ID` oder `?since=`.
- Idempotente Message Sends ueber `clientTxnId`.
- Minimal Room und Membership Store.
- Room APIs und UI-Migration.
- Retention Policy und Purge Job.
- Zentralisierte Room Authorization.

## Leitprinzipien

- Pibo bleibt kein Matrix-Clone. Matrix/Synapse bleibt Inspirationsquelle fuer robuste Chat- und Sync-Konzepte.
- Agent-Ausfuehrung bleibt Pibo/Pi-owned, nicht Transport-owned.
- Jeder neue Transport muss auf demselben durable Event Log und denselben Auth-Regeln laufen.
- Human Collaboration und Agent Execution duerfen nicht vermischt werden: Rooms organisieren Arbeit, Sessions fuehren Agenten aus.
- Compliance, Audit und Retention werden als Produktfaehigkeiten behandelt, nicht als nachtraegliche Datenbank-Cronjobs.

## Horizon 1: Multi-Room Collaboration

1. Room UX ausbauen.
   - Spaces mit nested Rooms.
   - Pinned Rooms.
   - Unread Counts pro Room.
   - Mentions und Assignment-ähnliche Signale.
   - Room Topic, Purpose und sichtbare aktive Agent Profile.

2. Multi-session Rooms.
   - Ein Room kann mehrere Pibo Sessions enthalten.
   - Sessions koennen nach Aufgabe, Agent Profile, Branch/Fork oder Zeitpunkt gruppiert werden.
   - UI zeigt nicht nur eine Session-Liste, sondern einen Room Activity Stream plus auswaehlbare Agent Runs.

3. Read State und Notifications.
   - `lastReadStreamId` pro User/Room.
   - Read Receipts fuer menschliche User.
   - Optional Agent Read/Acknowledged Events, wenn ein Agent Room Context verarbeitet hat.
   - Notification Rules: mentions, failed runs, completed long-running runs, human handoff needed.

4. Room Search.
   - Volltextsuche ueber Chat Messages, final agent outputs, tool summaries und titles.
   - Filter nach Room, Agent Profile, User, Date Range, Status, Tool, Run ID.
   - Raw token deltas bleiben aus der normalen Suche ausgeschlossen.

## Horizon 2: Agent-Aware Room Semantics

1. Agent Roles im Room.
   - Ein Agent kann Room Member sein, aber mit anderem Principal-Typ als User.
   - Rollen: observer, responder, maintainer, reviewer, automation.
   - Explizite Berechtigung, ob ein Agent Messages senden, Tools ausfuehren oder Subagents starten darf.

2. Room Context Policy.
   - Pro Room definieren, welche Historie Agenten lesen duerfen.
   - Max Context Window, Retention Class, pinned context, excluded event types.
   - Safety Boundary: Private Human Messages duerfen nicht automatisch in Agent Prompts wandern, wenn das nicht erlaubt ist.

3. Agent Handoffs.
   - Formaler Handoff Event Type: von User zu Agent, Agent zu Agent, Agent zu User.
   - Handoff enthaelt Aufgabe, Constraints, relevante Events und erwartete Completion Criteria.
   - UI zeigt Handoff-Kette als nachvollziehbaren Arbeitsverlauf.

4. Decision Records.
   - Room Events fuer Entscheidungen, Approvals und Rejections.
   - Agenten koennen Vorschlaege machen, Menschen bestaetigen.
   - Spaeter fuer Audit, Compliance und Projekthistorie nutzbar.

## Horizon 3: Transport Evolution

1. WebSocket als optionaler Transport.
   - Nur einfuehren, wenn mehrere gleichzeitige Subscriptions, bidirektionale Presence/Typing/Read Receipts oder geringere Latenz es rechtfertigen.
   - WebSocket nutzt dasselbe Event Log, dieselben Cursor und dieselbe Room Authorization wie SSE.
   - Client kann mehrere Rooms/Sessions ueber eine Verbindung abonnieren.

2. Transport-Abstraktion.
   - Gemeinsames Interface fuer SSE, WebSocket und zukuenftige lokale/remote Clients.
   - Operationen:
     - subscribe room/session since cursor
     - replay backlog
     - publish client event
     - ack/read cursor
     - close/unsubscribe
   - Kein Transport darf eigene Persistenzregeln besitzen.

3. Offline-first Client Cache.
   - Browser speichert letzten Stream Cursor pro Room.
   - Bei Reload/offline/online wird zuerst lokaler Cache gezeigt, dann Server-Catch-up.
   - Konflikte werden ueber `clientTxnId` und serverseitige Stream-Order geloest.

4. Mobile und Desktop Readiness.
   - Push-taugliche Event-Klassen.
   - Kleine sync windows.
   - Backpressure bei vielen Rooms.
   - Low-bandwidth Mode: keine live token deltas, nur final messages und status events.

## Horizon 4: Governance, Compliance Und Safety

1. Retention Governance.
   - Org-/Workspace-defaults.
   - Room Overrides nur fuer berechtigte Rollen.
   - Legal Hold oder Protected Rooms, in denen Purge anders funktioniert.
   - Exportierbare Retention Reports.

2. Audit Log.
   - Separater Audit Event Stream fuer Security-relevante Aenderungen:
     - Membership changes.
     - Role changes.
     - Retention changes.
     - Agent permission changes.
     - Tool permission changes.
   - Audit Events duerfen nicht wie normale Chat Messages geloescht werden.

3. Moderation und Redaction.
   - Soft delete fuer normale UI.
   - Redaction fuer Payload-Inhalte, wenn rechtlich oder sicherheitlich noetig.
   - Redaction muss Trace-Rekonstruktion degraded, aber nicht kaputt machen.
   - Agenten duerfen redacted content nicht erneut in Prompts bekommen.

4. Policy Engine.
   - Room-/Workspace-Regeln fuer:
     - Welche Agenten duerfen laufen?
     - Welche Tools duerfen laufen?
     - Welche Daten duerfen in Agent Context?
     - Welche Events duerfen exportiert werden?
   - Erst einfache statische Policies, spaeter pluginfaehig.

## Horizon 5: Scale Und Operations

1. Storage Scaling.
   - SQLite bleibt fuer lokale/persoenliche Deployments gut.
   - Fuer Team-/Serverbetrieb braucht es eine Postgres-Option oder eine klare Datenbank-Adaptergrenze.
   - Event Log Schema muss monotone Cursor und effiziente Room-Queries auch in Postgres behalten.

2. Stream Partitioning.
   - Ein globaler `streamId` ist einfach.
   - Bei groesserem Betrieb koennen Room-partitionierte Streams oder writer-aware Cursor noetig werden.
   - Matrix/Synapse zeigt, dass Multi-writer Cursor frueh konzeptionell sauber gedacht werden sollten, auch wenn V1 single-writer bleibt.

3. Backpressure.
   - Live token deltas duerfen langsame Clients nicht unbegrenzt puffern.
   - Server sollte alte live deltas zusammenfassen koennen.
   - Clients koennen auf final-only Mode herabgestuft werden.

4. Observability.
   - Metriken fuer:
     - append latency
     - replay size
     - stream lag
     - reconnect count
     - duplicate txn hits
     - purge duration
     - room authorization denials
     - agent run latency per room
   - Operator CLI soll diese Metriken progressiv entdecken lassen.

## Horizon 6: External Integrations

1. Export/Import.
   - Room export als strukturierte JSONL oder SQLite bundle.
   - Export kann raw trace details optional enthalten.
   - Import darf Stream IDs neu mappen, muss aber event identity erhalten.

2. Bridge Surfaces.
   - Slack/Discord/Matrix Bridges nur als Channels/Adapters, nicht als Kernmodell.
   - Externe Messages werden zu Pibo Room Events normalisiert.
   - Agent Runs bleiben Pibo-owned.

3. Optional Matrix Bridge.
   - Matrix Room <-> Pibo Room mapping.
   - Matrix Events fuer human messages und final agent messages.
   - Pibo interne token deltas bleiben ausserhalb von Matrix oder werden stark komprimiert.
   - Keine Federation-Abhaengigkeit im Pibo Kern.

4. Plugin-facing Room APIs.
   - Plugins koennen Room Events lesen/schreiben, wenn Policies es erlauben.
   - Plugins bekommen keine direkte Datenbankmacht.
   - Alle Plugin-Aktionen gehen ueber dieselbe Authorization und Audit-Schicht.

## Strategische Reihenfolge

1. Rooms wirklich produktiv machen: unread, search, read state, room activity stream.
2. Agent Semantics sauber modellieren: roles, context policy, handoffs, decision records.
3. WebSocket und Offline Cache nur auf der stabilen Event-Log-Schicht bauen.
4. Governance und Audit vor Team-/Org-Nutzung ernsthaft ausbauen.
5. Storage Adapter und Scale erst einfuehren, wenn lokale SQLite-Grenzen praktisch sichtbar werden.
6. Externe Bridges spaet, nachdem das interne Room/Event-Modell stabil ist.

## Offene Architekturfragen

- Wird `PiboRoom` langfristig im Chat-App-Modul bleiben oder Teil eines allgemeineren Collaboration-Kerns?
- Soll es einen globalen Stream fuer alle Rooms geben oder pro Room einen Stream plus globales Ordering?
- Wie stark sollen Agent Principals wie User Principals behandelt werden?
- Welche Events sind canonical Chat History, welche nur Trace/Debug/Audit?
- Welche Retention-Klassen duerfen User konfigurieren, welche nur Admins?
- Brauchen Team-Deployments Multi-tenant Isolation oberhalb von `ownerScope`?
- Ab wann ist Postgres Pflicht statt optional?

## Nicht-Ziele Dieses Zukunftsplans

- Sofortige Umsetzung.
- Matrix-Protokollkompatibilitaet.
- Federation.
- E2E-Verschluesselung.
- Vollstaendige Enterprise-Governance in einem Schritt.
- WebSocket als Ersatz fuer die durable Sync-Schicht.

# Umbauplan: Pibo Chat Rooms Und Durable Event Log

## Ziel

Pibo Chat soll von einer session-zentrierten Live-UI zu einem robusten Chat-System mit Rooms, langlebiger Event-Historie, Cursor-Sync, Retry-Sicherheit und Retention ausgebaut werden.

Der Umbau orientiert sich an bewaehrten Matrix/Synapse-Konzepten, ohne Matrix als Server oder Protokoll direkt in den Kernpfad zu uebernehmen. Pibo behaelt seine Product Boundary: Pi Coding Agent bleibt fuer Agent-Ausfuehrung und Pi Sessions verantwortlich; Pibo besitzt Rooms, Membership, Chat Event Log, Retention, Web APIs und Transports.

## Entscheidung

WebSockets sind nicht der erste Schritt.

Der aktuelle Chat Web SSE Stream kann fuer Live-Deltas bleiben. Die Robustheit entsteht zuerst durch ein persistentes Event Log mit monotonen Stream-IDs, idempotenten Sends, Reconnect-Catch-up und Retention. WebSocket wird erst danach als optionaler Transport ueber derselben Event-Log- und Sync-Schicht sinnvoll.

## Betroffene Bereiche

- `src/apps/chat/read-model.ts`
- `src/apps/chat/stream.ts`
- `src/apps/chat/trace.ts`
- `src/apps/chat/web-app.ts`
- `src/apps/chat-ui/src/App.tsx`
- `src/sessions/store.ts`
- neue Chat-Room- und Event-Log-Module unter `src/apps/chat/`
- Tests in `test/chat-trace.test.mjs`, `test/web-channel.test.mjs` und neuen Chat-Room/Event-Log-Tests

## Annahmen

- Die Chat Web App bleibt same-origin und nutzt die bestehende Pibo Auth Boundary.
- Pibo Sessions bleiben die Runtime-/Agent-Konversationen.
- Pibo Rooms werden die user-facing Chat-Container, an denen eine oder mehrere Pibo Sessions haengen koennen.
- Token-Deltas bleiben fuer Live-UX wichtig, muessen aber nicht dauerhaft als normale Chat-Historie behandelt werden.
- Pi JSONL bleibt canonical fuer Pi Transcript-Details.
- Das Chat Event Log wird Pibo-owned und darf aus Pibo Output Events, User Inputs und UI-/Room-Aktionen bestehen.
- Federation ist nicht Teil dieses Plans.
- Matrix-Spaces werden als Inspiration fuer Room-Hierarchie genutzt, nicht als direktes Datenmodell.

## Erfolgskriterien

- Jeder persistente Chat Event hat eine monotone `streamId`.
- SSE sendet fuer persistente Frames einen framegenauen Cursor `id: <streamId>:<frameIndex>` und kann verpasste Frames via `Last-Event-ID` oder `?since=` nachliefern.
- `POST /api/chat/message` ist idempotent ueber `clientTxnId`.
- Es gibt ein minimales Room-Modell mit Name, Topic, Type, Parent/Space und Retention Policy.
- Es gibt ein Membership-Modell mit User, Role und Read Cursor.
- Pibo Sessions koennen einem Room zugeordnet werden.
- Die Chat Web App kann Room-Liste, Room-Details, Session-Liste und Trace-Ansicht aus dem neuen Modell laden.
- Retention kann raw token deltas anders behandeln als finale Chat-/Trace-Events.
- Bestehende Session-/Trace-Funktionalitaet bleibt waehrend der Migration nutzbar.
- `npm run typecheck` und relevante Tests bleiben gruen.

## Phase 1: Durable Chat Event Log

1. Neues Event-Log-Modul einfuehren.
   - Vorschlag: `src/apps/chat/event-log.ts`.
   - Public Interface:
     - `appendEvent(input): StoredChatEvent`
     - `listEvents(input: { roomId?: string; piboSessionId?: string; afterStreamId?: number; limit?: number }): StoredChatEvent[]`
     - `getEvent(streamId): StoredChatEvent | undefined`
   - Verify: Unit Tests fuer Append, monotone IDs, Query nach `afterStreamId`, Query nach Room/Session.

2. Schema fuer `chat_events` definieren.
   - `stream_id INTEGER PRIMARY KEY`
   - `room_id TEXT`
   - `pibo_session_id TEXT`
   - `event_id TEXT`
   - `event_type TEXT NOT NULL`
   - `actor_type TEXT`
   - `actor_id TEXT`
   - `client_txn_id TEXT`
   - `created_at TEXT NOT NULL`
   - `retention_class TEXT NOT NULL`
   - `payload_json TEXT NOT NULL`
   - Indizes:
     - `(room_id, stream_id)`
     - `(pibo_session_id, stream_id)`
     - `(event_id)`
     - `(room_id, actor_id, client_txn_id)` unique where `client_txn_id IS NOT NULL`
   - Verify: Migration/initialization test gegen `:memory:` und Dateipfad.

3. Bestehendes `web_chat_events` nicht sofort ersetzen.
   - Zunaechst parallel schreiben oder Adapter bauen.
   - Bestehende Trace-Rekonstruktion darf weiter funktionieren.
   - Verify: Alte `/trace` API bleibt kompatibel.

## Phase 2: Minimal Default-Room Und Session-Zuordnung

1. Default-Room pro Owner einfuehren.
   - Vor idempotenten Sends braucht jeder Chat-Send einen Room-Kontext.
   - Bestehende session-zentrierte Aufrufe bekommen automatisch einen persoenlichen Default-Room.
   - Neue Sessions werden ueber `metadata.chatRoomId` an diesen Room gehaengt.
   - Verify: Bootstrap und Message-POST funktionieren ohne expliziten `roomId` weiter.

2. Room Store und Membership Store einfuehren.
   - Vorschlag: `src/apps/chat/rooms.ts`.
   - `PiboRoom`:
     - `id`
     - `ownerScope`
     - `name`
     - `topic`
     - `type`: `space | chat | agent`
     - `parentRoomId`
     - `createdAt`
     - `updatedAt`
     - `retentionPolicyId`
     - `metadata`
   - `PiboRoomMember`:
     - `roomId`
     - `principalId`
     - `role`: `owner | admin | member | viewer`
     - `joinedAt`
     - `lastReadStreamId`
   - Verify: CRUD tests fuer Rooms, Membership und Read Cursor.

3. Session-Zuordnung als Migrationsbruecke.
   - Empfehlung bleibt `metadata.chatRoomId`, kein neues `PiboSession`-Top-Level-Feld in diesem Schritt.
   - Verify: neue Sessions werden im aktiven Room erstellt, alte Sessions bleiben sichtbar.

## Phase 3: SSE Cursor Und Reconnect-Catch-up

1. SSE Frames mit durablem Cursor versehen.
   - Ein gespeichertes Chat Event kann mehrere UI-Frames erzeugen.
   - `writeSse(...)` ergaenzt daher `id: <streamId>:<frameIndex>`, wenn der Frame aus einem gespeicherten Chat Event stammt.
   - Non-durable reine Keepalive/Ready Frames bekommen kein `id`.
   - Verify: SSE-Test prueft `id:` Ausgabe.

2. `/api/chat/events` um Catch-up erweitern.
   - Input:
     - `Last-Event-ID` Header
     - optional `?since=<streamId>` oder `?since=<streamId>:<frameIndex>`
   - Verhalten:
     - erst gespeicherte Events und Frames nach dem Cursor liefern
     - danach live subscriben
   - Verify: Integration Test verbindet mit `since`, bekommt verpasste Events in Reihenfolge und dann Live-Events.

3. Heartbeat einbauen.
   - Periodisch SSE Comment oder leichtgewichtiger Ping, damit Proxies/Browser stale Connections erkennen.
   - Verify: Test oder strukturierte Code-Abdeckung fuer Timer-Cleanup bei Cancel.

4. Stream-State pro Connection begrenzen.
   - `createChatStreamState()` bleibt Connection-lokal.
   - Bei Catch-up muss die Start-/End-Frame-Erzeugung aus gespeicherten Events deterministisch bleiben.
   - Verify: Reconnect mitten in Assistant-Streaming erzeugt keine doppelt kaputte UI-Struktur.

## Phase 4: Idempotente Message Sends

1. `POST /api/chat/message` akzeptiert `clientTxnId`.
   - Client muss fuer jede User Message eine stabile ID erzeugen.
   - Server nutzt `(roomId, actorId, clientTxnId)` als Idempotency-Key.
   - Bei Wiederholung wird die bereits erzeugte Antwort/Message-Referenz zurueckgegeben.
   - Verify: Zwei identische POSTs mit gleichem `clientTxnId` starten nur eine Agent-Ausfuehrung.

2. Input Event und Chat Event verbinden.
   - Persistiere zuerst `user.message.accepted`.
   - Danach emit an Session Router.
   - Bei Router-Fehler persistiere `user.message.failed` oder `run.error`.
   - Verify: Fehlerpfad laesst Client nicht im unklaren Zustand.

3. UI Retry-freundlich machen.
   - Composer generiert `clientTxnId`.
   - Pending Message bleibt sichtbar, bis Server acked.
   - Bei Netzwerkfehler kann derselbe Payload retryt werden.
   - Verify: Browser-/Component-Test fuer Retry ohne Doppelmessage.

## Phase 5: Room APIs Und UI-Migration

1. APIs ergaenzen.
   - `GET /api/chat/rooms`
   - `POST /api/chat/rooms`
   - `GET /api/chat/rooms/:roomId`
   - `PATCH /api/chat/rooms/:roomId`
   - `GET /api/chat/rooms/:roomId/events?since=...`
   - `POST /api/chat/rooms/:roomId/messages`
   - Verify: Auth- und Ownership-Tests.

2. Bootstrap erweitern.
   - Liefert Room Tree, selected Room und selected Session.
   - Bestehende Session-Liste bleibt als Rueckfall.
   - Verify: alter Client kann waehrend Migration weiter laden oder API-Version wird explizit getrennt.

3. Sidebar schrittweise umstellen.
   - Erst Rooms/Spaces anzeigen.
   - Darunter Sessions/Subsessions anzeigen.
   - Aktuelle Session-Navigation bleibt erhalten.
   - Verify: bestehende Subsession Sidebar Tests/Flows bleiben korrekt.

4. Topic und Room-Settings minimal anzeigen.
   - Name und Topic editierbar fuer Owner/Admin.
   - Keine komplexen Rollen-Settings in V1 UI.
   - Verify: PATCH validiert Laenge und Ownership.

## Phase 6: Retention Und Purge

1. Retention-Klassen definieren.
   - `live_delta`: kurzlebig, z.B. 1-7 Tage.
   - `trace_event`: mittlere Dauer oder room-policy.
   - `chat_message`: room-policy oder dauerhaft.
   - `audit_event`: laenger, falls benoetigt.
   - Verify: Event Append setzt korrekte Klasse.

2. Retention Policy Store.
   - Global default.
   - Optional pro Room Override.
   - Felder:
     - `deleteLiveDeltasAfterMs`
     - `deleteTraceEventsAfterMs`
     - `deleteChatMessagesAfterMs`
   - Verify: Policy-Aufloesung mit Room Override.

3. Background Purge Job.
   - Loescht alte Events in kleinen Batches.
   - Respektiert `retention_class`.
   - Darf Pi JSONL nicht loeschen.
   - Verify: Testdaten mit gemischten Klassen werden korrekt bereinigt.

4. Trace-Rekonstruktion nach Purge absichern.
   - Wenn live deltas fehlen, final messages/tool results muessen weiterhin reichen.
   - UI zeigt bei fehlender Detailhistorie einen sauberen degraded state.
   - Verify: Trace aus gepurgten Deltas bleibt lesbar.

## Phase 7: Security Und Reliability Hardening

1. Autorisierung zentralisieren.
   - Helper: `requireRoomAccess(roomId, action)`.
   - Alle Room/Event/Message APIs nutzen denselben Pfad.
   - Verify: Tests fuer fremde Rooms, archivierte Rooms, Viewer vs Member.

2. Rate Limits fuer Message Sends und Room Mutations.
   - Pro User/Room einfache Token Bucket oder vorhandene Boundary nutzen.
   - Verify: Missbrauch erzeugt 429 ohne Agent-Ausfuehrung.

3. Request-Groessen und Payload-Validierung.
   - Bestehende Body-Grenze bleibt.
   - Event Payloads muessen JSON-serialisierbar und typisiert sein.
   - Verify: Invalid Payload Tests.

4. Observability.
   - Metriken/Logs fuer append latency, catch-up count, dropped connections, purge count, duplicate txn hits.
   - Verify: lokale Logs oder strukturierte counters in Tests/Dev.

## Phase 8: Optional WebSocket Transport

1. Erst nach Phase 1-7 entscheiden.
   - WebSocket wird nur Transport, nicht neue Source of Truth.
   - Gleiche Event-Log-Cursor und gleiche Authorization wie SSE.

2. Einsatzkriterien.
   - Mehrere Rooms gleichzeitig live.
   - Bidirektionale Control Events wie typing/presence/read receipts.
   - Weniger HTTP-Verbindungen oder besseres Multiplexing noetig.

3. Interface.
   - Client sendet `subscribe room/session since`.
   - Server replayt aus Event Log und schaltet dann auf Live.
   - Client kann read receipts / presence senden.
   - Verify: WebSocket reconnect nutzt denselben Cursor wie SSE.

## Risiken

- Zu fruehe WebSocket-Einfuehrung wuerde die eigentlichen Reliability-Probleme nur verlagern.
- Jeden Token dauerhaft als normales Chat Event zu speichern kann die DB schnell aufblasen.
- Room-Konzept darf Pibo Sessions nicht ersetzen; Sessions bleiben Runtime-Einheiten.
- Idempotency muss vor automatischen Client-Retries kommen, sonst entstehen doppelte Agent-Runs.
- Retention darf nicht versehentlich Pi-owned JSONL oder Pibo Session Store loeschen.

## Empfohlene Umsetzungsreihenfolge

1. Durable Chat Event Log mit `streamId`.
2. SSE `id:` plus `Last-Event-ID` / `since` Catch-up.
3. Idempotente Message Sends mit `clientTxnId`.
4. Minimal Room und Membership Store.
5. Room APIs und UI-Migration.
6. Retention Policy und Purge Job.
7. Security/Rate-Limit/Observability Hardening.
8. Optional WebSocket als zweiter Transport.

## Nicht-Ziele Fuer V1

- Matrix Federation.
- Ende-zu-Ende-Verschluesselung nach Matrix-Art.
- Vollstaendige Matrix State Resolution.
- Multi-Server Rooms.
- Push Notification Infrastruktur.
- Vollstaendige Rollen-/Moderations-UI.
- WebSocket als Voraussetzung fuer den ersten robusten Chat-Room-Release.

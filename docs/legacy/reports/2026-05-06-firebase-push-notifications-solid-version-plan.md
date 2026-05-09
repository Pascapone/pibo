# Firebase Push Notifications – Implementierungsplan „Solide Version“

Datum: 2026-05-06

## Ziel

Pibo Chat soll Firebase Push Notifications für abgeschlossene Assistant-Antworten senden, wenn diese nach der bestehenden Read-/Unread-Semantik wirklich ungelesen sind.

Push Notifications sind kein zweites Notification-System. Sie sind ein Delivery-Adapter für das bestehende System aus `chat_events`, `chat_session_reads`, aktiven SSE-Streams und `unreadCount`.

## Aktueller Stand

Relevante Dateien:

- `src/apps/chat/event-log.ts`
- `src/apps/chat/web-app.ts`
- `src/apps/chat/trace.ts`
- `src/apps/chat/rooms.ts`
- `src/apps/chat-ui/src/App.tsx`
- `src/apps/chat-ui/src/api.ts`
- `src/apps/chat-ui/src/types.ts`
- `src/apps/chat-ui/public/sw.js`
- `src/apps/chat-ui/public/manifest.webmanifest`
- `test/web-channel.test.mjs`

Aktuelle Semantik:

- `chat_events` speichert Chat-Events mit monotonem `stream_id`.
- `chat_session_reads` speichert pro Session und Principal den Read-Cursor.
- `countUnreadMessages(...)` zählt Assistant-Antworten erst, wenn eine passende `message_finished`-Zeile existiert.
- `activeEventStreams` verfolgt aktive SSE-Verbindungen pro Session und Principal.
- `markActiveSessionRead(...)` markiert sichtbare aktive Sessions nach `assistant_message` oder `message_finished` als gelesen.
- `bootstrap?markRead=true` markiert nur die ausgewählte Session als gelesen.
- Archivierte Sessions werden aus Unread-Zählungen ausgeschlossen.

Jüngste Änderung:

- Die UI-Lampe zeigt Blau nur noch bei `unreadCount > 0`.
- „Recently active“ erzeugt kein blaues Unread-Signal mehr.

## Nicht-Ziele

Diese Version implementiert nicht:

- Quiet Hours
- per-Room oder per-Session Push-Preferences
- Notification Grouping über längere Zeitfenster
- vollständigen Assistant-Text in Push Payloads
- Native-App-spezifische Push-Kanäle

## Phase 1: Push-Datenmodell

Neue Datei:

```text
src/apps/chat/push-subscriptions.ts
```

Neue Tabelle für Geräte-/Browser-Tokens:

```sql
CREATE TABLE IF NOT EXISTS chat_push_subscriptions (
  id TEXT PRIMARY KEY,
  principal_id TEXT NOT NULL,
  owner_scope TEXT NOT NULL,
  fcm_token TEXT NOT NULL UNIQUE,
  user_agent TEXT,
  platform TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  last_seen_at TEXT NOT NULL,
  disabled_at TEXT
);
```

Neue Tabelle für Dedupe:

```sql
CREATE TABLE IF NOT EXISTS chat_push_deliveries (
  id TEXT PRIMARY KEY,
  principal_id TEXT NOT NULL,
  pibo_session_id TEXT NOT NULL,
  event_id TEXT NOT NULL,
  stream_id INTEGER NOT NULL,
  created_at TEXT NOT NULL,
  UNIQUE(principal_id, pibo_session_id, event_id)
);
```

Store-Methoden:

- `upsertSubscription(input)`
- `disableSubscriptionByToken(token)`
- `listActiveSubscriptions(principalId)`
- `countActiveSubscriptions(principalId)`
- `tryRecordDelivery(input): boolean`
- `deleteSubscriptionsForPrincipal(principalId)` falls später benötigt

## Phase 2: Backend-API

Neue Endpunkte in `src/apps/chat/web-app.ts`:

```text
GET    /api/chat/push/config
GET    /api/chat/push/status
POST   /api/chat/push/subscribe
DELETE /api/chat/push/subscribe
```

### `GET /api/chat/push/config`

Liefert nur öffentliche Web-Konfiguration:

```json
{
  "enabled": true,
  "firebase": {
    "apiKey": "...",
    "authDomain": "...",
    "projectId": "...",
    "messagingSenderId": "...",
    "appId": "..."
  },
  "vapidKey": "..."
}
```

Wenn die Server-Konfiguration fehlt:

```json
{
  "enabled": false
}
```

### `GET /api/chat/push/status`

Liefert den Status für die Settings-UI:

```json
{
  "enabled": true,
  "subscriptions": 2
}
```

### `POST /api/chat/push/subscribe`

Body:

```json
{
  "token": "...",
  "platform": "web"
}
```

Speichert oder aktualisiert das Token für `principalIdFor(webSession)` und `webSession.ownerScope`.

### `DELETE /api/chat/push/subscribe`

Body:

```json
{
  "token": "..."
}
```

Deaktiviert das Token. Die Zeile bleibt für Diagnose erhalten.

## Phase 3: Firebase Admin Dispatcher

Neue Datei:

```text
src/apps/chat/push-dispatcher.ts
```

Neue Dependency:

```text
firebase-admin
```

ENV-Konfiguration:

```text
PIBO_FIREBASE_PROJECT_ID
PIBO_FIREBASE_CLIENT_EMAIL
PIBO_FIREBASE_PRIVATE_KEY
PIBO_FIREBASE_WEB_API_KEY
PIBO_FIREBASE_WEB_AUTH_DOMAIN
PIBO_FIREBASE_WEB_MESSAGING_SENDER_ID
PIBO_FIREBASE_WEB_APP_ID
PIBO_FIREBASE_WEB_VAPID_KEY
```

Dispatcher-Verhalten:

- Firebase Admin lazy initialisieren.
- Wenn ENV fehlt, Push als disabled behandeln.
- An alle aktiven Tokens eines Principals senden.
- Ungültige Tokens bei Firebase-Fehlern deaktivieren.
- Keine Exception bis in den Chat-Event-Pfad durchreichen; Push-Fehler dürfen Chat nicht blockieren.
- Ergebnis für Tests und Debugging als strukturierter Wert zurückgeben.

Beispiel-Interface:

```ts
export type PushDispatcher = {
  isEnabled(): boolean;
  sendChatNotification(input: ChatPushNotificationInput): Promise<ChatPushDeliveryResult>;
};
```

## Phase 4: Push-Trigger im Event-Flow

Zentraler Hook:

```text
src/apps/chat/web-app.ts
ensureEventIndexing(...)
```

Trigger nur bei:

```ts
persistableEvent.type === "message_finished"
```

Ablauf:

1. `message_finished` wird in `chat_events` persistiert.
2. `markActiveSessionRead(...)` läuft wie heute.
3. Push-Kandidaten ermitteln.
4. Pro Principal prüfen, ob eine Notification erlaubt ist.
5. Dedupe-Eintrag schreiben.
6. FCM senden.

Bedingungen für Push:

- Die Session gehört zum `ownerScope` des Principals.
- Die Session ist nicht archiviert.
- Die Session hat keine aktive SSE-Verbindung für diesen Principal.
- `countUnreadMessages({ piboSessionId, principalId, afterStreamId: lastRead }) > 0` ist größer als 0.
- `tryRecordDelivery(...)` gibt `true` zurück.
- Push ist serverseitig aktiviert.
- Mindestens ein aktives FCM Token existiert.

Nicht bei `assistant_message` pushen. Die bestehende Unread-Semantik zählt Assistant-Antworten erst nach `message_finished`. Push muss dieselbe Semantik verwenden.

## Phase 5: Notification Payload

Payload ohne vollständigen Assistant-Text:

```json
{
  "notification": {
    "title": "Pibo reply finished",
    "body": "New assistant message in <session title>"
  },
  "data": {
    "type": "chat.assistant.finished",
    "roomId": "...",
    "piboSessionId": "...",
    "eventId": "...",
    "streamId": "123"
  },
  "webpush": {
    "fcmOptions": {
      "link": "/apps/chat/rooms/<roomId>/sessions/<piboSessionId>"
    }
  }
}
```

Warum kein voller Antworttext:

- weniger Datenschutzrisiko
- kleinere Payload
- keine Markdown-/Codeblock-Probleme in System-Notifications
- konsistent mit „Chat öffnen statt im Push lesen“

## Phase 6: Frontend-Integration

Neue API-Funktionen in:

```text
src/apps/chat-ui/src/api.ts
```

Neue Types in:

```text
src/apps/chat-ui/src/types.ts
```

Neue Settings-Komponente:

```text
src/apps/chat-ui/src/settings/PushNotificationsView.tsx
```

UI-Anforderungen:

- Anzeigen, ob Push serverseitig verfügbar ist.
- Anzeigen des Browser-Permission-States: `default`, `granted`, `denied`.
- Button „Push aktivieren“.
- Button „Dieses Gerät deaktivieren“.
- Fehlertext für fehlenden HTTPS-/Service-Worker-/Notification-Support.
- Keine aggressive Permission-Abfrage beim App-Start. Permission nur nach User-Klick anfragen.

Token-Flow:

1. `/api/chat/push/config` laden.
2. Service-Worker-Registration holen.
3. Firebase Web App initialisieren.
4. `getToken(messaging, { vapidKey, serviceWorkerRegistration })` aufrufen.
5. Token an `/api/chat/push/subscribe` senden.
6. Token lokal merken, damit `DELETE` möglich ist.

## Phase 7: Service Worker

Bestehende Datei erweitern:

```text
src/apps/chat-ui/public/sw.js
```

Aktuell übernimmt sie PWA-Caching. Ergänzen:

- Firebase Messaging Background Handler.
- `notificationclick` Handler.
- Bestehenden Chat-Tab fokussieren, wenn möglich.
- Sonst passende Chat-URL öffnen.

Wichtig:

- Der bestehende Service Worker läuft unter `/apps/chat/sw.js`.
- `getToken(...)` muss diese Registration explizit erhalten.
- Die App muss weiter funktionieren, wenn Service-Worker-Registrierung oder Push fehlschlägt.

## Phase 8: Tests

Backend-Tests in:

```text
test/web-channel.test.mjs
```

Neue Testfälle:

1. Kein Push für unfertige `assistant_message`.
2. Push bei `message_finished`, wenn Session unread ist.
3. Kein Push, wenn die Session für denselben Principal aktiv per SSE geöffnet ist.
4. Push für unfokussierte Child-Session.
5. Kein Push für archivierte Session.
6. Kein doppelter Push für gleichen `eventId`.
7. Ungültiges Token wird deaktiviert.
8. Subscribe-/Delete-Endpunkte erfordern Auth.
9. `/api/chat/push/config` gibt `enabled: false` zurück, wenn ENV fehlt.

Firebase Admin im Test nicht echt verwenden. Stattdessen ein kleines Dispatcher-Interface in `createChatWebApp(...)` injizieren.

Frontend-Checks:

```text
npm run chat-ui:typecheck
npm run typecheck
```

Wenn möglich zusätzlich ein Browser-Check in einem Docker-Compute-Worker.

## Phase 9: Deployment und Betrieb

Deployment-Voraussetzungen:

- Firebase-Projekt existiert.
- Web App ist in Firebase angelegt.
- VAPID Key ist erzeugt.
- Service Account ist erzeugt.
- ENV-Variablen sind auf dem Gateway gesetzt.
- App läuft über HTTPS oder localhost für lokale Tests.

Betriebsregeln:

- Push-Fehler dürfen Chat nicht brechen.
- Ungültige Tokens werden deaktiviert, nicht gelöscht.
- Keine Secrets in Bootstrap, JS-Bundle oder Service Worker.
- Push lässt sich durch fehlende ENV vollständig deaktivieren.

## Aufwandsschätzung

Realistischer Aufwand für die solide Version:

```text
3–5 Arbeitstage
```

Aufteilung:

- Backend Store/API/Dispatcher: 1.5–2 Tage
- Event-Trigger, Dedupe und Tests: 1 Tag
- Frontend Settings und Token-Flow: 1 Tag
- Service Worker, Browser-Test und Polishing: 0.5–1 Tag

## Reihenfolge der Umsetzung

1. `PushSubscriptionStore` und Tabellen anlegen.
2. `PushDispatcher` mit disabled/fake/admin Implementierung anlegen.
3. Backend-Endpunkte implementieren.
4. Push-Trigger in `ensureEventIndexing(...)` anbinden.
5. Backend-Tests schreiben.
6. Frontend API und Types ergänzen.
7. Settings-UI für Push bauen.
8. Service Worker erweitern.
9. Typecheck und Tests ausführen.
10. In Docker-Compute-Worker browsernah prüfen.

## Offene Entscheidungen

- Soll Push für alle Room-Mitglieder oder nur für Session-Owner senden? Aktuell wirkt das Modell owner-scope-zentriert. Für die erste solide Version: nur der betroffene Principal/Owner.
- Soll ein Push auch kommen, wenn ein anderer Tab im selben Room, aber nicht in derselben Session aktiv ist? Empfehlung: ja, wenn die konkrete Session nicht aktiv ist.
- Soll der Notification-Titel Session- oder Room-Namen verwenden? Empfehlung: Session-Titel im Body, App-Name im Titel.
- Soll der Token lokal in `localStorage` gespeichert werden? Empfehlung: ja, nur für Delete/Status im aktuellen Browser; Backend bleibt Quelle der Wahrheit.

## Quellen

Firebase-Dokumentation:

- https://firebase.google.com/docs/cloud-messaging/js/client
- https://firebase.google.com/docs/cloud-messaging/js/receive
- https://firebase.google.com/docs/cloud-messaging/send/admin-sdk

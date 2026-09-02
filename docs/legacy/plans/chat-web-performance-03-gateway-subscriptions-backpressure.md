---
type: "Historical Record"
title: "Chat Web Performance 03: Gateway Subscriptions und Backpressure"
description: "Preserves the original body as a deprecated historical record without promoting historical claims."
tags: ["historical","legacy","migration"]
status: "deprecated"
authority: "historical"
migration_lineage:
  source_path: "docs/legacy/plans/chat-web-performance-03-gateway-subscriptions-backpressure.md"
  source_commit: "0cd6a73449e1b555fa6e590d839d7e03c8dc98bf"
  baseline_commit: "2aef244301f5d181624662fdad53e18e83e80bd9"
  baseline_blob_oid: "3d8e837e1203d1a2bb4e07d57f40277af379e63e"
  source_bytes: 5260
  source_sha256: "bd9659cd6a47dbb317eeb445e69ea4b2766c320f4762abf990c9f335d403022a"
  source_body_sha256: "bd9659cd6a47dbb317eeb445e69ea4b2766c320f4762abf990c9f335d403022a"
generated:
  by: "process:pibo-okf-c-legacy"
  at: "2026-09-01T09:50:26Z"
---
# Chat Web Performance 03: Gateway Subscriptions und Backpressure

## Zweck

Dieses Dokument bewertet Gateway-Subscriptions und Backpressure-Handling. Es trennt den TCP Gateway von Browser-SSE, weil beide Pfade unterschiedliche Risiken haben.

## Ausgangslage

Der TCP Gateway in `src/gateway/server.ts` broadcastet jedes Router-Event an jede Verbindung:

```ts
private broadcastRouterEvent(event: PiboOutputEvent): void {
	for (const connection of this.connections) {
		connection.send({ type: "event", event: "router", payload: event });
	}
}
```

`connection.send()` ruft `socket.write(...)` auf und ignoriert den Rückgabewert. Der Gateway berücksichtigt also keine TCP-Backpressure.

Browser-SSE in `src/apps/chat/web-app.ts` ist ein anderer Pfad. Dort filtert `liveEventMatches(...)` Events für Chat Web Streams. Das Problem „alle Events an alle Clients“ trifft dort nicht in derselben Form zu.

## Was sinnvoll ist

### `socket.write()` Rückgabewert beachten

Das ist der kleinste sinnvolle Schritt. Wenn `socket.write()` `false` zurückgibt, hat der Socket-Buffer Druck. Der Gateway sollte dann:

- die Verbindung als slow markieren;
- weitere Writes begrenzen;
- auf `drain` warten;
- bei zu großem Backlog schließen oder nichtkritische Events droppen.

### Per-Connection Queue begrenzen

Eine harte Grenze verhindert unbounded memory growth. Die Policy muss klar sein:

- Kritische Responses auf Requests dürfen nicht gedroppt werden.
- Router-Event-Broadcasts können je nach Eventklasse gedroppt oder zusammengefasst werden.
- Bei dauerhaft langsamen Clients ist Schließen oft sicherer als unendliches Puffern.

### Legacy-Modus erhalten

Bestehende Clients sollten ohne Änderung weiter funktionieren. Neue Subscriptions sollten optional sein.

## Was riskant ist

### Gateway-Protokoll erweitern

Subscriptions ändern `src/gateway/protocol.ts`, `src/gateway/server.ts` und Clients. Das ist ein Protokollumbau, kein lokaler Performance-Fix.

Risiken:

- bestehende Clients bekommen nicht mehr die erwarteten Events;
- Subscriptions sind falsch gesetzt und Events fehlen;
- Debug-Clients verlieren Sichtbarkeit;
- Owner-Scope-Filter können Daten leaken oder zu viel blockieren.

### Subscription-Typen zu breit definieren

„session, room, owner scope, debug-all“ klingt nützlich, aber jeder Typ braucht Auth- und Semantikregeln. Besonders `debug-all` ist sensibel.

### Drop-Policy ohne Eventklassifikation

Nicht alle Events sind gleich. Dropping ist bei Live-Deltas eher möglich als bei Terminal-, Error- oder Audit-relevanten Events.

## Was den Code fundamental ändert

Fundamental wird der Umbau, wenn Clients explizit Subscription-State halten. Betroffen sind:

- `GatewayFrame` und Validierung in `src/gateway/protocol.ts`;
- Server-Verbindungszustand in `src/gateway/server.ts`;
- Gateway Client API;
- Tests für Request/Response und Event-Broadcast;
- eventuell Channel- oder Tool-Integrationen, die alle Events erwarten.

## Problematische Annahmen

Eine falsche Annahme wäre: „Chat Web bekommt heute jedes TCP-Gateway-Event.“ Der Browser-SSE-Pfad filtert bereits. Das Broadcast-Problem sitzt primär im TCP Gateway.

Eine zweite falsche Annahme wäre: „Subscriptions sind nur ein Filter.“ Sie sind auch ein Auth- und Kompatibilitätsproblem.

## Übersehene Punkte

### Request/Response darf nicht mit Broadcast verwechselt werden

Gateway-Verbindungen transportieren sowohl Antworten auf Requests als auch Router-Events. Backpressure-Policy muss unterscheiden, damit ein Client seine eigene Response nicht verliert.

### Slow Client Visibility

Operatoren brauchen Diagnostik:

- Anzahl Verbindungen;
- Backlog pro Verbindung;
- dropped events;
- closed slow clients;
- aktive Subscription-Filter.

### Browser-SSE braucht eigene Robustheit

Auch SSE kann langsame Clients haben. Der Plan sollte separat prüfen, ob `ReadableStream`-Writes Fehler sauber behandeln und ob Disconnects zuverlässig cleanup auslösen.

## Empfohlene Reihenfolge

1. TCP-Backpressure minimal härten: `write()` prüfen, `drain` verwenden, Backlog begrenzen.
2. Diagnostik für slow clients ergänzen.
3. Eventklassen definieren: critical, structural, live-delta, debug.
4. Subscription-Protokoll separat spezifizieren.
5. Legacy all-events default beibehalten.
6. Erst danach Session-/Owner-/Debug-Filter implementieren.

## Akzeptanzkriterien

- Bestehende Clients funktionieren im Legacy-Modus unverändert.
- Langsame Clients erzeugen kein unbounded memory growth.
- Request/Response-Frames bleiben zuverlässig.
- Dropping betrifft nur klar definierte nichtkritische Eventklassen.
- Subscription-Filter leaken keine fremden Owner-Scope-Daten.

## Mindesttests

- Legacy Client erhält weiterhin Router-Events.
- Slow Socket mit blockiertem Drain wird begrenzt oder geschlossen.
- Request Response kommt trotz Broadcast-Last an.
- Session-Subscription erhält nur passende Session-Events.
- Debug-all braucht explizite Berechtigung oder bleibt intern.
- Dropped-event-Zähler steigt bei künstlicher Backpressure.

## Empfehlung

Backpressure-Härtung ist wichtig und sollte vor Subscriptions kommen. Subscriptions brauchen eine eigene Protokollspezifikation und sollten nicht in einem gemischten Performance-Patch landen.

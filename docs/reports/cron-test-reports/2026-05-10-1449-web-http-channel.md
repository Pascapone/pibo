---
type: "Research"
title: "Test-Review: Web-HTTP-Helpers und Web-Channel-Basisflüsse"
description: "Preserves the original report body as stable research without promoting historical claims."
tags: ["migration","research","report"]
status: "stable"
authority: "informative"
migration_lineage:
  source_path: "docs/reports/cron-test-reports/2026-05-10-1449-web-http-channel.md"
  source_commit: "15f2cd832e627d49c71be6a60708e5409be8772f"
  baseline_commit: "2aef244301f5d181624662fdad53e18e83e80bd9"
  baseline_blob_oid: "84c72216ac024d292102d2f5eebff62f95404c80"
  source_bytes: 10431
  source_sha256: "9d27c9b0c727990915ef875626fd24e51080f8bf35ef28dc2a6d05b3fe6b8e2c"
  source_body_sha256: "9d27c9b0c727990915ef875626fd24e51080f8bf35ef28dc2a6d05b3fe6b8e2c"
generated:
  by: "process:pibo-okf-c-reports"
  at: "2026-09-01T07:57:34Z"
---
# Test-Review: Web-HTTP-Helpers und Web-Channel-Basisflüsse

Datum: 2026-05-10 14:49 Europe/Berlin

## Untersuchter Bereich

Dieser Lauf betrachtet den schmalen HTTP-Transport-Layer rund um:

- `src/web/http.ts`
  - `responseJson`, `responseHtml`
  - `readJsonBody`
  - `nodeRequestToWebRequest`
  - `sendWebResponse`
- `src/web/channel.ts`
  - HTTP-Request-Konvertierung, Canonical Redirects, `/health`, `/gateway/status`, Auth-/App-Routing und Fehlerabbildung
- Ausgewählte angrenzende Tests:
  - `test/web-http.test.mjs`
  - relevante Web-Host-Fälle in `test/web-channel.test.mjs`
  - Kontext aus `test/web-gateway.test.mjs` und `test/better-auth-config.test.mjs`

Nicht betrachtet wurden vollständige Chat-Web-Fachflüsse, UI-Browser-E2E und Deployment-Gateway-Tests. Diese gehören in spätere, größere Teststufen.

## Ausgeführte begrenzte Checks

```bash
node --test test/web-http.test.mjs
node --test test/web-channel.test.mjs
```

Ergebnis:

- `test/web-http.test.mjs`: 4/4 bestanden, ca. 0,15 s.
- `test/web-channel.test.mjs`: 48/48 bestanden, ca. 9,4 s.

Der zweite Lauf ist für eine schnelle Transportprüfung bereits relativ breit, weil die Datei viele Chat-Web-Fachflüsse mitstartet. Für die Analyse war er hilfreich, sollte aber nicht als Standard-Subset für jede kleine Änderung an `src/web/http.ts` gelten.

## Was die bestehenden Tests gut abdecken

### `test/web-http.test.mjs`

Stärken:

- Gute, kleine Unit-/Integrationsebene mit lokalem `node:http`-Server.
- Deckt die wichtigste dynamische Response-Kompression ab:
  - große JSON-Antwort mit `Accept-Encoding: gzip`,
  - `gzip;q=0`,
  - keine Brotli-Kompression für dynamisches JSON,
  - kleine JSON-Antwort bleibt unkomprimiert.
- Testet tatsächlich Header und entpackten Body, nicht nur interne Hilfsfunktionen.
- Läuft sehr schnell und eignet sich als granulare Entwicklungssuite für Änderungen an `sendWebResponse`.

### `test/web-channel.test.mjs`

Stärken im betrachteten Randbereich:

- Prüft, dass unauthentifizierte Chat-API-Anfragen über den Web-Host mit `401` beantwortet werden.
- Prüft Canonical-Redirects für App-Links.
- Prüft statische Asset-Auslieferung mit Cache- und Kompressionsheadern.
- Prüft Same-Origin-Schutz für mutierende Chat-Requests und einen Reverse-Proxy-Forwarded-Host-Fall.
- Prüft den zentralen Größen-Limit-Pfad: übergroße Request-Bodies werden mit `413` abgelehnt.

Diese Fälle decken wichtige produktnahe Risiken ab, besonders weil `nodeRequestToWebRequest` und `createRequestBaseURL` vor App- und Auth-Handlern liegen.

## Schwächen und Risiken

### 1. `web-http.test.mjs` deckt nur `sendWebResponse` ab

`src/web/http.ts` enthält vier exportierte Helfer, aber die direkte Testdatei importiert nur:

```js
import { responseJson, sendWebResponse } from "../dist/web/http.js";
```

Nicht direkt granular getestet sind:

- `nodeRequestToWebRequest`
  - Header-Multiplikation bei Array-Headern,
  - GET/HEAD ohne Body,
  - POST/PUT mit Body,
  - URL-Auflösung gegen `baseURL`,
  - Fehlerpfad bei `MAX_WEB_REQUEST_BODY_BYTES`.
- `readJsonBody`
  - leere Bodies,
  - ungültiges JSON,
  - JSON-Primitives wie `null`, String oder Array,
  - gültiges Objekt.
- `responseHtml`
  - Content-Type und Status-/Header-Merge.
- `responseJson`
  - Header-Merge-Reihenfolge und Statuscodes.

Ein Teil davon wird indirekt in `test/web-channel.test.mjs` erreicht. Für schnelle Entwicklung ist diese indirekte Abdeckung aber zu grob und erschwert Fehlerlokalisierung.

### 2. Request-Body-Limit ist nur über den großen Web-Channel-Test abgedeckt

Der oversized-body-Fall in `test/web-channel.test.mjs` ist sinnvoll, aber er ist ein integrierter App-/Auth-/Channel-Test. Wenn nur `src/web/http.ts` geändert wird, wäre ein direkter `nodeRequestToWebRequest`-Test kleiner und schneller.

Empfehlung: den bestehenden integrierten `413`-Test behalten, aber zusätzlich einen fokussierten HTTP-Helper-Test ergänzen.

### 3. `sendWebResponse` hat ungetestete Header- und Status-Randfälle

Wichtige ungetestete Fälle:

- `204` und `304` dürfen nicht komprimiert werden.
- Bereits gesetztes `content-encoding` darf nicht überschrieben werden.
- bestehender `Vary`-Header sollte `accept-encoding` nur einmal und case-insensitiv ergänzen.
- `Set-Cookie`-Mehrfachheader müssen als getrennte Header erhalten bleiben, soweit die Runtime sie via `getSetCookie()` liefert.
- Streaming-Response ohne Kompression wird nur über Implementierung gelesen, nicht gezielt mit einem `ReadableStream`-Test abgesichert.

Diese Randfälle sind transportnah und sollten nicht von Chat-Web-Fachtests abhängen.

### 4. Web-Channel-Testdatei ist zu breit für Transport-Änderungen

`test/web-channel.test.mjs` ist wertvoll als Integrationssuite, mischt aber viele Schichten:

- Web-Host-Routing,
- Auth-Mapping,
- Chat-App-Sessionlogik,
- Data-V2-Persistenz,
- SSE/Trace,
- Custom-Agent- und Package-Verwaltung,
- Room-/Unread-Logik.

Für Änderungen in `src/web/channel.ts` braucht das Team zusätzlich ein kleineres Subset, das nur den Host-Channel ohne Chat-App-Schwere prüft. Sonst werden einfache Transportänderungen unnötig mit langen und fachlich weit entfernten Tests validiert.

## Fehlende oder anzupassende Tests

### A. Direkte Tests für `nodeRequestToWebRequest`

Vorschlag für neue Fälle in `test/web-http.test.mjs` oder einer getrennten `test/web-request.test.mjs`:

1. `GET` übernimmt Methode, URL und Header, aber keinen Body.
2. `POST` übernimmt JSON-Body bytegenau.
3. Array-Header aus `IncomingMessage.headers` werden als mehrere Web-Headers übernommen.
4. Body über `MAX_WEB_REQUEST_BODY_BYTES` wirft `PiboWebHttpError` mit Status `413`.

### B. Direkte Tests für `readJsonBody`

Gezielte Fälle:

1. gültiges JSON-Objekt wird zurückgegeben.
2. ungültiges JSON ergibt `400`.
3. leerer Body ergibt `400`.
4. JSON-Array oder Primitive werden abgelehnt, falls das gewünschte Verhalten weiter `T extends object` meint. Falls Arrays erlaubt sein sollen, muss der Code statt des Tests angepasst werden; die aktuelle Implementierung akzeptiert Arrays, weil `typeof [] === "object"` gilt. Diese Annahme sollte fachlich geklärt werden.

### C. Zusätzliche `sendWebResponse`-Ränder

Gezielte Fälle:

1. `204` mit großem JSON-/Textbody wird nicht komprimiert.
2. vorhandenes `content-encoding` bleibt erhalten.
3. `Vary: Origin` wird zu `Origin, accept-encoding` ergänzt.
4. `Accept-Encoding: *;q=1` erlaubt gzip.
5. `Accept-Encoding: gzip;q=abc` wird nicht als akzeptiert interpretiert.

### D. Kleine Host-Channel-Basissuite

Eine neue kleine Suite könnte mit einem minimalen fake Web-App-Handler statt `createChatWebApp` arbeiten und folgende Fälle prüfen:

1. `/health` ohne Auth und ohne App-Initialisierung.
2. `/gateway/status` mit leeren Runtime-Statuses und active-runs.
3. `/api/auth/...` wird an `auth.handleRequest` delegiert.
4. unbekannter Pfad ergibt `{ error: "Not found" }` mit `404`.
5. App-Mount-Prefix und API-Prefix routen zum passenden Web-App-Handler.
6. `PiboWebHttpError` wird mit eigenem Status serialisiert; unbekannter Fehler wird `500`.

Das würde `src/web/channel.ts` unabhängig von Chat-Web-Fachlogik absichern.

## Empfohlene granulare Test-Kommandos/Subsets

Für Änderungen an `src/web/http.ts`:

```bash
npm run build
node --test test/web-http.test.mjs
```

Nach Ergänzung der vorgeschlagenen Helper-Fälle sollte meist reichen:

```bash
node --test test/web-http.test.mjs
```

wenn `dist/` bereits aus dem aktuellen Stand gebaut ist.

Für Änderungen an `src/web/channel.ts`:

```bash
npm run build
node --test test/web-http.test.mjs test/web-channel.test.mjs
```

Mittelfristig besser:

```bash
npm run build
node --test test/web-http.test.mjs test/web-host-routing.test.mjs
```

wobei `test/web-host-routing.test.mjs` die vorgeschlagene kleine Host-Channel-Basissuite wäre.

Für Auth-/Gateway-Konfiguration zusätzlich:

```bash
npm run build
node --test test/web-gateway.test.mjs test/better-auth-config.test.mjs
```

## Konkrete nächste Schritte

1. `test/web-http.test.mjs` um direkte Tests für `readJsonBody` und `nodeRequestToWebRequest` erweitern.
2. Einen fokussierten Test für die aktuelle Array-Akzeptanz in `readJsonBody` schreiben oder bewusst entscheiden, ob Arrays abgelehnt werden sollen.
3. `sendWebResponse`-Randfälle zu Status `204`/`304`, bestehendem `content-encoding`, `Vary` und `Set-Cookie` ergänzen.
4. Eine kleine `test/web-host-routing.test.mjs` einführen, die `createWebHostChannel` mit minimalem fake Web-App-Handler testet.
5. `test/web-channel.test.mjs` weiter als breitere Chat-Web-Integration behalten, aber nicht als einziges Standard-Feedback für Transportänderungen verwenden.

## Kurzfazit

Die vorhandenen Tests sichern die wichtigsten produktnahen Web-Host-Pfade ab und laufen aktuell grün. Die Granularität ist jedoch unausgewogen: `sendWebResponse` hat gute kleine Tests, während Request-Konvertierung, JSON-Body-Parsing und Host-Routing überwiegend indirekt über eine breite Chat-Web-Integrationsdatei geprüft werden. Kleine zusätzliche Helper- und Host-Routing-Tests würden Entwicklungsfeedback schneller machen und Fehler präziser lokalisieren.

## Umgesetzt am 2026-05-11 15:04 Europe/Berlin

- Bereich: Granulare HTTP-Helper-Tests für `readJsonBody` und `nodeRequestToWebRequest`.
- Geänderte Dateien: `test/web-http.test.mjs`, `docs/reports/cron-test-reports/2026-05-10-1449-web-http-channel.md`.
- Ausgeführte Kommandos: `npm run build`; `node --test test/web-http.test.mjs`.
- Ergebnis: Build erfolgreich; `test/web-http.test.mjs` mit 9/9 Tests bestanden.
- Verbleibende offene Punkte: Zusätzliche `sendWebResponse`-Randfälle und kleine Host-Channel-Basissuite bleiben offen.

## Umgesetzt am 2026-05-11 15:08 Europe/Berlin

- Bereich: Granulare `sendWebResponse`-Randfälle für 204, bestehendes `content-encoding`, `Vary`-Deduplizierung sowie `Accept-Encoding`-Wildcard/ungültige q-Werte.
- Geänderte Dateien: `test/web-http.test.mjs`, `docs/reports/cron-test-reports/2026-05-10-1449-web-http-channel.md`.
- Ausgeführte Kommandos: `npm run build`; `node --test test/web-http.test.mjs`.
- Ergebnis: Build erfolgreich; `test/web-http.test.mjs` mit 13/13 Tests bestanden.
- Verbleibende offene Punkte: Weitere optionale `sendWebResponse`-Randfälle wie `304`, `Set-Cookie`-Mehrfachheader und Streaming-Responses sowie die kleine Host-Channel-Basissuite bleiben offen.

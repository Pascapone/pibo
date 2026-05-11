# Cron Test Review: Gateway Request Helper

**Lauf:** 2026-05-10 14:08 Europe/Berlin  
**Bereich:** `src/gateway/request.ts` und `test/gateway-request.test.mjs` als schlanker Test-Subset für den Gateway-Request-Pfad, inklusive Nutzung durch `src/gateway/tool.ts`.

## Kontext und Ziel des Subsets

Der untersuchte Bereich ist ein guter Kandidat für einen sehr kleinen Entwickler-Test: Er prüft den TCP-/NDJSON-Request-Helper ohne echten `PiboGatewayServer`, Router-Laufzeit oder Web-Gateway. Das passt zum gewünschten Testsystem-Fluss: schnelle, isolierte Checks für Korrelation, Reihenfolge und Socket-Fehler vor größeren Gateway-/Router-Integrationssuiten.

## Betrachtete Dateien

- `src/gateway/request.ts`
- `src/gateway/protocol.ts`
- `src/gateway/server.ts` in Auszügen zur Einordnung der echten Frame-Verarbeitung
- `src/gateway/tool.ts`
- `test/gateway-request.test.mjs`
- `test/web-gateway.test.mjs`
- `test/gateway-backpressure-subscriptions.test.mjs`
- `package.json`

## Ausgeführter begrenzter Check

```bash
node --test test/gateway-request.test.mjs
```

Ergebnis: 3/3 Tests bestanden in ca. 103 ms.

Wichtig: Dieser direkte Test importiert `../dist/gateway/request.js`. Er validiert also den aktuell gebauten Stand in `dist/`, nicht zwingend die aktuelle TypeScript-Quelle, falls vorher nicht gebaut wurde.

## Stärken der bestehenden Tests

1. **Klarer, schneller Unit-/Komponententest**  
   `test/gateway-request.test.mjs` startet einen minimalen Mock-TCP-Gateway mit zufälligem Port. Dadurch bleibt der Test unabhängig von produktiven Gateways, Auth, Router-Runtimes und Persistenz.

2. **Wichtige Korrelation ist abgedeckt**  
   Der Test `sendGatewayMessageAndWaitForReply resolves only the correlated assistant reply` prüft, dass ein unpassendes `assistant_message` mit falschem `eventId` ignoriert und erst die passende Antwort akzeptiert wird.

3. **Rennbedingung Antwort-vor-Response ist abgedeckt**  
   Der Test `tolerates reply before response` deckt ein wichtiges asynchrones Verhalten ab: Router-Event kann vor dem `res`-Frame eintreffen.

4. **Keine breite Integrationslast**  
   Für die Kernlogik in `request.ts` ist der Mock sinnvoller als ein voller Gateway-Server, weil die Fehlerursache bei Regressionen eng eingegrenzt bleibt.

## Schwächen und Risiken

1. **Dist-Import kann Source-Regressionen verdecken**  
   Alle betrachteten Tests importieren aus `../dist/...`. Ein schneller Direktlauf wie `node --test test/gateway-request.test.mjs` ist nur dann aussagekräftig, wenn `dist/` aktuell ist. Für Entwickler-Subsets fehlt ein dokumentierter Befehl, der gezielt TypeScript kompiliert und genau diesen Test ausführt.

2. **Fehlerpfade von `sendGatewayMessageAndWaitForReply` fehlen**  
   In `src/gateway/request.ts` gibt es eigene Pfade für:
   - Gateway-`res` mit `ok: false`
   - korreliertes `session_error`-Router-Event
   - Socket-Close vor Reply
   - Timeout
   Diese sind in `test/gateway-request.test.mjs` nicht abgedeckt. Gerade `src/gateway/tool.ts` wandelt diese Fehler in Tool-Details um; deshalb sind die Fehlertexte und Reject-Bedingungen produktrelevant.

3. **Parsing-/Framing-Robustheit ist nur implizit geprüft**  
   Die Tests schicken vollständige JSON-Zeilen in einem `write`. `request.ts` enthält aber Buffer-Logik für mehrere Zeilen und Teilchunks. Die echte Gateway-Kommunikation ist zeilenbasiert; fragmentierte Frames sind ein realistischer TCP-Fall und sollten gezielt klein getestet werden.

4. **`sendGatewayEvent` ignoriert unkorrelierte Responses bisher ungetestet**  
   `sendGatewayEvent` filtert nach `frame.id === id`. Es gibt keinen Test, der zuerst ein `res` mit falscher ID sendet und danach die korrekte Response. Das ist symmetrisch zur Assistant-Reply-Korrelation und wäre ein kleiner, wertvoller Test.

5. **Event-ID-Übernahme bei vorhandener `event.id` fehlt**  
   Der Code setzt `eventWithId` auf `event.id ?? id`. Die Tests prüfen nur, dass eine ID generiert wird. Nicht geprüft ist, dass eine vom Caller gesetzte Event-ID erhalten bleibt und für die Reply-Korrelation verwendet wird. Das ist relevant für externe Korrelation und Wrapper-Aufrufe.

## Fehlende oder anzupassende Tests

Empfohlene Ergänzungen in `test/gateway-request.test.mjs`, weiterhin mit Mock-Gateway statt voller Integration:

1. **Gateway lehnt Nachricht ab**  
   Mock sendet `res` mit gleicher Request-ID und `ok: false`. Erwartung: `sendGatewayMessageAndWaitForReply` rejected mit Gateway-Fehlertext.

2. **Session-Error beendet Wait sofort**  
   Mock sendet korreliertes Router-Event `{ type: "session_error", eventId: frame.event.id }`. Erwartung: Reject mit `output.error`, unabhängig davon, ob `res` vorher oder nachher kommt.

3. **Unkorrelierte Response wird ignoriert**  
   Für `sendGatewayEvent`: zuerst `res` mit falscher ID, danach richtige `res`. Erwartung: Promise resolved erst mit korrekter Response.

4. **Vorhandene Event-ID bleibt stabil**  
   Aufruf mit `{ id: "caller-event-id", ... }`; Mock prüft empfangenes `frame.event.id`, sendet Assistant-Reply mit dieser ID. Erwartung: Reply wird gefunden und Request-Frame-ID bleibt separat.

5. **Fragmentierte NDJSON-Frames**  
   Mock schreibt eine Response in zwei `socket.write`-Chunks. Erwartung: Buffering löst korrekt erst nach Newline aus.

## Empfohlene granulare Test-Kommandos/Subsets

Für reine Analyse des aktuell gebauten Artefakts:

```bash
node --test test/gateway-request.test.mjs
```

Für eine aussagekräftige Entwicklerprüfung nach Änderungen an `src/gateway/request.ts` ohne Web-Build:

```bash
npx tsc -p tsconfig.json && node --test test/gateway-request.test.mjs
```

Für angrenzende Gateway-Frame- und Backpressure-Regressionen:

```bash
npx tsc -p tsconfig.json && node --test \
  test/gateway-request.test.mjs \
  test/gateway-backpressure-subscriptions.test.mjs \
  test/web-gateway.test.mjs
```

Der volle `npm test` bleibt sinnvoll für spätere Integrations-/Release-Phasen, ist aber für diese kleine Request-Helper-Schleife zu breit.

## Konkrete nächste Schritte

1. `test/gateway-request.test.mjs` um die vier bis fünf kleinen Fehler- und Framing-Fälle oben ergänzen.
2. In Entwicklerdokumentation oder Report-Index klar markieren, dass Direktläufe gegen `dist/` vorher `npx tsc -p tsconfig.json` brauchen, wenn Source-Änderungen bewertet werden.
3. Optional einen separaten Test für `src/gateway/tool.ts` ergänzen, der `sendGatewayMessageAndWaitForReply` mockt oder über einen Mock-Gateway Fehler und Erfolg prüft. Ziel: Tool-Details (`ok`, `error`, `reply`) absichern, ohne Router oder echte Gateway-Prozesse zu starten.

## Umgesetzt am 2026-05-11 11:10 Europe/Berlin

- Bereich: Granularer Gateway-Request-Korrelationstest für `sendGatewayEvent`, der fremde Response-IDs ignoriert und erst die passende Gateway-Response auflöst.
- Geänderte Dateien: `test/gateway-request.test.mjs`, `docs/reports/cron-test-reports/2026-05-10-1408-gateway-request.md`
- Ausgeführte Kommandos: `npm run build`; `node --test test/gateway-request.test.mjs`
- Ergebnis: Build erfolgreich; Gateway-Request-Subset grün mit 4/4 bestandenen Tests.
- Verbleibende offene Punkte: Weitere kleine Fehler- und Framing-Fälle aus dem Report, insbesondere Gateway-Reject, Session-Error und fragmentierte Frames.

## Kurzfazit

Das bestehende Gateway-Request-Subset ist schnell, sinnvoll granuliert und deckt zwei wichtige Korrelationseigenschaften ab. Die größte Testsystem-Lücke liegt nicht in Breite, sondern in den fehlenden negativen Pfaden und in der `dist/`-Abhängigkeit der Direktläufe. Mit wenigen zusätzlichen Mock-Gateway-Fällen würde dieser Bereich ein sehr gutes frühes Entwickler-Signal liefern.

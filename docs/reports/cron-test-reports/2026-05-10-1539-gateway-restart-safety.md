---
type: "Research"
title: "Test-Review: Gateway-Restart-Safety"
description: "Preserves the original report body as stable research without promoting historical claims."
tags: ["migration","research","report"]
status: "stable"
authority: "informative"
migration_lineage:
  source_path: "docs/reports/cron-test-reports/2026-05-10-1539-gateway-restart-safety.md"
  source_commit: "15f2cd832e627d49c71be6a60708e5409be8772f"
  baseline_commit: "2aef244301f5d181624662fdad53e18e83e80bd9"
  baseline_blob_oid: "b8dbed2d5fc0b115afd92f4a9e35faee6721621a"
  source_bytes: 6416
  source_sha256: "e3f91b963044d6956302efaff7d15e9fbb3ba96f1921cbbde4c8c6ac52712611"
  source_body_sha256: "e3f91b963044d6956302efaff7d15e9fbb3ba96f1921cbbde4c8c6ac52712611"
generated:
  by: "process:pibo-okf-c-reports"
  at: "2026-09-01T07:57:34Z"
---
# Test-Review: Gateway-Restart-Safety

Datum: 2026-05-10 15:39 Europe/Berlin

## Untersuchter Bereich

Fokus dieses Laufs war die Schutzlogik für Gateway-Start/-Restart und die dazugehörigen Deployment-Hinweise.

Betrachtete Dateien:

- `test/gateway-restart-safety.test.mjs`
- `src/gateway/cli.ts`
- `src/web/channel.ts`
- `src/gateway/web.ts`
- `src/gateway/pidfile.ts`
- `scripts/deploy-web.sh`
- `scripts/deploy-web-dev.sh`
- `package.json`

Ausgeführter begrenzter Check:

```bash
node --test test/gateway-restart-safety.test.mjs
```

Ergebnis: 11 Tests bestanden in ca. 3,5 s.

## Was gut funktioniert

- `checkActiveWork()` ist sehr granular abgedeckt: Processing, Streaming, Queue, aktive Yielded Runs, unbekannter Status und Idle-Fall werden separat geprüft.
- Der Force-Confirmation-Token ist explizit als Contract getestet. Das schützt gegen unbeabsichtigte Änderungen an der Operator-Schnittstelle.
- Die Deploy-Script-Tests prüfen die wichtigste Policy: Deploy-Skripte bauen nur und drucken CLI-Restart-Anweisungen, statt selbst direkt Services zu stoppen oder neu zu starten.
- Die `gateway start command`-Tests nutzen kleine Fake-Gateways statt echte Host-Gateways. Das passt gut zur Projektregel, den Host-Gateway nicht ad hoc zu manipulieren.
- Die Suite ist schnell genug für einen fokussierten Entwicklungs-Check und vermeidet lange Integrationsläufe.

## Schwächen und Risiken

1. **Tests importieren aus `dist/` statt aus `src/`.**  
   `test/gateway-restart-safety.test.mjs` importiert `../dist/gateway/cli.js` und startet `dist/bin/pibo.js`. Ein direkter `node --test ...`-Lauf kann deshalb gegen veraltete Build-Artefakte laufen. Für Review-Zwecke war das akzeptabel, aber als Entwicklungs-Subset sollte der Build-Schritt bewusst davorstehen, wenn `src/gateway/cli.ts` geändert wurde.

2. **CLI-Restart-Pfade sind nur indirekt getestet.**  
   `checkActiveWork()` ist gut als Unit getestet, aber `pibo gateway web restart` selbst wird nicht mit Fake-Status und Fake-Manager geprüft. Dadurch bleiben Risiken in Argument-Parsing, `--force --confirm`, Exit-Code-Verhalten, Fehlermeldungen und Health-Waiting.

3. **`/gateway/status` als Produzent der Safety-Daten ist kaum abgedeckt.**  
   `src/web/channel.ts` erzeugt `runtimeStatuses` und `activeRuns`, inklusive Filterung aktiver Run-Statuses und Deduplizierung. Die aktuelle Safety-Suite mockt diesen Endpunkt, prüft aber nicht, ob der echte Web-Channel die erwartete Payload liefert.

4. **Modus-Erkennung ist zwischen mehreren Dateien verteilt.**  
   `src/gateway/web.ts` bestimmt `dev`/`prod` über Dev-Auth, Port 4808 und Auth-Base-URL; `src/gateway/cli.ts` erwartet für `web` den Modus `prod` und für `dev` den Modus `dev`. Die Start-Tests decken einen falschen Modus ab, aber nicht die eigentliche `webGatewayMode()`-Entscheidungsmatrix.

5. **Deploy-Script-Assertions sind sinnvoll, aber grob.**  
   Die Regex `systemctl|restart pibo|stop pibo` verhindert einige direkte Restart-Operationen, lässt aber andere riskante Varianten wie `service ... restart`, `pkill`, `kill`, `pibo gateway restart` oder direkte `dist/bin/pibo.js gateway restart` theoretisch offen.

## Fehlende oder anzupassende Tests

Empfohlene Ergänzungen, ohne die Suite unnötig breit zu machen:

- **CLI-Contract-Subset für `gateway web restart`:**
  - blockiert bei `/gateway/status` mit `processing: true`;
  - blockiert bei Status-HTTP-Fehler oder unbekanntem Modus;
  - akzeptiert `--force` nur mit `--confirm restart-active-agents`;
  - ruft bei Idle genau den konfigurierten Manager mit `restart <service>` auf;
  - wartet danach auf gesunden `mode: prod`.

- **Web-Channel-Status-Subset für `/gateway/status`:**
  - liefert `mode`, `health.mode`, `runtimeStatuses` und `activeRuns` aus einem minimalen Fake-`PiboChannelContext`;
  - filtert inaktive Run-Statuses aus;
  - dedupliziert identische Runs;
  - behandelt fehlende optionale Context-Methoden als leere Arrays.

- **Mode-Resolution-Subset für `src/gateway/web.ts`:**
  - Better-Auth ohne Dev-Konfiguration ergibt `prod`;
  - Port 4808 ergibt `dev`;
  - `dev.`-Base-URL ergibt `dev`;
  - `PIBO_DEV_AUTH=1` ohne Docker bleibt verboten.

- **Deploy-Script-Policy-Test härten:**
  - zusätzlich gegen `systemctl`, `service`, `pkill`, `kill`, `gateway restart` und direkte `dist/bin/pibo.js gateway restart` prüfen;
  - weiterhin erlauben: gedruckte Hinweise `pibo gateway web restart` und `pibo gateway dev restart`.

## Empfohlene granulare Test-Kommandos

Schneller innerer Loop für reine Safety-Logik, wenn `dist/` aktuell ist:

```bash
node --test --test-name-pattern "gateway restart safety" test/gateway-restart-safety.test.mjs
```

Deploy-Script-Policy isoliert:

```bash
node --test --test-name-pattern "deploy scripts" test/gateway-restart-safety.test.mjs
```

Start-Kommando-Fake-Gateway isoliert:

```bash
node --test --test-name-pattern "gateway start command" test/gateway-restart-safety.test.mjs
```

Nach Änderungen an `src/gateway/cli.ts`, `src/web/channel.ts` oder `src/gateway/web.ts` sollte bewusst ein Build davorstehen:

```bash
npm run build && node --test test/gateway-restart-safety.test.mjs
```

## Konkrete nächste Schritte

1. `test/gateway-restart-safety.test.mjs` um ein eigenes `gateway web restart command`-Describe erweitern, das Fake-HTTP-Status und Fake-Manager wie beim Start-Test nutzt.
2. Einen kleinen Web-Channel-Status-Test ergänzen, entweder in `test/web-channel.test.mjs` oder als neues fokussiertes `test/gateway-status-web-channel.test.mjs`.
3. Den Deploy-Script-Policy-Test auf weitere direkte Restart-/Kill-Varianten ausweiten.
4. In der Testdokumentation oder im README der Reports festhalten, dass diese Suite bei Source-Änderungen nur nach Build aussagekräftig ist, solange sie aus `dist/` importiert.

## Umgesetzt am 2026-05-11 13:08 Europe/Berlin

- Bereich: Deploy-Script-Policy-Test gegen weitere direkte Restart-/Stop-/Kill-Varianten gehärtet, ohne gedruckte CLI-Hinweise zu verbieten.
- Geänderte Dateien:
  - `test/gateway-restart-safety.test.mjs`
  - `docs/reports/cron-test-reports/2026-05-10-1539-gateway-restart-safety.md`
- Ausgeführte Kommandos:
  - `node --test --test-name-pattern "deploy scripts" test/gateway-restart-safety.test.mjs`
- Ergebnis: 2 Tests bestanden.
- Verbleibende offene Punkte: CLI-Restart-Command-Subset, `/gateway/status`-Producer-Subset und Mode-Resolution-Subset bleiben offen.

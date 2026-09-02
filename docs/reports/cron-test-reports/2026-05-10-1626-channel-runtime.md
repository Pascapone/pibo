---
type: "Research"
title: "Test-Review: Gateway-Channel-Lifecycle und Channel Runtime Context"
description: "Preserves the original report body as stable research without promoting historical claims."
tags: ["migration","research","report"]
status: "stable"
authority: "informative"
migration_lineage:
  source_path: "docs/reports/cron-test-reports/2026-05-10-1626-channel-runtime.md"
  source_commit: "15f2cd832e627d49c71be6a60708e5409be8772f"
  baseline_commit: "2aef244301f5d181624662fdad53e18e83e80bd9"
  baseline_blob_oid: "124acbed30f808ad8905471b18ba38db8852723c"
  source_bytes: 7660
  source_sha256: "6216472b053b8e5ee182cb63d43f9ca62a2c4af3c2464f8982cee6774f165eb4"
  source_body_sha256: "6216472b053b8e5ee182cb63d43f9ca62a2c4af3c2464f8982cee6774f165eb4"
generated:
  by: "process:pibo-okf-c-reports"
  at: "2026-09-01T07:57:34Z"
---
# Test-Review: Gateway-Channel-Lifecycle und Channel Runtime Context

**Zeitpunkt:** 2026-05-10 16:26 Europe/Berlin  
**Bereich:** Plugin-registrierte Channels beim `PiboGatewayServer`, insbesondere Start/Stop-Lifecycle, Auth-Voraussetzungen und `PiboChannelContext.createSession()`.

## Scope dieses Laufs

Untersucht wurde ein bewusst kleiner Schnitt:

- `test/channel-runtime.test.mjs`
- `test/plugin-registry.test.mjs` als angrenzende Registry-Abdeckung
- `src/gateway/server.ts`
- `src/channels/types.ts`
- `src/plugins/registry.ts`
- `src/plugins/types.ts`

Der Docker-Compute-Worker konnte nicht gestartet werden (`/usr/bin/pibo: Permission denied`). Deshalb wurde nur ein begrenzter Host-Check ausgeführt und keine Source-Code-Änderung vorgenommen.

## Ausgeführter granularer Check

```bash
node --test test/channel-runtime.test.mjs
```

Ergebnis: 2 Tests bestanden in ca. 1s.

## Was die bestehenden Tests gut abdecken

- `test/channel-runtime.test.mjs` prüft einen wichtigen Integrationspunkt: Ein registrierter Channel wird durch `PiboGatewayServer.start()` gestartet und erhält einen Kontext, mit dem er eine Pibo Session anlegen kann.
- Der Test verifiziert konkret, dass `createSession()` Profil-Aliase normalisiert: Input `profile: "codex"` wird als `codex-compat-openai-web` gespeichert.
- Der Stop-Pfad ist zumindest minimal abgedeckt: `server.stop()` ruft `channel.stop()` auf.
- Der negative Auth-Fall ist klar und schnell: `auth.mode === "required"` ohne registrierten Auth-Service bricht den Gateway-Start mit einer verständlichen Fehlermeldung ab.
- `test/plugin-registry.test.mjs` ergänzt die Abdeckung auf Registry-Ebene: Channel-Registrierung, Auth-Service-Registrierung und doppelte Auth-Services werden geprüft.

## Schwächen und Risiken

1. **Start-Fehler von Channels sind nicht abgesichert.**  
   `src/gateway/server.ts` startet Channels sequenziell und pusht sie erst nach erfolgreichem `channel.start(context)` nach `startedChannels`. Wenn Channel 1 erfolgreich startet und Channel 2 beim Start wirft, ist nicht getestet, ob bereits gestartete Channels gestoppt oder Ressourcen freigegeben werden. Der aktuelle Code scheint in diesem Fehlerpfad keinen automatischen Rollback aufzurufen.

2. **Stop-Reihenfolge wird nur indirekt geprüft.**  
   `stopChannels()` stoppt per Stack in umgekehrter Startreihenfolge. Das ist sinnvoll, aber nicht explizit getestet. Bei voneinander abhängigen Channels kann diese Reihenfolge wichtig sein.

3. **`PiboChannelContext` ist deutlich breiter als der Test.**  
   Der Test nutzt nur `createSession()`. Nicht abgedeckt sind `emit`, `subscribe`, `getSession`, `updateSession`, `deleteSession`, `findSessions`, Runtime-Status, Signal-Snapshots, Gateway-Actions, Capability-Catalog, Product-Events, dynamische Profile, Context-Files, Skills und Web-Apps. Das ist als Unit-Schnitt akzeptabel, aber als Contract-Test für Plugin-Channels noch dünn.

4. **Auth-Mode-Matrix ist unvollständig.**  
   Getestet ist nur `required` ohne Auth-Service. Nicht getestet sind `required` mit Auth-Service im Context, `trusted-local`, sowie `none` mit Warnung. Gerade `none` ist sicherheitsrelevant, auch wenn aktuell nur eine Warnung ausgegeben wird.

5. **Modellauswahl in `createSession()` ist nicht isoliert getestet.**  
   `createSession()` setzt `activeModel` über `input.activeModel ?? selectRequestedModelProfile(...)`. Der vorhandene Test prüft nur das Profil, nicht ob ein explizites `activeModel` erhalten bleibt oder ob Defaults korrekt eingefroren werden. Das ist teilweise durch Model-Tests abgedeckt, aber nicht an der Channel-Gateway-Grenze.

6. **Tests importieren `dist`.**  
   Wie viele bestehende Tests hängt `test/channel-runtime.test.mjs` von vorher gebautem `dist` ab. Für schnelle Entwicklungs-Subsets ist das fragil: ein Entwickler kann versehentlich stale `dist` testen. Das sollte nicht in jedem Einzeltest geändert werden, aber die empfohlenen Subsets sollten den Build-Zustand klar nennen.

## Fehlende oder anzupassende Tests

Empfohlene neue kleine Tests, ohne große Gateway-E2E-Suite:

1. **Channel-Start-Rollback-Test**
   - Setup: zwei Test-Channels, erster startet erfolgreich, zweiter wirft.
   - Erwartung klären und festschreiben: Entweder `server.start()` stoppt bereits gestartete Channels, oder der Report dokumentiert bewusst, dass Caller danach `stop()` aufrufen müssen.
   - Wenn automatische Cleanup-Semantik gewünscht ist, sollte der Test zuerst das gewünschte Verhalten fixieren.

2. **Stop-Reihenfolge-Test**
   - Setup: zwei startende Channels, beide schreiben `start:a`, `start:b`, `stop:b`, `stop:a` in ein Array.
   - Erwartung: LIFO-Stop-Reihenfolge.

3. **Auth-Context-Test für `required` mit Auth-Service**
   - Setup: required Channel plus Test-Auth-Service.
   - Erwartung: `context.auth?.name === "test-auth"` und Gateway startet erfolgreich.

4. **`auth.mode: "none"` Warn-Test**
   - Setup: Channel ohne Auth, `console.error` temporär abfangen.
   - Erwartung: Warnung enthält Channel-Namen. Dieser Test sollte klein bleiben und keine echten Sockets nutzen.

5. **Channel-Context-Session-Contract-Test**
   - Setup: Channel legt Session an, liest sie mit `getSession`, aktualisiert sie mit `updateSession`, findet sie mit `findSessions`, löscht sie mit `deleteSession`.
   - Erwartung: Store-Operationen funktionieren durch denselben Context. Das wäre ein gezielter Contract-Test für Plugin-Autoren.

6. **`activeModel` Preservation-Test**
   - Setup: `createSession({ activeModel: ... })` im Channel.
   - Erwartung: gespeicherte Session behält das explizite `activeModel`; Default-Auswahl greift nur ohne Input.

## Empfohlene granulare Test-Kommandos

Für schnelle Entwicklung an Channel-/Gateway-Context-Code:

```bash
npm run build
node --test test/channel-runtime.test.mjs
```

Wenn Registry-Änderungen beteiligt sind:

```bash
npm run build
node --test test/plugin-registry.test.mjs test/channel-runtime.test.mjs
```

Wenn nur bereits frisches `dist` vorliegt, reicht als sehr schnelles Feedback:

```bash
node --test test/channel-runtime.test.mjs
```

Wichtig: Der letzte Befehl ist nur sicher, wenn `dist` garantiert aktuell ist.

## Konkrete nächste Schritte

1. Einen kleinen `channel-runtime`-Testblock für Lifecycle-Randfälle ergänzen: Start-Rollback und LIFO-Stop-Reihenfolge.
2. Einen separaten Auth-Mode-Testblock ergänzen: `required` mit Auth-Service und `none`-Warnung.
3. Danach den Channel-Context-Contract schrittweise erweitern, beginnend mit Session-Store-Methoden (`getSession`, `updateSession`, `findSessions`, `deleteSession`).
4. Vor größeren Gateway-/Web-Deploy-Suites weiterhin dieses kleine Subset nutzen, damit Channel-Regressionen früh und gezielt sichtbar werden.

## Kurzfazit

Die vorhandene Channel-Runtime-Suite ist schnell und sinnvoll, aber sie prüft bisher hauptsächlich den Happy Path von `createSession()` und einen Auth-Fehler. Der nächste Qualitätsgewinn liegt in sehr kleinen Lifecycle- und Context-Contract-Tests, nicht in einer breiteren End-to-End-Suite.

## Umgesetzt am 2026-05-11 16:08 Europe/Berlin

- Bereich: Lifecycle-Randfall für Plugin-Channels; expliziter Test der LIFO-Stop-Reihenfolge.
- Geänderte Dateien: `test/channel-runtime.test.mjs`, `docs/reports/cron-test-reports/2026-05-10-1626-channel-runtime.md`.
- Ausgeführte Kommandos: `npm run build`; `node --test test/channel-runtime.test.mjs`.
- Ergebnis: Build erfolgreich; `test/channel-runtime.test.mjs` mit 3/3 bestandenen Tests.
- Verbleibende offene Punkte: Start-Rollback bei Channel-Startfehlern, weitere Auth-Mode-Tests und Channel-Context-Session-Contract-Tests bleiben offen.

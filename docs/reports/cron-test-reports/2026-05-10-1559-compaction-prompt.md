# Test-Review: Compaction Prompt und Runtime-Compaction

**Zeitpunkt:** 2026-05-10 15:59 Europe/Berlin  
**Bereich:** Workspace-lokale Compaction-Prompt-Konfiguration, Parser, Umschaltung und Pi-Compaction-Extension.  
**Ziel dieses Laufs:** Prüfen, ob die vorhandenen Tests für `src/core/compaction-prompt.ts` das spezifizierte Verhalten aus `docs/specs/capabilities/runtime-prompt-and-compaction.md` granular und entwicklungsfreundlich absichern.

## Betrachtete Dateien

- `GLOSSARY.md`
- `AGENTS.md`
- `package.json`
- `test/compaction-prompt.test.mjs`
- `test/base-prompt.test.mjs` als Vergleichsmuster
- `src/core/compaction-prompt.ts`
- `src/apps/chat/web-app.ts` Prompt-API-Ausschnitt und Normalizer
- `src/apps/chat-ui/src/context/CompactionPromptView.tsx`
- `docs/specs/capabilities/runtime-prompt-and-compaction.md`

## Ausgeführter begrenzter Check

```bash
node --test test/compaction-prompt.test.mjs
```

Ergebnis: 2 Tests bestanden. Der Check ist sinnvoll granular: schnell, ohne Gateway, ohne Browser, ohne komplette Build-Suite. Voraussetzung ist aber ein vorhandenes aktuelles `dist/`, weil der Test aus `../dist/core/compaction-prompt.js` importiert.

## Was die vorhandenen Tests gut abdecken

1. **Schneller Core-Regressionstest:** `test/compaction-prompt.test.mjs` läuft in ca. 1,2 Sekunden und eignet sich gut für lokale Entwicklungs-Loops, wenn `dist` aktuell ist.
2. **Mode-Toggle und Inhaltserhalt:** Der Test `compaction prompt switches between library and custom prompt without losing custom content` prüft den wichtigsten Persistenzfluss: Library -> Custom speichern -> Library aktivieren -> Custom reaktivieren.
3. **Strukturvalidierung:** Der Parser-Test prüft alle vier Pflichtsektionen und verifiziert bei einem defekten Custom-Prompt eine konkrete Fehlermeldung für die fehlende `<summary-prompt>`-Sektion.
4. **Isolation:** Die Tests verwenden temporäre Arbeitsverzeichnisse und vermeiden Zustand in `.pibo/` des echten Workspaces.

## Schwächen und Risiken

1. **Dist-Import-Risiko:** Der Test importiert aus `dist/`. Als schneller Subset-Test ist das gut für Release-Artefakte, aber schlecht für eine enge TDD-Schleife nach Änderungen in `src/core/compaction-prompt.ts`, solange kein Build lief. Ein Entwickler kann grüne Tests gegen alten `dist` sehen.
2. **Fallback bei fehlendem Custom-File fehlt:** Die Spec verlangt, dass `mode: custom` ohne `.pibo/compaction-prompt.md` effektiv auf Library fällt. Der aktuelle Test prüft nur den Normalfall mit existierendem Custom-File.
3. **Fehlgeschlagener Save schützt alten Prompt nicht explizit:** Der Test prüft, dass ein kaputter Prompt abgelehnt wird, aber nicht, dass ein bereits gespeicherter gültiger Custom-Prompt unverändert bleibt und weiter aktiv ist.
4. **Compaction-Erzeugung bleibt ungetestet:** `generatePiboCompaction`, Prompt-Zusammenbau, Split-Turn-Verhalten und File-Operation-Anhänge sind zentrale Laufzeitlogik, werden aber nicht direkt getestet. Die Spec markiert diese Anforderung als implementiert, obwohl die Testabdeckung derzeit nur Parser/Persistenz trifft.
5. **API-Schutz ist nur indirekt geprüft:** `src/apps/chat/web-app.ts` verlangt Session und Same-Origin für Prompt-Mutationen, aber es gibt keinen gezielten Test für `/api/chat/compaction-prompt` und `/api/chat/compaction-prompt/custom`.
6. **UI hat keine fokussierte Testabdeckung:** `CompactionPromptView.tsx` enthält wichtige Zustandsübergänge, insbesondere Editieren, Save-Fehler und Toggle. Diese bleiben ohne Komponenten- oder leichtgewichtige Interaction-Tests.

## Fehlende oder anzupassende Tests

### Kleine Core-Tests

Empfohlen: `test/compaction-prompt.test.mjs` um sehr kleine Fälle erweitern oder in `test/compaction-prompt-core.test.mjs` splitten.

Konkrete Fälle:

- `mode custom without custom markdown falls back to library effective mode`  
  Setup: `.pibo/compaction-prompt.json` mit `{ "mode": "custom" }`, aber keine Markdown-Datei. Erwartung: `readPiboCompactionPrompt(cwd).mode === "custom"`, `effectiveMode === "library"`, aktiver Pfad ist Library.
- `invalid custom save preserves previous valid custom prompt`  
  Setup: gültigen Custom-Prompt speichern, danach ungültigen Prompt speichern wollen. Erwartung: Reject, Dateiinhalt und `effectiveMode` bleiben beim gültigen Custom-Prompt.
- `set custom mode creates custom file from library when missing`  
  Diese Semantik steckt in `setPiboCompactionPromptMode("custom")`; ein Test würde verhindern, dass die UI später auf ein leeres Custom-Editor-Feld fällt.

### Mittlere Core-/Extension-Tests

Aktuell sind `buildSummaryPrompt`, `buildTurnPrefixPrompt`, `computeFileLists`, `formatFileOperations` und `generatePiboCompaction` nicht exportiert. Statt sofort große Integrationstests zu bauen, wäre ein kleiner testbarer Kern sinnvoll:

- File-Operation-Anhänge trennen gelesene Dateien von geänderten Dateien; geänderte Dateien dürfen nicht zusätzlich unter `<read-files>` stehen.
- Split-Turn-Compaction enthält `Turn Context (split turn)` und nutzt bei fehlender History `No prior history.`.
- Vorhandene `previousSummary` führt zum Update-Prompt statt zum Initial-Summary-Prompt.

### API-Subset

Ein gezielter Web-Handler-Test sollte prüfen:

- `GET /api/chat/compaction-prompt` verlangt Auth.
- `PATCH /api/chat/compaction-prompt` lehnt ungültigen Mode mit 400 ab.
- `PUT /api/chat/compaction-prompt/custom` lehnt nicht-string `markdown` ab.
- Same-Origin-Check läuft vor Mutation.

Das sollte kein voller Browser-/Gateway-Test sein, sondern ein schneller Web-App-Handler-Test nach Muster vorhandener Chat-Web-HTTP-Tests.

## Empfohlene granulare Test-Kommandos

Für schnelle Arbeit an Prompt-Persistenz und Parser:

```bash
npm run build -- --pretty false
node --test test/compaction-prompt.test.mjs
node --test test/base-prompt.test.mjs test/compaction-prompt.test.mjs
```

Wenn ein src-naher Test-Runner eingeführt wird, sollte der bevorzugte Loop ohne vollständigen Web-UI-Build auskommen, z. B. ein separates Core-Test-Kommando, das TypeScript direkt aus `src/` ausführt.

Für API-Änderungen später:

```bash
node --test test/web-http.test.mjs test/compaction-prompt.test.mjs
```

Nur vor Merge/Deployment:

```bash
npm run typecheck
npm test
```

## Konkrete nächste Schritte

1. Einen kleinen Fallback-Test für `mode: custom` ohne Custom-Datei ergänzen.
2. Einen Preservation-Test ergänzen: ungültiger Custom-Save darf einen bestehenden gültigen Custom-Prompt nicht überschreiben.
3. Prüfen, ob die Compaction-Prompt-Builder als kleiner interner Test-Hook exportiert oder in ein reines Hilfsmodul ausgelagert werden sollten. Ziel: Split-Turn und File-Operation-Anhänge ohne Modell/API-Key testen.
4. Einen fokussierten API-Test für `/api/chat/compaction-prompt*` planen, bevor weitere Prompt-UI-Arbeit erfolgt.

## Gesamtbewertung

Die vorhandenen Tests sind sinnvoll, schnell und gut isoliert, decken aber nur den Persistenz-/Parser-Rand ab. Für langfristige Sicherheit fehlt vor allem ein zweites granuläres Subset für die eigentliche Compaction-Zusammenstellung. Dieses Subset sollte kleiner bleiben als ein Gateway- oder Browser-Test und keine echten Modellaufrufe benötigen.

## Umgesetzt am 2026-05-11 11:24 Europe/Berlin

- Bereich: Granularer Core-Test für `mode: custom` ohne vorhandene `.pibo/compaction-prompt.md`.
- Geänderte Dateien: `test/compaction-prompt.test.mjs`, `docs/reports/cron-test-reports/2026-05-10-1559-compaction-prompt.md`.
- Ausgeführte Kommandos: `npm run build -- --pretty false`; `node --test test/compaction-prompt.test.mjs`.
- Ergebnis: Build erfolgreich; Compaction-Prompt-Subset erfolgreich mit 3/3 Tests.
- Verbleibende offene Punkte: Preservation-Test für ungültigen Custom-Save, Test für Custom-Mode-Dateierzeugung, Builder-/API-Subsets aus diesem Report.

## Umgesetzt am 2026-05-11 15:14 Europe/Berlin

- Bereich: Preservation-Test für ungültigen Custom-Save.
- Geänderte Dateien: `test/compaction-prompt.test.mjs`, `docs/reports/cron-test-reports/2026-05-10-1559-compaction-prompt.md`.
- Ausgeführte Kommandos: `npm run build -- --pretty false`; `node --test test/compaction-prompt.test.mjs`.
- Ergebnis: Build erfolgreich; Compaction-Prompt-Subset grün mit 4/4 Tests. Abgesichert ist, dass ein invalides Custom-Prompt-Save den bestehenden gültigen Custom-Prompt, `updatedAt` und aktiven Custom-Pfad nicht überschreibt.
- Verbleibende offene Punkte: Test für Custom-Mode-Dateierzeugung, Builder-/API-Subsets aus diesem Report.

## Umgesetzt am 2026-05-11 15:33 Europe/Berlin

- Bereich: Custom-Mode-Dateierzeugung für Compaction-Prompts.
- Geänderte Dateien: `test/compaction-prompt.test.mjs`, `docs/reports/cron-test-reports/2026-05-10-1559-compaction-prompt.md`.
- Ausgeführte Kommandos: `node --test test/compaction-prompt.test.mjs`.
- Ergebnis: Grün; Compaction-Prompt-Subset mit 5/5 Tests bestanden. Abgesichert ist, dass `setPiboCompactionPromptMode("custom")` ohne vorhandene Custom-Datei eine Library-Kopie anlegt und als aktiven Custom-Pfad nutzt.
- Verbleibende offene Punkte: Builder-/API-Subsets aus diesem Report bleiben offen.

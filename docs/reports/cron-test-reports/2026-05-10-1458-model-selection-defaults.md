# Test-Review: Model-Katalog, Model-Defaults und Active-Model-Freeze

Datum: 2026-05-10 14:58 Europe/Berlin

## Untersuchter Bereich

Dieser Lauf betrachtet einen eng abgegrenzten Bereich: die Auswahl und Darstellung von Modellen für Pibo Sessions.

Betrachtete Produktbereiche:

- `src/apps/chat/model-catalog.ts`
  - `buildModelCatalogFromRegistry`
  - `loadModelCatalog`
- `src/core/model-defaults.ts`
  - Persistenz und Sanitizing von Produkt-Model-Defaults
  - Auswahl von Main-/Subagent-Modellen, Thinking-Level und Fast-Mode
- `src/core/session-model.ts`
  - `resolvePiboSessionActiveModel`
  - Freeze des `activeModel` auf Pibo-Session-Ebene
- Angrenzende Verwendung in:
  - `src/core/session-router.ts`
  - `src/gateway/server.ts`
  - `src/apps/chat/web-app.ts`
  - `src/apps/chat-ui/src/App.tsx`
  - Session Stores mit `activeModel`-Persistenz

Nicht betrachtet wurden echte Provider-Registry-Initialisierung, Chat-UI-Browserflüsse und vollständige Runtime-Ausführung mit Modellwechseln. Diese gehören in breitere Integrations- oder Browser-Suites.

## Ausgeführte begrenzte Checks

```bash
node --test test/model-catalog.test.mjs test/model-defaults.test.mjs test/session-model-source-of-truth.test.mjs
```

Ergebnis:

- `test/model-catalog.test.mjs`: bestanden.
- `test/session-model-source-of-truth.test.mjs`: bestanden.
- `test/model-defaults.test.mjs`: 1 Fehler in `model defaults persist and roundtrip`.

Der Fehler ist kein langer Komplettlauf, sondern ein guter granularer Hinweis: Die Test-Erwartung und das aktuelle Verhalten von `sanitizePiboModelDefaults` passen nicht mehr zusammen.

Fehlerbild:

- Erwartet werden nur gesetzte Keys: `main`, `subagent`, `thinking`.
- Tatsächlich enthält das Ergebnis zusätzlich Keys mit Wert `undefined`: `mainThinking`, `subagentThinking`, `fast`, `mainFast`, `subagentFast`.

Betroffene Dateien:

- `test/model-defaults.test.mjs`
- `src/core/model-defaults.ts`

## Was die bestehenden Tests gut abdecken

### `test/model-catalog.test.mjs`

Stärken:

- Sehr kleine, schnelle Unit-Suite ohne echte Provider-Initialisierung.
- Prüft Provider-Gruppierung und Sortierung über Labels.
- Prüft, dass Provider-Auth-Status auf Provider und Modelle übertragen wird.
- Prüft `reasoning: false` indirekt sinnvoll, weil `supportsReasoning` dann `undefined` bleibt.

Diese Datei ist ein gutes Entwicklungs-Subset für reine Änderungen an `buildModelCatalogFromRegistry`.

### `test/model-defaults.test.mjs`

Stärken:

- Deckt Persistenzpfad über temporäres Verzeichnis ab.
- Prüft die wichtigste Priorität bei der Modellauswahl:
  1. harter Profile-Pin über `withModel`,
  2. Rollen-Override (`mainModel`/`subagentModel`),
  3. Produkt-Defaults.
- Prüft die Thinking-Level-Priorität zwischen Profile-Override und Default.

### `test/session-model-source-of-truth.test.mjs`

Stärken:

- Testet die wichtige Produktentscheidung, dass neue Sessions den aktuellen Default als `activeModel` einfrieren.
- Sichert ab, dass bestehende Sessions nicht durch später geänderte Defaults umgedeutet werden.
- Enthält einen Subagent-Fall für Subagent-Defaults.
- Prüft SQLite-Persistenz und Migration älterer Tabellen ohne `active_model_json`.

Diese Suite ist wertvoll, weil sie das Modell nicht nur als UI-Detail, sondern als Session-Source-of-Truth behandelt.

## Schwächen und Risiken

### 1. `model-defaults.test.mjs` ist nicht an die erweiterten Defaults angepasst

`src/core/model-defaults.ts` unterstützt inzwischen zusätzliche Felder:

- `mainThinking`
- `subagentThinking`
- `fast`
- `mainFast`
- `subagentFast`

Der Roundtrip-Test erwartet aber noch ein schmaleres Objekt. Dadurch schlägt die Suite fehl, obwohl der Unterschied möglicherweise nur eine Serialisierungs-/Sanitizing-Entscheidung ist.

Empfehlung: Fachlich entscheiden, ob `sanitizePiboModelDefaults` bewusst alle bekannten Keys mit `undefined` zurückgeben soll oder ob es nur gesetzte Keys ausgeben soll. Danach den Test entsprechend schärfen. Für API-Antworten und JSON-Dateien ist ein sparsames Objekt oft ergonomischer, während ein vollständiges Shape intern einfacher zu verarbeiten ist. Der Test sollte diese Entscheidung explizit machen.

### 2. Fast-Mode-Auswahl ist ungetestet

`selectRequestedFastMode` wird in `src/core/session-router.ts` verwendet, hat aber in `test/model-defaults.test.mjs` keinen eigenen Test. Das ist riskant, weil die Prioritätslogik parallel zu Thinking-Level läuft, aber boolesche Defaults zusätzliche Fallen haben:

- `false` ist ein gültiger expliziter Wert und darf nicht durch `??`-ähnliche Fallbacks ersetzt werden.
- Main- und Subagent-Fallbacks unterscheiden sich.
- Profile-Override und Produkt-Default müssen in derselben Reihenfolge wie die UI aufgelöst werden.

### 3. Rollen-spezifische Thinking-Defaults sind nur teilweise abgedeckt

Der bestehende Thinking-Test prüft `profile.thinkingLevel` vor `defaults.thinking`. Nicht direkt getestet sind:

- `mainThinking` vor globalem `thinking`,
- `subagentThinking` vor globalem `thinking`,
- Subagent-Profil-Override vor Subagent-Default,
- explizites Rollen-Override bei Main-Session.

Gerade weil Chat-UI, Router und Runtime ähnliche Prioritäten nachbilden, sollten diese Fälle in einer kleinen reinen Unit-Suite abgesichert werden.

### 4. Model-Katalog-Fehlerpfad ist zu grob

`loadModelCatalog` fängt alle Fehler und gibt `{ providers: [] }` zurück. Das ist produktseitig robust, aber ungetestet. Ein Test sollte mindestens dokumentieren, dass ein Provider-/Service-Initialisierungsfehler die Chat-Bootstrap-Antwort nicht sprengt.

Aktuell ist nur `buildModelCatalogFromRegistry` getestet, nicht `loadModelCatalog` selbst. Weil `loadModelCatalog` `createAgentSessionServices` direkt importiert, ist ein granularer Test dafür schwer. Das ist ein Hinweis auf eine kleine Testbarkeits-Lücke, nicht zwingend auf schlechten Code.

### 5. UI-Auflösung dupliziert Backend-Prioritäten

`src/apps/chat-ui/src/App.tsx` enthält eigene Resolver für:

- `resolveSessionActiveModel`,
- `resolveSessionThinkingLevel`,
- `resolveSessionFastMode`.

Diese Logik spiegelt Backend-Prioritäten aus `src/core/model-defaults.ts` und `src/core/session-model.ts`. Es gibt keine fokussierten Tests, die sicherstellen, dass UI-Badges und Backend-Runtime-Auswahl bei Main/Subagent/Custom-Agent/Static-Agent-Fällen gleich entscheiden.

Das ist besonders relevant, weil eine falsche UI-Anzeige kein Runtime-Fehler ist, aber Entwickler und Nutzer über das tatsächlich verwendete Modell täuschen kann.

### 6. Gateway-Session-Erzeugung nutzt einen separaten Pfad

`src/gateway/server.ts` setzt bei direkter Gateway-Session-Erzeugung ein `activeModel` über `selectRequestedModelProfile(profileContext, loadPiboModelDefaults())`. Der Router-Pfad dagegen nutzt `resolvePiboSessionActiveModel` und Produkt-Defaults aus den Router-Optionen.

`test/session-router-store.test.mjs` deckt den Router-Fall ab: Produkt-Defaults schlagen workspace-lokale Defaults. Ein ähnlich kleiner Test für den Gateway-Erzeugungspfad wäre sinnvoll, falls dieser Pfad weiter produktiv relevant ist.

## Fehlende oder anzupassende Tests

### A. Roundtrip-Test für Model-Defaults korrigieren

In `test/model-defaults.test.mjs` sollte der erste Test entweder:

1. explizit das vollständige interne Shape mit `undefined`-Keys erwarten, oder
2. erwarten, dass `savePiboModelDefaults`/`sanitizePiboModelDefaults` nur definierte Werte zurückgeben.

Wichtig ist nicht welche Variante gewählt wird, sondern dass der Test die gewollte API- und Dateiform klar beschreibt.

### B. Sanitizing-Fälle ergänzen

Neue kleine Fälle in `test/model-defaults.test.mjs`:

1. unbekannte Top-Level-Keys werden verworfen.
2. ungültige Modellprofile werden verworfen:
   - fehlender Provider,
   - leerer oder whitespace-only `id`,
   - Array statt Objekt.
3. ungültige Thinking-Level werden verworfen.
4. boolesche Felder akzeptieren nur echte Booleans, nicht Strings wie `"false"`.
5. gültige `false`-Werte bleiben erhalten.

### C. Fast-Mode-Auswahl ergänzen

Gezielte Fälle:

1. Main-Session: `mainFast` schlägt `fast`.
2. Subagent-Session: `subagentFast` schlägt `fast`.
3. Profile-Fast schlägt Produkt-Default.
4. `false` überschreibt ein default-`true` korrekt.

### D. Rollen-spezifische Thinking-Auswahl ergänzen

Gezielte Fälle:

1. Main: `mainThinkingLevel` vor `thinkingLevel` vor `defaults.mainThinking` vor `defaults.thinking`.
2. Subagent: `subagentThinkingLevel` vor `thinkingLevel` vor `defaults.subagentThinking` vor `defaults.thinking`.
3. Globales `thinking` bleibt Fallback, aber kein Override.

### E. Active-Model-Freeze bei Profil-Pins ergänzen

`test/session-model-source-of-truth.test.mjs` sollte zusätzlich prüfen:

1. `profile.model` gewinnt vor Session-Defaults beim ersten Freeze.
2. `profile.mainModel` gewinnt vor `defaults.main` für Main-Sessions.
3. `profile.subagentModel` gewinnt vor `defaults.subagent` für Subagents.
4. Rückgabewerte werden geklont, sodass spätere Mutation des Quellobjekts nicht die Session verfälscht.

### F. UI-/Backend-Paritätscheck als kleine reine Suite

Statt Browser-E2E sollte ein kleiner extrahierter Resolver-Test reichen. Dafür müsste die UI-Resolverlogik entweder exportierbar gemacht oder in ein kleines gemeinsames Modul verschoben werden.

Testfälle:

1. Session mit `activeModel` zeigt genau dieses Modell.
2. Static-Agent `model` schlägt Rollen-Defaults.
3. Custom-Agent `mainModel`/`subagentModel` wird rollenabhängig genutzt.
4. Backend-Default wird nur als Fallback angezeigt.
5. Thinking/Fast-Badge folgt denselben Main-/Subagent-Prioritäten.

## Empfohlene granulare Test-Kommandos/Subsets

Für reine Änderungen an Model-Defaults und Auswahlprioritäten:

```bash
npm run build
node --test test/model-defaults.test.mjs test/session-model-source-of-truth.test.mjs
```

Für reine Änderungen am Model-Katalog:

```bash
npm run build
node --test test/model-catalog.test.mjs
```

Für Session-Store- oder `activeModel`-Persistenzänderungen:

```bash
npm run build
node --test test/session-model-source-of-truth.test.mjs test/pibo-data-session-store.test.mjs test/performance-optimizations.test.mjs
```

Für Router-Integration mit Produkt-Defaults:

```bash
npm run build
node --test test/session-router-store.test.mjs
```

Diese Subsets sind deutlich gezielter als `npm test`, weil sie Modell-Auswahl, Persistenz und Router-Integration getrennt prüfbar machen.

## Konkrete nächste Schritte

1. `test/model-defaults.test.mjs` reparieren: gewünschtes Sanitizing-Shape entscheiden und Roundtrip-Erwartung anpassen.
2. In derselben Datei Sanitizing-, Fast-Mode- und rollen-spezifische Thinking-Fälle ergänzen.
3. `test/session-model-source-of-truth.test.mjs` um Profil-Pin- und Clone-Fälle erweitern.
4. Prüfen, ob `loadModelCatalog` durch Dependency Injection oder einen kleinen Wrapper testbar gemacht werden sollte, ohne echte Pi-Services zu initialisieren.
5. UI-Resolverlogik für Modell-/Thinking-/Fast-Badges aus `App.tsx` extrahieren und mit Backend-Prioritäten abgleichen.

## Kurzfazit

Die vorhandenen Tests treffen die Kernidee des Bereichs gut: Modell-Defaults werden produktseitig gewählt und pro Session als `activeModel` eingefroren. Der aktuelle granulare Check zeigt aber eine konkrete Drift: `test/model-defaults.test.mjs` ist mit dem erweiterten Defaults-Shape nicht synchron. Außerdem fehlen kleine Tests für Fast-Mode, rollen-spezifische Thinking-Defaults und UI-/Backend-Parität. Diese Lücken lassen sich mit wenigen fokussierten Unit-Tests schließen, bevor größere Chat-Web- oder Runtime-Suites nötig werden.

## Umgesetzt am 2026-05-11 12:08 Europe/Berlin

- Bereich: Fast-Mode-Auswahl und rollen-spezifische Thinking-Auswahl in `test/model-defaults.test.mjs`.
- Geänderte Dateien: `test/model-defaults.test.mjs`, `docs/reports/cron-test-reports/2026-05-10-1458-model-selection-defaults.md`.
- Ausgeführte Kommandos: `npm run build`; `node --test test/model-defaults.test.mjs`.
- Ergebnis: 4/4 Tests bestanden; abgedeckt sind `mainFast`/`subagentFast` vor globalem `fast`, explizites `false` vor default-`true`, sowie `mainThinking`/`subagentThinking` und Profil-/Rollen-Overrides vor globalem `thinking`.
- Verbleibende offene Punkte: Sanitizing-Matrix, `session-model-source-of-truth` Profil-Pin-/Clone-Fälle, Model-Katalog-Fehlerpfad und UI-/Backend-Parität bleiben offen.

## Umgesetzt am 2026-05-11 12:44 Europe/Berlin

- Bereich: Sanitizing-Matrix für Model-Defaults.
- Geänderte Dateien: `test/model-defaults.test.mjs`, `docs/reports/cron-test-reports/2026-05-10-1458-model-selection-defaults.md`.
- Ausgeführte Kommandos: `node --test test/model-defaults.test.mjs`.
- Ergebnis: Grün; 5/5 Tests bestanden. Abgedeckt sind unbekannte Top-Level-Keys, ungültige Modellprofile, ungültige Thinking-Level, boolesche Felder mit echten Boolean-Werten und die Erhaltung von explizitem `false`.
- Verbleibende offene Punkte: `session-model-source-of-truth` Profil-Pin-/Clone-Fälle, Model-Katalog-Fehlerpfad und UI-/Backend-Parität bleiben offen.

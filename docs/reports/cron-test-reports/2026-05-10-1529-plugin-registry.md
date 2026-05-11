# Test-Review: Plugin-Registry und Codex-kompatible Profiloberfläche

**Zeitpunkt:** 2026-05-10 15:29 Europe/Berlin  
**Untersuchter Bereich:** `PiboPluginRegistry`, Built-in-/Codex-Compat-Plugin-Registrierung und die zugehörigen Profil-/Capability-Catalog-Tests.

## Betrachtete Dateien

- `test/plugin-registry.test.mjs`
- `test/codex-compat.test.mjs`
- `test/runtime-tool.test.mjs` und `test/subagents.test.mjs` nur als angrenzende Subset-Probe
- `src/plugins/registry.ts`
- `src/plugins/types.ts`
- `src/plugins/builtin.ts`
- `src/plugins/codex-compat.ts`
- `src/core/profiles.ts`
- `package.json`

## Ausgeführte Checks

```bash
npm run build >/tmp/pibo-build-plugin-review.log 2>&1 && node --test test/plugin-registry.test.mjs
node --test test/codex-compat.test.mjs test/runtime-tool.test.mjs test/subagents.test.mjs
```

Ergebnis:

- `test/plugin-registry.test.mjs`: **7/7 bestanden**.
- Kombinierte angrenzende Probe: `test/codex-compat.test.mjs` bestand, aber `test/runtime-tool.test.mjs` und ein Test in `test/subagents.test.mjs` scheiterten. Diese Fehlschläge wurden nicht weiter als Zielbereich analysiert; sie zeigen aber, dass das größere Subset für schnelle Plugin-Registry-Änderungen aktuell zu breit bzw. umgebungsabhängig ist.

## Stärken

1. **Registry-Verträge sind schon gut isoliert.**  
   `test/plugin-registry.test.mjs` prüft ohne Gateway- oder Web-Server-Prozess die wichtigsten Registry-Verträge: Default-Profil, Gateway-Producer-Profil, Capability Catalog, User-Skill-Trennung, Pi-Package-Katalogeinträge, Plugin-API-Registrierung und Duplicate-Guards.

2. **Guter Schutz gegen zentrale Namenskollisionen.**  
   Der Test deckt doppelte Tools, Slash Commands, Auth Services und Web-App-Routen ab. Das passt gut zu `src/plugins/registry.ts`, wo diese Fehler früh beim Registrieren ausgelöst werden.

3. **Provider-backed Tools werden sinnvoll getrennt getestet.**  
   `test/plugin-registry.test.mjs` prüft, dass `web_search` im Catalog als native Tool ohne lokale Definition sichtbar ist. `test/codex-compat.test.mjs` ergänzt dies um aktive Profil-Inspection und OpenAI-Provider-Serialisierung.

4. **Kleines, schnelles Entwicklungs-Subset vorhanden.**  
   Nach Build läuft `node --test test/plugin-registry.test.mjs` in dieser Probe in ca. 1,2 Sekunden. Das ist ein gutes Granularitätsniveau für Änderungen an `src/plugins/registry.ts` und `src/plugins/types.ts`.

## Schwächen und Risiken

1. **`default plugin registry builds profiles...` ist ein großer Snapshot-Test.**  
   Der Test assertiert die komplette sichtbare Gateway-Action-Liste inklusive Reihenfolge und Beschreibungen. Das erkennt Drift, ist aber breit: Jede neue Built-in-Action bricht denselben Registry-Test, auch wenn das eigentliche Risiko in `src/plugins/builtin.ts` liegt. Empfehlung: den bestehenden Snapshot behalten, aber zusätzliche kleine Tests für Action-Kategorien ergänzen, damit Ursachen schneller sichtbar sind.

2. **Core-Gateway-Actions werden fast nur als Catalog-Metadaten getestet.**  
   `src/plugins/builtin.ts` enthält viele Parameter-Parser und Execute-Wrapper (`session.fork`, `session.tree_navigate`, `session.switch`, `thinking`, `login.*`, `logout`). Die Registry-Suite prüft überwiegend Namen und Slash Commands, aber nicht die Parser-Fehlerpfade und nicht, ob die Action den passenden Context-Callback mit normalisierten Parametern aufruft.

3. **Product-Event-API ist unterabgedeckt.**  
   `src/plugins/registry.ts` implementiert `emitProductEvent`, Listener-Dispatch, Fehler-Sammlung und Unsubscribe. Im betrachteten Test wird nur `onEvent`/`notifyEvent` geprüft. Für Plugins wie Context Files ist Product-Event-Verhalten wichtig, aber aktuell nicht granular in der Registry-Suite abgesichert.

4. **Web-App-Routen sind nur für einen Overlap-Fall getestet.**  
   `validateWebRoute` und `webRoutesOverlap` behandeln weitere wichtige Fälle: fehlender führender Slash, trailing Slash, Root-Pfad-Overlap, `mountPath` gegen fremdes `apiPrefix` und umgekehrt. Dafür gibt es im Registry-Test bisher keine gezielten Cases.

5. **Profil-Alias- und Upsert-/Remove-Lifecycle sind nicht direkt abgedeckt.**  
   `upsertProfile`, `removeProfile`, `upsertContextFile`, `removeContextFile` und Alias-Konflikte sind zentrale dynamische Funktionen für Custom Agents/Context Files. Die aktuelle Plugin-Registry-Suite prüft hauptsächlich initiale Registrierung. Das lässt Regressionsrisiko bei dynamischen Profilen.

6. **Angrenzende Tests sind als schnelles Subset ungeeignet.**  
   Die Probe `node --test test/codex-compat.test.mjs test/runtime-tool.test.mjs test/subagents.test.mjs` scheiterte in Runtime-/Subagent-Fällen, obwohl `codex-compat` selbst bestand. Für Registry-Änderungen sollte man diese Dateien nicht pauschal zusammen laufen lassen, sondern gezielt nach betroffenem Verhalten auswählen.

## Fehlende oder anzupassende Tests

Empfohlene kleine Ergänzungen, ohne große Integration-Suite:

1. **`test/plugin-registry.test.mjs`: Product-Event-Contract**
   - Listener erhält Event mit generierter `id` und `createdAt`.
   - Explizite `id`/`createdAt` bleiben erhalten.
   - Unsubscribe entfernt Listener.
   - Listener-Fehler landen in `getEventErrors()` und blockieren andere Listener nicht.

2. **`test/plugin-registry.test.mjs`: Web-App-Route-Matrix**
   - `mountPath` ohne `/` wird abgelehnt.
   - trailing Slash wird abgelehnt.
   - `/` überschneidet sich mit jedem anderen Pfad.
   - `mountPath` einer App überschneidet sich mit `apiPrefix` einer anderen App.
   - Gleicher `apiPrefix` bei verschiedenen Apps wird abgelehnt.

3. **Neue oder erweiterte Built-in-Action-Unit-Suite**
   - Fokus auf `src/plugins/builtin.ts`, ohne Router/Gateway.
   - Mock-Context mit Call-Recorder.
   - Positive und negative Parametertests für `session.fork`, `session.tree_navigate`, `session.switch`, `thinking`, `login.start`, `login.complete`, `login.apikey`, `logout`.
   - Ziel: Parser-Regressionen sichtbar machen, ohne die große Gateway-Action-Liste anzufassen.

4. **Dynamic-Profile-Lifecycle-Tests**
   - `upsertProfile` ersetzt Alias-Mapping sauber.
   - `removeProfile` entfernt Profil und Aliase.
   - Alias darf nicht mit bestehendem Profilnamen kollidieren.
   - `upsertContextFile` erhält Plugin-Kontext für Plugin-API-Aufrufe, `removeContextFile` entfernt per effektivem Key.

## Empfohlene granulare Test-Kommandos

Für Änderungen an `src/plugins/registry.ts`:

```bash
npm run build >/tmp/pibo-build.log 2>&1 && node --test test/plugin-registry.test.mjs
```

Für Änderungen an `src/plugins/codex-compat.ts`, `src/tools/web-search.ts` oder Codex-Profil-Zusammensetzung:

```bash
npm run build >/tmp/pibo-build.log 2>&1 && node --test test/codex-compat.test.mjs
```

Für Profil-Inspection mit Runtime-Tool-/Subagent-Oberfläche erst nach den kleinen Subsets:

```bash
npm run build >/tmp/pibo-build.log 2>&1 && node --test test/codex-compat.test.mjs test/subagents.test.mjs
```

Nicht als schneller Registry-Check empfohlen:

```bash
node --test test/codex-compat.test.mjs test/runtime-tool.test.mjs test/subagents.test.mjs
```

Diese Kombination vermischt Registry-/Profil-Verträge mit persistenten Runtime-Backends und erzeugte in diesem Lauf Fehlersignale außerhalb des untersuchten Bereichs.

## Konkrete nächste Schritte

1. `test/plugin-registry.test.mjs` um Product-Event- und Web-Route-Matrix-Cases ergänzen.
2. Eine kleine Built-in-Action-Suite schaffen oder den bestehenden Registry-Test so erweitern, dass Action-Parser getrennt von der großen Action-Liste geprüft werden.
3. Dynamic-Profile-Lifecycle gezielt testen, bevor weitere Custom-Agent- oder Context-File-Funktionen auf `upsertProfile`/`removeProfile` aufbauen.
4. Die Runtime-Tool-Fehlschläge aus der angrenzenden Probe separat prüfen; nicht in diesem Registry-Report vermischen.

## Umgesetzt am 2026-05-11 14:23 Europe/Berlin

- Bereich: Product-Event-Contract der Plugin-Registry mit generierter Metadaten-ID/`createdAt`, Erhalt expliziter Felder, Listener-Isolation bei Fehlern und Unsubscribe-Verhalten.
- Geänderte Dateien: `test/plugin-registry.test.mjs`, `docs/reports/cron-test-reports/2026-05-10-1529-plugin-registry.md`
- Ausgeführte Kommandos: `node --test test/plugin-registry.test.mjs`
- Ergebnis: Plugin-Registry-Subset grün mit 8/8 bestandenen Tests.
- Verbleibende offene Punkte: Web-App-Route-Matrix, Built-in-Action-Unit-Suite und Dynamic-Profile-Lifecycle-Tests aus diesem Report bleiben offen.

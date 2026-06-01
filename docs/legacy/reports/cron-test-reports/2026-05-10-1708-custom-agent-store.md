# Test-Review: Custom-Agent-Store und Profil-Brücke

Datum: 2026-05-10 17:08 Europe/Berlin

## Untersuchter Bereich

Dieser Lauf betrachtet gezielt die Persistenz und Runtime-Übersetzung von Custom Agents:

- `src/apps/chat/agent-store.ts`
- `src/apps/chat/agent-profiles.ts`
- Web-API-Ausschnitte in `src/apps/chat/web-app.ts` für `/api/chat/agents`
- Tests:
  - `test/agent-store.test.mjs`
  - `test/agent-profiles.test.mjs`
  - relevante Custom-Agent-Abschnitte in `test/web-channel.test.mjs`

Ausgeführt wurde nur ein kleines, passendes Subset:

```bash
node --test test/agent-store.test.mjs test/agent-profiles.test.mjs
```

Ergebnis: 9 Tests bestanden in ca. 214 ms. Kein kompletter Build- oder Gesamttestlauf, weil für diesen Review die Store-/Profil-Unit-Suite ausreicht.

## Was gut funktioniert

- `test/agent-store.test.mjs` ist schnell und fokussiert. Die Tests erzeugen temporäre SQLite-Dateien und vermeiden produktive Gateway- oder Web-Abhängigkeiten.
- Wichtige Persistenzpfade sind bereits abgedeckt:
  - Legacy-Profilnamen werden vor `list()` migriert.
  - Archivieren, Wiederherstellen und Löschen funktionieren auf Store-Ebene.
  - `autoContextFiles`, `mcpServers`, `builtinToolNames`, `piPackages` und Model-Overrides werden persistiert.
- Der Pi-Package-Test nutzt ein temporäres Arbeitsverzeichnis und prüft sowohl Deduplizierung als auch Fehler bei unbekannten Packages.
- `test/agent-profiles.test.mjs` deckt bewusst tolerante Profil-Erzeugung für fehlende Skills und Context Files ab. Das passt zum UI-Fall, in dem alte Custom Agents auf nicht mehr vorhandene Capability-Einträge zeigen können.
- `test/web-channel.test.mjs` ergänzt breite End-to-End-Flüsse für Custom-Agent-Erstellung, Session-Erzeugung, Broken-ContextFile-Anzeige, Archivierung, Delete-Schutz und Namensvalidierung.

## Schwächen und Risiken

### 1. Store-Tests decken neue Optionsfelder nur teilweise ab

`src/apps/chat/agent-store.ts` hat inzwischen mehrere Optionsfelder:

- `thinkingLevel`, `mainThinkingLevel`, `subagentThinkingLevel`
- `fast`, `mainFast`, `subagentFast`
- `builtinTools`
- `builtinToolNames`
- `mainModel`, `subagentModel`

Getestet sind aktuell nur `builtinToolNames` und die Model-Overrides. Für Thinking-/Fast-Optionen gibt es keine direkte Store-Roundtrip-Abdeckung. Das ist riskant, weil diese Felder als nullable SQLite-Spalten serialisiert werden und besonders leicht durch `undefined`, `null`, ungültige Werte oder spätere Migrationen driften.

### 2. Profil-Brücke wird zu wenig als Mapping-Vertrag getestet

`createCustomAgentProfileDefinition()` setzt viele Builder-Optionen:

- Built-in Tool Mode und Tool-Namen
- Auto-Context-Files
- MCP-Server
- Pi-Packages
- Run-Control-Package
- Main/Subagent-Modelle
- Thinking-/Fast-Optionen
- Native Tools und Subagents

Die aktuellen Tests prüfen aber nur, dass unbekannte Skills und Context Files übersprungen werden. Ein kleiner Contract-Test sollte sicherstellen, dass ein vollständiger `CustomAgentDefinition` in eine `InitialSessionContext`-Struktur mit den erwarteten Feldern übersetzt wird. Sonst können neue Felder im Store korrekt persistiert sein, aber beim Runtime-Profil unbemerkt verloren gehen.

### 3. Web-API-Coverage ist breit, aber nicht granular

Die Custom-Agent-Webtests liegen hauptsächlich in `test/web-channel.test.mjs`. Diese Suite startet einen Web-Host-Channel und prüft mehrere Produktflüsse. Das ist wertvoll für Integration, aber für Entwicklungsfeedback zu groß und thematisch gemischt.

Beispiele:

- `chat web app creates custom agents from the native capability catalog`
- `chat web app surfaces broken custom agent context files and allows cleanup`
- `chat web app archives and permanently deletes custom agents with their sessions`
- `chat web app validates custom agent profile names`

Für schnelle Entwicklung an `web-app.ts` fehlen kleinere Handler-/Normalizer-Subsets, z. B. nur für `createAgentInput()`, `createAgentUpdate()`, `normalizeAgentSubagents()` und `requireAgentProfileNameAvailable()`.

### 4. Cross-Owner-Namenssemantik ist nicht explizit getestet

`CustomAgentStore` erzwingt `profile_name TEXT NOT NULL UNIQUE`, und `requireAgentProfileNameAvailable()` prüft bestehende Agents global, nicht nur pro Owner. Das kann sinnvoll sein, weil Custom-Agent-Profile im Channel-Kontext global registriert werden. Es ist aber eine Produktannahme mit UX-Auswirkung: Zwei Nutzer können nicht denselben Custom-Agent-Namen verwenden.

Diese Annahme sollte mit einem gezielten Test dokumentiert werden. Falls später Profile pro Owner isoliert werden, wäre genau dieser Test der Änderungsmarker.

### 5. Legacy-Migrationen sind nur für Profilnamen direkt geprüft

Der Store enthält Migrationen für mehrere Spalten:

- `archived_at`
- `auto_context_files`
- `mcp_servers_json`
- `pi_packages_json`
- `main_model_json`, `subagent_model_json`
- `thinking_level`
- Thinking-/Fast-Optionsspalten
- `builtin_tool_names_json`

Direkt getestet ist nur die Legacy-Profilnamenmigration. Ein kleiner Migrationstest mit einer minimalen alten Tabelle würde mehr Sicherheit geben, ohne einen breiten Integrationslauf zu brauchen.

## Fehlende oder anzupassende Tests

Empfohlene kleine Tests, ohne direkte Implementierung in diesem Cron-Lauf:

1. **Store-Roundtrip für Thinking/Fast/Builtin-Mode**
   - Datei: `test/agent-store.test.mjs`
   - Prüfen: create + update + get für `thinkingLevel`, `mainThinkingLevel`, `subagentThinkingLevel`, `fast`, `mainFast`, `subagentFast`, `builtinTools`.
   - Auch prüfen: ungültige Thinking-Level werden auf Store-Ebene verworfen oder auf Web-Ebene abgelehnt, je nach gewünschtem Vertrag.

2. **Profil-Mapping-Contract**
   - Datei: `test/agent-profiles.test.mjs`
   - Ein vollständiger Custom Agent mit Tools, Subagent, MCP, Pi-Package, Models, Thinking/Fast und Run-Control wird in `profile.create()` übersetzt.
   - Erwartung: `session` enthält exakt diese Auswahl.

3. **Cross-Owner-Agent-Name-Test**
   - Datei: `test/agent-store.test.mjs` oder ein kleines Web-API-Subset.
   - Aktuelle Erwartung, falls global gewollt: gleicher `displayName` bei anderem `ownerScope` schlägt fehl.
   - Alternative Erwartung, falls pro Owner gewollt: Schema/Registrierung müsste später geändert werden. Der Test macht die Entscheidung sichtbar.

4. **Migration-Snapshot für alte Tabellen**
   - Datei: `test/agent-store.test.mjs`
   - Alte `chat_agents`-Tabelle ohne neue Spalten anlegen, Store öffnen, `get()`/`list()` prüfen.
   - Erwartung: Defaultwerte sind stabil, besonders `autoContextFiles === true` und `builtinToolNames` entspricht dem Default.

5. **Kleiner Web-Normalizer-Test statt nur Web-Channel-E2E**
   - Aktuell sind die Normalizer nicht exportiert. Entweder bewusst so lassen und Web-Channel-Tests akzeptieren, oder eine kleine testbare Boundary einführen.
   - Ziel wäre ein schneller Test für invalides `subagents`, `builtinTools`, `mainModel`, `thinkingLevel`, `piPackages` ohne kompletten Web-Host.

## Empfohlene granulare Test-Kommandos

Für Store-/Profil-Arbeit:

```bash
node --test test/agent-store.test.mjs
node --test test/agent-profiles.test.mjs
node --test test/agent-store.test.mjs test/agent-profiles.test.mjs
```

Für Web-API-Flüsse erst später im Entwicklungsflow:

```bash
node --test test/web-channel.test.mjs --test-name-pattern "custom agents|agent profile names|legacy custom agent"
```

Falls ein Build nötig ist, weil die Tests aus `dist/` importieren:

```bash
npm run build
node --test test/agent-store.test.mjs test/agent-profiles.test.mjs
```

## Konkrete nächste Schritte

1. Einen kleinen Store-Test für Thinking-/Fast-/Builtin-Mode-Roundtrips ergänzen.
2. Einen Profil-Mapping-Test ergänzen, der alle aktuellen `CustomAgentDefinition`-Felder einmal bis in den erzeugten Session-Kontext verfolgt.
3. Die globale Namensentscheidung für Custom Agents explizit testen und im Testnamen dokumentieren.
4. Danach erst die breiteren Web-Channel-Custom-Agent-Tests als Integrationsabsicherung nutzen.

## Umgesetzt am 2026-05-11 13:38 Europe/Berlin

- Bereich: Globale Custom-Agent-Namenssemantik über Owner-Grenzen hinweg.
- Geänderte Dateien: `test/agent-store.test.mjs`, `docs/reports/cron-test-reports/2026-05-10-1708-custom-agent-store.md`.
- Ausgeführte Kommandos: `node --test test/agent-store.test.mjs`.
- Ergebnis: Grün; 9/9 Agent-Store-Tests bestanden. Der neue Test dokumentiert, dass identische `displayName`/`profileName`-Werte auch bei unterschiedlichem `ownerScope` abgelehnt werden, und prüft, dass dabei kein Agent für den zweiten Owner angelegt wird.
- Verbleibende offene Punkte: Profil-Mapping-Contract, Migration-Snapshot und kleinere Web-Normalizer-Tests sind weiterhin offen.

## Umgesetzt am 2026-05-11 14:33 Europe/Berlin

- Bereich: Migration-Snapshot für alte `chat_agents`-Tabellen ohne neuere Optionsspalten.
- Geänderte Dateien: `test/agent-store.test.mjs`, `docs/reports/cron-test-reports/2026-05-10-1708-custom-agent-store.md`.
- Ausgeführte Kommandos: `node --test test/agent-store.test.mjs`.
- Ergebnis: Grün; 10/10 Agent-Store-Tests bestanden. Abgesichert ist, dass Migrationen stabile Defaults für `autoContextFiles`, MCP-/Pi-Package-Listen, Built-in-Tool-Namen, Model-/Thinking-/Fast-Felder, `archivedAt` und `runControl` liefern.
- Verbleibende offene Punkte: Profil-Mapping-Contract und kleinere Web-Normalizer-Tests bleiben offen.

## Betrachtete Dateien und Kommandos

Gelesen/analysiert:

- `GLOSSARY.md`
- `AGENTS.md`
- `package.json`
- `src/apps/chat/agent-store.ts`
- `src/apps/chat/agent-profiles.ts`
- `src/apps/chat/web-app.ts`
- `test/agent-store.test.mjs`
- `test/agent-profiles.test.mjs`
- relevante Treffer in `test/web-channel.test.mjs`

Ausgeführt:

```bash
find . \( -path './node_modules' -o -path './.git' -o -path './dist' -o -path './.worktrees' \) -prune -o -type f \( -name '*test*' -o -name '*spec*' -o -name 'vitest.config*' -o -name 'playwright.config*' -o -name 'jest.config*' \) -print
rg -n "agents|customAgents|agentStore|/agents" test/*.test.mjs
rg -n "thinkingLevel|mainThinking|subagentThinking|mainFast|subagentFast|builtinTools|builtinToolNames|autoContextFiles|runControl|mainModel|subagentModel" test/*.test.mjs src/apps/chat/agent-store.ts src/apps/chat/agent-profiles.ts
node --test test/agent-store.test.mjs test/agent-profiles.test.mjs
```

## Umgesetzt am 2026-05-11 12:53 Europe/Berlin

- Bereich: Store-Roundtrip für Thinking-/Fast-/Builtin-Mode-Optionen in Custom Agents.
- Geänderte Dateien: `test/agent-store.test.mjs`, `docs/reports/cron-test-reports/2026-05-10-1708-custom-agent-store.md`.
- Ausgeführte Kommandos: `npm run build`; `node --test test/agent-store.test.mjs`.
- Ergebnis: Build erfolgreich; 8/8 Agent-Store-Tests bestanden. Der neue Test prüft create/update/get für `thinkingLevel`, `mainThinkingLevel`, `subagentThinkingLevel`, `fast`, `mainFast`, `subagentFast` und `builtinTools`, inklusive Sanitizing ungültiger Werte.
- Verbleibende offene Punkte: Profil-Mapping-Contract, Cross-Owner-Namenssemantik, Migration-Snapshot und kleinere Web-Normalizer-Tests sind weiterhin offen.

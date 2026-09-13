---
type: "Validation Report"
title: "Plugin-System-Umbau: konsolidierter Entwicklungsstand"
description: "Dokumentiert den isolierten Implementierungsstand, geprüfte Modulgrenzen und noch offene Produktintegration nach dem begrenzten Multi-Agent-Arbeitsfenster."
tags: ["plugins", "validation", "migration", "checkpoint"]
status: "draft"
authority: "evidentiary"
generated: { by: "openai-codex/gpt-6", at: "2026-09-12T09:57:58Z" }
sources:
  - id: "continuation-authorization"
    resource: "scope:owner continuation instruction 2026-09-12; implement the complete rebuild with subagents; old-session restrictions explicitly do not apply and must be removed from the handoff"
  - id: "rebuild-plan"
    resource: "/plans/unified-plugin-system-rebuild.md"
  - id: "execution-ledger"
    resource: "/plans/unified-plugin-system-execution.md"
  - id: "implementation"
    resource: "scope:plugin-system-rebuild source commit fdc7b887f73bdf9aa5fcf873b1bc931d921ba3dd; baseline upstream/dev cac4dcd03945b9754db7be9ab2ab4324f10c335c; isolated Docker validation"
---

# Einordnung

Dies ist ein gesicherter Entwicklungszwischenstand des [vollständigen Umbaus](/plans/unified-plugin-system-rebuild.md), keine abgeschlossene Produktmigration. In der damaligen Session begrenzte der Nutzer das verbleibende Arbeitsfenster und untersagte für deren Abschluss weitere Agents. Diese zeitlich begrenzten Anweisungen gelten nicht für die Fortsetzung. Vorhandene Worker erhielten direkte Steering-Nachrichten zum geordneten Abschluss; ihre laufenden Aufgaben wurden nicht vorsorglich abgebrochen. Die [Abnahmematrix](/plans/unified-plugin-system-execution.md#acceptance-register) bleibt offen.

Die Änderungen entstanden auf `plugin-system-rebuild` in einem separaten Worktree, ausgehend von `cac4dcd03945b9754db7be9ab2ab4324f10c335c`. Builds, Tests und temporäre Datenmutationen liefen im isolierten Docker-Worker. Der Controller-Gateway wurde nicht neu gestartet, umkonfiguriert oder aktualisiert. Es gibt keinen Pibo2-Nachweis, PR, Merge, Release oder veröffentlichten Kandidaten.

# Übergabe und gesicherter Arbeitsstand

**Dieser Bericht ist der Einstieg für einen neuen implementierenden Agent.** Er benötigt Zugriff auf den unten genannten Worktree/Branch und dessen verlinkte Dateien. Eine isolierte Kopie dieses Markdown-Textes enthält den Implementierungsstand nicht. Der Branch wurde noch nicht gepusht. Für die Fortsetzung sind weder alte Agent-Kontexte noch Dateien unter `/tmp` erforderlich; die dortigen fachlichen Ergebnisse sind jetzt im [Artefaktregister](#vollständiges-artefaktregister) erhalten.

| Gegenstand | Verbindlicher Einstieg |
|---|---|
| Quellcode | `/root/code/pibo/.worktrees/plugin-system-rebuild`, Branch `plugin-system-rebuild` |
| Ausgangspunkt | `cac4dcd03945b9754db7be9ab2ab4324f10c335c` (`upstream/dev` beim Start) |
| Plan und Basisinventar | Commit `932c72f3`; [vollständiger Plan](/plans/unified-plugin-system-rebuild.md) und [Arbeits-/Abnahmestand](/plans/unified-plugin-system-execution.md) |
| Getesteter Produktcode | `fdc7b887f73bdf9aa5fcf873b1bc931d921ba3dd` |
| Erste gesicherte Dokumentation | `e1eaa13e`; spätere reine Dokumentationscommits ergänzen diesen Übergabe-Audit |
| Isolierte Ausführung | Docker `pibo-dev-plugin-system-rebuild`, Source `/workspace`, Speicherlimit 2 GiB; Ports 4840–4844 reserviert, kein Test-Gateway gestartet |
| Git im Docker-Worker | Isolierter Spiegel `/tmp/pibo-plugin-history.git`, Worktree `/workspace`; nach neuen Host-Commits vor strikten Docs-Prüfungen synchronisieren |
| Zusätzliche lokale Sicherung | `/root/code/pibo-checkpoints/plugin-system-rebuild-2026-09-12.bundle`; inkrementelles Git-Bundle ab obiger Basis, mit `git bundle verify` prüfen; enthält keine Abhängigkeiten/Containerdaten |

Der Controller-Checkout `/root/code/pibo` enthält fremde Änderungen und ist **nicht** die Arbeitskopie dieses Umbaus. Quelländerungen, Builds und Tests gehören in den isolierten Docker-Worker. Die [genauen Prüfkommandos](artifacts/plugin-system-checkpoint-2026-09-12/validation-commands.txt) nennen den Zielcontainer ausdrücklich und verwenden die gemeinsame Validierungssperre. Bei einem neuen Docker-Worker dessen Aufbau und Git-Spiegel nach den vorhandenen Docker-Skills herstellen; keinen experimentellen Host-Gateway verwenden.

**Fortsetzung in der neuen Session, 2026-09-12:** Der Nutzer hat den vollständigen Umbau nach dem präzisierten Plan beauftragt und den Einsatz von Subagents ausdrücklich bestätigt. Die Abschlussbeschränkungen der alten Session sind aufgehoben und werden nicht auf neue Sessions übertragen. Dieser Bericht beschreibt den damaligen Implementierungs- und Prüfstand; den laufenden Arbeitsstand führt das [Arbeitsregister](/plans/unified-plugin-system-execution.md). Für Umsetzung und Abnahme gelten die aktuellen Projektregeln für Docker, Pibo2 und GitHub.

# Fortschritt und Vollständigkeitsgrenze

Die Aufwandsschätzung des Orchestrators beträgt **etwa 30 Prozent des vollständigen Umbaus, plausibler Bereich 25–35 Prozent**. Das ist eine grobe Einschätzung nach vorhandenem Fundament und verbleibender Produktintegration, keine aus Testanzahl oder gleich großen Arbeitspaketen berechnete Messzahl. AP00–AP10 sowie AP15/AP16 haben Teilergebnisse; AP11–AP14 und AP17–AP19 haben noch keinen abgeschlossenen Implementierungsmeilenstein. **Kein AP ist vollständig abgenommen; 0 von 37 Abnahmeszenarien sind geschlossen.**

Die technischen Fundamente sind wesentlich weiter als das nutzbare Gesamtprodukt. Ein vollständiger installierter Feature-Durchstich fehlt, und die Standardoberfläche ist vorübergehend unvollständig. Aufwand und Risiken der breiten Extraktion werden erst durch AP11 belastbarer abschätzbar.

# Vorliegende Implementierung

| Bereich | Vorliegender Code und geprüfte Grenzen | Offene Produktverbindung |
|---|---|---|
| SDK, Host und Resolver | Browserfähige SDK-Exports mit Deklarationen; Manifestvalidierung; gemeinsame Ownership und rückwärts aufgeräumte Scopes; reine Auswahlauflösung; Runtime-Kompatibilität; explizite Revisionen und Konfigurationsprovenienz | Sichere Änderung einer laufenden Produktkomposition und vollständige Builtin-Manifeste |
| Dienste | Host und Resolver verwenden dieselbe Auswahlregel für Anbieter; benötigte Anbieterrevisionen werden ohne implizite Agent-Tools in den Plan aufgenommen | Vollständige Besitzer- und Verbraucherprojektion an jeder Produktgrenze |
| Installation und Persistenz | Inhaltsadressierte Artefakte, Integritätsprüfung vor Import, CAS, Operationen, Generationenreservierungen, immutable Snapshots und Payload-Verweise | Standard-Manager, Anbindung von `runPluginCli` an `src/cli.ts`, vollständige Live-/Profil-Collector und sicherer Lifecycle |
| Deinstallation und Migration | Bestätigungsplan mit erneuter Verbraucherprüfung; Retirement-Sperre; erhaltene Sessions und Historie; Journal mit echten Prozessabbruchtests | Migration realer vollständiger Produktbestände und integrierte Wiederaufnahme |
| Web-API | Bestehende Authentisierung und Origin-Prüfung vor Managementzugriff; feste Sessionbindung; gespeicherter Plan getrennt von reiner Vorschau; isolierte Browser-Assets | Standarddienste und sämtliche Designer-v2-Dispatcher-/Normalizer-Anschlüsse |
| Runtime | Gemeinsamer Generationenplan, Admission, Hooks und getrennte gespeicherte Builds/Vorschau; explizite Pi-Discovery-Grenze | Vollständige Standardkomposition und echte Ausführung auf Pi, Codex und OMP |
| Browser und Designer | Generischer Browser-Host, sessiongebundene CAS-Tabsets, Plugin-Auswahl und Konfigurationsziele; AgentStore-CAS und Migration | Vollständige Default-Manifeste, ausgelieferte Browser-Einstiege und authentisierte headful Produktprüfung |

Die Default-Oberfläche ist im Umbau: entfernte feste Ansichten werden noch nicht vollständig durch installierte Beiträge ersetzt. Ein erfolgreicher Build ist daher keine Freigabe für die bestehende Benutzerführung. Fehlende Produktdienste liefern ausdrücklich einen Fehler, statt einen zweiten Host oder einen unvollständigen Verbraucher-Collector zu erfinden.

# Integrationskorrekturen

- Alle Backend-Artefakte werden vor dem ersten Pluginimport geprüft. Die SDK-Auflösung liegt außerhalb der gehashten Artefakte und verwendet das tatsächlich installierte Pibo-Paket.
- Die Web-Routen laufen vor alten Katalog-/Profil-Wartungsschritten. Ihre Lesepfade dürfen keine Profile erzeugen, Eventindizes aktivieren oder eine Runtime starten.
- `kind=actual` liefert ausschließlich gespeicherte Generationen; `kind=preview` verwendet auch bei vorhandener Historie die reine Vorschau. Eine fremde Session im Antwortplan wird abgewiesen.
- Ein Browser-Einstieg im Paketroot veröffentlicht nur sich selbst. Ein Unterverzeichnis darf keine deklarierte Backend-Datei enthalten. Pfadtraversal, falsche Kodierung und Symlink-Ausbrüche werden geprüft.
- Benötigte Service-Anbieter werden einschließlich Artefaktrevision in den Generationenplan aufgenommen. Mehrdeutige oder nicht deklarierte Ersetzungen scheitern; fremde Agent-Tools bleiben deaktiviert.

# Verifikation

**Getesteter Quellcommit:** `fdc7b887f73bdf9aa5fcf873b1bc931d921ba3dd`. Die [Dateihashes](/reports/artifacts/plugin-system-checkpoint-2026-09-12/source-inventory.json) fixieren die geänderten Quell-/Testdateien gegenüber der Basis. Die anschließenden Dokumentationscommits verändern keinen Produktcode. Der Übergabe-Audit verglich alle 97 erfassten Dateien mit ihren Hashes und prüfte, dass keine gegenüber der Basis geänderte Produkt-/Testdatei im Inventar fehlt.

| Prüfung auf diesem Quellstand | Ergebnis |
|---|---|
| `npm run build` einschließlich Workflow-, Backend-, SDK-, Web- und bestehendem VSCode-Webview-Build | bestanden |
| `npm run chat-ui:typecheck` | bestanden |
| `node --test --test-concurrency=1 test/plugin-system-*.test.mjs` | **170/170 bestanden**, keine Skips |
| Zusammengeführte betroffene Bestandsregressionen, 19 Testdateien | **111/123 bestanden, 12 offen**, keine Skips |
| Öffentlicher SDK-Einstieg als Browserbundle | bestanden; keine Node-Imports |
| `npm run docs:validator:test` | **84/84 bestanden** |
| Strikte Dokumentation, Indizes und Änderungslog | 802 Markdown-Pfade, null Fehler/Warnungen; erneut nach finaler Dokumentation geprüft |

Der [vollständige Build-/Plugin-Testlauf](/reports/artifacts/plugin-system-checkpoint-2026-09-12/committed-build-and-plugin-tests.log), die [offenen Bestandsfälle](/reports/artifacts/plugin-system-checkpoint-2026-09-12/regression-summary.txt), der [vollständige Bestandslauf](/reports/artifacts/plugin-system-checkpoint-2026-09-12/committed-regressions.log) und die [Dokumentationstests](/reports/artifacts/plugin-system-checkpoint-2026-09-12/documentation-tests.log) sind erhalten. Das bestehende Vite-Chunkgrößen-Advisory und die Test-Renderer-Deprecation sind keine bestandene Browserabnahme.

Die zwölf offenen Fälle verteilen sich auf eine alte Pi-Package-Ablehnung, zwei Altshell-Source-Assertions und neun Build-Context-/Skill-Inspector-Erwartungen. Teilweise haben sich die beabsichtigten Verträge geändert; die Default-Oberfläche ist zugleich tatsächlich unvollständig verdrahtet. Diese Befunde müssen vor einer Produktfreigabe fachlich abgeglichen werden. Keine Assertion wurde nur für eine grüne Zahl entfernt. Der zunächst fehlgeschlagene Resource-Inspector-Fall wurde durch die reine Projektion bereits vorhandener Sessionmetadaten korrigiert und besteht im abschließenden Lauf.

Die TypeScript-/React-Tests verwenden jetzt einen expliziten lokalen Lader; die Browser-Modell-/Hosttests liegen im regulär entdeckten Testverzeichnis. Ein globales `--import tsx` ist für diese Tests nicht mehr nötig. Für die Controller-Bind-Unitprüfungen wurde ausschließlich im Testprozess `PIBO_COMPUTE_WORKER` entfernt, damit die simulierte Controller-Grenze geprüft wird. Der Docker-Worker und seine Authentisierung wurden nicht verändert.

Der spätere [Übergabe-Audit](artifacts/plugin-system-checkpoint-2026-09-12/handoff-integrity.json) und dessen [Dokumentationsprüfung](artifacts/plugin-system-checkpoint-2026-09-12/handoff-documentation-validation.log) ergänzen diese Belege; dabei wurde kein Produktcode geändert und kein Produkt-Testlauf als neu ausgeführt dargestellt.

Die ausführlichen Teilübergaben sind als [Management](/reports/artifacts/plugin-system-checkpoint-2026-09-12/worker-management.txt), [Browser](/reports/artifacts/plugin-system-checkpoint-2026-09-12/worker-browser.txt), [Designer](/reports/artifacts/plugin-system-checkpoint-2026-09-12/worker-designer.txt) und [Runtime](/reports/artifacts/plugin-system-checkpoint-2026-09-12/worker-runtime.txt) erhalten. Ihre Teilprüfungen überlappen und sind nicht zusätzlich zu summieren. Der Core-Aufruf war vor seinem Abschlussbericht abgebrochen; erhaltene Core-Änderungen wurden vom Orchestrator geprüft und in den gemeinsamen Lauf einbezogen.

Die neuen Plugin-Routen lesen gespeicherte Generationen und eine separat injizierte Vorschau. Der **alte** `buildContextBuildSnapshotForRequest`-HTTP-Pfad erzeugt dagegen weiterhin eine Inspection-Ressourcen-Session; dieser Anschluss bleibt ausdrücklich offen. Die aktuelle Standardkomposition veröffentlicht noch keinen vollständigen PluginManager/Runtime-Coordinator und keine installierten Default-Browser-Manifeste. Der Branch ist damit **nicht merge- oder releasefähig**.

# Nächster Einstieg

1. Standard-Manager, tatsächlichen CLI-Dispatcher und sicher abgegrenzten Host-Lifecycle mit vollständigen Verbrauchern verbinden. Kein Stop-all-Adapter für die Deinstallation eines einzelnen Plugins.
2. Runtime-Coordinator, Service-Anbieter, reine Vorschau und Designer-v2-Normalisierung durch die echten Dispatcher verdrahten. Fehlende oder unveränderte Legacy-Referenzen erhalten; nicht still durch Defaults ersetzen.
3. Default-Browser-Manifeste, gemeinsame React-/SDK-Auslieferung und installierte Web Annotations gemäß AP11 integrieren. Desktop und schmale Ansicht mit echten Sessions prüfen, einschließlich A→B→A und Replay.
4. Erst nach AP11-Abnahme AP12–AP18 fortsetzen: gesamte Builtin-Extraktion, Migration und Entfernung alter Pfade einschließlich eigenständiger TUI und beider VSCode-Oberflächen.
5. Den exakten integrierten Kandidaten vollständig lokal, außerhalb des Repositorys und anschließend auf Pibo2 prüfen. A01–A37 einzeln mit tatsächlicher Evidenz schließen; aktuelle Spezifikationen erst dann auf das nachgewiesene Produktverhalten umstellen.

# Konkrete Code-Einstiege und nächste Prüfpunkte

Alle Pfade sind relativ zum oben genannten Worktree. Die detaillierten Verträge und Abschlussberichte stehen im folgenden Register; bei Widersprüchen gelten Plan, getesteter Quellcode und dieser konsolidierte Stand vor älteren Zwischenberichten.

| Bereich | Code-Einstieg | Nächster offener Nachweis |
|---|---|---|
| SDK/Host/Resolver | `src/plugins/{sdk,manifest,host,scope,services,service-providers,selection,resolution}.ts` | Vollständige Default-Provider und sicherer gezielter Plugin-Lifecycle; keine zweite aktive Registry |
| Installation und Bootstrap | `src/plugins/{manager,store,operations,sources,backend-loader,product-services,cli}.ts`, `src/cli.ts`, `src/gateway/server.ts` | Standard-Manager und Service-Publikation; `runPluginCli` ist vorhanden, aber noch nicht im echten CLI-Dispatcher angeschlossen; vollständige Verbraucher statt unbekannte Beziehungen als frei zu behandeln |
| Runtime und Inspector | `src/agent-runtime/{plugin-plan,plugin-context-build,legacy-context-preview,plugin-hooks}.ts`, `src/core/session-router.ts`, `src/apps/chat/web-app.ts` | `pluginRuntime`-Injection, reine Vorschau, wirkliche Adapter-Lieferung; alten `buildContextBuildSnapshotForRequest` ohne Inspection-Ressourcen-Session ersetzen |
| Designer/Migration | `src/apps/chat/{agent-store,agent-profiles,chat-capability-routes}.ts`, `src/apps/chat-ui/src/agents/`, `src/plugins/{migration-journal,product-state-migration}.ts` | v2-Validierung, Revision/CAS und Normalisierung durch echte Web-Dispatcher; reale Altbestände und sämtliche unabhängigen Ressourcen erhalten |
| Browser und Sessionwechsel | `src/apps/chat-ui/src/plugins/`, `src/apps/chat/plugin-browser-routes.ts`, `src/apps/chat-ui/src/App.tsx` | Default-Manifeste und gemeinsamer React-/SDK-Modulgraph; Routing/`openView`; A→B→A mit unbestätigten Saves, StrictMode/AbortSignal, awaitbare Navigation-Guards und Wiederherstellung außerhalb austauschbarer Shell prüfen |
| Settings/Terminal/Composer | `src/apps/chat-ui/src/plugins/{plugin-settings,build-context-view,builtin-browser-entry}.tsx`, `src/apps/chat-ui/src/composer/Composer.tsx` | Konfigurationsversion aus Metadaten statt fester Annahme, vollständige Paste-/Drop-/Send-Hooks, Replay/Fallback und historische Herkunft; derzeit nur Teiltests |
| Fixtures und Abnahme | `test/fixtures/plugin-system/`, `test/plugin-system-*.test.mjs`, A01–A37 im Plan | Annotations als gewöhnlich installiertes Plugin, vollständiges Migrationsinventar, Headful- und echte Pi/Codex/OMP-Ausführung |

Die zwölf Bestandsfehler zuerst anhand des vollständigen Fehlerlogs fachlich einordnen: bestätigte Verhaltensregression beheben oder eine absichtlich geänderte Erwartung mit Ersatznachweis aktualisieren. Keine pauschale Löschung von Alttests. Die erste vollständige Produktabnahme bleibt AP11; breite AP12–AP14-Extraktion hängt daran.

# Abschluss der früheren Agent-Arbeit

Alle zehn früheren Worker-/Researcher-Sessions sind bei der erneuten [Statusprüfung](artifacts/plugin-system-checkpoint-2026-09-12/agent-status.json) inaktiv. Die vier zum Abschlussfenster laufenden Worker erhielten um 06:34 UTC direkte Steering-Nachrichten und beendeten danach ihre Arbeit. Es läuft kein Worker weiter, der noch ungesicherte Änderungen nachliefern soll.

| Stream | Übernommener Endzustand |
|---|---|
| Core | Aufruf vor Abschlussbericht abgebrochen; Vertrags-/Fortschrittsbericht und Änderungen erhalten, vom Orchestrator geprüft und gemeinsam getestet |
| Management | Abschlussbericht erhalten; Installation, Persistenz, Journal und Retirement-Module integriert |
| Runtime | Abschlussbericht erhalten; Generationenplan und Hooks integriert, Standardverbindungen offen |
| Browser | Äußerer Run meldete Fehler, die tatsächliche Session lief noch weiter und endete nach Steering; finaler Bericht erhalten |
| Designer | Abschlussbericht erhalten; UI-/Store-/Migrationsfundament integriert, echter v2-Dispatcher offen |
| Research | Drei fachliche Berichte erhalten; Desktop-/Abnahme-Recherche ohne vollständigen Abschlussbericht. Diese Inventarlücken bleiben AP00-Arbeit und werden nicht als erledigt dargestellt |

# Vollständiges Artefaktregister

Alle nachfolgend verlinkten Dateien gehören zum Branch. `historical-*`, Verträge und Einzelberichte sind eingefrorene Arbeitsstände: frühe Testzahlen, damalige Zuständigkeiten und Agent-Aufträge sind keine aktuellen Freigaben. Besonders die drei Rechercheberichte untersuchten teilweise den alten Controller-Checkout `2cd45f171ca615c11927a8719819aff05f20e1fd`; ihre Fundstellen müssen gegen die Implementierungsbasis abgeglichen werden.

Das [Scratch-Inventar](artifacts/plugin-system-checkpoint-2026-09-12/scratch-artifact-inventory.json) weist jede vorgefundene Datei des früheren Rechercheverzeichnisses mit Hash und Übernahmeentscheidung aus. Fachliche Berichte, Verträge, Baseline-Auszüge und Testläufe sind erhalten. Überholte Fortsetzungs-/Run-Zustände werden durch diesen Bericht ersetzt; reine Client-/Steering-Transportprotokolle sind bewusst nicht als Implementierungsevidenz übernommen. Die drei Rechercheberichte ersetzen kein vollständiges AP00-Inventar.

Die Fixture-Kopien entsprechen `test/fixtures/plugin-system/legacy-builtin-catalog.json` und `legacy-agent-selections.json`. Erstere fixiert den tatsächlichen Basiskatalog, letztere synthetische Auswahlfälle aus dem Baseline-Vertrag; beide sind keine Kopie produktiver Benutzerdaten. Vollständige globale Tab-/Settings-Migrationsfixtures fehlen weiterhin.

| Artefakt | Rolle |
|---|---|
| [agent-status.json](artifacts/plugin-system-checkpoint-2026-09-12/agent-status.json) | Erneut gelesener Endzustand sämtlicher früherer Agent-Sessions |
| [committed-build-and-plugin-tests.log](artifacts/plugin-system-checkpoint-2026-09-12/committed-build-and-plugin-tests.log) | Integrierter Build und 170 neue Plugin-Tests |
| [committed-regressions.log](artifacts/plugin-system-checkpoint-2026-09-12/committed-regressions.log) | Vollständiger Bestandslauf mit 12 Fehlern und Assertiondetails |
| [contract-browser.txt](artifacts/plugin-system-checkpoint-2026-09-12/contract-browser.txt) | Vertragsübergabe des browser-Streams; spätere Integrationskorrekturen beachten |
| [contract-core.txt](artifacts/plugin-system-checkpoint-2026-09-12/contract-core.txt) | Vertragsübergabe des core-Streams; spätere Integrationskorrekturen beachten |
| [contract-designer.txt](artifacts/plugin-system-checkpoint-2026-09-12/contract-designer.txt) | Vertragsübergabe des designer-Streams; spätere Integrationskorrekturen beachten |
| [contract-management.txt](artifacts/plugin-system-checkpoint-2026-09-12/contract-management.txt) | Vertragsübergabe des management-Streams; spätere Integrationskorrekturen beachten |
| [contract-runtime.txt](artifacts/plugin-system-checkpoint-2026-09-12/contract-runtime.txt) | Vertragsübergabe des runtime-Streams; spätere Integrationskorrekturen beachten |
| [core-integration-progress.txt](artifacts/plugin-system-checkpoint-2026-09-12/core-integration-progress.txt) | Erhaltener Core-Zwischenbericht vor Abbruch |
| [documentation-tests.log](artifacts/plugin-system-checkpoint-2026-09-12/documentation-tests.log) | 84 bestandene Dokumentationstests im ursprünglichen Checkpoint |
| [documentation-validation.log](artifacts/plugin-system-checkpoint-2026-09-12/documentation-validation.log) | Strikte Docs-, Index- und Log-Prüfung im ursprünglichen Checkpoint |
| [fixture-legacy-agent-selections.json](artifacts/plugin-system-checkpoint-2026-09-12/fixture-legacy-agent-selections.json) | Bytegleiche Kopie der synthetischen Legacy-Auswahlfälle |
| [fixture-legacy-builtin-catalog.json](artifacts/plugin-system-checkpoint-2026-09-12/fixture-legacy-builtin-catalog.json) | Bytegleiche Kopie des Basiskatalog-Fixtures |
| [historical-ap00-ap04-kernel-sdk-research.txt](artifacts/plugin-system-checkpoint-2026-09-12/historical-ap00-ap04-kernel-sdk-research.txt) | Historische Recherche: Kernel, SDK und Integrationsgrenzen; Baselineabweichung beachten |
| [historical-baseline-paths.txt](artifacts/plugin-system-checkpoint-2026-09-12/historical-baseline-paths.txt) | Historischer Inventar-/Quellauszug; kein vollständiger Abnahmebeleg |
| [historical-browser-tests-1.log](artifacts/plugin-system-checkpoint-2026-09-12/historical-browser-tests-1.log) | Historischer Teilprüflauf; Ergebnis nicht zum integrierten Teststand addieren |
| [historical-browser-typecheck-1.log](artifacts/plugin-system-checkpoint-2026-09-12/historical-browser-typecheck-1.log) | Historischer Teilprüflauf; Ergebnis nicht zum integrierten Teststand addieren |
| [historical-browser-validation-2.log](artifacts/plugin-system-checkpoint-2026-09-12/historical-browser-validation-2.log) | Historischer Teilprüflauf; Ergebnis nicht zum integrierten Teststand addieren |
| [historical-browser-validation-final.log](artifacts/plugin-system-checkpoint-2026-09-12/historical-browser-validation-final.log) | Historischer Teilprüflauf; Ergebnis nicht zum integrierten Teststand addieren |
| [historical-composition-baseline-lines.txt](artifacts/plugin-system-checkpoint-2026-09-12/historical-composition-baseline-lines.txt) | Historischer Inventar-/Quellauszug; kein vollständiger Abnahmebeleg |
| [historical-designer-closure-validation.log](artifacts/plugin-system-checkpoint-2026-09-12/historical-designer-closure-validation.log) | Historischer Teilprüflauf; Ergebnis nicht zum integrierten Teststand addieren |
| [historical-designer-final-source-tests.log](artifacts/plugin-system-checkpoint-2026-09-12/historical-designer-final-source-tests.log) | Historischer Teilprüflauf; Ergebnis nicht zum integrierten Teststand addieren |
| [historical-designer-final-validation.log](artifacts/plugin-system-checkpoint-2026-09-12/historical-designer-final-validation.log) | Historischer Teilprüflauf; Ergebnis nicht zum integrierten Teststand addieren |
| [historical-designer-tests-first.log](artifacts/plugin-system-checkpoint-2026-09-12/historical-designer-tests-first.log) | Historischer Teilprüflauf; Ergebnis nicht zum integrierten Teststand addieren |
| [historical-designer-tsc-first.log](artifacts/plugin-system-checkpoint-2026-09-12/historical-designer-tsc-first.log) | Historischer Teilprüflauf; Ergebnis nicht zum integrierten Teststand addieren |
| [historical-designer-ui-tsc-first.log](artifacts/plugin-system-checkpoint-2026-09-12/historical-designer-ui-tsc-first.log) | Historischer Teilprüflauf; Ergebnis nicht zum integrierten Teststand addieren |
| [historical-designer-validation-second.log](artifacts/plugin-system-checkpoint-2026-09-12/historical-designer-validation-second.log) | Historischer Teilprüflauf; Ergebnis nicht zum integrierten Teststand addieren |
| [historical-integration-notes.txt](artifacts/plugin-system-checkpoint-2026-09-12/historical-integration-notes.txt) | Historische Vertragsentscheidungen und AP11-Skizze; spätere Korrekturen dieses Berichts gehen vor |
| [historical-legacy-surfaces-baseline.txt](artifacts/plugin-system-checkpoint-2026-09-12/historical-legacy-surfaces-baseline.txt) | Historischer Inventar-/Quellauszug; kein vollständiger Abnahmebeleg |
| [historical-management-source-sha256.txt](artifacts/plugin-system-checkpoint-2026-09-12/historical-management-source-sha256.txt) | Historischer Inventar-/Quellauszug; kein vollständiger Abnahmebeleg |
| [historical-management-tests-0616.log](artifacts/plugin-system-checkpoint-2026-09-12/historical-management-tests-0616.log) | Historischer Teilprüflauf; Ergebnis nicht zum integrierten Teststand addieren |
| [historical-management-tests-final.log](artifacts/plugin-system-checkpoint-2026-09-12/historical-management-tests-final.log) | Historischer Teilprüflauf; Ergebnis nicht zum integrierten Teststand addieren |
| [historical-management-tsc-0616.log](artifacts/plugin-system-checkpoint-2026-09-12/historical-management-tsc-0616.log) | Historischer Teilprüflauf; Ergebnis nicht zum integrierten Teststand addieren |
| [historical-management-tsc-final.log](artifacts/plugin-system-checkpoint-2026-09-12/historical-management-tsc-final.log) | Historischer Teilprüflauf; Ergebnis nicht zum integrierten Teststand addieren |
| [historical-ownership.txt](artifacts/plugin-system-checkpoint-2026-09-12/historical-ownership.txt) | Historische Dateizuständigkeiten; keine aktiven Worker-Sperren |
| [historical-package-state-config-migration.txt](artifacts/plugin-system-checkpoint-2026-09-12/historical-package-state-config-migration.txt) | Historische Recherche: Paketverwaltung, Persistenz und Migration; Baselineabweichung beachten |
| [historical-pibo-plugin-rebuild-baseline-build.log](artifacts/plugin-system-checkpoint-2026-09-12/historical-pibo-plugin-rebuild-baseline-build.log) | Historischer Teilprüflauf; Ergebnis nicht zum integrierten Teststand addieren |
| [historical-pibo-plugin-rebuild-baseline-tests.log](artifacts/plugin-system-checkpoint-2026-09-12/historical-pibo-plugin-rebuild-baseline-tests.log) | Historischer Teilprüflauf; Ergebnis nicht zum integrierten Teststand addieren |
| [historical-registrations-baseline.txt](artifacts/plugin-system-checkpoint-2026-09-12/historical-registrations-baseline.txt) | Historischer Inventar-/Quellauszug; kein vollständiger Abnahmebeleg |
| [historical-runtime-final-validation.log](artifacts/plugin-system-checkpoint-2026-09-12/historical-runtime-final-validation.log) | Historischer Teilprüflauf; Ergebnis nicht zum integrierten Teststand addieren |
| [historical-runtime-focused-1.log](artifacts/plugin-system-checkpoint-2026-09-12/historical-runtime-focused-1.log) | Historischer Teilprüflauf; Ergebnis nicht zum integrierten Teststand addieren |
| [historical-runtime-focused-2.log](artifacts/plugin-system-checkpoint-2026-09-12/historical-runtime-focused-2.log) | Historischer Teilprüflauf; Ergebnis nicht zum integrierten Teststand addieren |
| [historical-runtime-profile-context.txt](artifacts/plugin-system-checkpoint-2026-09-12/historical-runtime-profile-context.txt) | Historische Recherche: Runtime, Designer und Build Context; Baselineabweichung beachten |
| [historical-runtime-regressions.log](artifacts/plugin-system-checkpoint-2026-09-12/historical-runtime-regressions.log) | Historischer Teilprüflauf; Ergebnis nicht zum integrierten Teststand addieren |
| [historical-runtime-tsc-1.log](artifacts/plugin-system-checkpoint-2026-09-12/historical-runtime-tsc-1.log) | Historischer Teilprüflauf; Ergebnis nicht zum integrierten Teststand addieren |
| [historical-runtime-tsc-2.log](artifacts/plugin-system-checkpoint-2026-09-12/historical-runtime-tsc-2.log) | Historischer Teilprüflauf; Ergebnis nicht zum integrierten Teststand addieren |
| [historical-services-api-baseline.txt](artifacts/plugin-system-checkpoint-2026-09-12/historical-services-api-baseline.txt) | Historischer Inventar-/Quellauszug; kein vollständiger Abnahmebeleg |
| [regression-summary.txt](artifacts/plugin-system-checkpoint-2026-09-12/regression-summary.txt) | Namen und Fundstellen der 12 offenen Bestandsfälle |
| [scratch-artifact-inventory.json](artifacts/plugin-system-checkpoint-2026-09-12/scratch-artifact-inventory.json) | Übernahme-/Ausschlussregister der früheren temporären Dateien |
| [source-inventory.json](artifacts/plugin-system-checkpoint-2026-09-12/source-inventory.json) | Getesteter Source-Commit und vollständige Hashliste der geänderten Produkt-/Testdateien |
| [validation-commands.txt](artifacts/plugin-system-checkpoint-2026-09-12/validation-commands.txt) | Exakte reproduzierbare Container-/Testbefehle einschließlich der 19 Bestandsdateien |
| [worker-browser.txt](artifacts/plugin-system-checkpoint-2026-09-12/worker-browser.txt) | Vollständiger Abschlussbericht des browser-Streams, einschließlich offener Grenzen |
| [worker-designer.txt](artifacts/plugin-system-checkpoint-2026-09-12/worker-designer.txt) | Vollständiger Abschlussbericht des designer-Streams, einschließlich offener Grenzen |
| [worker-management.txt](artifacts/plugin-system-checkpoint-2026-09-12/worker-management.txt) | Vollständiger Abschlussbericht des management-Streams, einschließlich offener Grenzen |
| [worker-runtime.txt](artifacts/plugin-system-checkpoint-2026-09-12/worker-runtime.txt) | Vollständiger Abschlussbericht des runtime-Streams, einschließlich offener Grenzen |
| [handoff-integrity.json](artifacts/plugin-system-checkpoint-2026-09-12/handoff-integrity.json) | Audit von Source-Hashes, Fixture-Kopien und vollständiger Artefaktverlinkung |
| [handoff-documentation-validation.log](artifacts/plugin-system-checkpoint-2026-09-12/handoff-documentation-validation.log) | Erneute Dokumentationsprüfungen nach diesem Übergabe-Audit |

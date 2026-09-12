---
type: "Validation Report"
title: "Plugin-System-Umbau: konsolidierter Entwicklungsstand"
description: "Dokumentiert den isolierten Implementierungsstand, geprüfte Modulgrenzen und noch offene Produktintegration nach dem begrenzten Multi-Agent-Arbeitsfenster."
tags: ["plugins", "validation", "migration", "checkpoint"]
status: "draft"
authority: "evidentiary"
generated: { by: "openai-codex/gpt-6", at: "2026-09-12T06:55:46Z" }
sources:
  - id: "rebuild-plan"
    resource: "/plans/unified-plugin-system-rebuild.md"
  - id: "execution-ledger"
    resource: "/plans/unified-plugin-system-execution.md"
  - id: "implementation"
    resource: "scope:plugin-system-rebuild source commit fdc7b887f73bdf9aa5fcf873b1bc931d921ba3dd; baseline upstream/dev cac4dcd03945b9754db7be9ab2ab4324f10c335c; isolated Docker validation"
---

# Einordnung

Dies ist ein gesicherter Entwicklungszwischenstand des [vollständigen Umbaus](/plans/unified-plugin-system-rebuild.md), keine abgeschlossene Produktmigration. Der Nutzer begrenzte das verbleibende Arbeitsfenster und untersagte weitere Agents. Vorhandene Worker erhielten direkte Steering-Nachrichten zum geordneten Abschluss; ihre laufenden Aufgaben wurden nicht vorsorglich abgebrochen. Die [Abnahmematrix](/plans/unified-plugin-system-execution.md#acceptance-register) bleibt offen.

Die Änderungen entstanden auf `plugin-system-rebuild` in einem separaten Worktree, ausgehend von `cac4dcd03945b9754db7be9ab2ab4324f10c335c`. Builds, Tests und temporäre Datenmutationen liefen im isolierten Docker-Worker. Der Controller-Gateway wurde nicht neu gestartet, umkonfiguriert oder aktualisiert. Es gibt keinen Pibo2-Nachweis, PR, Merge, Release oder veröffentlichten Kandidaten.

# Vorliegende Implementierung

| Bereich | Vorliegender Code und geprüfte Grenzen | Offene Produktverbindung |
|---|---|---|
| SDK, Host und Resolver | Browserfähige SDK-Exports mit Deklarationen; Manifestvalidierung; gemeinsame Ownership und rückwärts aufgeräumte Scopes; reine Auswahlauflösung; Runtime-Kompatibilität; explizite Revisionen und Konfigurationsprovenienz | Sichere Änderung einer laufenden Produktkomposition und vollständige Builtin-Manifeste |
| Dienste | Host und Resolver verwenden dieselbe Auswahlregel für Anbieter; benötigte Anbieterrevisionen werden ohne implizite Agent-Tools in den Plan aufgenommen | Vollständige Besitzer- und Verbraucherprojektion an jeder Produktgrenze |
| Installation und Persistenz | Inhaltsadressierte Artefakte, Integritätsprüfung vor Import, CAS, Operationen, Generationenreservierungen, immutable Snapshots und Payload-Verweise | Standard-Manager, vollständige Live-/Profil-Collector und sicherer Lifecycle |
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

**Getesteter Quellcommit:** `fdc7b887f73bdf9aa5fcf873b1bc931d921ba3dd`. Die [Dateihashes](/reports/artifacts/plugin-system-checkpoint-2026-09-12/source-inventory.json) fixieren die geänderten Quell-/Testdateien gegenüber der Basis. Der anschließende Dokumentationscommit verändert keinen Produktcode.

| Prüfung auf diesem Quellstand | Ergebnis |
|---|---|
| `npm run build` einschließlich Workflow-, Backend-, SDK-, Web- und bestehendem VSCode-Webview-Build | bestanden |
| `npm run chat-ui:typecheck` | bestanden |
| `node --test --test-concurrency=1 test/plugin-system-*.test.mjs` | **170/170 bestanden**, keine Skips |
| Zusammengeführte betroffene Bestandsregressionen, 19 Testdateien | **111/123 bestanden, 12 offen**, keine Skips |
| Öffentlicher SDK-Einstieg als Browserbundle | bestanden; keine Node-Imports |
| `npm run docs:validator:test` | **84/84 bestanden** |
| Strikte Dokumentation, Indizes und Änderungslog | 802 Markdown-Pfade, null Fehler/Warnungen; erneut nach finaler Dokumentation geprüft |

Der [vollständige Build-/Plugin-Testlauf](/reports/artifacts/plugin-system-checkpoint-2026-09-12/committed-build-and-plugin-tests.log), die [offenen Bestandsfälle](/reports/artifacts/plugin-system-checkpoint-2026-09-12/regression-summary.txt) und die [Dokumentationstests](/reports/artifacts/plugin-system-checkpoint-2026-09-12/documentation-tests.log) sind erhalten. Das bestehende Vite-Chunkgrößen-Advisory und die Test-Renderer-Deprecation sind keine bestandene Browserabnahme.

Die zwölf offenen Fälle verteilen sich auf eine alte Pi-Package-Ablehnung, zwei Altshell-Source-Assertions und neun Build-Context-/Skill-Inspector-Erwartungen. Teilweise haben sich die beabsichtigten Verträge geändert; die Default-Oberfläche ist zugleich tatsächlich unvollständig verdrahtet. Diese Befunde müssen vor einer Produktfreigabe fachlich abgeglichen werden. Keine Assertion wurde nur für eine grüne Zahl entfernt. Der zunächst fehlgeschlagene Resource-Inspector-Fall wurde durch die reine Projektion bereits vorhandener Sessionmetadaten korrigiert und besteht im abschließenden Lauf.

Die TypeScript-/React-Tests verwenden jetzt einen expliziten lokalen Lader; die Browser-Modell-/Hosttests liegen im regulär entdeckten Testverzeichnis. Ein globales `--import tsx` ist für diese Tests nicht mehr nötig. Für die Controller-Bind-Unitprüfungen wurde ausschließlich im Testprozess `PIBO_COMPUTE_WORKER` entfernt, damit die simulierte Controller-Grenze geprüft wird. Der Docker-Worker und seine Authentisierung wurden nicht verändert.

Die ausführlichen Teilübergaben sind als [Management](/reports/artifacts/plugin-system-checkpoint-2026-09-12/worker-management.txt), [Browser](/reports/artifacts/plugin-system-checkpoint-2026-09-12/worker-browser.txt), [Designer](/reports/artifacts/plugin-system-checkpoint-2026-09-12/worker-designer.txt) und [Runtime](/reports/artifacts/plugin-system-checkpoint-2026-09-12/worker-runtime.txt) erhalten. Ihre Teilprüfungen überlappen und sind nicht zusätzlich zu summieren. Der Core-Aufruf war vor seinem Abschlussbericht abgebrochen; erhaltene Core-Änderungen wurden vom Orchestrator geprüft und in den gemeinsamen Lauf einbezogen.

Die neuen Plugin-Routen lesen gespeicherte Generationen und eine separat injizierte Vorschau. Der **alte** `buildContextBuildSnapshotForRequest`-HTTP-Pfad erzeugt dagegen weiterhin eine Inspection-Ressourcen-Session; dieser Anschluss bleibt ausdrücklich offen. Die aktuelle Standardkomposition veröffentlicht noch keinen vollständigen PluginManager/Runtime-Coordinator und keine installierten Default-Browser-Manifeste. Der Branch ist damit **nicht merge- oder releasefähig**.

# Nächster Einstieg

1. Standard-Manager und sicher abgegrenzten Host-Lifecycle mit vollständigen Verbrauchern verbinden. Kein Stop-all-Adapter für die Deinstallation eines einzelnen Plugins.
2. Runtime-Coordinator, Service-Anbieter, reine Vorschau und Designer-v2-Normalisierung durch die echten Dispatcher verdrahten. Fehlende oder unveränderte Legacy-Referenzen erhalten; nicht still durch Defaults ersetzen.
3. Default-Browser-Manifeste, gemeinsame React-/SDK-Auslieferung und installierte Web Annotations gemäß AP11 integrieren. Desktop und schmale Ansicht mit echten Sessions prüfen, einschließlich A→B→A und Replay.
4. Erst nach AP11-Abnahme AP12–AP18 fortsetzen: gesamte Builtin-Extraktion, Migration und Entfernung alter Pfade einschließlich eigenständiger TUI und beider VSCode-Oberflächen.
5. Den exakten integrierten Kandidaten vollständig lokal, außerhalb des Repositorys und anschließend auf Pibo2 prüfen. A01–A37 einzeln mit tatsächlicher Evidenz schließen; aktuelle Spezifikationen erst dann auf das nachgewiesene Produktverhalten umstellen.

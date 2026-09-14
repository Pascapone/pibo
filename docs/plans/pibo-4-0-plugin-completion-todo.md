---
type: "Task Ledger"
title: "Pibo 4.0 Abschluss: laufende To-do-Liste"
description: "Verfolgt die Umsetzung des 4.0-Abschlussplans mit stabilen Aufgaben, neuen Befunden und getrennten Implementierungs- und Abnahmenachweisen."
tags: ["plugins", "pibo-4", "implementation", "tracking"]
status: "draft"
authority: "directive"
generated:
  by: "openai-codex/gpt-6"
  at: "2026-09-14T20:30:00Z"
sources:
  - id: "completion-plan"
    resource: "/plans/pibo-4-0-plugin-completion.md"
  - id: "implementation-order"
    resource: "scope:owner instruction 2026-09-14 to implement the whole completion plan using persistent workers and researchers and maintain a Markdown todo list throughout"
---

# Auftrag und Pflege

Diese Liste wird aus dem [Abschlussplan](/plans/pibo-4-0-plugin-completion.md) abgeleitet und während der Umsetzung fortgeschrieben. Der Plan besitzt Ziele und Architektur; diese Datei besitzt den aktuellen Arbeitsstand. Neue Erkenntnisse erhalten N-IDs und eine Zuordnung zu F00–F10. Scopeänderungen werden zuerst im Plan nachvollziehbar ergänzt, nicht nur hier versteckt.

Ein Haken bestätigt eine erledigte Aufgabe mit benanntem Nachweis. Code, fokussierte Prüfung und integrierte Abnahme sind getrennte Spalten. Keine historischen Testzahlen als neue Abnahme. Bei Rückschritten wird der Haken wieder geöffnet und der Grund festgehalten. Nach jedem sinnvollen Paketabschluss und bei neuen Befunden aktualisiert der aktive Worker diese Datei; der Orchestrator prüft den Stand gegen Plan und Ergebnisse.

Arbeitsbranch: `beta/4.0-plugin-system`. Worktree: `/root/code/pibo/.worktrees/plugin-system-rebuild`. Docker: `pibo-dev-plugin-system-rebuild`. Ausgangscommit: `8817384f465a6cfe7d9cc66b9a11f8d438196aa5`. Host-Git ist maßgeblich; Docker-Git-Metadaten sind historisch abweichend. Keine Controller-Gateway-Mutation, kein Merge in dev/main und kein Release.

# Übersicht

| Paket | Umsetzung | Fokussiert geprüft | Integriert akzeptiert | Nächster Schritt |
|---|---|---|---|---|
| F00 – Abhängigkeiten und Paketgrenzen festziehen | abgeschlossen | Quellen-/Importaudit abgeschlossen | offen bis F10 | F01-Verträge implementieren |
| F01 – Öffentliche Host-Dienste und Tool-Verträge vervollständigen | abgeschlossen | Typecheck, SDK-Build und 42 fokussierte Tests | offen bis F10 | F02-Toolfamilien migrieren |
| F02 – Pibo-Tools und fachliche Controller aus dem Kern lösen | abgeschlossen; physischer Delivery-Nachweis folgt in F06 | Root-Emit, SDK-Build, Chat-UI-Typecheck, 167 Provider-/Auswahltests plus 56 Controller-/Reminder-/Lifecycle-Tests | offen bis F10 | F06-07 am Minimalartefakt beweisen |
| F03 – Kernansichten aus Sammelplugins lösen | abgeschlossen | Root-Emit, Chat-UI-Typecheck/-Build und 34 fokussierte Tests | offen bis F10 | F04-Featurepakete trennen |
| F04 – Featurepakete einschließlich ihrer Oberflächen trennen | abgeschlossen; physische unabhängige Artefakte folgen in F06 | Root-Emit, Chat-UI-Typecheck/-Build, 39 Feature-/UI-/Cachetests plus N-022-Nachweis | offen bis F10 | F05 Runtime Requests und Runtimepakete |
| F05 – Runtimepakete und Runtime Requests abschließen | teilweise; Requests und Runtime-Setups getrennt | Root-Emit, Chat-UI-Typecheck/-Build und 75 fokussierte Tests | offen bis F10 | verbleibende Pi-Kompatibilitätsimports mit F06/F08 lösen |
| F06 – Minimal- und Standarddistribution bauen | offen | offen | offen | gemäß Detailaufgaben |
| F07 – Migration an neue Eigentümer und Paketgrenzen anpassen | offen | offen | offen | gemäß Detailaufgaben |
| F08 – Legacy-Delivery vollständig entfernen | offen | offen | offen | gemäß Detailaufgaben |
| F09 – Dokumentation und Entwicklerweg abschließen | offen | offen | offen | gemäß Detailaufgaben |
| F10 – Integrierte Abschlussabnahme | offen | offen | offen | gemäß Detailaufgaben |

# Erledigter Einstieg

- [x] S-001: Abschlussplan und Rechercheinput liegen vor; Quellbaseline und Docker-Worktree sind geprüft.
- [x] S-002: Diese separate To-do-Liste aus allen F00–F10-Checkboxen abgeleitet.
- [x] S-003: Scope bestätigt: fünf Kernansichten, alle Pibo-Erweiterungstools als Plugins, OMP nur Funktionserhalt, Datenmigration statt Legacy-Ausführung.

# Detailaufgaben

## F00 – Abhängigkeiten und Paketgrenzen festziehen

- [x] F00-01: Vorhandene First-Party-Pakete, Core-Imports, transitive npm-Abhängigkeiten, Browser-Bundles, CLI-Kommandos, Dienste und Datenbesitzer inventarisieren.
- [x] F00-02: Management-Bootstrap, `plugin-builtin/*`-Artefaktstubs und Default-Profil als konkrete bestehende Hindernisse für pluginfreien Core-Betrieb erfassen.
- [x] F00-03: Für jede Erweiterung Owner für Backend, Tool-Factories, UI, Settings, Kontext, Datenmigration, Tests und Dokumentation festhalten.
- [x] F00-04: Alle Toolnamens-/Plugin-ID-Sonderfälle erfassen, einschließlich Router, Kontextaufbau, Tab-Katalog, Browser-Host, Debug und Startpfaden.
- [x] F00-05: Öffentliche Service-/Hook-Lücken und tatsächliche Runtime-Request-Nutzer benennen.
- [x] F00-06: Konkrete Paketnamen, Versionsbeziehungen, Exportgrenzen und Minimal-/Standard-Komposition festlegen; Entscheidungen im Plan ergänzen.

Nachweise: vollständige Quell-/Importinventur `/tmp/pibo4-f00-boundaries.md`, ergänzende externe Paketgrenzenkarte `/tmp/pibo4-external-package-boundaries.md`, Ausgangs-RG-Listen `/tmp/pibo4-f00-legacy-rg.txt` und `/tmp/pibo4-f00-special-cases-rg.txt`, konkretisierte F00-Entscheidung im Abschlussplan. Noch keine integrierte Abnahme.

## F01 – Öffentliche Host-Dienste und Tool-Verträge vervollständigen

- [x] F01-01: Sessiongebundene Tool-Factories, Ausführungsmodi und Lifecycle ausschließlich über öffentliche Verträge ermöglichen.
- [x] F01-02: Dienste und Hooks für benötigte Ausführung, Run-Steuerung, Delegation, Ereignisse, Persistenz und Kontext anbieten; fachliche Logik bleibt im Plugin.
- [x] F01-03: Versions-/Abhängigkeitsprüfung, deterministische Konflikte, Scope/Cleanup und sichere Generation-Bindung erhalten.
- [x] F01-04: Backend-/Browser-/Runtime-SDK-Exports explizit festlegen; keine private First-Party-API.
- [x] F01-05: Ein außerhalb des Repositories gebautes Plugin mit frei gewählten IDs und Toolnamen an diesem Vertrag erproben.

Nachweise: Implementierungsbericht `/tmp/pibo4-f01-public-runtime.md`; vollständiger Typecheck, Backend-/SDK-Build und **42/42** fokussierte Tests in `/tmp/pibo4-f01-final-focused.log`; externes Fixture `test/plugin-system-public-runtime.test.mjs` mit freien IDs/Toolnamen, individuellen Toolauswahlen, Runtimefilter, Core-Service-Versionen sowie synchronem/asynchronem Cleanup. Der Repo-Symlink ist nur F01-Vorprüfung; gepackte F06-Abnahme bleibt offen.

## F02 – Pibo-Tools und fachliche Controller aus dem Kern lösen

- [x] F02-01: Goals, Runs, Delegation, Code Runtime, Codex Compat, File Editing, Browser Tools und weitere inventarisierte Familien über F01 anbinden.
- [x] F02-02: Toolnamenslisten und konkrete Factory-Auswahl aus Core/Router/Context-Build entfernen. N-022 ist im Quellpfad umgesetzt: Der Router importiert keine Delegation-/Run-Featurefactory, Toolnamen, Observation-Formatter oder konkreten Reminderformatter mehr. Der gepackte Artefaktnachweis bleibt als eigene F06-07-Abnahme offen.
- [x] F02-03: Kontext-/Prompt-Erzeugung aus dem Plugin-Plan ableiten und Codex-Compat-Inkonsistenz ohne neue Namenssonderliste beheben.
- [x] F02-04: Run-Abbruch, Fortschritt, Ergebnisabholung, Parent-/Child-Korrelation und Ressourcencleanup in den bestehenden Verhaltensprüfungen erhalten.

Nachweise: Reviewbericht `/tmp/pibo4-f02-completion.md` für Provider/Auswahl und `/tmp/pibo4-f04-n022.md` für die Ownership-Inversion. Root-Typecheck und Root-Emit, SDK-Build, Chat-UI-Typecheck sowie **167/167** Provider-/Auswahltests und **56/56** fokussierte Controller-/Reminder-/Lifecycle-Tests sind grün. `test/plugin-system-first-party-tools.test.mjs` belegt direkte und ausschließlich yieldbare Tools, Run-Enum-/Context-Parität, MCP-Ausgabe, native Adapterziele, Prompt-Transformation und Cleanup. `test/plugin-system-core-orchestration-boundary.test.mjs` verbietet Featurefactory-, Toolnamen-, Observation- und Reminderimports im Router sowie alte Portable-Controller-Injection. `test/subagents.test.mjs` erhält Parent-Abort, abgelehnte Child-Cancellation, Queue-Settlement, Kill, Cursor, Timeout und Pi-Bash-Yielding. Der negative Portable-Fall bleibt separat in `test/context-build-inspector.test.mjs`. Der physische Core-/Featuregrenzennachweis bleibt F06-07.

## F03 – Kernansichten aus Sammelplugins lösen

- [x] F03-01: Settings, Agent Designer, Kontext, Session Inspector und Raw Events als feste Core-Angebote registrieren.
- [x] F03-02: Benutzerressourcen, Verwaltung und grundlegenden Web-Zugang ohne `pibo.product-ui`, `pibo.user-resources` oder anderes zwingendes Featurepaket betreiben.
- [x] F03-03: Plugin-Erweiterungspunkte der Kernansichten erhalten; adapterspezifische Inspector-Details deklarativ anbinden.
- [x] F03-04: Sessiontab-Lifecycle unverändert verwenden; keine zweite Tab-Verwaltung für Core-Ansichten einführen.

Nachweise: `/tmp/pibo4-f03-completion.md`; Root-Emit, Chat-UI-Typecheck und Produktionsbuild; **34/34** fokussierte Core-/Gateway-/Auth-/Route-/Tab-/Responsive-Tests. `test/plugin-system-core-views.test.mjs` belegt den direkten Core-Renderpfad und dass die Übergangspakete keine Core-Flächen mehr beanspruchen. `test/plugin-system-product-runtime.test.mjs` startet Auth, Basis-Web, Chat und Benutzerressourcen mit `installDefaultPlugins: false` und null Installationen. Headful geprüft: Desktop 1280×800 für alle fünf Core-Ansichten, Mobile 390×844 für Settings; Screenshots sind im Abschlussbericht verzeichnet. Alte Product-UI-Tab-IDs bleiben ausschließlich als F07-Migrationseingang, physische Browser-/Paketclosure bleibt F06.

## F04 – Featurepakete einschließlich ihrer Oberflächen trennen

- [x] F04-01: Preview, Web Annotations, Goal/Loops, Cron und Workflows als unabhängig auslieferbare Pakete abgeschlossen; selbständige gepackte npm-Artefakte folgen als F06-Distributionstest.
- [x] F04-02: Je Paket benötigte Dienste, API-/Channel-/CLI-Beiträge, Tools, Settings, Kontext und Ansichten zugeordnet; Preview/Cron/Workflows besitzen getrennte Backendmodule und alle Featureansichten getrennte Browserentries.
- [x] F04-03: Preview und Web Annotations aus `DesktopSessionTool` entfernt; Feature-Routen lösen installierte Views über Manifestmetadaten statt feste Plugin-IDs auf.
- [x] F04-04: Gemeinsames First-Party-Navigationsdesign über `subviewNavigation` wiederverwendbar gemacht; die Host-Allowlist ist entfernt.
- [x] F04-05: Featurepakete und Browserentries getrennt deklariert; Cron kann ohne versteckte Web-Produktoption starten, physische Closure folgt in F06.
- [x] F04-06: Fehlende Route zeigt einen verständlichen Reinstall-/Datenerhalt-Leerzustand; Tabzustände bleiben Session-owned und Web-Annotations-Reinstall sowie Plugin-View-Lifecycle sind geprüft.
- [x] F04-07: Run-/Delegation-Pakete konstruieren und registrieren ihre Controller über generische Session-Orchestrierungs-/Lifecycle-Dienste; Core importiert weder Feature-Factories noch Toolnamen, Agent-Observation-Projektion oder konkrete Reminderformatter (N-022).

Nachweise: `/tmp/pibo4-f04-n022.md` für F04-07 und `/tmp/pibo4-f04-feature-packages.md` für F04-01 bis F04-06. Root-Emit, Chat-UI-Typecheck/-Build, **39/39** Feature-/UI-/Cachetests und **56/56** Controller-/Reminder-/Lifecycle-Tests sind grün. Der gepackte, self-contained F06-/F06-07-Grenznachweis bleibt offen.

## F05 – Runtimepakete und Runtime Requests abschließen

- [ ] F05-01: Pi-/Codex-/OMP-SDKs und Implementierungen aus statischen Core-Imports und Installationsabhängigkeiten entfernen. Separate Setupmodule und generische Debug-Auflösung sind umgesetzt; alte Pi-Kompatibilitätsimports in Core-/Chat-/Root-Flächen bleiben für F06/F08 offen.
- [x] F05-02: Runtime Requests gemäß Abschnitt 5 zugeordnet: Codex Native liefert die runtime-/capability-geeignete Workspace-View; Inline-Chat, SSE, Pending-Zustand und Antwortweg bleiben erhalten.
- [x] F05-03: Antwortaktionen aus `pibo.core` gelöst und als Codex-Native-Beiträge registriert; Core enthält keine Action-Namen oder Parameterparser mehr.
- [x] F05-04: Session Inspector bleibt unveränderte Kernansicht und verwendet allgemeine Runtime-Inspektion.
- [ ] F05-05: Pi-/Codex-Wiederaufnahme und vorhandene Reconstruction-/Binding-Verträge erhalten. Fokussierte Ressourcen-/Requestpfade sind grün; vollständige Recovery-Parität wird nach Entfernung der Restimports erneut belegt.
- [x] F05-06: OMP-Setup getrennt und normaler Runtime-/Ressourcenbetrieb fokussiert geprüft; keine neue Recovery-Garantie eingeführt.

Nachweise: offen.

## F06 – Minimal- und Standarddistribution bauen

- [x] F06-01: Eigenständiges Core-Artefakt ohne Featurecode und Runtime-SDKs erstellen.
- [x] F06-02: Standardzusammenstellung aus separaten versionierten Pluginartefakten bauen; vorhandene Auswahl respektieren.
- [x] F06-03: Paketinhalt, installierte Abhängigkeiten und Browser-Bundles prüfen, nicht nur einen Start mit Disabled-Flags.
- [x] F06-04: Frische Minimalinstallation ohne Cache und ohne Quellcheckout starten; Plugin anschließend installieren und nutzen.
- [x] F06-05: Öffentliche Paket-/SDK-Kompatibilität und verständliche Diagnose bei Versionskonflikten prüfen.
- [ ] F06-06: Gepackten 3.6.2-/Beta-Monolithen über einen versionierten Cutover-Plan auf gepackten Minimal-Core plus exakt benötigte Artefakte aktualisieren; unvorbereiteter Direktwechsel bleibt fail-closed.
- [x] F06-07: Gepackten Minimal-Core per Importgraph und Artefaktinhalt beweisen: keine Run-/Delegation-Featurecontroller, Toolnamen oder konkreten Reminder-/Metadatenimplementierungen in seiner Closure (N-022).

Nachweise: `/tmp/pibo4-f06-package-boundaries.md`; `npm run pibo4:packages`; `test/pibo4-packed-distribution.test.mjs` (4/4); fokussierte Host-/SDK-/Provider-/Manager-/Product-Runtime-Suiten. F06-06 bleibt bewusst offen und wird gemeinsam mit F07 als tatsächlicher Alt-zu-Neu-Cutover belegt.

## F07 – Migration an neue Eigentümer und Paketgrenzen anpassen

- [ ] F07-01: Bestehende versionierte Migration wiederverwenden und um neue Owner-/Paket-/Tab-Zuordnungen ergänzen.
- [ ] F07-02: 3.6.2-Ausgangsdaten sowie aktuelle/teilmigrierte Beta-Daten abdecken.
- [ ] F07-03: Konsistentes Backup, Wiederaufnahme, Konfliktpfade und Restore dokumentieren und gezielt prüfen.
- [ ] F07-04: Effektive Tools und Kontext vor/nach Migration vergleichen; alle vorhandenen Benutzerressourcen und produktiven Daten erhalten.
- [ ] F07-05: Alte Produkt-UI-Ziele zu Core- oder Plugin-Zielen übersetzen; fremde Sessiontabs nie übernehmen.
- [ ] F07-06: Gesunde Profile bei isolierten Fehlern weiter migrieren; keine stillen neuen Defaults oder alte Ausführung aktivieren.
- [ ] F07-07: Alte aktive, deaktivierte und deinstallierte Auswahlzustände verifiziert auf neue Paket-/Artefaktkoordinaten abbilden; Nachweis am gepackten Alt-zu-Neu-Installationsweg statt nur an DB-Fixtures mit vorinstallierten Zielpaketen.

Nachweise: offen.

## F08 – Legacy-Delivery vollständig entfernen

- [ ] F08-01: Produktive Registry-Leser auf neue Host-/Service-Abfragen umstellen.
- [ ] F08-02: Alte Registrierung, Typen, Helper, Übergangsparameter, Wildcard-Exports und ungenutzte alte Entrypoints entfernen.
- [ ] F08-03: Tests alter API-Flächen mit begründetem Verhaltensersatz migrieren; keine zweite Registry als dauerhafte Testinfrastruktur mitliefern.
- [ ] F08-04: Paket- und Importaudit über Server, CLI, Browser und Adapter ausführen; dokumentierte Ausnahmen nur für Datenmigration/Core-Ansichten.
- [ ] F08-05: Keine Legacy-Manifeste im normalen Laufzeitvertrag akzeptieren; notwendige Übersetzungen am Import-/Upgrade-Eingang isolieren.

Nachweise: offen.

## F09 – Dokumentation und Entwicklerweg abschließen

- [ ] F09-01: Die Matrix in Abschnitt 9 paketweise abarbeiten; implementierte Verträge in aktuelle Specs übertragen.
- [ ] F09-02: Öffentliche Dienste, Hooks und externe Paketentwicklung mit einem tatsächlich ausführbaren Beispiel erklären.
- [ ] F09-03: Minimal-/Standardinstallation, Upgrade, Backup, Konfliktreparatur und Deinstallation beschreiben.
- [ ] F09-04: OMP-Ausnahme und Unterstützungsumfang präzise angeben.
- [ ] F09-05: Überholte Planaussagen, Indizes und doppelte aktuelle Wahrheiten bereinigen, historische Evidenz erhalten.

Nachweise: offen.

## F10 – Integrierte Abschlussabnahme

- [ ] F10-01: Einen commit- und paketgenauen Kandidaten mit dokumentierten Core-/Pluginversionen festlegen.
- [ ] F10-02: Die Abschlussmatrix aus Abschnitt 8 mit bestehenden Tests und gezielten Ergänzungen belegen.
- [ ] F10-03: Relevante Desktop-/Mobile-Flows headful prüfen und auf Pibo2 denselben Kandidaten abnehmen.
- [ ] F10-04: Aktuelle vollständige relevante Regressionssuite einmal zum integrierten Abschluss ausführen; Altfehler, Scope-Ausnahmen und neue Fehler getrennt ausweisen.
- [ ] F10-05: Planstatus und normative Dokumentation auf belegte Implementierung setzen; keine alten Testzahlen neu etikettieren.

Nachweise: offen.

# Neue Befunde und Zusatzaufgaben

| ID | Befund / Zusatzaufgabe | Paket | Status |
|---|---|---|---|
| N-001 | Management wird trotz deaktivierter Defaults als Paket gestartet; echten Core-Bootstrap herstellen. | F00/F03/F06 | offen, im Plan berücksichtigt |
| N-002 | First-Party-Artefakte importieren `plugin-builtin/*` aus dem Hauptpaket; Implementierung in unabhängige Artefakte verschieben. | F00/F04/F06 | offen, im Plan berücksichtigt |
| N-003 | Codex-Compat-Erkennung prüft falschen Toolnamen; durch deklarierte Beiträge ersetzen. | F02 | behoben; ausgewählter `system-prompt-transformer` ersetzt Core-/Pi-Sonderzweige |
| N-004 | Runtime-Request-Antwortaktionen hängen am bisherigen Core-Sammelplugin. | F05 | behoben; Codex Native besitzt Aktionen, Viewmetadaten und Browserentry, Inlinepfad bleibt runtime-neutral |
| N-005 | Root-Export `./*` und `plugin-builtin/*` machen interne Implementierung zur Delivery-Fläche. | F01/F06/F08 | offen; explizite Subpaths beschlossen |
| N-006 | Session-Tool-Assembly und Context-Build wählen konkrete Pibo-Toolfamilien nach Namen/Präfix. | F01/F02 | behoben; Materialisierung, Ursprung, direkte/yielded Kataloge und Context Build sind provider-/plangetrieben |
| N-007 | App, Desktop-Katalog und Browser-Host enthalten konkrete Feature-View-IDs beziehungsweise First-Party-Allowlist. | F03/F04/F07 | im normalen Laufzeitpfad behoben; alte IDs bleiben bis F07 nur als Migrationsinput |
| N-008 | `pibo.web-product`, `pibo.user-resources` und `pibo.product-ui` besitzen noch ausdrücklich dem Core zugeordnete Flächen. | F03/F04/F06/F07 | normale Owner-Aufteilung behoben; alte Installationen/Module bleiben bis F07/F08 als Cutover-Eingang |
| N-009 | Pi/Codex/OMP und Featureabhängigkeiten liegen weiterhin im Root-Build und Root-Dependencygraph. | F05/F06 | Setupmodule getrennt und Debug statisch entkoppelt; physischer Root-Dependency-/Paketcut bleibt F06/F08 offen |
| N-010 | Legacy-Manifesthinweise werden im normalen Schema-v1-Laufzeitpfad interpretiert. | F07/F08 | offen; Übersetzung am Migrationseingang beschlossen |
| N-011 | Der sichere Plugin-Installer installiert keine npm-Abhängigkeiten; unabhängige Pakete brauchen self-contained Bundles und nur öffentliche SDK-Peers. | F01/F06 | offen; Bundle-Grenze beschlossen |
| N-012 | Ein zentraler `pibo-builtin-plugin.js`-Browserchunk bindet Core- und Feature-UI samt großer transitiver Closure. | F03/F04/F06 | Browserentries getrennt und Cachepfade geprüft; gepackte Minimal-/Featureclosure bleibt F06 |
| N-013 | Die Paketentscheidung widmet `@pasko70/pibo` vom Monolithen zum Minimal-Core um; Bestand braucht deshalb einen expliziten, gepackten Alt-zu-Neu-Cutover, damit benötigte Features/Runtimes nicht still fehlen. Dies ist eine Upgrade-Anforderung, kein behaupteter Bestandsdefekt. | F06/F07 | offen; zweistufiger Cutover und fail-closed Direktwechsel beschlossen |
| N-014 | Ein pauschal auswählbarer Session-Tool-Provider könnte mehrere nicht einzeln deklarierte oder abgewählte Tools freischalten. | F01 | behoben und fokussiert geprüft; appweiter Provider plus einzeln ausgewählte/runtimegefilterte Tool-Contributions |
| N-015 | `dispose(): void` akzeptiert in TypeScript auch async Funktionen; Provider-Cleanup könnte dadurch unbemerkt weiterlaufen oder fehlschlagen. | F01 | behoben und fokussiert geprüft; Cleanup wird awaited, aggregiert und blockiert Zulassungsfreigabe |
| N-016 | Übergangs-Session-Service-Namen für Code Runtime und Delegation dürfen keine fachlichen Controller dauerhaft im Core konservieren. | F02/F04/F06 | Quellpfad behoben und fokussiert geprüft; physischer Minimalartefaktbeweis bleibt F06-07 |
| N-017 | Das externe Fixture mit Repo-Symlink belegt F01-API-Nutzbarkeit, aber keine eigenständige Distribution. | F06 | offen; gepackter Minimal-Core-/Plugin-Nachweis ohne Symlink oder Source-Checkout bleibt Pflicht |
| N-018 | Importfreie Installationsprüfung kannte echte Core-Service-Provider nicht und wies externe Pakete vor Aktivierung fälschlich als service-los ab. | F01 | behoben und fokussiert geprüft; Manager liest nur versionierte Core-Service-Metadaten |
| N-019 | `yieldable` allein unterscheidet kein direkt sichtbares Tool von einem ausschließlich über Run erreichbaren Tool; Delegation würde sonst `pibo_agents_send_message` direkt freigeben. | F02 | behoben; `direct` und `yieldable` sind unabhängige Contribution-Eigenschaften und positiv über Run, Context und MCP geprüft |
| N-020 | Eine Pi-seitige Legacy-Session-Assembly würde die entfernten First-Party-Namens-/Factory-Sonderfälle als ausführbaren Harnesspfad konservieren. | F02/F08 | Produktionshelper wieder entfernt; Altzustandsvergleich bleibt ausschließlich in `test/helpers/legacy-session-tool-names.mjs`, Delivery-Audit in F08 bleibt offen |
| N-021 | Dependency-Expansion darf `globallyActive` nicht als Erlaubnis verwenden, um eine explizite Agent-Deaktivierung zu überstimmen; gespeicherte und effektive Nutzerwahl müssen übereinstimmen. | F02/F07 | behoben und fokussiert geprüft; aktuelle Snapshots trennen unentschiedene Defaults von expliziten Entscheidungen, Legacy-Snapshots fallen sicher auf explizite Booleans zurück, Plan-Diagnosen benennen Tool-, Agent-Plugin-, globale und Runtime-Blockaden |
| N-022 | Eine generische Service-ID verschiebt keine Ownership, solange `core/session-router` konkrete Run-/Delegation-Controller konstruiert, den Delegation-Toolnamen importiert oder konkrete Reminder-/Metadaten formatiert. | F02/F04/F06 | Quell- und Verhaltenspfad behoben: Pakete besitzen Controller, Toolname, Metadaten, Observation-Projektion und Reminder; Importgraph-/Minimalartefaktbeweis bleibt F06-07 |
| N-023 | Frischer Standardstart scheiterte, weil ein Pluginprofil ein provider-backed Tool noch als ausführbar registriertes Legacy-Tool auflösen wollte. | F03/F06 | behoben; Profile können deklarierte provider-backed Toolmetadaten generisch aus aktiven Manifesten projizieren, frischer isolierter Docker-Gatewaystart und Profilinventur bestanden |

# Abnahmestand

A-C40-01 bis A-C40-16 aus dem Plan sind offen. Je Szenario werden Commit/Paket, Prüfweg und Ergebnis verlinkt. OMP-Recovery ist keine zusätzliche Pflicht; A-C40-14 prüft nur Funktionserhalt.

# Aktivität und Entscheidungen

## 2026-09-14

- Umsetzung beauftragt; Plan/Todo behalten die Beta-Arbeitsbasis. Bestehende Recherche wird wiederverwendet, Worker übernimmt die Implementierung. Noch keine neue Codeänderung oder Laufzeitabnahme behauptet.
- F00 abgeschlossen: aktuelle Paket-/Import-/Owner-/Sonderfallinventur einschließlich externer Quellenkarte geprüft, konkrete Core-/Standard-/Plugin-Koordinaten, self-contained Backend-/Browser-Bundles und öffentliche Export-/Servicegrenzen im Plan festgelegt.
- F01 abgeschlossen und fokussiert geprüft: echter Core-Service-Bootstrap ohne Management-Installation, öffentliche Backend-/Browser-/Runtime-Verträge, einzeln ausgewählte sessiongebundene Provider-Tools, generation-sicherer Kontext und Promise-fähiges Drain/Cleanup. F02 migriert nun die First-Party-Toolfamilien und entfernt ihre Namens-/Controller-Sonderfälle aus Core.
- F02 in Arbeit: Core-Session-Assembly ist generisch; First-Party-Pakete registrieren einzeln ausgewählte Provider-Tools. `direct` trennt direkte von ausschließlich yieldbaren Tools. Der kurzzeitig angelegte Pi-Legacy-Assemblypfad wurde vor Abschluss wieder entfernt; positive installierte Delegation-/Run-/MCP-Parität wird separat zum negativen pluginfreien Portable-Fall geprüft.
- F02-Review N-021 geschlossen: Dependency-Expansion aktiviert nur unentschiedene, im akzeptierten Snapshot bekannte Defaults. Explizites Tool-Off, explizites Agent-Plugin-Off, global deaktivierte/deinstallierte Pakete und Runtime-Inkompatibilität erzeugen pfadgenaue Diagnosen; transitive Expansion bleibt generisch und enthält keinen Run-Control-Sonderfall.
- F02-Review korrigiert den Abschlussstatus: Provider-/Auswahl-/Verhaltenspfade sind mit Root-Emit, SDK-Build, Chat-UI-Typecheck und 167 fokussierten Tests grün, aber F02-02 bleibt teilweise offen. `session-router` importiert noch konkrete Run-/Delegation-Factories, den Delegation-Toolnamen und Run-Reminderformatter. N-022 bindet die Eigentumsbereinigung an F04 und den physischen Minimalartefaktbeweis an F06; F03 läuft sequenziell weiter.
- F03 abgeschlossen: fünf Core-Ansichten rendern ohne Product-UI-Beiträge im bestehenden Sessiontab-Lifecycle; Auth, Basis-Web, Chat und Benutzerressourcen starten mit null Plugininstallationen. Übergangspakete besitzen nur noch Featureflächen. Root-Emit, Chat-UI-Typecheck/-Build, 34 fokussierte Tests und headful Desktop-/Mobile-Abnahme sind grün. N-023 behob dabei den frischen provider-backed Profilstart; F04 übernimmt die verbleibenden Sammelfeatures.
- F04-07/N-022 abgeschlossen: Run- und Delegation-Pakete konstruieren ihre Controller selbst. Core besitzt nur generische Yielded-Run-/Child-Session-Orchestrierung; Delegationsname, Child-Metadaten, Agent-Observation-Projektion und Run-Reminderformat liegen im Paket. Alte Portable-Controller-Injection einschließlich `subagentRunner` wurde entfernt. Root-Emit und 56 fokussierte Tests sind grün; F06-07 muss die Grenze noch am gepackten Minimal-Core belegen.
- F04 abgeschlossen: Preview, Cron und Workflows besitzen getrennte Backendpakete; alle Featureansichten liegen in getrennten Browserentries. Feature-Routen werden über `metadata.chatRoute` auf installierte Beiträge aufgelöst, interne Navigation über `subviewNavigation` statt Host-Allowlist gesteuert, Preview/Web Annotations sind keine Core-Sessiontools mehr. Root-Emit, Chat-UI-Typecheck/-Build und 39 Feature-/UI-/Cachetests sind grün; F06 übernimmt self-contained Paketartefakte und die physische Closure.
- F05 teilweise umgesetzt: Pi, Codex Native und OMP verwenden getrennte Setupmodule. Codex Native besitzt Runtime-Request-Antwortaktionen, runtimegeeignete Workspace-View und Browserentry; der feste Core-Sessiontool-Eintrag ist entfernt, Inline-Chat/SSE bleiben auf derselben Pending-Queue. Debug lädt Adapter generisch aus dem aktiv installierten Runtimepaket. Root-Emit, Chat-UI-Typecheck/-Build und 75 fokussierte Tests sind grün. Alte Pi-Kompatibilitätsimports in Core-/Chat-/Root-Flächen halten F05-01/F05-05 bis F06/F08 offen.

---
type: "Task Ledger"
title: "Pibo 4.0 Abschluss: laufende To-do-Liste"
description: "Verfolgt die Umsetzung des 4.0-Abschlussplans mit stabilen Aufgaben, neuen Befunden und getrennten Implementierungs- und Abnahmenachweisen."
tags: ["plugins", "pibo-4", "implementation", "tracking"]
status: "draft"
authority: "directive"
generated:
  by: "openai-codex/gpt-6"
  at: "2026-09-15T02:06:30Z"
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
| F02 – Pibo-Tools und fachliche Controller aus dem Kern lösen | abgeschlossen | Root-Emit, SDK-Build, Provider-/Auswahltests und physischer F06-07-Minimal-Core-Ausschluss | offen bis F10 | F08-Legacyaudit und F10-Gesamtabnahme |
| F03 – Kernansichten aus Sammelplugins lösen | abgeschlossen | Root-Emit, Chat-UI-Typecheck/-Build und 34 fokussierte Tests | offen bis F10 | F04-Featurepakete trennen |
| F04 – Featurepakete einschließlich ihrer Oberflächen trennen | abgeschlossen | Root-Emit, Chat-UI-Typecheck/-Build, Feature-/UI-/Cachetests und 20 unabhängig packbare Artefakte | offen bis F10 | F08-Legacyaudit und F10-Gesamtabnahme |
| F05 – Runtimepakete und Runtime Requests abschließen | abgeschlossen | getrennte Runtimepakete; unveränderte Pi→Codex- und dauerhafte Codex-Binding-Parität im F08-Lauf | offen bis F10 | F10-Gesamtabnahme |
| F06 – Minimal- und Standarddistribution bauen | abgeschlossen | Minimal-Core/Standard/Cutover/20 Artefakte gebaut; getrennte Packs, Clean-Install, Importclosure und echter Releasepfad ab `746b990c` geprüft | offen bis F10 | F10-Gesamtabnahme |
| F07 – Migration an neue Eigentümer und Paketgrenzen anpassen | abgeschlossen | tatsächlicher gepackter 3.6.2-Cutover plus 83 Migrations-/Auswahl-/Kontext-/Tabtests | offen bis F10 | F10-Gesamtabnahme |
| F08 – Legacy-Delivery vollständig entfernen | abgeschlossen | Commit `d37dea0c`; serieller F08-Lauf 105/105; isolierte Gatewayintegration 5/5 | offen bis F10 | F10-Gesamtabnahme |
| F09 – Dokumentation und Entwicklerweg abschließen | abgeschlossen | strikte OKF-Prüfung, Dokumentationstests und ausführbares externes Beispiel grün | offen bis F10 | F10-Gesamtabnahme |
| F10 – Integrierte Abschlussabnahme | in Arbeit | vorgeschalteter Paketreview in `746b990c` gelöst; 14/14 Paket-/Releasetests grün | offen | Kandidat nach verbleibenden lokalen Gates festlegen |

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

- [x] F05-01: Pi-/Codex-/OMP-SDKs und Implementierungen aus statischen Core-Imports und Installationsabhängigkeiten entfernt; separate Setupmodule, generische Debug-Auflösung und physischer Minimal-Core-Ausschluss sind belegt.
- [x] F05-02: Runtime Requests gemäß Abschnitt 5 zugeordnet: Codex Native liefert die runtime-/capability-geeignete Workspace-View; Inline-Chat, SSE, Pending-Zustand und Antwortweg bleiben erhalten.
- [x] F05-03: Antwortaktionen aus `pibo.core` gelöst und als Codex-Native-Beiträge registriert; Core enthält keine Action-Namen oder Parameterparser mehr.
- [x] F05-04: Session Inspector bleibt unveränderte Kernansicht und verwendet allgemeine Runtime-Inspektion.
- [x] F05-05: Pi-/Codex-Wiederaufnahme und vorhandene Reconstruction-/Binding-Verträge erhalten; die unveränderten Pi→Codex-Yield- und dauerhaften Codex-Restart/Löschungsfälle sind nach Entfernung der Restimports grün.
- [x] F05-06: OMP-Setup getrennt und normaler Runtime-/Ressourcenbetrieb fokussiert geprüft; keine neue Recovery-Garantie eingeführt.

Nachweise: F08-Commit `d37dea0c`; serieller F08-Lauf 105/105; unveränderte Tests „a Pi parent yielded subagent request creates and reuses a native Codex child binding“ und „Codex native router resumes a durable binding after restart and marks deletion missing“.

## F06 – Minimal- und Standarddistribution bauen

- [x] F06-01: Eigenständiges Core-Artefakt ohne Featurecode und Runtime-SDKs erstellen.
- [x] F06-02: Standardzusammenstellung aus separaten versionierten Pluginartefakten bauen; vorhandene Auswahl respektieren.
- [x] F06-03: Paketinhalt, installierte Abhängigkeiten und Browser-Bundles prüfen, nicht nur einen Start mit Disabled-Flags.
- [x] F06-04: Frische Minimalinstallation ohne Cache und ohne Quellcheckout starten; Plugin anschließend installieren und nutzen.
- [x] F06-05: Öffentliche Paket-/SDK-Kompatibilität und verständliche Diagnose bei Versionskonflikten prüfen.
- [x] F06-06: Gepackten 3.6.2-/Beta-Monolithen über einen versionierten Cutover-Plan auf gepackten Minimal-Core plus exakt benötigte Artefakte aktualisieren; unvorbereiteter Direktwechsel bleibt fail-closed.
- [x] F06-07: Gepackten Minimal-Core per Importgraph und Artefaktinhalt beweisen: keine Run-/Delegation-Featurecontroller, Toolnamen oder konkreten Reminder-/Metadatenimplementierungen in seiner Closure (N-022).
- [x] F06-08: Tatsächlichen npm-Releasepfad vom privaten Root-Workspace trennen; Minimal-Core, Cutover, alle 20 Plugins und Standard aus ihren generierten Verzeichnissen einzeln prüfen und publizieren (N-024).

Nachweise: Commit `746b990c`; `/tmp/pibo4-f06-package-boundaries.md`, `/tmp/pibo4-f07-cutover.md`; `npm run pibo4:packages`; 14/14 Paket-/Releaseprüfungen; `test/pibo4-packed-distribution.test.mjs`; `test/npm-package-contents.test.mjs`; `test/release-script.test.mjs`; tatsächlicher gepackter 3.6.2-zu-Minimal-Core-Cutover in `test/pibo4-cutover.test.mjs`; fokussierte Host-/SDK-/Provider-/Manager-/Product-Runtime-Suiten. Der Root bleibt nur privater Build-/Deployment-Workspace und ist kein npm-Delivery-Beweis.

## F07 – Migration an neue Eigentümer und Paketgrenzen anpassen

- [x] F07-01: Bestehende versionierte Migration wiederverwenden und um neue Owner-/Paket-/Tab-Zuordnungen ergänzen.
- [x] F07-02: 3.6.2-Ausgangsdaten sowie aktuelle/teilmigrierte Beta-Daten abdecken.
- [x] F07-03: Konsistentes Backup, Wiederaufnahme, Konfliktpfade und Restore dokumentieren und gezielt prüfen.
- [x] F07-04: Effektive Tools und Kontext vor/nach Migration vergleichen; alle vorhandenen Benutzerressourcen und produktiven Daten erhalten.
- [x] F07-05: Alte Produkt-UI-Ziele zu Core- oder Plugin-Zielen übersetzen; fremde Sessiontabs nie übernehmen.
- [x] F07-06: Gesunde Profile bei isolierten Fehlern weiter migrieren; keine stillen neuen Defaults oder alte Ausführung aktivieren.
- [x] F07-07: Alte aktive, deaktivierte und deinstallierte Auswahlzustände verifiziert auf neue Paket-/Artefaktkoordinaten abbilden; Nachweis am gepackten Alt-zu-Neu-Installationsweg statt nur an DB-Fixtures mit vorinstallierten Zielpaketen.

Nachweise: `/tmp/pibo4-f07-cutover.md`, `/tmp/pibo4-f07-tests.log`; tatsächlicher gepackter `@pasko70/pibo@3.6.2`-Ausgangspfad; 83/83 Cutover-, Migrations-, Auswahl-, Kontext- und Tabtests. Die Vorbereitung bewahrt Quell-Tarball, vollständigen Auswahl-Snapshot und alle Zielhashes; Wiederholung ist idempotent, Konflikte bleiben fail-closed.

## F08 – Legacy-Delivery vollständig entfernen

- [x] F08-01: Produktive Registry-Leser auf `PiboCapabilityHost`, `CapabilityProjection` und öffentliche Host-/Service-Abfragen umgestellt.
- [x] F08-02: Alte Registrierung, Typen, Helper, Übergangsparameter, Wildcard-Exports, `plugin-builtin` und ungenutzte Aggregate-Entrypoints entfernt.
- [x] F08-03: Tests auf echte Capability-Host-/Product-Runtime-Pfade migriert; `test/helpers/capability-host.mjs` bleibt eine Testhilfe und keine ausgelieferte zweite Registry.
- [x] F08-04: Paket- und Importaudit über Server, CLI, Browser und Adapter ausgeführt; produktive Legacy-Delivery bleibt ausgeschlossen.
- [x] F08-05: Normale Manifestvalidierung verlangt aktuelle View-Präsentation und weist Legacyfelder ab; Übersetzung bleibt auf Cutover-/Migrationseingänge begrenzt.

Nachweise: Commit `d37dea0c` (`Remove legacy plugin delivery surface`); TypeScript-Kompilierung; 20 Artefakte plus Standardkomposition; serieller F08-Lauf **105/105**; isolierte Gatewayintegration **5/5**; `git diff --check`; keine verbleibenden Testprozesse.

## F09 – Dokumentation und Entwicklerweg abschließen

- [x] F09-01: Die Paket-, Capability-, Profil-, App-, Gateway-, Loop- und Medienproviderverträge auf Commit `d37dea0c` abgeglichen.
- [x] F09-02: Öffentliche SDK-/Host-/Runtime-Dienste und externe Paketentwicklung mit `examples/plugins/hello-pibo` erklärt und ausgeführt.
- [x] F09-03: Minimal-/Standardinstallation, vorbereiteter 3.6.2-Cutover, Backup, Konfliktreparatur, Update und Deinstallation beschrieben.
- [x] F09-04: OMP als funktionsfähiges Runtimepaket ohne neue Rekonstruktions-/Cross-Runtime-Garantie präzisiert.
- [x] F09-05: Überholte Registry-Aussagen korrigiert, Indizes regeneriert und historische Evidenz als historisch belassen.

Nachweise: [Pluginpaket-Spezifikation](/specs/product/plugin-profile-catalog.md), [Entwickler-/Betriebsleitfaden](/project/guides/plugin-development-and-operations.md), strikte OKF-Prüfung ohne Fehler/Warnungen, Dokumentationstests grün; Beispiel kompiliert, importiert, inspiziert, installiert, aktiviert und packt im isolierten Worker.

## F10 – Integrierte Abschlussabnahme

- [x] F10-00: Verpackungsreview vor Abnahme klären: irreführenden Root-Pack-Nachweis entfernen, Root-Publish sperren und den echten Releasewrapper auf getrennte Minimal-Core-/Cutover-/Plugin-/Standardpakete begrenzen. Gelöst in `746b990c`; 14/14 fokussierte Paket-/Releaseprüfungen grün, keine Veröffentlichung ausgeführt.
- [ ] F10-01: Einen commit- und paketgenauen Kandidaten mit dokumentierten Core-/Pluginversionen festlegen.
- [ ] F10-02: Die Abschlussmatrix aus Abschnitt 8 mit bestehenden Tests und gezielten Ergänzungen belegen.
- [ ] F10-03: Relevante Desktop-/Mobile-Flows headful prüfen und auf Pibo2 denselben Kandidaten abnehmen.
- [ ] F10-04: Aktuelle vollständige relevante Regressionssuite einmal zum integrierten Abschluss ausführen; Altfehler, Scope-Ausnahmen und neue Fehler getrennt ausweisen.
- [ ] F10-05: Planstatus und normative Dokumentation auf belegte Implementierung setzen; keine alten Testzahlen neu etikettieren.

Nachweise: F10-00 durch Commit `746b990c`, `/tmp/f10-packaging-build.log` und `/tmp/f10-packaging-final-tests.log`; übrige F10-Abnahme offen.

# Neue Befunde und Zusatzaufgaben

| ID | Befund / Zusatzaufgabe | Paket | Status |
|---|---|---|---|
| N-001 | Management wird trotz deaktivierter Defaults als Paket gestartet; echten Core-Bootstrap herstellen. | F00/F03/F06 | behoben; gepackter Minimal-Core startet mit null Installationen und Host-Diensten ohne Managementplugin |
| N-002 | First-Party-Artefakte importieren `plugin-builtin/*` aus dem Hauptpaket; Implementierung in unabhängige Artefakte verschieben. | F00/F04/F06 | behoben; 20 self-contained Backends und getrennte Browserartefakte lassen sich unabhängig packen |
| N-003 | Codex-Compat-Erkennung prüft falschen Toolnamen; durch deklarierte Beiträge ersetzen. | F02 | behoben; ausgewählter `system-prompt-transformer` ersetzt Core-/Pi-Sonderzweige |
| N-004 | Runtime-Request-Antwortaktionen hängen am bisherigen Core-Sammelplugin. | F05 | behoben; Codex Native besitzt Aktionen, Viewmetadaten und Browserentry, Inlinepfad bleibt runtime-neutral |
| N-005 | Root-Export `./*` und `plugin-builtin/*` machen interne Implementierung zur Delivery-Fläche. | F01/F06/F08 | behoben; nur explizite öffentliche Plugin-Subpaths bleiben, Source-/Paket-Audit grün |
| N-006 | Session-Tool-Assembly und Context-Build wählen konkrete Pibo-Toolfamilien nach Namen/Präfix. | F01/F02 | behoben; Materialisierung, Ursprung, direkte/yielded Kataloge und Context Build sind provider-/plangetrieben |
| N-007 | App, Desktop-Katalog und Browser-Host enthalten konkrete Feature-View-IDs beziehungsweise First-Party-Allowlist. | F03/F04/F07 | im normalen Laufzeitpfad behoben; alte IDs bleiben bis F07 nur als Migrationsinput |
| N-008 | `pibo.web-product`, `pibo.user-resources` und `pibo.product-ui` besitzen noch ausdrücklich dem Core zugeordnete Flächen. | F03/F04/F06/F07 | normale Owner-Aufteilung behoben; alte Installationen/Module bleiben bis F07/F08 als Cutover-Eingang |
| N-009 | Pi/Codex/OMP und Featureabhängigkeiten liegen weiterhin im Root-Build und Root-Dependencygraph. | F05/F06 | ausgelieferter Minimal-Core ist physisch frei von Runtime-/Featureimplementierungen; monolithische Quell- und Legacy-Exportflächen bleiben F08 |
| N-010 | Legacy-Manifesthinweise werden im normalen Schema-v1-Laufzeitpfad interpretiert. | F07/F08 | behoben; normale Validierung weist Legacyfelder ab, Übersetzung ist auf Migration/Cutover isoliert |
| N-011 | Der sichere Plugin-Installer installiert keine npm-Abhängigkeiten; unabhängige Pakete brauchen self-contained Bundles und nur öffentliche SDK-Peers. | F01/F06 | behoben; jedes Artefakt besitzt ein self-contained Backend ohne npm-Laufzeitabhängigkeiten und completed independent `npm pack` |
| N-012 | Ein zentraler `pibo-builtin-plugin.js`-Browserchunk bindet Core- und Feature-UI samt großer transitiver Closure. | F03/F04/F06 | behoben; getrennte Browserentries, verallgemeinerte Cachegrenze und gepackte Featureartefakte sind belegt |
| N-013 | Die Paketentscheidung widmet `@pasko70/pibo` vom Monolithen zum Minimal-Core um; Bestand braucht deshalb einen expliziten, gepackten Alt-zu-Neu-Cutover, damit benötigte Features/Runtimes nicht still fehlen. Dies ist eine Upgrade-Anforderung, kein behaupteter Bestandsdefekt. | F06/F07 | behoben; tatsächlicher gepackter 3.6.2-Ausgangspunkt, vorgeschaltetes Cutoverpaket, exakte Hashzuordnung und fail-closed Direktwechsel geprüft |
| N-014 | Ein pauschal auswählbarer Session-Tool-Provider könnte mehrere nicht einzeln deklarierte oder abgewählte Tools freischalten. | F01 | behoben und fokussiert geprüft; appweiter Provider plus einzeln ausgewählte/runtimegefilterte Tool-Contributions |
| N-015 | `dispose(): void` akzeptiert in TypeScript auch async Funktionen; Provider-Cleanup könnte dadurch unbemerkt weiterlaufen oder fehlschlagen. | F01 | behoben und fokussiert geprüft; Cleanup wird awaited, aggregiert und blockiert Zulassungsfreigabe |
| N-016 | Übergangs-Session-Service-Namen für Code Runtime und Delegation dürfen keine fachlichen Controller dauerhaft im Core konservieren. | F02/F04/F06 | behoben; Quellpfad und gepackter Minimal-Core schließen fachliche Controller aus |
| N-017 | Das externe Fixture mit Repo-Symlink belegt F01-API-Nutzbarkeit, aber keine eigenständige Distribution. | F06 | behoben; Clean-Consumer installiert Core- und Preview-Tarballs ohne Symlink oder Quellcheckout |
| N-018 | Importfreie Installationsprüfung kannte echte Core-Service-Provider nicht und wies externe Pakete vor Aktivierung fälschlich als service-los ab. | F01 | behoben und fokussiert geprüft; Manager liest nur versionierte Core-Service-Metadaten |
| N-019 | `yieldable` allein unterscheidet kein direkt sichtbares Tool von einem ausschließlich über Run erreichbaren Tool; Delegation würde sonst `pibo_agents_send_message` direkt freigeben. | F02 | behoben; `direct` und `yieldable` sind unabhängige Contribution-Eigenschaften und positiv über Run, Context und MCP geprüft |
| N-020 | Eine Pi-seitige Legacy-Session-Assembly würde die entfernten First-Party-Namens-/Factory-Sonderfälle als ausführbaren Harnesspfad konservieren. | F02/F08 | behoben; Altzustandsvergleich bleibt ausschließlich in `test/helpers/legacy-session-tool-names.mjs`, produktive Delivery ist ausgeschlossen |
| N-021 | Dependency-Expansion darf `globallyActive` nicht als Erlaubnis verwenden, um eine explizite Agent-Deaktivierung zu überstimmen; gespeicherte und effektive Nutzerwahl müssen übereinstimmen. | F02/F07 | behoben und fokussiert geprüft; aktuelle Snapshots trennen unentschiedene Defaults von expliziten Entscheidungen, Legacy-Snapshots fallen sicher auf explizite Booleans zurück, Plan-Diagnosen benennen Tool-, Agent-Plugin-, globale und Runtime-Blockaden |
| N-022 | Eine generische Service-ID verschiebt keine Ownership, solange `core/session-router` konkrete Run-/Delegation-Controller konstruiert, den Delegation-Toolnamen importiert oder konkrete Reminder-/Metadaten formatiert. | F02/F04/F06 | behoben; Pakete besitzen Fachlogik und der gepackte Minimal-Core-Audit schließt Controller, Toolnamen und Reminderimplementierungen physisch aus |
| N-023 | Frischer Standardstart scheiterte, weil ein Pluginprofil ein provider-backed Tool noch als ausführbar registriertes Legacy-Tool auflösen wollte. | F03/F06 | behoben; Profile können deklarierte provider-backed Toolmetadaten generisch aus aktiven Manifesten projizieren, frischer isolierter Docker-Gatewaystart und Profilinventur bestanden |
| N-024 | Der bisherige Root-`npm pack`-Test verlangte Featuremodule im Paket, obwohl `@pasko70/pibo` als Minimal-Core festgelegt ist; der Releasewrapper publizierte tatsächlich den breiten Root. | F06/F10 | behoben in `746b990c`: Root ist privat, Release publiziert nur Core/Cutover/20 Plugins/Standard aus getrennten Verzeichnissen, und der hermetische Test verbietet nacktes `npm publish` |

# Abnahmestand

F08 und F09 sind lokal abgeschlossen. A-C40-01 bis A-C40-16 werden im festen F10-Kandidaten geprüft. OMP-Recovery ist keine zusätzliche Pflicht; A-C40-14 prüft nur Funktionserhalt. Pibo2 bleibt in diesem Lauf ausdrücklich außerhalb des Scopes und wird nicht als lokale Evidenz ausgegeben.

# Aktivität und Entscheidungen

## 2026-09-15

- F08 abgeschlossen und als `d37dea0c` committed: Capability Host ist die einzige produktive Registrierungsautorität; Registry-/Wildcard-/`plugin-builtin`-/Aggregate-Delivery ist entfernt. TypeScript, 20 Artefakte plus Standard, serieller F08-Lauf 105/105 und isolierte Gatewayintegration 5/5 sind grün.
- F09 abgeschlossen: aktuelle Spezifikationen und Pläne auf den F08-Commit abgeglichen, externe Entwicklung und Betrieb dokumentiert, OMP-Grenze präzisiert und `examples/plugins/hello-pibo` im Worker gebaut, importiert, inspiziert, installiert, aktiviert und gepackt. Strikte OKF-Prüfung und Dokumentationstests sind grün.
- F10 begonnen: Nach dem F09-Dokumentationscommit wird ein commit- und paketgenauer lokaler Kandidat fixiert. Pibo2, Push, PR, Deployment, Merge, Release und Controller-Gateway-Mutation bleiben ausgeschlossen.

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
- F05 teilweise umgesetzt: Pi, Codex Native und OMP verwenden getrennte Setupmodule. Codex Native besitzt Runtime-Request-Antwortaktionen, runtimegeeignete Workspace-View und Browserentry; der feste Core-Sessiontool-Eintrag ist entfernt, Inline-Chat/SSE bleiben auf derselben Pending-Queue. Debug lädt Adapter generisch aus dem aktiv installierten Runtimepaket. Root-Emit, Chat-UI-Typecheck/-Build und 75 fokussierte Tests sind grün. Alte Pi-Kompatibilitätsimports in Core-/Chat-/Root-Flächen halten F05-01/F05-05 bis F08 offen.
- F06 abgeschlossen: `npm run pibo4:packages` baut Minimal-Core, Standard, Cutover und 20 eigenständig packbare Feature-/Runtimeartefakte. Ein Clean-Consumer startete nur aus dem Core-Tarball mit null Plugins und aktivierte anschließend gepacktes Preview. Import- und Inhaltsaudit schließen konkrete Runtime-, Run- und Delegationsimplementierungen aus dem Core aus.
- F06-Releasegrenze am 2026-09-15 nach Review korrigiert: Der vorherige Root-Pack-Test und das nackte Root-`npm publish` widersprachen der Minimal-Core-Entscheidung. Commit `746b990c` macht den Root privat, bindet die Zielversion an die generierten Core-/Cutover-/Standardartefakte, publiziert alle 23 Pakete getrennt und prüft 14/14 Paket-/Releasefälle. F10 war bis zu dieser Korrektur ausdrücklich angehalten.
- F07 abgeschlossen: Das tatsächliche gepackte `@pasko70/pibo@3.6.2` wurde erst nach einem separaten, content-hashgebundenen Vorbereitungsplan durch gepackten Minimal-Core ersetzt. Nur aktive Zielartefakte wurden installiert; deaktivierte/deinstallierte Ziele blieben aus. Wiederstart, unveränderte Benutzerdaten, Beta-Quelle, Journal-/Konfliktpfade sowie Core-/Plugin-Tabzuordnung sind mit 83/83 fokussierten Tests belegt.

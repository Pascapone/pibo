---
type: "Plan"
title: "Pibo 4.0 abschließen: unabhängiger Kern und vollständig auslieferbare Plugins"
description: "Plant den Abschluss von Pibo 4.0 mit pluginfrei startbarem Kern, extern auslieferbaren Funktionspaketen, bereinigten Erweiterungs-APIs, sicherer Datenmigration und aktueller Dokumentation."
tags: ["plugins", "pibo-4", "architecture", "migration", "delivery", "runtime", "web"]
status: "draft"
authority: "directive"
generated:
  by: "openai-codex/gpt-6"
  at: "2026-09-16T08:00:00Z"
sources:
  - id: "owner-beta-feedback"
    resource: "scope:owner decisions 2026-09-16 in Pibo Room room_209cf2ff-6b46-4705-a216-a6d2138604bd; Core-owned conditional Agent Delegation; independent optional Run Control; complete Codex Native delivery; stable Settings and Sidebar scrolling"
  - id: "owner-completion"
    resource: "scope:owner decisions 2026-09-14 in Pibo Session ps_c5596e29-e5db-47e8-a736-714f4a1c99cf; independent minimal core; all Pibo extension tools through public plugin contracts; explicit core views; Codex-owned Runtime Requests subject to dependency inspection; OMP maintenance only; remove executable legacy APIs; preserve data through migration; write a plan without implementation"
  - id: "owner-test-policy"
    resource: "scope:owner instructions 2026-09-12 through 2026-09-14; preserve existing behavioral tests; fast UI iteration without repeated full suites; integrated final validation at completion"
  - id: "predecessor"
    resource: "/plans/unified-plugin-system-rebuild.md"
  - id: "execution-history"
    resource: "/plans/unified-plugin-system-execution.md"
  - id: "workspace-contract"
    resource: "/specs/web/session-workspace-lifecycle.md"
  - id: "pibo2-acceptance"
    resource: "/reports/pibo-4-0-plugin-system-pibo2-acceptance-2026-09-15.md"
  - id: "inspected-baseline"
    resource: "scope:read-only research and selected parent source inspection at beta/4.0-plugin-system commit 8817384f465a6cfe7d9cc66b9a11f8d438196aa5 on 2026-09-14; no fresh runtime acceptance in this planning task"
---

# Zweck und Verbindlichkeit

Dieser Plan beschreibt die verbleibende Arbeit bis zum sauberen Plugin-Modell von Pibo 4.0. Der große Umbau ist bereits vorhanden. Jetzt werden die verbliebenen Sonderwege entfernt, der Kern tatsächlich unabhängig ausgeliefert und alle Erweiterungen über denselben öffentlichen Vertrag angebunden.

Die nachfolgende Zielarchitektur begann als geplantes Verhalten. Am 15. September 2026 sind F00–F10 einschließlich der erneut geprüften N-033-Runtime-/Ressourcenlieferung für den festen Code-/Paketkandidaten `cb975d3e91aec82763990ab76b0626d23bd8f2d9` implementiert, dokumentiert, lokal abgenommen und auf Pibo2 akzeptiert. Das Beta-Feedback vom 16. September ergänzt F11 und revidiert den früheren Delegations-Plugin-Schnitt: Agent Delegation ist eine bedingte Kernfähigkeit, Run Control bleibt ein unabhängiges optionales Plugin.[^owner-beta-feedback] Die [laufende To-do-Liste](/plans/pibo-4-0-plugin-completion-todo.md) trennt Implementierung, Prüfung und Abnahme; der [Pibo2-Abnahmebericht](/reports/pibo-4-0-plugin-system-pibo2-acceptance-2026-09-15.md) hält die frühere Cutover-Abnahme fest. Veröffentlichung, PR, Merge, Release und npm-Publish bleiben separate Aktionen.

Dieser Plan führt die festgelegten Restentscheidungen aus dem [bisherigen Umbauplan](/plans/unified-plugin-system-rebuild.md) fort. Bei Widersprüchen zu dessen pauschaler Aussage „alle Produktoberflächen sind Plugins“, zur alten Default-Komposition, zu tolerierten Legacy-APIs oder zum OMP-Ausbau ist **dieser Plan maßgeblich**. Sonstige Anforderungen, insbesondere Daten-, Kontext- und UI-Parität, bleiben bestehen. Das [bisherige Ausführungsprotokoll](/plans/unified-plugin-system-execution.md) bleibt Nachweis vergangener Arbeit; alte offene Checkboxen bedeuten nicht automatisch, dass deren Implementierung erneut erforderlich ist.

Arbeitsbasis ist `beta/4.0-plugin-system`, Ausgangscommit `8817384f465a6cfe7d9cc66b9a11f8d438196aa5`, im bestehenden Worktree `/root/code/pibo/.worktrees/plugin-system-rebuild`. Es gibt keinen Neustart von einem älteren Development-Stand. Der Controller-Gateway bleibt unangetastet. Code und Laufzeitprüfungen liefen im isolierten Docker-Worker; anschließend wurde derselbe content-adressierte Kandidat auf Pibo2 akzeptiert.

# 1. Überblick für Produktverantwortliche

**Das Ziel:** Pibo ist ein eigenständig startbarer Kern. Erweiterungen bringen ihre Werkzeuge, Dienste, Ansichten, Einstellungen und Kontextbeiträge selbst mit. Unsere eigenen Erweiterungen benutzen dieselben Schnittstellen wie Plugins anderer Entwickler. Der Kern kennt diese konkreten Plugins nicht.

```mermaid
flowchart LR
    E["Externes Plugin"] --> V["Öffentlicher Plugin-Vertrag"]
    F["Pibo-eigenes Plugin"] --> V
    V --> K["Pibo-Kern: Sessions, Daten, Dienste, Erweiterungspunkte"]
    K --> U["Kernansichten: Settings, Designer, Kontext, Inspector, Raw Events"]
    B["Optionale Standarddistribution"] --> E
    B --> F
```

Die Pfeile zeigen Abhängigkeiten. Es gibt keinen umgekehrten Import vom Kern zu Preview, Goal, einer bestimmten Runtime oder deren Werkzeugen. Ein allgemeiner Plugin-Loader darf installierte Pakete natürlich zur Laufzeit laden; das ist keine fest eingebaute Produktabhängigkeit.

Eine Standardinstallation darf weiterhin die vertraute Pibo-Ausstattung anbieten. Sie ist eine Zusammenstellung unabhängiger Pakete. Eine Minimalinstallation enthält dieselben Kernfunktionen, aber keine versteckt vorausgesetzten Erweiterungen.

Die Abschlussarbeit besteht aus fünf Teilen:

1. Kernverträge vervollständigen und alle konkreten Tool-/Plugin-Sonderfälle daraus entfernen.
2. Funktionspakete samt Backend, Tools, UI und Datenzuständigkeit wirklich trennen.
3. Minimaldistribution und externe Entwicklung ohne Zugriff auf interne Pibo-Dateien ermöglichen.
4. Alte Daten automatisch übernehmen und die alten ausführbaren Schnittstellen entfernen.
5. Bestehendes Verhalten gezielt nachweisen und Dokumentation an den fertigen Stand angleichen.

# 2. Festgelegte Zuständigkeiten

Diese Entscheidungen stammen vom Auftraggeber. Ihre grundsätzliche Produktzuordnung wird während der Umsetzung nicht erneut geöffnet.[^owner-completion]

| Bestandteil | Zielzuständigkeit | Konsequenz |
|---|---|---|
| Plugin-Host, Installation, Konfigurationsspeicher, öffentlicher SDK-Vertrag | Kern | Müssen ohne Erweiterung verfügbar sein; keine Abhängigkeit vom zu installierenden Paket. |
| Pibo Sessions, Rooms, Profile, ausgewählte Runtime-Bindings, neutrales Produktprotokoll | Kern | Identitäten und Daten bleiben bei Deinstallation von Erweiterungen bestehen. |
| Web-Zugang, Authentifizierung, grundlegende Chat-/Session-Oberfläche, Tab-Verwaltung | Kern | Die ausdrücklich notwendigen Kernansichten dürfen nicht durch ein fehlendes Web-/Produkt-Plugin ausfallen. Keine Modell-Ausführung ohne installierte Runtime. |
| Settings einschließlich Plugin-Verwaltung | Kernansicht | Immer vorhanden, nicht als Plugin deaktivierbar. Erweiterungen können ihre eigenen Einstellungen dort beisteuern. |
| Agent Designer | Kernansicht | Immer vorhanden; zeigt verfügbare Runtime-/Plugin-Angebote und verständliche Leerzustände. |
| Kontext einschließlich eigener Skills, Kontextdateien und Kontextinspektion | Kernansicht und Kernressourcen | Ohne Plugin nutzbar; Plugins dürfen eigene Ressourcen und Erweiterungen beitragen. |
| Session Inspector | Kernansicht | Bleibt runtime-neutral; adapterspezifische Details kommen über Beiträge der Runtime. Nicht mit Runtime Requests verwechseln. |
| Raw Events | Kernansicht | Neutrale Diagnose gespeicherter/live Ereignisse, ohne Import einzelner Runtime- oder Featureimplementierungen. |
| Preview | Eigenes Plugin | Preview-Dienst, Ansichten, dazugehörige Werkzeuge/CLI-Beiträge und Einstellungen kommen zusammen. |
| Web Annotations | Eigenes Plugin | Tools, API-/Ereignisbeiträge, Ansichten und Einstellungen gehören zum selben fachlichen Paket. |
| Goal/Loops | Eigenes Plugin | Appweiter Dienst und optionales Agent-Tooling bleiben getrennt aktivierbar; zugehörige Loop-Ansicht gehört zum Plugin. |
| Cron Jobs | Eigenes Plugin | Zeitplanlogik, Verwaltung, zugehörige Tools/Channels und UI sind Erweiterung. Allgemeine Persistenz-/Ausführungsdienste dürfen vom Kern bezogen werden. |
| Workflows | Erweiterung | Vorhandene Funktion erhalten und paketieren; keine neue Workflow-Engine im Rahmen dieses Plans. |
| Pi und Codex Native | Jeweilige Runtime-Plugins | Adapter, Implementierung und runtimeeigene Abhängigkeiten werden nicht vom Kern importiert. |
| Runtime Requests | Ziel: Beitrag des Codex-Native-Plugins | Tab und Inline-Interaktion gemeinsam anbinden; andere tatsächliche Nutzer vor Verschiebung prüfen, siehe Abschnitt 5. |
| Oh My Pi / OMP | Runtime-Plugin im Erhaltungsumfang | Muss installierbar und im bisherigen normalen Betrieb funktionsfähig bleiben. Keine neue Recovery, Migrationserweiterung oder Runtimewechsel-Unterstützung. |
| Agent Delegation | Bedingte Kernfähigkeit | Sobald ein Profil mindestens einen Subagent aktiviert, stellt der Kern automatisch `pibo_agents_send_message`, `pibo_agents_list_agents`, `pibo_agents_observe` und `pibo_agents_kill` bereit. Ohne Subagent fehlen diese Tools. Es gibt kein auswählbares Delegation-Plugin. |
| Run Control | Eigenes optionales Plugin | Kann Delegations- und andere yieldable Tools kapseln, ist für direkte Delegation aber weder Voraussetzung noch automatisch ausgewählt. |
| Übrige Pibo-eigene Tools, Goals, File Editing, Browser Tools, Search, MCP-Integration, Speech/Transcription | Fachlich zugeordnete Plugins | Kein allgemeiner im Core verbleibender Tool-Katalog oder Namensdispatch. Allgemeine Ausführungsmechanismen und Lifecycle bleiben Kernverträge. |

**Harness-eigene Tools** wie native Pi-/Codex-Werkzeuge bleiben Sache der jeweiligen Runtime. „Keine eingebauten Tools“ bezieht sich auf Pibo-eigene Erweiterungswerkzeuge im Kern; native Harness-Werkzeuge werden nicht künstlich erneut als Pibo-Tools implementiert.

Ein Plugin braucht keinen Tab. Es kann nur Werkzeuge, nur Kontext, nur einen Systemdienst, nur UI oder eine Kombination liefern. Keine automatisch erzeugten leeren Tabs. Runtime-Auswahl ist weiterhin eine Auswahl installierter Runtime-Angebote; deren Systemaktivierung wird nicht als Agent-Capability umgedeutet.

# 3. Zielverträge und Architekturregeln

## C40-BOUNDARY-001: Keine fachlichen Plugin-Abhängigkeiten im Kern

Der ausgelieferte Kern MUSS ohne Import von Featurepaketen und ohne deren transitive Runtime-Abhängigkeiten bauen und starten. Er DARF keine Listen konkreter Erweiterungstoolnamen, Präfixabfragen, Plugin-ID-Sonderfälle, fest verdrahtete Feature-Renderer oder dynamische versteckte Imports besitzen, die eine konkrete Erweiterung funktionsfähig machen.

Zulässige Grenzen sind:

- allgemeine Schnittstellen, etwa Tool-Ausführung, Session-Zugriff, Persistenz, Ereignisse, UI-Beiträge und Runtime-Operationen;
- die ausdrücklich in Abschnitt 2 festgelegten Kernansichten;
- isolierte Datenmigration mit alten IDs/Formaten, ohne alten Ausführungscode;
- eine separate Standarddistribution, die konkrete Pluginpakete auswählt;
- Tests und Entwicklungsfixtures außerhalb des ausgelieferten Kerns.

Ein neuer Name für den bisherigen Built-in-Katalog oder eine ausgelieferte Default-Liste in einem Core-Unterordner erfüllt die Trennung nicht. Die Prüfung umfasst Importgraph, Paketinhalt, Startpfade und tatsächliche Installation, nicht nur Textsuche.

## C40-SDK-001: Gleicher Vertrag für eigene und externe Plugins

Ein externer Entwickler MUSS ein Plugin außerhalb des Pibo-Repositories bauen, paketieren, installieren und ausführen können, ohne Pibo-Quellcode zu verändern. Pibo-eigene Plugins erhalten keine private Abkürzung oder Zulassung nach Namen.

Der öffentliche Vertrag umfasst mindestens:

- Manifest, Identität, Version, Abhängigkeiten sowie deklarierte System- und Agent-Beiträge;
- Tool-Schema, Ausführungsfunktion bzw. Factory, Fehler, Abbruch, Fortschritt, Ergebnisse und Ausführungsmodus;
- deklarierte Anforderungen an Runtime-Fähigkeiten und öffentliche Host-Dienste;
- Skills, Kontextbeiträge und Reihenfolge/Ladeverhalten einschließlich Build-Context-Inspektion;
- Backend-/Browser-Beiträge, Ansichten, optionale Settings und Routing-/CLI-/Channel-Beiträge, soweit das Feature sie benötigt;
- Scope, Lebenszyklus, registrierte Ressourcen und geordnete Bereinigung;
- versionierte Plugin-Daten, Konfiguration sowie Upgrade-/Deinstallationsverhalten.

Backend- und Browser-SDK bleiben getrennt, damit keine Node-/Runtime-Abhängigkeiten versehentlich im Browser landen. Öffentliche Exports werden ausdrücklich aufgelistet. Interne Deep Imports und ein breiter Wildcard-Export sind kein Ersatz für fehlende SDK-Verträge.

## C40-SERVICE-001: Zugriff auf den Kern ohne Umkehr der Abhängigkeit

Plugins dürfen die Funktionsweise des Harness über definierte Hooks, Services, Runtime-Adapter und UI-Erweiterungspunkte verändern. Der Vertrag darf nicht auf additive Tabs beschränkt werden. Bestehende Annahme vertrauenswürdigen Plugin-Codes bleibt bestehen; eine neue Sandbox ist nicht Gegenstand dieses Plans.

Der Kern stellt Fähigkeiten bereit, etwa einen Session-Dienst, Ereigniszugriff oder einen Ausführungsdienst. Das Plugin implementiert die fachliche Bedeutung. Fehlende Dienste oder inkompatible Versionen führen vor Aktivierung zu einer erklärten Diagnose. Plugin-zu-Plugin-Abhängigkeiten sind zulässig, müssen aber ausdrücklich im Manifest stehen.

Vereinfachtes Pseudocode-Ziel, keine bereits existierende SDK-Syntax:

```text
Plugin.setup(scope):
    sessions = scope.requireService("sessions", version=1)
    scope.registerTool("beliebiger_name", schema, execute)

execute(input, invocation):
    session = sessions.forInvocation(invocation)
    return pluginEigeneFunktion(session, input)

Kern bei Tool-Aufruf:
    beitrag = effektiverPlan.findeTool(toolId)
    führeRegistrierteFunktionAus(beitrag, gebundenerAufrufkontext)
```

Der Aufrufkontext ist an Session, Runtime-Generation, Plugin-Revision und ausgewählte Beiträge gebunden. Plugin-Konfiguration oder Tool-Auswahl einer anderen Session darf nicht hineingeraten. Keine breite globale Session-Registry als Ersatz für einen öffentlichen Dienst.

Ersetzungen und Hooks benötigen definierte Reihenfolge, Konfliktverhalten, Fehlerbehandlung und Cleanup. Ein aufgehobenes Plugin darf keine Listener, Timer, Renderer, Tool-Credentials oder laufenden Controller unerkannt zurücklassen. Keine automatische Ausweitung auf beliebiges Hot-Reload oder parallele Pluginversionen.

## C40-TOOLS-001: Fachliche Tools gehören ihrem Produkt-Owner

Die konkreten Definitionsgeneratoren für Goals, Runs und andere optionale Erweiterungswerkzeuge liegen in ihren fachlichen Paketen. Agent Delegation ist die ausdrückliche Ausnahme: Subagents gehören zum Kernprofil, daher konstruiert der zentrale Router die vier stabilen `pibo_agents_*`-Werkzeuge direkt aus der effektiven Subagent-Auswahl. Diese Namen dürfen nur an dieser Kernfähigkeit gebunden sein und bilden keinen allgemeinen Tool-Katalog.

Direkte Agent Delegation funktioniert ohne Run Control. Ist Run Control ausgewählt, darf es dieselben yieldable Delegationsdefinitionen über seinen allgemeinen Run-Lifecycle ausführen. Auslagerbare Ausführung, Fortschritt, Cancel und Ergebnisabholung bleiben allgemeine Dienste. Goal-spezifische Weiterlaufbedingungen gehören zum Goal-Plugin. Jeder weitere Spezialfall erhält einen dokumentierten Owner und wird vor Abschluss beseitigt oder als echter allgemeiner Kernvertrag begründet.

Die bestehende Inkonsistenz in `profileFromPluginPlan()` – Prüfung auf `codex` bei tatsächlich anders benannten Compat-Tools – wird mit dieser Trennung behoben. Eine weitere harte Toolnamensliste als dauerhafter Fix ist nicht das Ziel. Kontext und Verhalten werden aus ausgewählten Beiträgen bzw. deklarierter Plugin-Konfiguration abgeleitet.

## C40-VIEWS-001: Gemeinsamer Tab-Lifecycle, unterschiedliche Eigentümer

Der Kern besitzt Tabs, Session-Zuordnung, Reihenfolge, aktive Instanz, Layout, Cache, Refresh und Before-Leave-Verhalten. Feature-Renderer gehören ihren Plugins. Die fünf festgelegten Kernansichten verwenden dieselbe Tab-Infrastruktur, benötigen aber keine Plugininstallation und dürfen explizite Kernziele haben.

Keine Feature-Allowlist in App, Desktop-Katalog oder Browser-Host. Manifestmetadaten und registrierte Renderer entscheiden über sichtbare Plugin-Module, unterstützte Runtime-Fähigkeiten und Navigation. Auch die zuletzt eingeführte Unterdrückung doppelter Navigation für bestimmte First-Party-IDs wird in eine allgemeine Darstellungsoption überführt.

Die bestehende Bedienqualität bleibt erhalten: kompletter Tab anklickbar, Plus direkt hinter dem letzten Tab, Drag/Resize, lokale Drawer bei schmalem Panel, mobile Navigation, gecachte Panels und gezielter Refresh. Plugin-Autoren dürfen ihr eigenes Layout gestalten. Das gemeinsame First-Party-Design ist eine wiederverwendbare öffentliche UI-Hilfe, kein Zwang zu privaten Core-Komponenten.

## C40-SCOPES-001: System, Agent und Session bleiben unabhängig

Systemaktivierung kontrolliert Plugin-Dienste. Der Agent Designer kontrolliert nur freigegebene agentbezogene Beiträge. Der Session-Arbeitsbereich speichert die für diese Session geöffneten Ansichten. Diese drei Entscheidungen dürfen einander nicht implizit überschreiben.

Beispiel Goal: Systemdienst aktiv; Agent A besitzt Goal-Tools; Agent B besitzt sie nicht; beide können bei vorhandener Berechtigung die appweite Verwaltung nutzen. Das Ausschalten der Agent-Tools stoppt keinen appweiten Dienst. Settings sind keine abwählbare Agent-Capability. Änderungen gelten an den bereits definierten sicheren Generation-Grenzen.

# 4. Paketierung und Minimalbetrieb

## C40-DELIVERY-001: Zwei Kompositionen aus denselben Paketen

Die Umsetzung trennt den Kern von einer optionalen Standardzusammenstellung:

| Komposition | Inhalt | Erwartetes Verhalten |
|---|---|---|
| Minimal | Kern und seine notwendigen Abhängigkeiten, null Plugininstallationen | Verwaltung, Auth, Sessions/History und Kernansichten funktionieren. Keine versteckte Pi-, Codex-, Goal-, Preview- oder Cron-Initialisierung. |
| Standard | Derselbe Kern plus ausdrücklich ausgewählte Pluginpakete | Vertrauter Produktumfang; Plugins bleiben einzeln installierbar und entfernbar. |
| Benutzerdefiniert | Kern plus beliebige kompatible externe/First-Party-Pakete | Keine Maintainer-Codeänderung nötig. |

Die Namen der npm-Pakete und der Distributionsbefehle werden im ersten Arbeitspaket festgelegt. Sie müssen vor der Paketextraktion dokumentiert sein. Ein Monorepo ist zulässig; separate Repositories sind keine Voraussetzung. Entscheidend sind eigenständige Artefakte und geschlossene öffentliche Abhängigkeiten.

**Konkrete Ausgangsbefunde am untersuchten Beta-Commit:** `src/plugins/product-runtime.ts` startet auch bei `installDefaultPlugins: false` noch den Management-Beitrag `pibo.plugin-management`. Dieser Mechanismus muss durch echten Core-Bootstrap ersetzt werden. Zudem erzeugt `src/plugins/default-packages.ts` Backend-Stubs mit Imports auf `@pasko70/pibo/plugin-builtin/...`. Ein separat benanntes Pluginartefakt ist damit noch keine unabhängige Featureauslieferung: Die Implementierung und ihre Abhängigkeiten müssen in das jeweilige Paket wechseln. Auch `src/core/default-profile.ts` darf keine Pi-Toolnamen oder aktiviertes Goal-Control als runtimefreien Default voraussetzen.

Im Minimalpaket dürfen Runtime-SDKs, Feature-Backend-Code und Feature-Browser-Bundles nicht bloß deaktiviert mitgeschleppt werden. Installationsskripte dürfen sie auch nicht heimlich nachladen. Die Standardzusammenstellung liegt außerhalb des Core-Einstiegspunkts. Ein deaktiviertes oder deinstalliertes Plugin wird bei einem Core-Neustart nicht automatisch wieder aktiviert.

Ohne Runtime ist Agent-Ausführung nicht verfügbar. Settings und Designer erklären, dass eine Runtime installiert/ausgewählt werden muss. Profile und bestehende Sessions bleiben sichtbar; fehlende Runtime-Angebote löschen weder Konfiguration noch Bindings. UI-Leerzustände sind keine Fehlerseite und lösen keine Endlosschleife aus. Die Paketgröße und Startabhängigkeiten werden für Minimal und Standard erfasst; ein willkürliches Megabyte-Ziel ersetzt keinen Import-/Inhaltsnachweis.

# 5. Runtime Requests und Runtime-Grenzen

Runtime Requests und Session Inspector sind zwei verschiedene Funktionen. Session Inspector bleibt Kern. Zielzuständigkeit für Runtime Requests ist das Codex-Native-Plugin, weil die ursprünglichen Approval-/User-Input-Anfragen von dessen Protokoll stammen.

Vor dem Verschieben wird der vollständige Pfad erfasst: Produzent, normalisiertes Ereignis, gespeicherter Request-Zustand, Tab, Inline-Darstellung im Chat und Rückantwort. Pi- und OMP-Produzenten oder -Konsumenten dürfen nicht allein aus UI-Namen ausgeschlossen werden.

**Quellenbefund vom 14. September 2026:** Codex Native erzeugt in `src/agent-runtimes/codex-native/requests.ts` die Approval-/User-Input-Anfragen. Pi und OMP deklarieren in ihren Adaptern `approvals.supported: false` und `structuredUserInput: false`. Damit ist Codex Native der in dieser Recherche belegte produktive Produzent; neue Pi-/OMP-Anfragen werden nicht vorausgesetzt. Die neutrale Ereignis-/Pending-/Control-Kette liegt in `src/agent-runtime/events.ts`, `contract.ts` und `routed-session.ts`, SSE in `src/apps/chat/stream.ts`, UI in `runtime-request-panel.tsx` und `session-trace-pane.tsx`. Die Antwortaktionen `runtime.approval.respond` und `runtime.user_input.respond` werden heute über `src/plugins/builtin.ts` und das Sammelpaket `pibo.core` registriert. F05 muss diese versteckte Registrierungsabhängigkeit zusammen mit dem Renderer auflösen. Diese Befunde sind statisch geprüft, kein neuer Laufzeitnachweis.

Zielverhalten:

- Das Codex-Paket liefert erforderliche Request-Renderer und deren Tab-Beitrag sowie die Inline-Anbindung gemeinsam mit dem Adapter.
- Die allgemeine Routing-/Ereignishülle darf im Kern liegen, sofern sie runtime-neutral ist. Die Interpretation nativer Codex-Methoden bleibt im Plugin.
- Der Tab wird über deklarierte Eignung für die gebundene Session angeboten, nicht über eine im Core codierte Prüfung auf `codex-native`.
- Antworten bleiben an Request-ID, Session und Runtime-Generation gebunden; doppelte/veraltete Antworten werden abgefangen. Tabwechsel und Cache dürfen keine Antworten verlieren oder Requests doppelt beantworten.
- Der Nutzer kann eine ausstehende Anfrage weiterhin im normalen Chat bearbeiten. Ein zusätzlicher Tab ist kein Pflichtweg und keine zweite unabhängige Request-Queue.
- Deaktivierung/Upgrade bei ausstehenden Anfragen beachtet den bestehenden Drain-/Busy-Vertrag. Kein stilles Verwerfen und kein automatisch erteiltes Approval.
- Falls andere Runtimes bereits denselben Vertrag produktiv benutzen, wird deren bestehendes Verhalten erhalten: durch eine öffentliche gemeinsame UI-/Protokollhilfe oder explizite Paketabhängigkeit. Das wird als konkrete Implementierungsentscheidung dokumentiert, ohne neue Pi-Request-Features zu entwickeln.

## OMP-Ausnahme

OMP bleibt als Plugin lieferbar. Die für neue Paketgrenzen notwendigen Imports und SDK-Anschlüsse werden angepasst; bestehende normale Session-Erzeugung, Nachrichten und bisher unterstützte Wiederaufnahme müssen weiter funktionieren. Es wird kein neuer automatischer History-Rebuild, keine zusätzliche Sessionwechsel-/Cross-Runtime-Anbindung und keine neue Migrationsgarantie entwickelt. Bereits vorhandene Identitäten, Dateien und Historie bleiben erhalten.

Bekannte fehlende Recovery nach nicht sicher auflösbarer nativer Session bleibt dokumentierte Einschränkung und blockiert 4.0 nicht. „Keine neue OMP-Migration“ erlaubt weder Datenlöschung noch das Fallenlassen des funktionierenden Plugins. Pi und Codex Native bleiben im vollständigen zugesagten Native-first-/Fallback-Umfang.

# 6. Migration und Entfernung des alten Modells

## C40-UPGRADE-001: Daten übernehmen, alte Ausführung entfernen

Das Upgrade unterstützt bestehende 3.6.2-Daten und den bereits migrierten 4.0-Beta-Zustand. Die zweite Quelle ist wichtig: Aktuelle Tabs, Plugin-IDs und teilweise migrierte Profile dürfen durch die neue Paketaufteilung nicht verloren gehen.

```mermaid
flowchart TD
    A["Bestehende Installation"] --> B["Konsistente Sicherung und Versionsaufnahme"]
    B --> C["Versionierte Datenmigration"]
    C --> D{"Eindeutig übersetzbar?"}
    D -->|Ja| E["Neues Modell prüfen und aktivieren"]
    D -->|Nein| F["Original erhalten, betroffenen Teil blockieren, Reparatur erklären"]
    E --> G["Nur neuer Plugin-Vertrag zur Laufzeit"]
```

Vor Veränderungen werden Datenbanken einschließlich benötigter WAL-/Checkpoint-Konsistenz, Konfigurations-/Ressourcendateien, Installationsbestand und relevante native Session-Locators gesichert. Der Sicherungsplan unterscheidet Pibo Home von außerhalb liegenden Runtime-Transkripten. Eine reine Kopie von `pibo.sqlite` darf nicht als vollständiges Session-Backup bezeichnet werden. Keine Auth-Geheimnisse in Logs oder veröffentlichten Artefakten.

Migrationen sind versioniert, wiederaufnehmbar, konfliktbewusst und durch gesicherte Originalzustände nachvollziehbar. Plugin-Migrationscode wird erst aus einem verifizierten neuen Paket geladen; alte ausführbare Erweiterungen werden nicht als Datenimporter aktiviert. Soweit mehrere Datenbanken beteiligt sind, werden Schritte journalisiert und abgeglichen statt eine nicht vorhandene globale Transaktion zu behaupten.

Zu erhalten sind insbesondere:

- aktive/archivierte Profile, IDs, Aliase, Modelle, Runtime-Optionen, Tool-Auswahl und Ausführungsfilter;
- Skills und Kontextdateien samt Bytes, Reihenfolge, Quellen, Ladeverhalten und Referenzen;
- MCP-Auswahl, Subagent-Ziele und Overrides;
- Pibo Session-/Room-Identität, Historie, Runtime-Bindings und native Locator-Provenienz;
- appweite, agentbezogene und sessionbezogene Plugin-Konfiguration;
- tabbezogene IDs, Reihenfolge, aktive Instanz, Einstellungen und gespeicherte Zustände;
- Preview-/Annotations-/Goal-/Cron-/Workflow-Daten einschließlich Verknüpfungen und Job-Zustand.

Bereits fehlende Referenzen bleiben als solche erkennbar. Eine erfolgreiche Migration darf keine Defaults aktivieren, die vorher nicht aktiv waren. Bei nicht eindeutig zuordenbaren Beiträgen bleiben Daten erhalten und der betroffene Teil erhält einen konkreten Reparaturhinweis. Gesunde Profile sollen dadurch nicht unnötig blockiert werden.

Aufteilung bisheriger Sammelpakete braucht eine explizite alte-ID-zu-neuem-Owner-Tabelle: beispielsweise Produkt-UI zu Kernansicht oder eigenem Featurepaket. Interne Settings-/Tab-IDs werden übersetzt, ohne der aktuell ausgewählten Session fremde Tabs zuzuordnen. Diese Tabelle gehört zur Migration; der normale Tab-Renderer erhält keine dauerhafte Liste historischer Feature-Aliase.

Native-first bleibt erhalten: vorhandene native Session finden und weiterverwenden; nur sicher nachgewiesene Abwesenheit erlaubt den bestehenden begrenzten History-Import bei Pi/Codex. Auth-, Rechte-, Korruptions- oder vorübergehende Fehler führen nicht zu leerem Ersatz. OMP gilt gemäß Abschnitt 5.

## C40-LEGACY-001: Keine alten ausführbaren Erweiterungs-APIs im Delivery

Nach Umstellung der Aufrufstellen werden entfernt:

- synchrone Legacy-Registrierung einschließlich `registerPlugin`, der zugehörigen `createApi` und `definePiboPlugin`, soweit sie den alten Vertrag bilden;
- alte `PiboPlugin`-/`PiboPluginApi`-Exports und veraltete externe Tool-Assembly-Schnittstellen;
- `subagentRunner`-Kompatibilität und sonstige Übergangsparameter statt ihrer öffentlichen Nachfolger;
- die Registry-Kompatibilitätsfassade, nachdem ihre produktiven Leser auf Host-/Service-Verträge umgestellt sind;
- alte ausführbare Pi-Package-/Discovery-Fallbacks, Default-Registries und doppelte Ausführungspfade;
- Laufzeitinterpretation veralteter Manifestfelder, soweit diese durch versionierte Import-/Upgradeschritte ersetzt werden können;
- unkontrollierte öffentliche Deep Imports über Wildcard-Exports.

Legacy-Namen dürfen in isolierten Datenformatlesern, Zuordnungstabellen, historischen Dokumenten und Migrationsfixtures vorkommen. Sie dürfen nicht zur Ausführung eines alten Plugins führen. Neue Fehlermeldungen benennen den 4.0-Nachfolger statt eine alte API weiter als supported anzubieten.

Alte Tests werden nach bewiesenem Verhalten eingeordnet: Produktverhalten erhalten; Tests der ausdrücklich entfernten API dürfen auf die öffentliche Nachfolgeschnittstelle umgestellt werden. Tests nur deshalb zu löschen, weil sie die neue Architektur auf Fehler hinweisen, ist unzulässig.

## Rollback

Rollback verwendet das vorherige Paketset und eine dazu konsistente Sicherung. Kein Downgrade älterer Software auf bereits inkompatibel umgeschriebene Daten ohne unterstützten Rückweg. Während Cutover werden neue Schreibvorgänge entweder kontrolliert angehalten oder nachvollziehbar abgegrenzt. Nach dem Cutover neu entstandene Daten dürfen bei Rücksicherung nicht stillschweigend verworfen werden. Vor dem Release wird ein unterbrochener Upgrade-Lauf samt Wiederaufnahme und ein tatsächlicher Restore in isolierter Umgebung belegt.

# 7. Arbeitspakete und Reihenfolge

Alle folgenden Pakete sind bei Erstellung **offen**. „Implementiert“, „gezielt geprüft“ und „integriert akzeptiert“ werden getrennt dokumentiert. Ein Agent bearbeitet ein zusammenhängendes Paket bis zu einem reviewbaren Ergebnis; keine künstlichen Mini-Aufträge oder parallelen Änderungen an denselben zentralen Dateien.

## F00 – Abhängigkeiten und Paketgrenzen festziehen

- [ ] Vorhandene First-Party-Pakete, Core-Imports, transitive npm-Abhängigkeiten, Browser-Bundles, CLI-Kommandos, Dienste und Datenbesitzer inventarisieren.
- [ ] Management-Bootstrap, `plugin-builtin/*`-Artefaktstubs und Default-Profil als konkrete bestehende Hindernisse für pluginfreien Core-Betrieb erfassen.
- [ ] Für jede Erweiterung Owner für Backend, Tool-Factories, UI, Settings, Kontext, Datenmigration, Tests und Dokumentation festhalten.
- [ ] Alle Toolnamens-/Plugin-ID-Sonderfälle erfassen, einschließlich Router, Kontextaufbau, Tab-Katalog, Browser-Host, Debug und Startpfaden.
- [ ] Öffentliche Service-/Hook-Lücken und tatsächliche Runtime-Request-Nutzer benennen.
- [ ] Konkrete Paketnamen, Versionsbeziehungen, Exportgrenzen und Minimal-/Standard-Komposition festlegen; Entscheidungen im Plan ergänzen.

Einstieg: `src/plugins/default-packages.ts`, `src/plugins/product-runtime.ts`, `src/plugins/registry.ts`, `src/core/session-router.ts`, `src/tools/session-tool-set.ts`, `src/agent-runtime/plugin-plan.ts`, `package.json` und Browser-Komposition.

**Fertig, wenn:** Für jede heutige Funktion ein Zielowner existiert; kein „misc builtin“ versteckt Restlogik. Offene Schnittstellen sind als konkrete Folgearbeit beschrieben. Abhängigkeiten: keine.

### F00-Entscheidung: Paket-, Export- und Servicegrenzen

Die Quellinventur am Ausgangscommit bestätigt neben N-001 bis N-004 weitere harte Restgrenzen: Root-`./*`-Export, produktive `PiboPluginRegistry`-Leser, konkrete Toolfamilien in Session-Tool-Assembly und Context-Build, feste Feature-IDs in App/Desktop/Browser-Host, normale Interpretation alter Manifestfelder sowie statische Runtime-/Featureabhängigkeiten im Root-Artefakt. Der Arbeitsnachweis liegt in `/tmp/pibo4-f00-boundaries.md`; das laufende Ledger führt die Befunde N-005 bis N-010.

Der Core behält den Paketnamen `@pasko70/pibo`. Seine einzigen öffentlichen Code-Subpaths sind `./plugin-sdk` für JSON-/Browserverträge, `./plugin-host` für Backend-Setup und Host-Lifecycle sowie neu `./plugin-runtime` für Runtime-Adapter, sessiongebundene Tool-Provider und Runtime-Request-Beiträge. `./package.json` bleibt lesbar. Der Wildcard-Export und `./plugin-builtin/*` entfallen. First-Party-Pakete dürfen dieselben öffentlichen Subpaths wie externe Pakete verwenden, aber keine Repo-internen Deep Imports.

Die Standardzusammenstellung heißt `@pasko70/pibo-standard`. Fachpakete verwenden die Koordinate `@pasko70/pibo-plugin-<fachname>` und bleiben einzeln versioniert: `preview`, `web-annotations`, `goal-loops`, `cron`, `workflows`, `runtime-pi`, `runtime-codex-native`, `runtime-omp`, `code-runtime`, `file-editing`, `web-search`, `browser-tools`, `gateway-tools`, `codex-compat`, `run-control`, `agent-delegation`, `mcp-cli`, `transcription-openai-chatgpt`, `transcription-openai` und `standard-profiles`. Auth, Web-Grundzugang, Pluginverwaltung, User Resources, Settings, Agent Designer, Context, Session Inspector, Raw Events und Standard Shell bleiben Core.

Core stellt versionierte Host-Dienste für Pluginverwaltung, Sessionplan, Produktoptionen, Session-/Generation-Kontext, Ereignisse, Persistenz und allgemeine Runtime-Controls bereit. Ausführbare Pluginwerkzeuge kommen über einen öffentlichen sessiongebundenen Providervertrag; der Core iteriert ausgewählte Provider und deklarierte Services, ohne Namen oder Plugin-IDs auszuwerten. Runtime Requests verwenden die runtime-neutrale Pending-/Event-/Control-Hülle; Codex Native liefert Eignung, Renderer-Metadaten und Antwortaktionen. Pi und OMP behalten `false` für Approval und Structured Input.

Minimal startet Core-Dienste mit null Plugininstallationen. Standard ist eine explizite Paketliste außerhalb des Core-Starts und respektiert vorhandene Deaktivierung/Deinstallation. Weil der sichere Installer absichtlich keine fremden `npmDependencies` nachinstalliert, enthalten First-Party-Pakete self-contained Backend- und, soweit benötigt, Browser-Bundles; nur die öffentlichen Core-SDK-Subpaths bleiben externe Peer-Grenze. Kein erzeugtes Artefakt importiert Implementierung aus dem Core. Der bisherige zentrale `pibo-builtin-plugin.js`-Chunk wird in einen kleinen Core-Entry und fachliche Browserartefakte getrennt. Alte IDs bleiben ausschließlich in versionierten Datenmappings und historischen Fixtures.

Die Umwidmung von `@pasko70/pibo` vom Monolithen zum Minimal-Core erzeugt eine eigene Upgrade-Anforderung. Der reproduzierbare Distributionsweg ist zweistufig: Die noch alte, monolithische Installation erzeugt zuerst einen versionierten Cutover-Plan mit Paketversionen, Content-Hashes und der belegten Zuordnung jeder alten aktiven, deaktivierten oder deinstallierten Auswahl zu neuen Artefakten. Anschließend installiert ein expliziter 4.0-Upgrade-/Standard-Bundle-Schritt nur die laut Altzustand benötigten neuen Pakete, prüft ihre Artefakte und migriert die Daten; erst nach erfolgreicher Prüfung wird der neue Minimal-Core aktiviert. Ein direktes Paketupdate mit erkanntem, aber nicht vorbereitetem Monolith-/Beta-Zustand bricht mit einer konkreten Upgrade-Anweisung ab, statt still ohne bisher benötigte Features oder Runtimes zu starten. Frische Minimalinstallationen erzeugen keinen Cutover-Plan und installieren keine Defaults. Bewusst deaktivierte, deinstallierte oder nicht ausgewählte Pakete werden durch Cutover oder Standardzusammenstellung nicht reaktiviert.

## F01 – Öffentliche Host-Dienste und Tool-Verträge vervollständigen

- [ ] Sessiongebundene Tool-Factories, Ausführungsmodi und Lifecycle ausschließlich über öffentliche Verträge ermöglichen.
- [ ] Dienste und Hooks für benötigte Ausführung, Run-Steuerung, Delegation, Ereignisse, Persistenz und Kontext anbieten; fachliche Logik bleibt im Plugin.
- [ ] Versions-/Abhängigkeitsprüfung, deterministische Konflikte, Scope/Cleanup und sichere Generation-Bindung erhalten.
- [ ] Backend-/Browser-/Runtime-SDK-Exports explizit festlegen; keine private First-Party-API.
- [ ] Ein außerhalb des Repositories gebautes Plugin mit frei gewählten IDs und Toolnamen an diesem Vertrag erproben.

**Fertig, wenn:** Das externe Paket registriert Tool, Kontext, Settings und optional eine View ohne Core-Patch; inkompatible Pakete liefern eine verständliche Diagnose. Abhängigkeit: F00.

### F01-Entscheidung: einzeln ausgewählte Session-Tools

Ein `session-tool-provider` ist appweite Infrastruktur und keine pauschale Agent-Capability. Jedes von ihm erzeugbare Tool bleibt eine eigene agentbezogene `tool`-Contribution mit Name, Runtimeprädikat, Konfiguration, Auswahlzustand und expliziter `sessionToolProvider`-Abhängigkeit. Der Resolver übergibt dem Provider pro Generation ausschließlich diese tatsächlich ausgewählten und runtimekompatiblen Toolbeiträge. Die Materialisierung verwirft nicht deklarierte, abgewählte, doppelte, ausgelassene, namensfalsche oder schemafreie Definitionen. Der Ausführungskontext wird an den einzelnen Toolbeitrag gebunden, nicht nur an den Sammelprovider.

Provider-Cleanup darf synchron oder asynchron sein. Session- und Router-Drain widerrufen zuerst die Generation, warten dann alle Cleanup-Schritte in umgekehrter Reihenfolge ab und geben die Generation-Zulassung nur bei vollständigem Erfolg frei. Cleanup-Fehler bleiben aggregiert sichtbar. Der F01-Nachweis nutzt ein außerhalb des Repositorybaums erzeugtes TypeScript-Fixture über die öffentlichen Subpaths; der lokale Paketsymlink ist ausdrücklich nur API-Vorprüfung. Der symlinkfreie Nachweis aus gepackten Minimal-/Pluginartefakten bleibt F06.

## F02 – Pibo-Tools und fachliche Controller aus dem Kern lösen

- [ ] Goals, Runs, Code Runtime, Codex Compat, File Editing, Browser Tools und weitere optionale Familien über F01 anbinden; die bedingte Core-Delegation aus F11 separat behandeln.
- [ ] Toolnamenslisten und konkrete Factory-Auswahl aus Core/Router/Context-Build entfernen.
- [ ] Kontext-/Prompt-Erzeugung aus dem Plugin-Plan ableiten und Codex-Compat-Inkonsistenz ohne neue Namenssonderliste beheben.
- [ ] Run-Abbruch, Fortschritt, Ergebnisabholung, Parent-/Child-Korrelation und Ressourcencleanup in den bestehenden Verhaltensprüfungen erhalten.

Einstieg: `src/tools/session-tool-set.ts`, `src/core/context-build.ts`, `src/core/session-router.ts`, `src/plugins/packaged-control-tools.ts`, `src/plugins/packaged-tool-families.ts`, `src/agent-runtime/plugin-plan.ts`.

Eine generisch benannte Core-Service-Factory erfüllt diese Grenze nicht, wenn der Core weiterhin den konkreten Feature-Controller konstruiert, dessen Toolnamenkonstanten importiert oder featurebezogene Reminder und Metadaten formatiert. Das Featurepaket konstruiert und registriert seinen Controller selbst über generische Session-Orchestrierungs- und Lifecycle-Dienste. Allgemeine Run-Scheduling-/Cancellation-Primitiven dürfen Core sein; konkrete Toolcontroller, Remindertexte und Featuremetadaten nicht.

**Fertig, wenn:** Der Kern kann eine neue gleichartige Toolfamilie ohne Codeänderung ausführen und hat keine Kenntnis ihrer fachlichen Namen oder Implementierungsimports. Abhängigkeit: F01.

## F03 – Kernansichten aus Sammelplugins lösen

- [ ] Settings, Agent Designer, Kontext, Session Inspector und Raw Events als feste Core-Angebote registrieren.
- [ ] Benutzerressourcen, Verwaltung und grundlegenden Web-Zugang ohne `pibo.product-ui`, `pibo.user-resources` oder anderes zwingendes Featurepaket betreiben.
- [ ] Plugin-Erweiterungspunkte der Kernansichten erhalten; adapterspezifische Inspector-Details deklarativ anbinden.
- [ ] Sessiontab-Lifecycle unverändert verwenden; keine zweite Tab-Verwaltung für Core-Ansichten einführen.

**Fertig, wenn:** Die fünf Kernansichten sind ohne Plugins nutzbar und enthalten verständliche Leerzustände. Abhängigkeiten: F00, relevante UI-Verträge aus F01.

## F04 – Featurepakete einschließlich ihrer Oberflächen trennen

- [x] Preview, Web Annotations, Goal/Loops, Cron und Workflows als unabhängig auslieferbare Pakete abschließen; gepackte npm-Artefakte werden in F06 belegt.
- [x] Je Paket alle benötigten Dienste, API-/Channel-/CLI-Beiträge, Tools, Settings, Kontext und Ansichten mitliefern.
- [x] Feature-Einträge aus `DesktopSessionTool` und festem Plugin-ID-App-Dispatch entfernen; nur echte Kernziele behalten.
- [x] Gemeinsames First-Party-Navigationsdesign als wiederverwendbare Hilfe anbieten; keine Plugin-ID-Allowlist im Host.
- [x] Plugin-Abhängigkeiten explizit deklarieren; keine implizite Preview- oder Cron-Abhängigkeit über einen globalen Import.
- [x] Deinstallation erhält Daten/Tabzustände und zeigt fehlende Angebote verständlich; Wiederinstallation stellt zuordenbare Zustände wieder bereit.
- [ ] Run Control konstruiert seinen Controller über generische Session-Orchestrierungs-/Lifecycle-Dienste; Core-Delegation wird in F11 aus der effektiven Subagent-Auswahl erzeugt. Core importiert keine Run-Featurefactory oder konkreten Reminderformatter.

Einstieg: `src/apps/chat-ui/src/desktop-tabs-model.ts`, `src/apps/chat-ui/src/App.tsx`, `src/apps/chat-ui/src/plugins/plugin-workspace.tsx`, `src/apps/chat-ui/src/plugins/builtin-browser-entry.tsx`, jeweilige `packaged-*`-Module.

**Fertig, wenn:** Installation eines Featurepakets genügt für seine vollständige Funktion; Entfernen beeinträchtigt keine unabhängigen Kernansichten. Abhängigkeiten: F01–F03; Datencutover erst mit F07.

### F04-Zwischenstand: generische Run-/Child-Orchestrierung

N-022 wurde am 16. September durch die ausdrückliche F11-Produktentscheidung teilweise revidiert. Der Core besitzt wieder die bedingte Agent-Delegation samt Tooldefinitionen, Child-Metadaten und Beobachtungsprojektion, weil Subagents selbst Core-Konfiguration sind. Run Control besitzt weiterhin Remindertext und Run-Lifecycle und bleibt unabhängig optional. Die alte Controller-Injection der Portable-Tool-Session einschließlich `subagentRunner` bleibt entfernt.

Der fokussierte Nachweis umfasst Root-Emit und 56 Run-/Delegation-/Reminder-/Portable-/Codex-Ressourcentests; `/tmp/pibo4-f04-n022.md` protokolliert die Befunde. Diese Quellprüfung ersetzt den F06-07-Nachweis nicht: Erst Importgraph und Inhalt des gepackten Minimal-Core belegen die physische Delivery-Grenze.

### F04-Abschluss: getrennte Featureoberflächen

Preview, Cron und Workflows besitzen getrennte Backendmodule; Preview, Cron, Workflows, Goal/Loops, Web Annotations, Build Context und die Toolfamilien besitzen getrennte stabile Browserentries. `metadata.chatRoute` ordnet bestehende Produkt-Routen installierten Beiträgen zu, ohne konkrete Plugin-ID im App-Dispatch. `view.subviewNavigation` legt deklarativ fest, ob Host oder Renderer die interne Navigation zeichnet; die frühere First-Party-Allowlist ist entfernt. Preview und Web Annotations sind keine `DesktopSessionTool`-Werte mehr. Fehlende Featurepakete liefern einen verständlichen Leerzustand und lassen Sessiontab-/Datenzustand für eine Wiederinstallation bestehen.

Root-Emit, Chat-UI-Typecheck/-Build und 39 fokussierte Feature-/UI-/Cachetests sind grün; `/tmp/pibo4-f04-feature-packages.md` enthält den Nachweis. Die Module werden im Arbeitsbaum bereits nach Owner getrennt, aber der Beleg eigenständiger self-contained npm-Artefakte und der physische Minimal-Core-Importgraph gehören weiterhin zu F06. Historische Product-UI-IDs bleiben bis F07 ausschließlich Cutover-Eingang; F08 entfernt danach ihre ausführbaren Übergangsmodule.

## F05 – Runtimepakete und Runtime Requests abschließen

- [ ] Pi-/Codex-/OMP-SDKs und Implementierungen aus statischen Core-Imports und Installationsabhängigkeiten entfernen.
- [x] Runtime Requests gemäß Abschnitt 5 zuordnen, inklusive Inline-Chat und Antwortweg; vorhandene andere Verbraucher erhalten.
- [x] Registrierung der Antwortaktionen aus `pibo.core` lösen; Plugin-Requests über öffentliche Actions/Controls anbinden, ohne Codex-Fallunterscheidung im Kern.
- [x] Session Inspector bleibt Kern und verwendet allgemeine Runtime-Inspektion.
- [ ] Pi-/Codex-Wiederaufnahme und vorhandene Reconstruction-/Binding-Verträge erhalten.
- [ ] OMP nur soweit für Paketgrenzen nötig anpassen und normalen Betrieb prüfen; bekannte Recovery-Grenze dokumentieren.

**Fertig, wenn:** Keine Runtime ist Voraussetzung für den Core-Start; eine installierte Runtime bringt ihre Angebote selbst mit. Request-Antworten bleiben funktionsfähig. Abhängigkeiten: F01, F03, gemeinsame UI-Verträge aus F04.

### F05-Zwischenstand: Runtime Requests und getrennte Runtime-Setups

Pi, Codex Native und OMP besitzen getrennte Backend-Setupmodule. Codex Native registriert die beiden Runtime-Request-Antwortaktionen, ihre Parameterprüfung, eine runtime-/capability-geeignete Workspace-View und einen eigenen Browserentry. Core registriert diese Action-Namen nicht mehr; Runtime Requests sind kein fester `DesktopSessionTool`. Der Inline-Chat bleibt als runtime-neutrale gemeinsame UI-/SSE-Hilfe bestehen und adressiert dieselben Request-IDs und dieselbe Pending-Queue wie die optionale View. Debug löst History-Adapter generisch aus dem aktiv installierten Runtimepaket statt über den statischen Sammeladapter auf.

Root-Emit, Chat-UI-Typecheck/-Build und 75 fokussierte Runtime-/Request-/UI-/Debugtests sind grün; `/tmp/pibo4-f05-runtime-requests.md` enthält den Zwischenbericht. F05 bleibt offen, weil alte Pi-Kompatibilitätsimports und Root-Exports (`core/runtime`, `core/routed-session`, Chat-Modell-/Trace-Kompatibilität) noch keine physische runtimefreie Core-Closure erlauben. Deren Entfernung/Service-Inversion wird mit F06/F08 abgeschlossen; danach wird Pi-/Codex-Recovery erneut vollständig geprüft.

## F06 – Minimal- und Standarddistribution bauen

- [x] Eigenständiges Core-Artefakt ohne Featurecode und Runtime-SDKs erstellen.
- [x] Standardzusammenstellung aus separaten versionierten Pluginartefakten bauen; vorhandene Auswahl respektieren.
- [x] Paketinhalt, installierte Abhängigkeiten und Browser-Bundles prüfen, nicht nur einen Start mit Disabled-Flags.
- [x] Frische Minimalinstallation ohne Cache und ohne Quellcheckout starten; Plugin anschließend installieren und nutzen.
- [x] Öffentliche Paket-/SDK-Kompatibilität und verständliche Diagnose bei Versionskonflikten prüfen.
- [x] Einen gepackten alten Monolith-/Beta-Stand über den zweistufigen Cutover auf gepackten Minimal-Core plus exakt gemappte Artefakte aktualisieren; ein unvorbereiteter Direktwechsel muss fail-closed bleiben.
- [x] Den gepackten Minimal-Core per Importgraph und Artefaktinhalt darauf prüfen, dass Run- und andere optionale Featurecontroller sowie konkrete Reminderimplementierungen nicht benötigt oder mitgeliefert werden. Die kleine bedingte Core-Delegation aus F11 ist Bestandteil des Kerns und lädt ohne ausgewählte Subagents keine Tools.
- [x] Den tatsächlichen npm-Releasepfad an dieselben Artefaktgrenzen binden: Der private Repository-Root darf nicht publiziert werden; Core, Cutover, jedes Plugin und Standard werden aus getrennten generierten Verzeichnissen geprüft und publiziert.
- [x] N-025 geschlossen: Das Core-Artefakt ist selbst eine installierbare App mit `bin/pibo`, `dist/bin/pibo.js`, `gateway:web`, Chat Web und den fünf Core-Ansichten; Clean-/Offline-Tests belegen den realen Start und die physische Feature-/Runtimefreiheit.

Stand 2026-09-15: Der N-025-Kandidat `8ad776f1` führte den dependency-freien ausführbaren `@pasko70/pibo@4.0.0-beta.1` ein. N-026 ist im Code-/Paketcommit `51bcfcef4653328823e79a0f2386b786fcf003d9` behoben: Der installierte Minimal-Core startet weiterhin `pibo --version`, `pibo gateway:web`, `/health`, Chat Web und die Storage-/Telemetry-Worker ohne Quellcheckout oder Netzwerkauflösung, besitzt im Agent-Katalog aber keinerlei Erweiterungsskills. `pi-agent-harness`, Runtime-/Docker-/Loop-/Ralph-Anleitungen und weitere Standard-Skills gehören nun dem Paket `pibo.builtin-profiles`; `web-annotations` bleibt Eigentum seines Fachpakets. Das ausschließlich in der Minimal-Core-Komposition registrierte Profil `core` verwendet `pibo.runtime-unassigned`, deaktiviert Builtin-Tools und erzeugt kein Runtimeplugin. Bootstrap, Session-Pluginplan und Agent-Pluginpreview antworten erfolgreich mit leeren Plugin-/Contribution-Mengen und einer `runtime-unassigned`-Warnung. Die Paketclosure prüft ausführbaren Server und Worker per Metafile, entfernt nicht erreichbare Browserchunks und verbietet konkrete Runtimeimplementierungen, `packaged-*`, Featurecontroller, Plugin-Entrypoints sowie verwaiste First-Party-Subview-Chunks. Der aktuelle Core-Tarball hat SHA-256 `fa617086c90459beb756ae9c43e851d61653d8fb51eaf592940a4e738795f8fb`.

`@pasko70/pibo-standard@4.0.0-beta.1` ist nun selbst ausführbar und liefert `pibo` sowie `pibo-standard`. Sein einzelner offline installierbarer Tarball enthält Core und genau die 20 in `package-set.json` festgelegten npm-Pakete als gebündelte Abhängigkeiten. Der generische Kompositionsstart installiert und aktiviert fehlende Quellen in Deklarationsreihenfolge, während vorhandene Deaktivierung oder Deinstallation weiterhin maßgeblich bleibt. Frischer Start und Wiederstart zeigen genau 20 aktive Installationen, Profil `base` und die Pi-Runtime. Der content-addressed Candidate-Installer und der Deployment-Pool verwenden die Standard-App statt des pluginfreien Core-Binaries. Der Standard-Tarball hat SHA-256 `20a931a2c84cd879217715d1a3e052abe9f2699918f19b277303c32559bf73ae`.

Die N-026-Korrektur beseitigt außerdem zwei durch die Vollsuite sichtbar gewordene Ordnungsfehler. Der Core stellt den User-Resources-Dienst vor Pluginaktivierung bereit, materialisiert benutzerdefinierte Ressourcen aber erst danach; dadurch kann ein User Skill keinen später aktivierten Plugin-Skill wie `skill-creator` doppelt registrieren. Die Chat-Navigation verbindet den synchronen Signalstatus mit dem dauerhaften Lesezeitpunkt, sodass ein noch nicht persistierter `session_error` sofort als Fehler erscheint und erst nach einer echten Lesebestätigung auf `idle` wechselt. Die fokussierten Paketprüfungen bestanden 10/10, die drei Ursachen-Suiten 31/31, die serielle Vollsuite ohne den separat ausgeführten Gatewaytest 3.046 Tests mit 3.036 Pässen, 0 Fehlern und 10 Skips sowie die Gatewayintegration 5/5 ohne Restprozess. Headful Mobile 390×844 und Desktop 1280×800 zeigten alle 20 Standardplugins als `ACTIVE`; die abschließenden CDP-Neuladungen hatten keine fehlgeschlagenen Antworten oder Konsolenfehler.

Historische Evidenz vor N-025 bleibt erhalten: `test/pibo4-packed-distribution.test.mjs`, der tatsächliche gepackte 3.6.2-Cutover, die Releasegrenzen-Commits und `/tmp/pibo4-f06-package-boundaries.md` belegen weiterhin die früheren Teilgrenzen, ersetzen aber nicht den neuen ausführbaren Start.

**Fertig, wenn:** Minimalbetrieb und nachträgliche externe Erweiterung sind aus echten gepackten Artefakten nachgewiesen. Abhängigkeiten: F02–F05; Migration von Bestand mit F07.

## F07 – Migration an neue Eigentümer und Paketgrenzen anpassen

- [x] Bestehende versionierte Migration wiederverwenden und um neue Owner-/Paket-/Tab-Zuordnungen ergänzen.
- [x] 3.6.2-Ausgangsdaten sowie aktuelle/teilmigrierte Beta-Daten abdecken.
- [x] Konsistentes Backup, Wiederaufnahme, Konfliktpfade und Restore dokumentieren und gezielt prüfen.
- [x] Effektive Tools und Kontext vor/nach Migration vergleichen; alle vorhandenen Benutzerressourcen und produktiven Daten erhalten.
- [x] Alte Produkt-UI-Ziele zu Core- oder Plugin-Zielen übersetzen; fremde Sessiontabs nie übernehmen.
- [x] Gesunde Profile bei isolierten Fehlern weiter migrieren; keine stillen neuen Defaults oder alte Ausführung aktivieren.
- [x] Alte Auswahlzustände samt aktiv/deaktiviert/deinstalliert in einen versionierten Cutover-Plan und verifizierte neue Paket-/Artefaktzuordnungen überführen; Nachweis am gepackten Alt-zu-Neu-Installationsweg statt nur an vorbereiteten DB-Fixtures.

Einstieg: `src/apps/chat/agent-store.ts`, `src/plugins/migration-journal.ts`, `src/plugins/product-state-migration.ts`, `src/plugins/browser-v1-upgrade.ts`, `src/gateway/server.ts` und Datenmigrationen.

Stand 2026-09-14: Das getrennt packbare Cutover-Werkzeug bewahrt den vollständigen alten Auswahl-Snapshot sowie Quell-, Core- und Artefakthashes, bevor der Monolith ersetzt wird. Minimal-Core prüft Plan und Bytes vor dem Datenzugriff, installiert nur aktive Ziele, lässt negative Auswahl uninstalliert und schreibt nach vollständiger Aktivierung einen wiederholbaren Abschlussbeleg. Bestehende Agent-, Ressourcen-, Sitzungs- und Browsermigrationen behalten ihre Journal-/CAS-Grenzen; alte Product-UI-Ziele werden am Import zu Core- oder neuen Pluginzielen übersetzt. Der fokussierte Nachweis umfasst 83/83 Tests und den tatsächlichen gepackten 3.6.2-Ausgangspunkt; Details stehen in `/tmp/pibo4-f07-cutover.md`.

**Fertig, wenn:** Wiederholter Start verändert bereits migrierte Daten nicht erneut; Unterbrechung und Konflikte führen weder zu Datenverlust noch Doppelaktivierung. OMP-Ausnahme bleibt explizit. Abhängigkeiten: endgültige Owner aus F00/F03–F05 und Artefakte aus F06.

## F08 – Legacy-Delivery vollständig entfernen

- [x] Produktive Registry-Leser auf neue Host-/Service-Abfragen umstellen.
- [x] Alte Registrierung, Typen, Helper, Übergangsparameter, Wildcard-Exports und ungenutzte alte Entrypoints entfernen.
- [x] Tests alter API-Flächen mit begründetem Verhaltensersatz migrieren; keine zweite Registry als dauerhafte Testinfrastruktur mitliefern.
- [x] Paket- und Importaudit über Server, CLI, Browser und Adapter ausführen; dokumentierte Ausnahmen nur für Datenmigration/Core-Ansichten.
- [x] Keine Legacy-Manifeste im normalen Laufzeitvertrag akzeptieren; notwendige Übersetzungen am Import-/Upgrade-Eingang isolieren.

Stand 2026-09-15: Commit `d37dea0c` ersetzt die Registry durch `PiboCapabilityHost` und `CapabilityProjection`, entfernt Wildcard-/`plugin-builtin`-Delivery sowie Aggregate-Entrypoints und hält Altformen ausschließlich an Migrationseingängen und in Testdaten. TypeScript-Kompilierung, 20 Pibo-4-Artefakte plus Standardkomposition, der serielle F08-Lauf mit 105/105 Tests und die isolierte Gatewayintegration mit 5/5 Tests sind grün.

**Fertig, wenn:** Das ausgelieferte System besitzt einen ausführbaren Erweiterungsvertrag und keinen alten Registrierungsweg. Abhängigkeiten: F01–F07.

## F09 – Dokumentation und Entwicklerweg abschließen

- [x] Die Matrix in Abschnitt 9 paketweise abarbeiten; implementierte Verträge in aktuelle Specs übertragen.
- [x] Öffentliche Dienste, Hooks und externe Paketentwicklung mit einem tatsächlich ausführbaren Beispiel erklären.
- [x] Minimal-/Standardinstallation, Upgrade, Backup, Konfliktreparatur und Deinstallation beschreiben.
- [x] OMP-Ausnahme und Unterstützungsumfang präzise angeben.
- [x] Überholte Planaussagen, Indizes und doppelte aktuelle Wahrheiten bereinigen, historische Evidenz erhalten.

Stand 2026-09-15: Die aktuelle [Pluginpaket-Spezifikation](/specs/product/plugin-profile-catalog.md) bindet den Capability-/Legacy-Cutover an `d37dea0c` und die physische npm-Releasegrenze an `746b990c`. Der [Entwickler-/Betriebsleitfaden](/project/guides/plugin-development-and-operations.md) beschreibt öffentliche Subpaths, Minimal/Standard, Cutover, Recovery, OMP-Grenze und Deinstallation. `examples/plugins/hello-pibo` kompiliert und importiert außerhalb der Produktkomposition, wird importfrei inspiziert, installiert, aktiviert und per `npm pack --dry-run` geprüft. Strikte OKF-Prüfung und Dokumentationstests sind grün.

**Fertig, wenn:** Ein Entwickler ohne Repo-internes Wissen ein Plugin hinzufügen kann und ein Betreiber den Upgrade-/Restore-Weg nachvollziehen kann. Abhängigkeiten: laufend zu F01–F08, endgültige Reconciliation nach Codeabschluss.

## F10 – Integrierte Abschlussabnahme

- [x] Vorgeschalteten Verpackungsreview auflösen: Der Root-Workspace ist kein npm-Releaseartefakt; der echte Wrapper publiziert ausschließlich getrennte Minimal-Core-/Cutover-/Plugin-/Standardpakete. Commit `746b990c`, Paketbuild und 14/14 fokussierte Paket-/Releaseprüfungen belegen die Grenze; keine Veröffentlichung wurde ausgeführt.
- [x] Commit- und paketgenauen lokalen Kandidaten festgelegt: `cb975d3e91aec82763990ab76b0626d23bd8f2d9`; Core, Cutover und Standard `4.0.0-beta.1`; 20 Pluginpakete `1.0.0`; das lokale Candidate-Assembly enthält alle 23 Tarballs checksum-gebunden.
- [x] Abschlussmatrix aus Abschnitt 8 mit bestehenden Tests, gezielten Ergänzungen und ausdrücklich begrenzter Fixture-Evidenz belegt.
- [x] Relevante Desktop-/Mobile-Flows einschließlich des installierten Minimal-Core headful geprüft. Pibo2 bleibt aufgrund der Arbeitsanweisung außerhalb dieses lokalen Abschlusslaufs und wird als separate Release-Evidenz ausgewiesen.
- [x] Aktuelle vollständige relevante Regressionssuite ausgeführt: der serielle Lauf ohne den separat begrenzten Gatewaytest ergab 3.046 Tests, 3.036 Pässe, 0 Fehler und 10 Skips; die Gatewayintegration bestand anschließend 5/5 und beendete den Testprozess sauber.
- [x] Planstatus und normative Dokumentation auf den damals belegten Implementierungsstand gesetzt; historische und aktuelle Zahlen bleiben getrennt.
- [x] N-025 integriert: Kandidat `8ad776f1` ist durch ausführbaren Core-Clean-Start, Offline-Installation aller 23 Tarballs und physische Closure belegt.
- [x] N-026 integriert: Kandidat `51bcfcef4653328823e79a0f2386b786fcf003d9` ergänzt den ausführbaren Standard-Only-Offlinepfad mit genau 20 Plugins, entfernt Erweiterungsskills aus Core und behebt die beiden in der Vollsuite gefundenen Start-/Signalreihenfolgen.
- [x] N-027 integriert: Kandidat `bb010a72141ea32059e992c8e9fad54fe111bd3e` liefert Core, Cutover, Standard und 20 Plugins als content-addressed Offline-Assembly. Der ausgelieferte Prepare-Runner und `pibo-standard gateway:web --cutover-plan` lösen die gebündelten Zielartefakte per Prüfsumme auf, erhalten aktive/deaktivierte/deinstallierte Zustände, Receipt, Sessions und Chatdaten und sind beim Wiederstart idempotent.
- [x] N-028 integriert: Kandidat `34691ecf95fb9bcfdcde7d896537c9fa1dc1ea9f` akzeptiert im ausschließlich externen Cutover-Prepare-Paket exakt semantische 1.x-, 2.x-, 3.x-Quellen sowie 4.0.0-alpha/beta/rc-Prereleases. Der reale Quellstand `@pasko70/pibo@1.7.2` ist damit checksum-gebunden vorbereitbar; falsche Paketidentität, malformed SemVer, 4.x stable/newer, 5.x und 0.x bleiben abgelehnt.
- [x] N-029 integriert: Kandidat `eda0911e6bb7722f59f6c203e596f9cc40390f8a` behandelt `pibo.standard-shell` ausschließlich im externen Cutover-Mapping als durch `@pasko70/pibo-standard` ersetzten Kompositionsowner. Es wird kein Pluginartefakt und kein Target erzeugt; der vorhandene generische `supersededOwners`-Pfad tombstoned den Altowner beim Start und Wiederstart.
- [x] N-030 integriert: Kandidat `2ca6701f24125c5f7db0f6a2ffcfeeddf1d06275` schließt ausschließlich die durch den verifizierten Plan signierten `supersededOwners` während der Cutover-Installationsgraphprüfung aus. Normale Providerkonflikte bleiben strikt. Alle Cutover-DB-Änderungen laufen bis zum erfolgreichen Abschluss in einer gemeinsamen Transaktion; Aktivierungsfehler rollen Installationen, Operationen und Artefaktzeilen zurück, erzeugen kein Receipt und können sicher erneut ausgeführt werden.
- [x] N-031 integriert: Kandidat `9a23906fc012f7d484cbaf3b464073867f561679` installiert alle aktiven Revisionsziele zuerst und aktiviert sie anschließend als einen vollständig vorgeprüften Cold-Start-Hostgraph. Historische, optionale und unbekannte Session-/Profilreferenzen sowie freigegebene Admissions bleiben erhalten und blockieren nicht; reservierte Admissions, aktive Runs/Runtimes und erforderliche Pluginabhängigkeiten brechen vor Mutation ab. Jede unvollständige Batchaktivierung wirft und rollt die gesamte Cutover-Transaktion zurück; normale Live-Drain-Semantik bleibt unverändert.
- [x] N-032 integriert: Kandidat `b785ca10d28bbbfcbe06b2efb836a1e8defd2b79` ersetzt einen retained SDK-Symlink nur nach vollständiger Planprüfung und nach direktem Nachweis eines `idle` PluginHost, unmittelbar vor dem ersten `host.start`. Der Tausch erfolgt über einen temporären Link und atomisches Rename auf den exakt aufgelösten neuen Core-Paketroot. Normale SDK-Vorbereitung und aktive Hosts verweigern Eigentümerwechsel weiterhin; gleiche Ziele werden idempotent wiederverwendet. Standard importiert Core aus genau dem checksum-gebundenen Root statt aus einer verschachtelten bundled Kopie.
- [x] N-033 integriert und nach realem Stagingbefund erneut geschlossen: Kandidat `cb975d3e91aec82763990ab76b0626d23bd8f2d9` registriert im self-contained Pi-Runtime-Backend die statisch gebündelten OAuth-Flows beider tatsächlich enthaltenen `pi-ai`-Instanzen. Damit bleiben keine variablen relativen OAuth-Imports auf nicht gelieferte Nachbardateien angewiesen. Bei einem expliziten `PIBO_HOME` löst die User-Resource-Schicht retained absolute Skillpfade generisch auf `${PIBO_HOME}/user-skills/<name>/SKILL.md` um, sofern dort die verwaltete Ressource liegt; ausdrücklich konfigurierte andere Roots behalten ihre bisherige Semantik. `maintain-okf-docs` bleibt User Resource, und die vier bestehenden Profilauswahlen bleiben unverändert. Ein gepackter Standard-Gatewaytest startet mit einem stale retained Pfad, belegt den rebasierten Bootstrapkatalog sowie die echte Turn-Vorbereitung und hinterlässt auch bei Assertionsfehlern keinen Gatewayprozess. Core-Builtin, Legacy-Fallback und pluginspezifischer Core-Pfad bleiben ausgeschlossen.

Stand 2026-09-15: Die kanonische serielle Regression ohne den separat begrenzten Gatewaytest umfasst nach N-027 3.047 Tests, 3.037 Pässe, 0 Fehler und 10 Skips. Die separat mit harter Grenze ausgeführte Gatewayintegration bestand 5/5 und hinterließ keinen Testprozess. Typecheck, Root-Emit, Chat-UI-Build und `npm run build` einschließlich Core-/Standardpaketen sind grün. Die fokussierten Paketprüfungen bestanden 10/10; die drei Ursachen-Suiten für Signalstatus, User-Skill-Ownership und Product Runtime bestanden 31/31. Der echte installierte Core-Tarball startet mit null Plugins und null Skills. Der echte installierte Standard-Tarball startete und startete erneut mit genau 20 aktiven Paketen. Headful Mobile 390×844 und Desktop 1280×800 zeigten die Standard-Pluginverwaltung mit 20 `ACTIVE`-Einträgen; die finalen CDP-Neuladungen meldeten keine fehlgeschlagenen Netzwerkanfragen oder Konsolenfehler. Belege: `/tmp/n026-standard-plugins-mobile.png`, `/tmp/n026-standard-plugins-desktop.png`, `/tmp/n026-standard-plugins-cdp.json` und `/tmp/n026-standard-plugins-desktop.json`.

Die Kandidaten `b30a1e03`, `8ad776f1` und `51bcfcef` bleiben historische Vor-N-025-, Vor-N-026- beziehungsweise Vor-N-027-Stände. Die lokale Abnahme für `bb010a72141ea32059e992c8e9fad54fe111bd3e` verwendet kontrollierte Runtime-/Request-Fixtures, wo externe Providerzugänge nicht Teil des Laufs waren. Sie ist keine npm-Veröffentlichung, kein Release, keine Pibo2-Abnahme und kein realer All-Runtime-Modellnachweis.

**Fertig, wenn:** Jede Zusage hat aktuelle Evidenz oder eine ausdrücklich vereinbarte Einschränkung. Für den F00–F10-Kandidaten erfüllt; F11 benötigt erneut lokale Paketabnahme und Pibo2-Akzeptanz. Release/Tag/Publish bleiben getrennte spätere Aktionen.

# 7a. F11 – Beta-Feedback: Core-Delegation, vollständiges Codex Native und stabile Scrollflächen

- [x] Das auswählbare Paket `pibo.agent-delegation` aus Standardkomposition, Agent Designer und gespeicherten Auswahlen entfernen; alte Auswahlwerte beim Lesen sicher bereinigen.
- [x] Alle vier Delegationswerkzeuge automatisch und ausschließlich bei mindestens einem effektiven Subagent bereitstellen.
- [x] Direkte Delegation ohne Run Control ausführen; ausgewähltes Run Control darf Delegation weiterhin als yieldable Tool kapseln.
- [x] Offizielle Codex-CLI und das passende Plattformpaket einschließlich `codex-code-mode-host` in Standard und content-adressierter Candidate-Assembly vollständig ausliefern; Minimal bleibt runtimefrei.
- [x] Settings-Inhalt auf Desktop und Mobile innerhalb des verfügbaren Pane-Viewports scrollbar machen.
- [x] Raum- und Session-Scrollpositionen bei Navigation, Route-Remount und mobilem Aus-/Einblenden bewahren; Sessionpositionen pro Raum und Archivansicht führen.
- [x] Preview, VS Code, Web Annotations, alle Tool-Ansichtsmodi und Debug-/Token-/Cache-Funktionen über bestehende fokussierte Verträge erneut prüfen.
- [ ] Den exakten festen Commit auf Pibo2 installieren und dort die betroffenen Browser- und Codex-Native-Flows mit `openai-codex/gpt-5.6-luna` und Reasoning Effort Medium akzeptieren.

Lokale Evidenz: vollständiger Typecheck und Build; 20 auswählbare Pluginartefakte; pluginfreier Minimal-Core; Standard mit offizieller Codex-Laufzeit; Candidate-Assembly mit 23 Pibo- und zwei Codex-Tarballs; 211/211 fokussierte Delegations-, Plugin-, UI-, Tool-Ansichts- und Debugtests; vollständige serielle Suite mit 3.075 Tests, 3.065 Pässen, 0 Fehlern und 10 Skips; gepackter Offline-Cutover mit leerem npm-Cache; headful Settings-Scroll auf 1440×900 und 390×844; mobile und Desktop A→B→A-Raum-/Sessionnavigation mit erhaltenen Scrollpositionen. Pibo2 bleibt bis zur erneuten Installation offen.

# 8. Validierungsphilosophie und Abschlussmatrix

Bestehende Tests sind der primäre Verhaltensvertrag. Sie werden so wenig wie möglich verändert. Neue Tests schließen tatsächliche Architektur-, Migrations- oder Lifecycle-Lücken. Änderungen an Tests werden damit begründet, welches alte Verhalten weiterhin geprüft wird oder welcher alte API-Vertrag ausdrücklich entfällt.[^owner-test-policy]

Während der Implementierung: relevante fokussierte Prüfungen, nötige Typechecks/Builds und schnelle UI-Iteration. Keine Fullsuite nach jedem CSS-/Tab-Edit, keine Dauertests und keine künstlichen Gates zwischen kleinen Schritten. Stabile Testergebnisse werden nur bei neuen Änderungen oder konkreten Zweifeln wiederholt. Beim integrierten Abschluss folgt die vollständige relevante Prüfung des festen Kandidaten.

| ID | Nachzuweisendes Szenario | Erfolgskriterium |
|---|---|---|
| A-C40-01 | Core installieren, null Plugins, null Runtimes | Start und Kernansichten funktionieren; keine Feature-/Runtime-Module werden benötigt oder nachinstalliert. |
| A-C40-02 | Externes Paket außerhalb des Repositories bauen | Tool mit unbekanntem Namen, Kontext, Settings und View ohne Core-Patch installierbar; keine privaten Imports. |
| A-C40-03 | Mehrere unabhängige Pluginpakete einzeln installieren/entfernen | Alle fachlich zugehörigen Beiträge erscheinen/verschwinden; unabhängige Funktionen bleiben intakt. |
| A-C40-04 | Gemischtes Goal-Plugin, zwei unterschiedlich konfigurierte Agents | Appdienst bleibt unabhängig von Agent-Toolauswahl; keine implizite Capability-Freigabe. |
| A-C40-05 | Ausführung mit Fortschritt, Cancel, Delegation und ausgelagertem Run | Gleicher Verhaltensvertrag ohne Namensdispatch; korrekte Session-/Generation-Zuordnung und Cleanup. |
| A-C40-06 | Runtime-/Service-Abhängigkeit fehlt oder ist inkompatibel | Präzise Aktivierungsdiagnose, kein teilaktives Plugin oder stiller Ersatz. |
| A-C40-07 | Plugin deaktivieren bei laufender Arbeit/ungespeicherter UI | Bestehende Guards/Drain greifen; keine verlorenen Daten, automatisch beantworteten Requests oder Geisterprozesse. |
| A-C40-08 | Session A mit Tabs, B leer, schnelle/langsame Wechsel und Refresh | Kein Tab-Übertrag; Reihenfolge/aktive Instanz pro Session; Cache und expliziter Refresh bleiben korrekt. |
| A-C40-09 | Desktop und Mobile, Core-/Plugin-Ansichten | Vorhandene Navigation, Fokus, optimistisches Session-Rename, Resize, Drawer, Plus-Position und vollständige Tab-Klickfläche bleiben erhalten. |
| A-C40-10 | Codex Approval und User Input in Chat und Tab | Eine gemeinsame Anfrage, richtige Rückantwort, keine Doppelantwort; falsche Session/veraltete Anfrage abgewiesen. |
| A-C40-11 | 3.6.2-Upgrade und Upgrade bereits migrierter Beta | Profile, Kontext, Plugin-Auswahl, Feature-Daten und Sessiontabs bleiben äquivalent; Core-/Plugin-Owner korrekt. |
| A-C40-12 | Unterbrechung, Wiederholung, Konflikt und Restore | Journal setzt sicher fort; Quellen bleiben gesichert; kein Datenverlust, keine neue Default-Auswahl. |
| A-C40-13 | Bestehende Pi-/Codex-Sessions, echtes Fehlen sowie Auth-/Rechtefehler | Original bevorzugt; Rekonstruktion nur bei belegtem Fehlen; keine fälschlich leere Ersatzsession. |
| A-C40-14 | OMP installieren und normalen bestehenden Betrieb nutzen | Plugin funktionsfähig; keine neue Recovery-/Cross-Runtime-Garantie verlangt. |
| A-C40-15 | Gepackte Minimal-/Standardartefakte und öffentliche Exports prüfen | Keine Legacy-Ausführung und keine versteckten Featureabhängigkeiten im Kern. |
| A-C40-16 | Dokumentation und Beispiel aus frischer Umgebung verwenden | Öffentlicher Installations-/Entwicklerweg funktioniert; Beschreibungen stimmen mit Kandidat überein. |

Lokale Evidenzzuordnung für `8ad776f1`:

- A-C40-01, A-C40-02, A-C40-03 und A-C40-15: `test/pibo4-executable-minimal-core.test.mjs`, `test/pibo4-packed-distribution.test.mjs`, `test/npm-package-contents.test.mjs`, `test/plugin-system-install.test.mjs`, `test/plugin-system-uninstall.test.mjs`, `test/plugin-system-v4-source-audit.test.mjs`, `test/release-script.test.mjs` und `test/compute-deployment-pool.test.mjs`.
- A-C40-04 bis A-C40-07: Plugin-Auswahl-, Goal-, Run-, Delegation-, Hook-, Lifecycle- und Produkt-Runtime-Tests der kanonischen Suite; die unveränderte Pi→Codex-yielded-Parität bleibt grün.
- A-C40-08 und A-C40-09: Sessiontab-, Desktoptab-, optimistische Session-, mobile Sidebar- und responsive UI-Tests sowie aktuelle headful Evidenz unter `/tmp/f10-{desktop,mobile}-*.png`, `/tmp/f06-core-final-desktop-five-views.png`, `/tmp/f06-core-final-mobile-settings.png` und `/tmp/f06-core-final-mobile-plugins.png`.
- A-C40-10: `test/codex-native-requests.test.mjs`, `test/chat-runtime-request-stream.test.mjs` und zugehörige Chat-UI-Requesttests; kontrollierte lokale Request-Evidenz, kein neuer externer Modellturn.
- A-C40-11 und A-C40-12: `test/pibo4-cutover.test.mjs`, `test/plugin-system-migration-journal.test.mjs`, automatische Legacy-Session-/Browsermigration und Konflikt-/Recoverytests.
- A-C40-13: bestehende Pi-/Codex-Router-, Binding-, Restart- und Portabilitytests; insbesondere die unveränderte dauerhafte Codex-Binding-Parität mit persistiertem `missing`.
- A-C40-14: `test/omp-runtime.test.mjs`, `test/omp-resources.test.mjs` und bestehende Portability-Grenzen; kein Anspruch auf neue OMP-Recovery.
- A-C40-16: ausführbares `examples/plugins/hello-pibo`, strikte OKF-Prüfung und 86 Dokumentationstests.

Für fachliche Refactorings dienen bestehende Runtime-, Context-, Session-, Plugin-, Tool- und UI-Tests als Ausgangspunkt. Ein bloßer Source-Stringtest beweist keine unabhängige Paketierung; ein Healthcheck beweist weder Migration noch funktionierende Tool-Ausführung. Neue externe Paketfixtures sollen allgemeine Verträge prüfen, nicht eine kopierte First-Party-Allowlist.

## Vorhandene Tests als konkrete Einstiegspunkte

Diese Dateien wurden für den Plan identifiziert, nicht in diesem Planungsschritt als Anwendungstests ausgeführt. Die Implementierung ergänzt die betroffenen Testnamen und tatsächlichen Befehle zu jedem Arbeitspaket.

| Arbeit | Vorhandene Tests / Hilfen | Was erhalten oder gezielt ändern? |
|---|---|---|
| Runtime Requests | `test/codex-native-requests.test.mjs`, `test/chat-runtime-request-stream.test.mjs`, `test/chat-ui-runtime-request-stream.test.mjs`, `test/chat-ui-runtime-request-panel.test.mjs` | Anfrage-/Antwort-/SSE-Verhalten, Redaction und UI erhalten; ergänzend Paketinstallation und gemeinsame Inline-/Tab-Quelle prüfen. |
| Web-Actions und Runtime-Vertrag | `test/web-channel.test.mjs`, `test/output-event-policy.test.mjs`, `test/agent-runtime-registry.test.mjs` | Allgemeines Routing, Ereignisse und Capability-/Control-Konsistenz erhalten. |
| Plugin-Lifecycle / Komposition | `test/plugin-system-lifecycle.test.mjs`, `test/plugin-system-runtime.test.mjs`, `test/plugin-system-product-runtime.test.mjs` | Gleiche Aktivierungs-/Cleanup-Verträge über öffentliche Host-Fixtures prüfen. |
| Alte Registry und Delivery | `test/plugin-system-v4-source-audit.test.mjs`, `test/plugin-registry.test.mjs`, `test/helpers/capability-host.mjs`, `test/helpers/plugin-product.mjs` | Registry-Ausnahme ist entfernt; Testhilfen verwenden den Capability Host, Produktverhalten bleibt abgedeckt. |
| Sessions und Runtime-Lifecycle | `test/runtime-routed-session.test.mjs`, `test/session-actions.test.mjs`, `test/codex-native-turn.test.mjs`, `test/codex-native-thread.test.mjs` | Keine Regression durch neue Dependency-Injection und getrennte Pakete; alte Registrierungs-Setups ersetzen. |
| OMP-Erhalt und vorhandene Portability | `test/omp-runtime.test.mjs`, `test/omp-resources.test.mjs`, `test/runtime-portability.test.mjs` | Bestehendes Verhalten einschließlich expliziter Unsupported-Grenzen erhalten; keine neue OMP-Recovery-Funktion verlangen. |

Der vorhandene [Session-Workspace-Vertrag](/specs/web/session-workspace-lifecycle.md) bleibt zusätzlich Einstieg für seine konkreten UI-/Persistenztests. F00 ergänzt die existierenden testspezifischen Pfade der weiteren Featurepakete; diese Liste ist kein Ersatz für deren Verhaltensabdeckung.

Reale Pi-/Codex-Modell- und Request-Pfade werden zum Abschluss begrenzt geprüft. OMP erhält einen Funktionserhaltungsnachweis, keine zusätzliche Recovery-Matrix. Fehlt externe Authentifizierung, wird genau dieser Nachweis als offen ausgewiesen; lokale Implementierung und unabhängige Prüfungen können weiterlaufen.

# 9. Dokumentationsarbeit als Teil der Implementierung

Dieser Plan wird jetzt in `docs/plans/` gespeichert. Aktuelle Specs werden erst geändert, wenn das beschriebene Verhalten tatsächlich implementiert und gegen den jeweiligen Commit geprüft ist. Neue Soll-Zustände werden nicht als bereits geltende Ist-Verträge ausgegeben.

| Dokument / Bereich | Ergebnis 2026-09-15 |
|---|---|
| `docs/plans/unified-plugin-system-rebuild.md` | Historischer Gesamtplan bleibt erhalten; dieser Abschlussplan besitzt weiterhin Vorrang für Core-Ansichten, OMP-Grenze und F00–F10. |
| `docs/plans/unified-plugin-system-execution.md` | Aktuelle F08-/F09-Ownership korrigiert; historische Evidenz und ältere Kandidatenzahlen bleiben klar als historisch markiert. |
| `docs/specs/product/plugin-profile-catalog.md` | Vollständig auf Capability Host, immutable Pakete, öffentliche Subpaths, Lifecycle, Cutover und entfernte Legacy-Delivery neu gebunden. |
| `docs/specs/product/app-context.md` | Web-Komposition auf Core-owned `provideCoreWebProduct` und `runWebGatewayServer` korrigiert. |
| `docs/specs/resources/external-mcp-and-pi-packages.md` | Bereits deprecated; keine aktuelle Pluginautorität und daher keine konkurrierende Ist-Spezifikation. |
| `docs/specs/resources/index.md` | Geprüft und durch den OKF-Indexer ohne zusätzliche Drift bestätigt. |
| `docs/specs/web/session-workspace-lifecycle.md` | Bereits commit-gebunden aktuell für Session-owned Core-/Plugin-Tabs, Refresh, Cache und Migration; unverändert validiert. |
| `docs/specs/gateway/web-host-and-channel.md` | Registry-Traceability durch Capability-Host-/Gateway-Symbole ersetzt. |
| `docs/specs/orchestration/loops-goals-and-ralph.md` | Gateway-Komposition auf `runWebGatewayServer` und aktuellen Commit nachgezogen; OMP bleibt unabhängig. |
| `docs/specs/resources/transcription-and-speech-providers.md` | Providerregistrierung und Session-Lifecycle auf `PiboCapabilityHost` sowie aktuellen F08-Nachweis gebunden. |
| `docs/specs/runtime/adapter-contract.md` | Bereits aktuell für adapterneutrale Binding-/Recovery-Verträge; unverändert validiert. |
| `docs/specs/runtime/codex-native-adapter.md` | Bereits aktuell für Codex-eigene Requests, Antwortwege und Recovery; unverändert validiert. |
| `docs/specs/runtime/pi-adapter.md`, `docs/specs/runtime/omp-adapter.md` | Bereits aktuell; OMP dokumentiert normalen Betrieb und explizit fehlende sichere Rekonstruktion. |
| `docs/project/guides/plugin-development-and-operations.md` | Neu: externe Entwicklung, öffentliche Dienste, Minimal/Standard, Upgrade, Recovery, Konfiguration und Uninstall. |
| `examples/plugins/hello-pibo` | Neu: tatsächlich gebautes, inspiziertes, installiertes, aktiviertes und packbares externes Beispiel. |
| `docs/specs/web/context-settings-and-agent-designer.md` | Kernansichten, unabhängige Benutzerressourcen, Plugin-Erweiterungspunkte und Leerzustände ohne Runtime dokumentieren. |
| `docs/specs/web/app-shell-bootstrap-navigation-and-pwa.md`, `docs/specs/web/streaming-cache-and-live-projection.md` | Core-Shell, Bootstrap, Streaming/Cache und optionale Feature-/Request-Renderer auf neue Komposition abstimmen. |
| Weitere Tool-, Context-/Build-Context- und Migration-Spezifikationen | Öffentliche Dienste und Owner in den bestehenden Domain-Verträgen nachziehen; verbleibende genaue Pfade in F00 ergänzen. |
| Architektur-/Entscheidungsdokument unter `docs/project/` | Dauerhafte Kern-/Plugin-Grenze, Dependency-Richtung, öffentliche Serviceverträge und Minimal-/Standard-Komposition erklären. |
| Entwickler-Guide unter `docs/project/` | Externes Paket von null bis Installation: Manifest, SDK, Tools, Kontext, UI, Settings, Dependencies, Fehler, Tests, Lifecycle und Versionswechsel. Neue Pfade als Guide anlegen. |
| Operator-Guide/Runbook unter `docs/project/` | Minimal-/Standardinstallation, vollständiges Backup, 3.6.2-/Beta-Upgrade, Konfliktreparatur, Deinstallation, Wiederinstallation und Restore dokumentieren. |
| `GLOSSARY.md` | „Kern“, „Plugin“, „Kernansicht“, „Runtime Request“, „Session Inspector“, „Distribution“ und Services konsistent unterscheiden; keine alte Registry als alternative Architektur erklären. |
| `DESIGN.md` | Gemeinsames First-Party-Design als wiederverwendbare UI-Konvention, Core-Ausnahmen und Plugin-Gestaltungsfreiheit festhalten. |
| `README.md`, öffentliche Paket-READMEs und CLI-Hilfe | 4.0-Installationswege, benötigte Runtime, externe Pluginentwicklung und klare Breaking Changes aktualisieren; CLI-Hilfe schrittweise entdeckbar halten. |
| `docs/index.md`, nächste Indizes, `docs/log.md`, `docs/project/okf-migration-ledger.json` | Neue/verschobene Konzepte korrekt erfassen, Indizes generieren und Änderungen nachvollziehbar protokollieren. |

Jedes neue aktuelle Verhalten erhält einen einzigen normativen Domain-Owner, passende stabile Anforderungs-IDs und echte Source-/Test-Zuordnung. Geschlossene Planteile werden nach Konsolidierung historisiert. Veröffentlichte Evidenz bleibt unverändert; Korrekturen erhalten eigene Nachweise. Keine künstliche Neuschreibung alter Prüfungen als aktuelle Abnahme.

Dokumentationsprüfungen gemäß Projektprofil: `npm run docs:validate`, `npm run docs:validate:okf`, `npm run docs:validate:migration`, `npm run docs:indexes:check`, `npm run docs:log:check`, `npm run docs:validator:test`. `docs:validate` deckt den strikten Modus ab. Die planende Änderung benötigt keine App- oder Pibo2-Abnahme, weil sie keine Laufzeit ändert.

# 10. Risiken, Entscheidungen und Abschluss

| Risiko | Umgang |
|---|---|
| Nur sichtbare Registrierung wandert, fachlicher Code bleibt im Core | Importgraph und gepackte Minimalinstallation prüfen; Feature-Controller dem Paketowner zuordnen. Die ausdrücklich Core-eigene bedingte Agent Delegation bleibt die dokumentierte Ausnahme. |
| Bisher globale Dienste werden durch naive Extraktion mehrfach gestartet | Eine klare Dienstinstanz pro definiertem Scope, explizite Provider-Abhängigkeiten und Cleanup-Nachweis. |
| Sammelpakete aufzuteilen verliert IDs, Tabzustände oder Settings | Versionierte Owner-Zuordnung und Migration sowohl von 3.6.2 als auch aktuellem Beta-Zustand. |
| SDK ist zu eng, First-Party-Plugins greifen wieder auf Interna zu | Externes Beispiel früh ausführen; fehlende allgemeine Verträge zuerst ergänzen. |
| SDK bietet unklare Hooks mit zufälliger Reihenfolge | Reihenfolge, Konflikte, Austausch und Fehler explizit definieren; kein implizites Verhalten nach Pluginname. |
| Request-UI wird verschoben und blockiert andere Runtimes | Tatsächliche Produzenten/Konsumenten vor F05 prüfen; existierende Unterstützung erhalten, keinen neuen OMP-Ausbau beginnen. |
| Default-Komposition installiert entfernte Plugins erneut | Installationsabsicht von aktuellem Aktivierungszustand trennen; bestehende Benutzerauswahl ist maßgeblich. |
| Teständerungen verdecken Regressionen | Verhaltenstests erhalten, API-bedingte Anpassungen begründen, endgültige Parität am festen Kandidaten nachweisen. |

Noch zu konkretisierende Implementierungsentscheidungen sind Paketnamen/Versionierung, genaue öffentliche Service-Schnittstellen und die kleinste gemeinsame Request-Hilfe für tatsächlich vorhandene andere Verbraucher. Diese Details werden in F00/F01 anhand der Quellen entschieden; sie ändern nicht die vereinbarte Kern-/Plugin-Grenze. Ein neues Framework, Marketplace, Sandbox, unbegrenztes Hot-Reload, neues Pi-Request-Produkt oder OMP-Featureausbau gehören nicht zum Auftrag.

**Abgeschlossen ist der Umbau, wenn:** Der Kern ohne Plugins aus einem echten Minimalartefakt startet; optionale Erweiterungen über öffentliche Verträge separat lieferbar sind; nur die dokumentierte bedingte Agent-Delegation konkrete Core-Toolnamen besitzt; die fünf Core-Ansichten erhalten sind; bestehende Daten über den dokumentierten Upgrade-Weg übernommen werden; Pi/Codex den zugesagten Sessionumfang erfüllen, OMP im vereinbarten Erhaltungsumfang funktioniert; UI-Parität und Dokumentation am exakten Kandidaten belegt sind.

[^owner-completion]: Produktentscheidungen des Auftraggebers vom 14. September 2026: harter 4.0-Schnitt, pluginfreier Kern, ausdrücklich benannte Kernansichten, extern lieferbare Erweiterungen und begrenzter OMP-Umfang.
[^owner-test-policy]: Bestehende Tests bewahren und für Verhaltensparität nutzen; gezielte Iteration während Entwicklung, integrierte Prüfung zum Abschluss.
[^owner-beta-feedback]: Produktentscheidungen des Auftraggebers vom 16. September 2026: Agent Delegation wird bei ausgewählten Subagents automatisch Core-Bestandteil und funktioniert ohne Run Control; Run Control bleibt optional; Codex Native muss vollständig ausgeliefert werden; Settings und Sidebars bewahren nutzbare Scrollflächen und Positionen.

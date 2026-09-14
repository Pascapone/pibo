---
type: "Plan"
title: "Pibo vollständig über Plugins erweitern: Umbauplan für Coding-Agents"
description: "Definiert den Plugin-Umbau mit getrennter systemweiter und agentbezogener Aktivierung, Agent-Designer, sessiongebundenen Tabs, plugin-eigenen Settings, vollständigem Build Context, Runtime-Beiträgen und sessionerhaltender Deinstallation."
tags: ["plugins", "architecture", "agent-designer", "runtime", "web", "migration"]
status: "draft"
authority: "directive"
generated:
  by: "openai-codex/gpt-6"
  at: "2026-09-14T08:10:00Z"
sources:
  - id: "v4-clean-cut"
    resource: "scope:owner decision 2026-09-13; plugin rebuild is Pibo 4.0; breaking interfaces accepted; automatic lossless migration; only new plugin delivery ships, no dual legacy runtime"
  - id: "optional-modules-owner-feedback"
    resource: "scope:owner feedback 2026-09-13; optional workspace modules; Settings/Plugins configuration; generic system versus agent contribution contracts; collapsed categorized designer; actionable legacy migration"
  - id: "test-preservation"
    resource: "scope:owner instruction 2026-09-12; preserve existing tests wherever possible and use them to prove behavioral parity after plugin migration; add new tests and justify unavoidable existing-test adjustments"
  - id: "owner-decisions"
    resource: "scope:owner conversation through 2026-09-11 including follow-up on Context/Settings, plugin-owned settings and context options, complete Build Context, persistent per-session desktop tabsets; plugin-only executable extensions, trusted plugins, Agent Designer, independent user resources, retained sessions"
    title: "Produktentscheidungen des Auftraggebers"
  - id: "activation-scopes"
    resource: "scope:owner clarification 2026-09-12; plugins may be system-only, agent-only or mixed; app-wide Goal mechanisms remain active independently of per-agent Goal tooling"
    title: "Systemweite Funktionen und getrennt auswählbares Agent-Tooling"
  - id: "planning-direction"
    resource: "scope:2026-09-11 follow-up architecture assessment and requested implementation plan; evolve Pibo's own system using Cordis principles"
    title: "Arbeitsgrundlage: eigenes System statt Cordis-Integration"
  - id: "research"
    resource: "/reports/cordis-plugin-architecture-feasibility-2026-09-11.md"
    title: "Vorangegangene Quellenanalyse; ursprüngliche Framework-Empfehlung durch diesen Plan fortgeschrieben"
  - id: "code-baseline"
    resource: "https://github.com/Pascapone/pibo/tree/cac4dcd03945b9754db7be9ab2ab4324f10c335c"
    title: "Geprüfter upstream/dev-Stand für bestehende Pfade und Tests"
---

# Zweck, Verbindlichkeit und Einstieg

Dieser Plan ist die gemeinsame Ausführungsgrundlage für Coding-Agents. Er beschreibt **noch zu implementierendes Verhalten** und ersetzt keine aktuelle Spezifikation. Alle Arbeitspakete beginnen offen. Ein Haken bedeutet später nachgewiesene Fertigstellung, nicht lediglich geschriebenen Code.

**Ziel:** Ein einziges Pibo-Plugin-System besitzt ausführbare Erweiterungen, installierbare Features und deren UI. Auch mitgelieferte Produktfunktionen werden darüber zusammengesetzt. Der Agent-Designer bleibt das zentrale Werkzeug zur Agent-Konfiguration. User-Skills, Kontextdateien und manuelle Subagent-Konfiguration bleiben ohne Plugin nutzbar.

**Fortschreibung vom 13. September 2026:** Ein Plugin benötigt keinen Tab. Nur ausdrücklich als fachliches Workspace-Modul deklarierte Views erscheinen in der Modulwahl. Plugin-Konfiguration bleibt unter Settings → Plugins verfügbar, unabhängig von einem eigenen Tab und von der Agent-Auswahl. Systemweite und agentbezogene Beiträge sind getrennte Vertragsdimensionen; die nachfolgende Philosophie ersetzt frühere pauschale Zuordnungen aller Settings zu Plugin-Tabs.

**Technische Arbeitsgrundlage:** Das bestehende Pibo-System wird weiterentwickelt. Cordis dient als Vorbild für Ownership, Dienste, Dependency-Auflösung und Cleanup; Cordis wird nicht als neue Laufzeitabhängigkeit eingeführt. DeepSeek Harness ist ausschließlich ein Implementierungsbeispiel. Die frühere Cordis-Übernahmeempfehlung im [Untersuchungsbericht](/reports/cordis-plugin-architecture-feasibility-2026-09-11.md) ist für diesen Plan nicht maßgeblich.[^planning-direction]

Der Plan legt bewusst einen begrenzten ersten Lifecycle fest. Eine reaktive Neuimplementierung von Cordis, beliebiges Hot-Reload und gleichzeitig aktive Versionen desselben Plugins sind nicht Teil der ersten Migration. Sollte ein Agent feststellen, dass der vereinbarte Umfang ohne solche Mechanismen nicht erreichbar ist, dokumentiert er den konkreten Konflikt, statt unbemerkt ein zweites Framework einzuführen.

Für den Einstieg liest ein Agent diese Abschnitte: Produktentscheidungen, Zielverträge, das übernommene Arbeitspaket, seine Abhängigkeiten und die zugehörigen Abnahmeszenarien. Der historische Bericht und die Referenz-Repositories sind vertiefende Quellen, keine Pflichtlektüre für jedes Paket.

## PLG-V4-001: Pibo 4.0 mit automatischer Datenmigration

Der Plugin-Umbau ist die nächste Hauptversion **4.0**. Breaking Changes an alten Erweiterungs-, Konfigurations- und internen APIs sind zulässig. Datenverlust oder eine stillschweigende Änderung der wirksamen Agent-Konfiguration sind es nicht. Diese Entscheidung ersetzt frühere Anforderungen an dauerhaft parallele Legacy-Delivery sowie die manuelle Migration einzelner Agents im Designer.

- **Ein Betriebsmodell:** Nach dem Upgrade laufen Registrierung, Capability-Auswahl, Kontextaufbau und Delivery ausschließlich über den neuen Plugin-Host und dessen effektiven Plan. Auch mitgelieferte Pibo-Funktionen und systemweite Dienste haben dort ihre Zuständigkeit. Entfernte alte Pfade dürfen nicht als stiller Fallback weiterlaufen.
- **Automatische Migration:** Vor der Aufnahme neuer Runtime-Generationen werden alte gespeicherte Daten erkannt, gesichert, anhand nachvollziehbarer Eigentümerzuordnungen übersetzt und geprüft. Kleine versionierte Datenimporter bleiben isoliert am Upgrade-/Restore-Eingang; wiederholtes Starten und Unterbrechungen müssen durch Journal, Quellprüfsumme, atomare lokale Schritte und Wiederaufnahme sicher sein. Bereits migrierte Daten werden nicht nochmals verändert.
- **Erhaltene Konfiguration:** Aktive und archivierte Profile, IDs/Aliase, Runtime-Bindings und Optionen, Modelle, Tool-Schemata und Auswahl, direkte/ausgelagerte Ausführung, Goal-/Run-Filter, MCP-Auswahl, Subagent-Ziele und Overrides, Skills, Kontextdateien und deren Inhalte, Referenzen, Herkunft, Reihenfolge und Ladeverhalten bleiben erhalten. Session-Historie und Verknüpfungen bleiben lesbar; historische Snapshots werden nicht umgeschrieben.
- **Keine falsche Plugin-Pflicht für Dateien:** Eigene Skills und Kontextdateien dürfen weiterhin unabhängige Ressourcen sein; sie durchlaufen denselben Plan und Delivery-Vertrag. Harness-eigene Tools und native Transkripte bleiben unter Harness-Kontrolle. Alte Pibo-Registrierung darf nicht einfach als Harness-Ressource umetikettiert werden, um ihre Migration zu umgehen.
- **Nachweis statt Defaults:** Der vorher wirksame Capability-/Kontextaufbau wird gegen den migrierten Aufbau verglichen. Keine pauschalen Defaults, keine verlorenen Filter, keine doppelte Kontextbeigabe. Bereits fehlende Referenzen bleiben mit Diagnose erhalten; vorhandene Ressourcen dürfen nicht durch Warnungen als erfolgreich ersetzt gelten. Echte nicht auflösbare Zuordnungen erzeugen einen präzisen Upgrade-Reparaturfall mit gesicherten Quelldaten, keinen Datenverlust und keinen alten Ausführungsfallback.
- **Produktfluss:** Erfolgreich migrierte Agents sind unmittelbar editierbar. Es gibt keinen regulären Hinweis oder Review-/Apply-Knopf für alte Tool-Auswahlen. Das Deployment auf Pibo2 prüft reale bestehende Profile zusätzlich zu isolierten Altzustands-Fixtures.
- **Tests:** Bestehende Tests bleiben der primäre Verhaltensvertrag. Ergänzende gezielte Upgrade-, Wiederaufnahme- und Kontext-Paritätstests sichern die Migration. Unvermeidbare Anpassungen wegen entfallender APIs werden mit erhaltenem Verhaltensnachweis begründet; Erwartungen dürfen nicht an verlorenes Verhalten angepasst werden. Die vereinbarte schnelle UI-Iteration ohne Fullsuite bleibt bestehen; die abschließende 4.0-Abnahme wird separat vollständig belegt.

Die 4.0-Entscheidung ist kein Auftrag zur sofortigen Veröffentlichung, zum Merge oder zur NPM-Publikation. Fertigstellung verlangt einen Audit der tatsächlich ausgelieferten alten Ausführungspfade; eine neue Versionsnummer oder entfernte UI-Meldung allein erfüllt sie nicht.

## Baseline und Arbeitsumgebung

- Geprüfter Pibo-Commit: `cac4dcd03945b9754db7be9ab2ab4324f10c335c`, beim Planbeginn identisch mit frisch abgerufenem `upstream/dev`.
- Dokumentations-Worktree: `/root/code/pibo-cordis-analysis`, Branch `docs/cordis-plugin-architecture`.
- Die dortigen Bericht-/Index-/Log-Änderungen gehören zur vorherigen Recherche und werden erhalten.
- Jeder Implementierungszweig beginnt später auf aktuellem `upstream/dev` und gleicht die hier genannten Pfade vor dem Editieren ab.
- Code, Builds und Laufzeittests laufen im isolierten Docker-Worker nach den Pibo-Skills; der Controller-Gateway wird nicht verändert.
- Vor jedem codewirksamen PR folgt Pibo2-Akzeptanz desselben lokal geprüften Kandidaten. Dieser Plan autorisiert keine Veröffentlichung, keinen Merge und keine Produktionsinstallation.

# Festgelegte Produktentscheidungen

Die folgenden Punkte stammen aus den Produktvorgaben; sie werden von Coding-Agents nicht erneut grundsätzlich entschieden.[^owner-decisions]

| ID | Festlegung |
|---|---|
| D01 | Plugins sind der einzige öffentliche Weg für ausführbare Pibo-Erweiterungen. Es gibt keinen zweiten Capability-Package- oder Pi-Package-Lifecycle. |
| D02 | Auch mitgelieferte UI und Dienste werden als Plugins aufgebaut. Öffentliche Erweiterungs- und Austauschverträge ersetzen Eingriffe in interne React-Strukturen als unterstützten Integrationsweg. |
| D03 | Installierte Plugins sind voll vertrauenswürdiger Code und dürfen Pibo umfassend verändern. Es wird keine Plugin-Sandbox und keine künstliche Beschränkung auf additive Tabs eingeführt. |
| D04 | Die Philosophie und Funktionen des Agent-Designers bleiben erhalten: Profile, Modelle, Runtime-Optionen, Ressourcen, Subagents und deren Konfiguration. |
| D05 | Im Designer ersetzt ein Plugin-Bereich die direkten Pibo-Tool- und Package-Bereiche. Pi Built-in Tools bleiben separat konfigurierbar. |
| D06 | Ein Agent kann die Agent-Beiträge eines Plugins aktivieren oder deaktivieren. Das verändert dessen systemweite Aktivierung nicht. Optionale Agent-Beiträge sind einzeln abwählbar; Pflichtbeiträge gelten innerhalb der aktivierten Agent-Seite. |
| D07 | User-Skills und Kontextdateien bleiben unabhängig von Plugins hinzufügbar und auswählbar. Manuelle Subagent-Konfiguration bleibt zusätzlich zu pluginbereitgestellten Subagents bestehen. |
| D08 | Der Built-in Pibo Tool Catalog wird in fachlich sinnvolle Plugins zerlegt. Codex Compat, Web Annotations, Run-Control und Goal-Control werden über denselben Vertrag bereitgestellt. |
| D09 | Die heutige CLI-basierte MCP-Anbindung wird ein Plugin. Weitere MCP-Adapter können als Plugins denselben Liefervertrag verwenden. |
| D10 | Unterstützung wird pro Beitrag deklariert. Optionale inkompatible Beiträge dürfen fehlen; erforderliche verhindern die betreffende Aktivierung mit Erklärung. |
| D11 | Der exklusive Pibo-Pi-Package-Weg entfällt vollständig. Dritte können einen Importer oder eine Pi-Integration als gewöhnliches Plugin bauen. Automatische ausführbare Pi-Extensions außerhalb des gewählten Plugin-Plans werden unterbunden. |
| D12 | Plugins können installiert und deinstalliert werden. Deinstallation erhält Sessions, Historie und Ergebnisse. Auswirkungen werden vorher ausgewiesen. |
| D13 | Lokale Entwicklung und versionierte Pakete werden unterstützt. Ein späterer Marketplace muss ohne Wechsel von Plugin-Identität und Format ergänzbar sein. |
| D14 | Produktoberfläche ist die Desktop-first Web-App einschließlich browserbasierter Terminal View. Eigenständige TUI und VS-Code-Erweiterung werden aus dem Produkt entfernt; die Operator-CLI bleibt. |
| D15 | Jeder Desktop-Tab gehört zur beim Öffnen ausgewählten Pibo Session. Sessionwechsel stellt deren eigenes persistiertes Tabset einschließlich aktivem Tab und View-Zustand wieder her; das gilt auch für Context und Settings. |
| D16 | Plugin-spezifische Settings und Kontextoptionen werden generisch unter Settings → Plugins angeboten. Ein fachlicher Plugin-Tab ist optional; Konfiguration erzeugt keinen eigenen Workspace-Tab. Unabhängige User-Ressourcen bleiben zugänglich. |
| D17 | Build Context macht die gesamte Kontextzusammensetzung einschließlich aller Plugins und Funktionen nachvollziehbar: Herkunft, Auswahl, Reihenfolge, Transformationen, Lieferung, Ausschlüsse und Grenzen der Einsehbarkeit. |
| D18 | Ein Plugin kann ausschließlich systemweite, ausschließlich agentbezogene oder beide Arten von Beiträgen enthalten. Systemweite Aktivierung und Agent-Auswahl sind getrennte Zustände desselben Plugins; das Goal-Plugin ist der verbindliche Mischfall. |
| D19 | Bestehende Tests bleiben möglichst unverändert und bilden den primären Nachweis, dass Pibo nach dem Plugin-Umbau wie zuvor funktioniert. Neue Tests ergänzen diesen Bestand. Unvermeidbare Anpassungen benötigen eine konkrete Begründung und erhalten den Verhaltensnachweis. |
| D20 | Das Erstellen einer Session verwendet ausschließlich die Client-Navigation der laufenden Chat-App. Die optimistische Session wird aktiviert und ihr Inline-Rename-Feld bereits vor Abschluss des Create-POST fokussiert, ohne Document-/PWA-Reload; eine neuere bewusste Auswahl bleibt maßgeblich. |
| D21 | Ein geöffneter echter Workspace-Tab bleibt beim Wechsel zu einem anderen Tab gemountet. Inaktivität wird dem View-Vertrag signalisiert; Refresh führt zuerst die registrierten Leave-/Autosave-Guards und ausstehenden Tabset-Saves aus und remountet bei Erfolg ausschließlich den gewählten Tab. Close entfernt ihn und gibt seine UI-Ressourcen frei. |
| D22 | Der sichtbare Desktop-Workspace ist Teil des revisionsgesicherten PluginStore-Tabsets seiner Pibo Session. Neue Sessions beginnen ohne echte Tabs; Reihenfolge, aktiver Tab und unterstützter View-Zustand werden weder Room- noch Browser-global geteilt. Auch die URL-/Route-Reconciliation gehört der Session-Auswahlgeneration, die die Route beobachtet hat: eine beim Sessionwechsel noch sichtbare Route von A darf weder ein bereits geladenes noch ein verzögert geladenes leeres Tabset von B initialisieren. Ein begrenzter Controller-Cache darf nur verlustfrei verwerfbare Einträge entfernen: lokale Entwürfe, CAS-Konflikte und laufende Reads/Writes bleiben bis Speicherung oder ausdrücklicher Recovery erhalten, während Browser-Hosts und React-Panels beim Sessionwechsel weiterhin entsorgt werden. |


## PLG-UX-002: Session-Erstellung und Session-eigener Workspace-Lifecycle

Diese Korrektur präzisiert D15 und AP08. Sie betrifft den laufenden Desktop-Workspace, nicht die bereits implementierte Session-Datenbankmigration oder den einmaligen Browser-v1-Import.

**Clientseitige Session-Erstellung:** Jede produktive „New Session“-Aktion innerhalb einer Room — einschließlich Agent Designer — verwendet denselben App-eigenen Create-/Selection-Flow. Dieser fügt die optimistische Zeile synchron ein, macht die betreffende Desktop-/Mobile-Sidebar sichtbar und fokussiert ihr leeres Inline-Rename-Feld, bevor der Create-POST abgeschlossen ist. Entwurf, Fokus sowie Bearbeiten-/Bestätigt-/Abgebrochen-Zustand gehören einer stabilen Operation und überleben den Austausch der temporären gegen die reale Session-ID ohne Hydration-Flackern oder erneutes Öffnen des Editors. Bestätigung zeigt den Titel sofort, reiht höchstens einen PATCH ein und sendet ihn ausschließlich an die reale `ps_`-ID; Abbruch unterdrückt ihn. Solange nur die temporäre ID existiert, sind Archivieren, Pinning, Löschen, Kontextmenü, Drag/Reorder und alle Backend-Mutationen gesperrt. Create- und Rename-Fehler haben eine ausdrückliche Recovery ohne stale PATCH und ohne Temp-ID-Request. Nur wenn die Operation Auswahl- und Room-Ownership weiterhin besitzt, ersetzt die reale Session die aktive Auswahl und aktualisiert die Route über den Client-Router; andernfalls gewinnt die neuere Nutzerauswahl. Späte Title-Persistenz darf nur den Cache der Ursprungs-Room hydrieren und niemals Navigation oder aktive Auswahl retargeten. `location.assign`, `location.href`, Formularnavigation und Service-Worker-/Document-Reload sind in diesem Pfad unzulässig.

**Generischer Tab-Lifecycle:** Ein echter Workspace-Tab besitzt eine stabile Mount-Identität. Tabwechsel versteckt die inaktiven Panels und setzt `active=false`, entfernt ihre React-Subtrees aber nicht. Dadurch bleiben lokaler Component-State, Editoren, Scrollposition und eingebettete Ressourcen erhalten. Ein pro Tab tastaturzugänglicher Refresh führt zuerst die für diese Plugin-Instanz registrierten Leave-/Autosave-Guards aus und wartet auf ausstehende Tabset-Saves. Nur nach erfolgreichem Abschluss remountet er dieses Panel; bei Guard-, Save- oder CAS-Fehler bleibt der bestehende Mount erhalten. Explizites Close entfernt das Panel, führt vorhandene Leave-/Autosave-Guards aus und gibt AbortController, Listener, Preview-/Browserinstanzen und sonstige View-Ressourcen frei. Das Mount-Budget bleibt durch das Tablimit und dadurch begrenzt, dass beim Sessionwechsel die Live-Panels der verlassenen Session entsorgt werden; nicht jede jemals besuchte Session bleibt gemountet. Diese Regeln werden aus View-/Instanzmetadaten abgeleitet und enthalten keine Settings- oder Plugin-ID-Ausnahme.

**Eine Session, eine Workspace-Wahrheit:** Desktop-Tabs, Reihenfolge, aktive Instanz und Workspace-Layout werden im vorhandenen `PluginSessionTabset` derselben `piboSessionId` gespeichert. Plugin-View-Zustand bleibt im zugehörigen `PluginTabInstance`. Der globale Browser-v1-Schlüssel ist ausschließlich Migrationsquelle und kein Laufzeit-Fallback. Solange das Zieltabset lädt, erscheinen keine Tabs der zuvor ausgewählten Session. Reads, Saves, Refreshes und View-Starts prüfen ihren festen Session-Owner; verspätete oder überholte Antworten dürfen weder Auswahl noch Zustand einer inzwischen aktiven anderen Session verändern. Dasselbe gilt für die Route-Reconciliation: Jede beobachtete Route ist an die damalige Session-Auswahlgeneration gebunden. Wechselt die Controller-Ownership schneller als die URL, darf die alte Route weder ein bereits bereites noch ein später fertig geladenes Zieltabset initialisieren; erst eine unter der aktuellen Auswahl beobachtete ausdrückliche Route darf wieder reconciliert werden. Der begrenzte Session-Controller-Cache überspringt beim Verwerfen jeden Controller mit lokalen Änderungen, CAS-Konflikt oder laufendem Read/Write. Der lokale Entwurf bleibt dadurch auch nach mehr als acht besuchten Sessions erreichbar; bereinigte Controller dürfen neu geladen werden. Dieser Schutz hält keine Browser-Hosts oder React-Panels der verlassenen Sessions am Leben. Eine Session ohne gespeichertes Tabset zeigt den leeren Workspace beziehungsweise die bewusste Plus-Auswahl, erzeugt aber keine Default-Tabs.

Der aktuelle implementierte Außenvertrag ist in der [Session- und Workspace-Lifecycle-Spezifikation](/specs/web/session-workspace-lifecycle.md) konsolidiert. PLG-UX-002 bleibt im Gesamtumbauplan als Herkunft, Umfang und Abnahmematrix erhalten.


## PLG-UX-001: Plugin-Philosophie, optionale Module und getrennte Zuständigkeiten

Diese owner-authorisierte Präzisierung beschreibt Zielverhalten, keine bereits abgenommene Implementierung. Sie hat Vorrang vor älteren Tab-/Settings-Zuordnungen in diesem Plan und dessen Arbeitspaketen.

Ein Plugin ist eine Erweiterungseinheit, kein Synonym für einen Tab. Es kann Dienste, Runtime-Integration, Tools, Skills, Kontext, Settings und fachliche UI in beliebiger unterstützter Kombination beitragen. Kein Plugin MUSS eine View oder ein Workspace-Modul besitzen. Ohne echte Fachoberfläche wird kein leerer oder automatisch erzeugter Settings-Tab angeboten. Loops und Previews sind Beispiele sinnvoller Module; reine File-Editing-Konfiguration ist ein Beispiel für Settings ohne Modul. Diese Beispiele begründen keine Sonderbehandlung einzelner Plugin-IDs.

Der öffentliche Manifest-/SDK-/Resolver-Vertrag MUSS drei voneinander unabhängige Fragen beantworten: Wo gilt ein Beitrag (System/App oder Agent)? Wo wird er präsentiert (Workspace-Modul, Konfiguration oder interne Infrastruktur)? Darf der Agent ihn auswählen (optional, erforderlich oder nicht agentbezogen)? Darstellung, API-Validierung und Lifecycle leiten sich aus denselben Metadaten ab. Namen, Titel, Plugin-ID-Listen oder das bloße Vorhandensein einer View dürfen diese Regeln nicht ersetzen. Ein generischer Beispielanbieter muss dieselben Regeln erfüllen wie mitgelieferte Plugins.

| Oberfläche | Verantwortung |
|---|---|
| Modulwahl / Plus-Tab | Ausschließlich deklarierte fachliche Workspace-Module; Desktop und Mobile verwenden dieselbe Verfügbarkeitsregel. Konfigurations- und Infrastruktur-Views erscheinen nicht. |
| Settings → Plugins | Systeminstallation, Aktivierung und Plugin-Konfiguration mit ausdrücklich sichtbarem App-/Agent-/Session-Ziel. Settings bleiben für installierte Plugins erreichbar, auch ohne Workspace-Modul oder aktivierte Agent-Beiträge; Ausführungs-/Berechtigungsgrenzen gelten weiterhin. |
| Agent Designer → Plugins | Nur Plugins mit agentbezogenen Beiträgen. Nur optionale agentbezogene Elemente sind umschaltbar; Pflichtbeiträge werden erklärt, aber nicht abwählbar gemacht. Systembeiträge und interne Settings-Views sind keine Agent-Checkboxen. |
| Agent Designer → Runtime | Auswahl einer systemweit verfügbaren Runtime plus deren Agent-Optionen. Installation/Aktivierung des Runtime-Plugins gehört nicht in die Agent-Pluginliste. |

System-only Plugins erscheinen nicht als aktivierbare Agent-Erweiterung. Bei gemischten Plugins zeigt der Designer ausschließlich die Agent-Seite: z. B. Goal-Tooling auswählbar pro Agent, Goal-Dienst und App-View systemweit verwaltet. Agent-Abwahl darf Systemdienste oder Einstellungen nicht abschalten. System-Abhängigkeiten können eine Agent-Auswahl verhindern; dann wird der Grund mit Verweis auf die zuständige Verwaltung erklärt, ohne das System heimlich einzuschalten. Interne Settings-Verfügbarkeit ist Infrastruktur und nicht selbst ein auswählbares Agent-Feature.

Jede Plugin-Karte im Agent Designer ist standardmäßig eingeklappt. Die Zusammenfassung zeigt Auswahl und relevanten Zustand; ausgeklappt werden Beiträge deterministisch nach Kategorien wie Tools, Skills, Kontext, Views oder Subagents gruppiert, soweit solche Beiträge tatsächlich agentbezogen und exponiert sind. Leere Kategorien fehlen. Runtime-Features und Adapter Profile Options sind separat ausklappbar und standardmäßig geschlossen. Pflicht-/Abhängigkeitsgründe bleiben verständlich und tastaturzugänglich.

## PLG-MIG-002: Bestehende Agent-Auswahl ohne Sackgasse migrieren

Ein vorhandener Agent ohne explizite Plugin-Auswahl MUSS einen ausführbaren, verständlichen Migrationsweg erhalten. Eine reine Warnung wie „Legacy selection needs an explicit migration“ ohne Aktion ist unzulässig. Die Migration leitet ihre Vorschau aus den bisherigen aktivierten Fähigkeiten ab, erhält deaktivierte Optionen, System-/Agent-Grenzen und Pflichtabhängigkeiten und speichert die neue Auswahl revisionsgesichert. Sie aktiviert keine pauschalen Plugin-Defaults und überschreibt keine bereits explizit gespeicherte Auswahl. Konflikte oder fehlende Ressourcen werden konkret erklärt; wiederholtes Laden/Migrieren ist idempotent. Nach erfolgreicher Migration können optionale Agent-Beiträge einzeln geändert und nach Reload wiedergefunden werden. Historische Session-Generationen bleiben unverändert.

## Feedbackrunde: Umsetzung und schlanke Prüfung

Diese Runde priorisiert schnelle Nutzerfeedback-Iteration. Bestehende Tests bleiben wertvoll und werden nur begründet angepasst; keine Fullsuite, Dauertests oder zusätzlichen schweren Gates vor dem nächsten Feedbackcandidate. Gezielte Vertrags-/Migrationschecks und der zum Anzeigen erforderliche Build genügen zusammen mit headful Desktop-/Mobile-Prüfung.

Zu zeigen sind: ein Plugin ohne View, ein Plugin nur mit Settings, ein echtes Workspace-Modul, ein System-only Plugin und ein gemischtes Plugin; alle über öffentliche generische Metadaten. Der bestehende Agent ohne Plugin-Auswahl muss migriert, ein optionales Tool geändert, gespeichert und neu geladen werden können. Settings sind dabei erreichbar und nicht als Capability abwählbar. Runtime- und Plugin-Karten starten geschlossen. Bereits installierte Pakete, bestehende Agenten, Sessionwechsel und alte Browserprofile gehören zur Stichprobe. Der Worker protokolliert verbleibende Lücken und konkrete Screenshots; der Orchestrator kontrolliert Fortschritt und Session-Fehler alle zehn Minuten.

Voll vertrauenswürdiger Code ist keine Garantie gegen Fehlverhalten. Die folgenden Validierungen sichern konsistente normale Ausführung und Kompatibilität; sie behaupten keine Sicherheitsgrenze gegenüber absichtlich eingreifendem Plugin-Code. Bestehende Web-Authentisierung und Session-gebundene Tool-Credentials werden durch diese Vertrauensentscheidung nicht abgeschafft.

## PLG-TEST-001: Bestehende Tests als Paritätsnachweis erhalten

Der Umbau MUSS das bisherige Produktverhalten über die vorhandenen Tests absichern. Bestehende Tests sind ein zu erhaltender Vertrag, auch wenn sich die interne Implementierung in Plugins verlagert. Neue Plugin-Tests ergänzen fehlende Vertrags-, Scope-, Lifecycle- und Migrationsfälle; sie ersetzen weder die Bestandsregressionen noch den abschließenden vollständigen Testlauf.[^test-preservation]

Bei einem fehlgeschlagenen Bestandstest MUSS zuerst geklärt werden, ob die Implementierung das bisherige Verhalten verletzt. Eine bestätigte Regression wird im Produktcode behoben. Ein grüner Plugin-Modultest rechtfertigt keine Änderung der bisherigen Erwartung. Insbesondere die zwölf im Handoff offenen Bestandsfehler werden einzeln untersucht und bis zur fachlichen Klärung offen geführt.

Notwendige Anpassungen sind auf zwei nachvollziehbare Fälle begrenzt: Ein Test benötigt den neuen Plugin-Installations-/Setup-Pfad, behält aber seine bisherigen Verhaltensassertions; oder eine ausdrücklich im Plan vereinbarte Produktänderung macht die frühere Erwartung ungültig, etwa die Entfernung eines alten Erweiterungswegs. Im zweiten Fall MUSS der Ersatztest die neue gewünschte Funktion und gegebenenfalls den erklärten Umgang mit dem entfernten Pfad belegen. Es genügt nicht, einen alten Test durch eine Assertion auf neue interne Strukturen zu ersetzen.

Tests dürfen nicht für einen grünen Lauf gelöscht, übersprungen, abgeschwächt oder über Runner-/Discovery-Änderungen ausgeschlossen werden. Eine fachlich notwendige Entfernung oder Änderung wird mit Dateipfad/Testname, bisheriger Erwartung, konkreter Planentscheidung beziehungsweise Setup-Grund und erhaltenem oder neuem Verhaltensnachweis im Abnahmebericht dokumentiert. Derselbe Nachweis gilt für bereits im früheren Umbaucheckpoint geänderte Tests; der Audit vergleicht auch gegen die ursprüngliche Baseline.

AP00 sichert den vorhandenen Testumfang und bekannte Ausgangsfehler. AP11 nutzt die bestehenden Featuretests über den tatsächlichen Plugin-Pfad. AP12–AP18 führen bei jeder Extraktion die betroffenen Bestandsregressionen aus. AP19 prüft den gesamten bestehenden und ergänzten Testumfang am integrierten Kandidaten sowie den Testdiff gegen die Baseline. Testanzahlen und grüne Einzelmodule allein schließen diesen Nachweis nicht.

# Zielverträge und Architektur

## PLG-CORE-001: Ein Plugin, stabile Identität und explizite Beiträge

Ein installierbares Plugin besitzt eine stabile ID, Version, SDK-Kompatibilität, Herkunft und einen Inhalts-Hash. Ein mitgeliefertes Plugin verwendet dasselbe Manifest und dieselben Loader-Verträge wie ein externes Plugin. Der Standardumfang wird durch eine deklarative Zusammenstellung bestimmt.

Vorgesehener Paketvertrag: `pibo.plugin.json` im Paketroot, mit getrennten Backend-/Browser-Einstiegen. Dieser Dateiname und die unten vorgeschlagenen Typnamen werden in AP01 als versionierter SDK-Vertrag konkretisiert; danach gelten Änderungen als Vertragsänderungen. Ein Plugin kann mehrere Dienste und Beitragsarten besitzen. Neue Beitragsarten können durch einen Dienst eines Plugins eingeführt werden, ohne einen konkurrierenden Loader zu eröffnen.

Die Beschreibung trennt:

- Paketabhängigkeiten und SDK-Versionen;
- Dienste, die für eine Aktivierung erforderlich oder optional sind;
- App-weite Beiträge und für Agents auswählbare Beiträge;
- Pflichtbeiträge, optionale Beiträge, Default-Auswahl und Beitragsabhängigkeiten;
- Runtime-Voraussetzungen und Implementierungen;
- Konfigurations- und Datenschema-Versionen;
- Browser-Assets sowie historische Daten-Fallbacks.

Settings-/Kontexteditoren gehören zur View-Beschreibung ihres Plugins; sie deklarieren den Konfigurationsscope und ein Ziel innerhalb des Plugin-Tabs. Beiträge deklarieren außerdem ihre Wirkung auf den Kontextaufbau oder ausdrücklich `keine Kontextwirkung`. AP01 definiert ein gemeinsames Inspector-/Provenienzschema, damit spätere Plugin-Typen in Build Context ohne neue fest verdrahtete Featureliste erscheinen.

Ein Beitrag besitzt eine qualifizierte ID aus Plugin-ID und lokaler Beitrags-ID. Tool-Namen bleiben, soweit möglich, die bisherigen Namen für Agent-Aufrufe. Die qualifizierte Identität löst Ownership und Konflikte; sie ersetzt nicht zwingend jeden sichtbaren Tool-Namen.

## PLG-CORE-002: Dienste, Registry und kontrollierter Lifecycle

Der kleine Kernel lädt Konfiguration, Paketbeschreibungen und die aktive Zusammenstellung. Er besitzt den Lifecycle, eine überprüfbare Registry und einen minimalen Start-/Diagnosepfad. Fachliche Dienste, Runtime-Adapter und UI werden über Plugins aktiviert.

Vorgeschlagene Verträge:

| Vertrag | Verantwortung |
|---|---|
| `PluginManifest` | Versionierte, serialisierbare Beschreibung ohne Import ausführbaren Codes |
| `PluginCatalog` | Abgeleitete Sicht auf installierte Plugins und deren deklarierte Beiträge |
| `PluginHost` | Aktivierungsplan prüfen, Dienste auflösen, Instanzen starten und geordnet stoppen |
| `PluginScope` | Plugin-Ownership, Disposer, Listener, Timer und Ressourcen einer Instanz sammeln |
| `PluginContributionResolver` | Auswahl, Pflichtbeiträge und Runtime-Voraussetzungen für einen Agent/Session-Start auflösen |
| `PluginOperationPlan` | Installations-, Update- oder Deinstallationsabsicht mit Revision und Auswirkungsprüfung |
| `PluginSourceResolver` | Lokale Verzeichnisse und versionierte Paketquellen in denselben Paketvertrag übersetzen |

Diese Module sind keine separaten Erweiterungssysteme. Ein Plugin-Host entscheidet über Aktivierung; Quellenadapter beschaffen nur Artefakte. Es gibt keine zweite manuell gepflegte Capability-Package-Liste.

Abhängigkeiten werden vor dem Start auf fehlende Provider, Versionskonflikte und Zyklen geprüft. Deterministische Aktivierungsreihenfolge ersetzt in Version 1 reaktive Service-Reaktivierung. Cleanup läuft einmalig in umgekehrter Reihenfolge und versucht auch nach einem einzelnen Fehler, weitere Ressourcen freizugeben. Teilweise gescheitertes Setup gibt alle bereits angelegten Registrierungen frei. Ein nicht sauber gestoppter Dienst bleibt als Fehler sichtbar und wird nicht als erfolgreich aktualisiert ausgewiesen.

Routen, Tools, Listener, UI-Beiträge und Services werden mit Eigentümer registriert. Die vorhandene `PiboPluginRegistry` darf während des Übergangs als Fassade dienen; sie darf keine eigene konkurrierende Wahrheit über aktivierte Beiträge behalten.

## PLG-CORE-003: Austauschbarkeit ohne zufälliges Überschreiben

Additive Beiträge und ersetzbare Provider sind unterschiedliche Verträge. Eine einzelne Shell, ein Renderer oder ein Dienst kann explizit durch einen anderen Provider ersetzt werden. Welcher Provider aktiv ist, wird in der Zusammenstellung festgehalten; Ladereihenfolge und „last write wins“ bestimmen das nicht.

Mitgelieferte Provider erhalten keine pauschale technische Unersetzbarkeit. Ein alternatives Plugin darf die gesamte Web-Shell, Navigation, Terminal View oder einen Pibo-Dienst ersetzen, wenn es dessen Vertrag erfüllt. Die Minimalfunktionen des Loaders und des Wiederherstellungs-/Diagnosepfads bleiben außerhalb der fachlichen Austauschfläche.

Direkter Zugriff auf interne React-Strukturen wird nicht als stabiler SDK-Vertrag angeboten. Voll vertrauenswürdiger Code kann technisch darüber hinausgehen; dafür wird keine Kompatibilitätsgarantie gegeben. Eine Registrierung kollidierender Tool-Namen wird ohne explizite Ersetzungsbeziehung abgewiesen.

## PLG-ACT-001: Systemweite Aktivierung und Agent-Auswahl

**Präzisierung vom 2026-09-12:** Ein Plugin MUSS systemweite und agentbezogene Funktionen unabhängig voneinander beschreiben können. „Systemweit“ bedeutet den Pibo App Context, unabhängig von ausgewähltem Agent, Room oder einer laufenden Session. Ein Paket besitzt weiterhin eine Plugin-ID, Revision und einen Installations-/Update-Lifecycle.[^activation-scopes]

| Form | Systemweite Seite | Agent-Seite |
|---|---|---|
| Nur agentbezogen | Keine fachliche systemweite Aktivierung erforderlich | Tools, Skills, Kontext oder Hooks pro Agent auswählbar |
| Nur systemweit | Dienste, Jobs, Routen oder App-Views funktionieren ohne Agent-Auswahl und ohne laufende Session | Kein wirkungsloser Aktivierungsschalter im Designer |
| Gemischt, etwa Goal | Goal-Zustand, Loop-Steuerung und App-Funktionen bleiben systemweit verfügbar | Goal-Tools und zugehöriger Agent-Kontext separat pro Agent auswählbar |

Installation, systemweite Aktivierung und Agent-Auswahl MÜSSEN getrennt gespeichert und angezeigt werden. Installiert bedeutet weder systemweit aktiv noch für jeden Agent ausgewählt. Die deklarative Standardkomposition aktiviert die systemweite Seite des mitgelieferten Goal-Plugins beim App-Start; sie bleibt auch aktiv, wenn kein Agent Goal-Tooling ausgewählt hat. Ein reines Agent-Plugin braucht keinen künstlichen fachlichen Systembeitrag. Ein reines System-Plugin darf im Designer zur Information erscheinen, aber nicht als auswählbares Agent-Toolpaket.

Jeder Beitrag MUSS seinen Aktivierungsbereich deklarieren. Pflicht-/Optional-Regeln, Defaults und Abhängigkeiten gelten innerhalb dieses Bereichs. Ein gemischtes Plugin kann insbesondere einen verpflichtenden Systemdienst und optional auswählbares Agent-Tooling besitzen. Eine fehlende Runtime-Fähigkeit eines Agent-Beitrags blockiert nur dessen Agent-/Runtime-Aktivierung; sie schaltet keinen davon unabhängigen Systembeitrag ab.

Agent-Beiträge dürfen explizit von Systemdiensten desselben oder eines anderen Plugins abhängen. Fehlt deren aktive kompatible Revision, MUSS die Auflösung die betroffene Agent-Auswahl mit Dependency-Pfad ablehnen. Ein Designer-Save aktiviert keine systemweite Funktion heimlich. Systemweite Aktivierung verleiht umgekehrt keinem Agent Tools, Skills, Kontext oder Hooks. Systemdienste dürfen nicht von der zufälligen Auswahl eines Agents abhängen. Systemweite Infrastruktur erzeugt insbesondere keine zweite native Tool-Lieferung außerhalb des Generationsplans.

Systemdienste werden für die aktive App-Komposition gestartet und besitzen ihren eigenen Lifecycle. Sessionstart, Sessionende und Agent-Wechsel erzeugen oder entsorgen sie nicht erneut. Agent-/Generationsressourcen behalten ihre bestehende getrennte Ownership. Agent-Deaktivierung wirkt an der vorgesehenen Generationsgrenze und darf weder gemeinsame Systemdienste stoppen noch laufende Goals oder Runs implizit abbrechen. Eine ausdrücklich systemweite Deaktivierung, ein Update oder eine Deinstallation prüft alle betroffenen System- und Agent-Verbraucher nach PLG-LIFE-001 bis -003 und AP15; fehlende sichere Drain-Grenzen bleiben ein erklärter Konflikt.

**UI und Konfiguration:** Systemstatus und Agent-Auswahl werden getrennt bezeichnet. Plugin-Settings deklarieren weiterhin ihren eigenen Daten-/Konfigurationsscope. Die Session-Ownership eines Desktop-Tabs bestimmt nicht die Lebensdauer des darin bedienten Systemdienstes. Eine systemweite View darf in Sessions von Agents ohne Plugin-Tooling verfügbar sein; Backend-Aktionen prüfen den Bereich der jeweiligen Funktion. Das erlaubt reguläre App-Bedienung, liefert dem Agent aber keine zusätzlichen Tools. Desktop-Tabs bleiben gemäß PLG-UI-001 sessiongebunden; der Systemdienst arbeitet auch ohne geöffneten Tab oder existierende Session.

**Goal-Beispiel:** Agent A aktiviert Goal-Tooling, Agent B nicht. Beide können die systemweite Goal-Funktion in der App nutzen. Nur As neue Runtime-Generation erhält die ausgewählten Goal-Tools und den zugehörigen Kontext. Deaktiviert A sein Tooling oder endet seine Session, bleibt die systemweite Goal-Funktion aktiv; bestehende Arbeit folgt ihrem eigenen Lifecycle. Ein Neustart rekonstruiert Systemaktivierung und beide Agent-Auswahlen getrennt.

## PLG-SEL-001: Agent-Auswahl und Pflichtbeiträge

Der Designer speichert die gewünschte Plugin-Auswahl sowie optionale Beitragsauswahl und Konfiguration. Pflichtbeiträge werden serverseitig berechnet und validiert. Ein manipuliertes API-Payload kann sie nicht als reguläre Konfiguration deaktivieren.

Die Auflösung erfolgt in dieser Reihenfolge:

1. Installierte Revisionen und den getrennten systemweiten Aktivierungsplan prüfen; reine Agent-Beiträge benötigen keine künstliche Systemaktivierung.
2. Agent-Auswahl und Plugin-Konfiguration validieren.
3. Pflichtbeiträge der Agent-Seite und explizite Abhängigkeiten zu aktiven Systemdiensten bestimmen; Systembeiträge nicht als Agent-Tools übernehmen.
4. Zulässigkeit optionaler Deaktivierungen prüfen.
5. Runtime-Voraussetzungen gegen den gewählten Adapter und die Instanz prüfen.
6. Konflikte mit User-Ressourcen, Tool-Namen und anderen Plugins ausweisen.
7. Einen unveränderlichen effektiven Plan für die Runtime-Generation erzeugen.

Fehlt eine optionale externe Voraussetzung, wird nur der Beitrag ausgelassen. Fehlt eine erforderliche, wird die betreffende Agent-/Runtime-Aktivierung abgelehnt. Eine rein appweite Plugin-Oberfläche kann unabhängig davon funktionieren. Plugin-Infrastruktur, die manuelle Subagents benötigt, wird als solche sichtbar; daraus folgt keine automatische Aktivierung aller Agent-Tools des Infrastruktur-Plugins.

Neue optionale Beiträge werden bei Updates bestehender Agent-Konfigurationen nicht automatisch eingeschaltet. Neue Agents können die Manifest-Defaults verwenden. Neue Pflichtbeiträge oder geänderte Semantik benötigen eine ausdrückliche Konfigurationsmigration mit sichtbarer Auswirkung.

## PLG-SEL-002: Eigenständige User-Ressourcen bleiben eigenständig

Zusätzlich zur Plugin-Auswahl bleiben User-Skill-Referenzen, Kontextdatei-Referenzen und manuelle Subagent-Definitionen separate Daten im Agent-Modell. Sie dürfen nicht zum Schein in installierbare Plugins umgewandelt werden.

Ressourcen tragen ihre Herkunft (`plugin`, `user`, `manual`, gegebenenfalls `harness`). Namensgleichheit führt nicht zum stillen Ersetzen. Exakte Doppelreferenzen können deterministisch dedupliziert werden; verschiedene Inhalte mit gleichem sichtbaren Namen brauchen eine klare Auswahl oder einen Konflikt. Die vorhandene Kontextreihenfolge und Subagent-Overrides werden erhalten beziehungsweise explizit migriert.

Plugin-Dateien sind innerhalb des Paketstands unveränderlich. Wer sie anpassen möchte, kann eine unabhängige User-Kopie anlegen. Deinstallation löscht keine User-Dateien.

## PLG-RT-001: Runtime-Unterstützung und Generationen

Pi, Codex Native und OMP bleiben getrennte Runtime-Adapter. Der Plugin-Resolver nutzt deren bestehenden Capability-Vertrag und Delivery Reports. Ein Plugin darf gemeinsame portable Beiträge sowie adaptergebundene Implementierungen enthalten. Erforderliche Pi-only-Agent-Beiträge werden unter Codex/OMP abgewiesen, bevor ihr Pi-Code importiert oder ausgeführt wird; unabhängige Systembeiträge bleiben aktiv.

Pibo-eigene Tools werden weiterhin direkt, über die Session-MCP-Bridge oder die OMP-Host-Bridge geliefert. Externe MCP-Server unter OMP bleiben ausdrücklich nicht unterstützt, solange der Adapter dies nicht implementiert. Die Migration darf diese Lücke nicht verschweigen oder zu einem stillen CLI-Fallback machen.

Jede Runtime-Generation erhält einen Snapshot von Plugin-Revisionen, ausgewählten Beiträgen, effektiver Konfiguration, Runtime-Bindung und Delivery-Status. Änderungen am Profil verändern nicht rückwirkend aktive Generationen. Subagents lösen den Plan ihres Zielprofils unabhängig vom Parent auf.

## PLG-UI-001: Pluginbasierte Shell und Desktop-Tabs

Backend und Browser haben getrennte Hosts mit demselben Plugin-Modell und denselben Identitäten. Ein versionierter authentisierter Katalog verbindet beide. Version 1 verwendet vorgebaute Browser-Module für voll vertrauenswürdige Plugins; Node-/Harness-Code bleibt aus Browser-Bundles ausgeschlossen.

Ein Tab-Vertrag beschreibt qualifizierte Plugin-/View-ID, Titel, Icon, Einstieg, Sichtbarkeit, Zustandsschema und Mount-Verhalten. **Jede Tabinstanz besitzt eine feste `piboSessionId`**, die beim Öffnen aus der ausgewählten Session übernommen wird. Sie folgt später keinem globalen Auswahlzustand. Ohne ausgewählte Session wird kein ungebundener Desktop-Tab erzeugt; der Host bietet zunächst Sessionauswahl/-anlage. Der minimale Bootstrap-/Recovery-Pfad bleibt erreichbar.

Pro Pibo Session wird ein versioniertes Tabset gespeichert: Instanz-IDs, Plugin-/View-Referenzen, Reihenfolge, aktiver Tab, serialisierbarer View-/Unterbereichszustand und sitzungsbezogener Layoutzustand. AP03/AP08 verwenden persistierte Produktdaten als maßgebliche Quelle; Browser-Speicher dient als Cache beziehungsweise als Quelle der v1-Migration. Ein anderer Agent, eine andere Room-ID oder die Runtime-Generation ersetzt den Schlüssel `piboSessionId` nicht. Globale Darstellungspräferenzen wie das Farbschema bleiben separat. Forks und Subagents erhalten eigenständige Tabsets; es gibt keine geteilten mutierbaren Tabinstanzen.

Beim Wechsel von A zu B wird A gesichert und ausschließlich Bs Tabset angezeigt. Beim Rückwechsel stehen As Tabs mit ausgewähltem Unterbereich, aktivem Tab und wiederherstellbarem View-Zustand bereit. Das gilt gleichermaßen für Plugin-Tabs, Context, Settings und übrige mitgelieferte Desktop-Views. Ein Tab mit appweiten Daten gehört trotzdem der Session, für die er geöffnet wurde. Ein Deep Link trägt die Session-ID und wählt zuerst diese Session; Back/Forward und Reload dürfen ihn nicht in die gerade zufällig ausgewählte Session umhängen.

Das Öffnen-Menü und ausführbare Tabaktionen werden nach dem deklarierten Aktivierungsbereich aufgelöst: System-Views aus der aktiven App-Komposition, Agent-Views aus dem effektiven Plugin-/Beitragsplan **dieser Session** samt Runtime-Lieferstatus. Installiert allein bedeutet nicht für den Session-Agent aktiviert. Änderungen an einem Agent-Default überschreiben weder aktive Generationen noch die Tabs anderer Sessions. Als systemweit deklarierte Views jedes Plugins können allen Sessions zur Verfügung stehen, ohne deren Agent-Tools zu aktivieren; dies gilt auch für Context, Settings, Verwaltung und Goals. Eine generische Plugin-Verwaltung darf Installationen erklären; sie ersetzt keine fehlende Session-Aktivierung durch heimliches Einschalten von Features.

Die Shell besitzt Fokus, Tastaturbedienung, Routing, Deduplizierung, Wiederherstellung und Ressourcenlimits. Deduplizierung umfasst die Session, qualifizierte View und deren deklarierte Instanzidentität; zwei Sessions dürfen unabhängig denselben Plugin-Tab öffnen. Fehlende/deaktivierte oder nicht mehr kompatible Beiträge behalten ihren gespeicherten Zustand als erklärten Platzhalter. Kontrolliertes Keep-alive behält stets die feste Sessionbindung und gewährt keine Ausführung, die der Session-Plan nicht mehr erlaubt.

Die Browser-Bridge liefert dem Tab seine feste Session-/Room-Identität, Runtime-/Aktivierungsrevision und namensraumgebundene Query-/Command-/Event-Zugänge. Backend-Routen und Event-Abonnements tragen Plugin-Ownership und bestehende Zugriffsprüfungen; Service-Objekte und Credentials werden nicht in den Browser-Katalog serialisiert. Beim Ausblenden/Unmount werden nicht mehr benötigte Abonnements und überholte Requests freigegeben. Späte Antworten, Debounces oder Autosaves behalten ihren ursprünglichen Session-/Tab-/Konfigurationsbezug und dürfen niemals in B schreiben, nur weil A verlassen wurde. Persistenzschreibvorgänge haben Revisionsprüfung; parallele Browser dürfen kein fremdes Session-Tabset überschreiben.

**GitHub-Beispiel für AP08/AP11:** Session A öffnet den GitHub-Tab ihres aktivierten Plugins. Ein Backend-Beitrag registriert Tools und speichert erfolgreiche PR-/Issue-/Kommentaraktionen mit Pibo-Session-ID, stabiler GitHub-Objekt-ID, URL und Ereignis-ID. Der Tab liest ausschließlich As Session-Projektion und abonniert Änderungen; eine Terminal-Karte verwendet dieselbe Objektidentität. Beim Wechsel zu B ohne GitHub-Aktivierung verschwindet As Tab aus der Ansicht und kann in B nicht als aktive Funktion geöffnet werden. Der Rückwechsel stellt As Tab wieder her. Wiederholte Zustellung wird über Ereignis-ID dedupliziert. Die Session-Zuordnung stammt aus dem Aufrufkontext, nicht aus frei vom Modell behaupteter Identität. Externe Aktionen über beliebige Shellbefehle oder außerhalb Pibos werden dadurch nicht automatisch erkannt; eine solche Synchronisierung benötigt einen eigenen expliziten Import-/Erkennungsvertrag.

## PLG-UI-002: Terminal-Beiträge und historische Darstellung

Es gibt zwei Erweiterungsstellen: komplette Session-Views und Beiträge innerhalb der Terminal View. Für Version 1 werden Tool-/Artefakt-Renderer, zugehörige Aktionen und ein definierter Composer-/Eingabe-Vertrag umgesetzt. Mitgelieferte Renderer verwenden dieselbe Registrierung.

Die Terminal-Projektion behält Ordering, Paging, Virtualisierung, stabile Row-IDs und Scroll-Anker. Plugin-Renderer erhalten begrenzte View Models und Aktionen statt mutierbarer Transcript-Arrays. Ein serialisierbarer Envelope enthält Plugin-ID, Beitragstyp, Daten-Schemaversion, Objekt-/Event-ID, Payload oder Payload-Verweis und textuellen Fallback.

Fehlende oder inkompatible Renderer dürfen Historie nicht unlesbar machen. Replay führt keine externe Schreibaktion aus. Fehler bleiben auf den betroffenen Beitrag begrenzt. GitHub-Tab und kompakte GitHub-Karte teilen fachliche Objektidentität, Zustand und geeignete Aktionen; visuelle Gleichheit ist nicht gefordert.

## PLG-UI-003: Plugin-eigene Settings und Kontextoptionen

Ein Plugin liefert seine Settings und konfigurierbaren Kontextbeiträge als generisch deklarierte Konfiguration unter Settings → Plugins. Dafür ist kein Workspace-Tab erforderlich. Fachliche Module können auf denselben Konfigurationseditor verlinken. Der Agent Designer verwaltet nur auswählbare Agent-Beiträge und verlinkt bei Bedarf den zuständigen Editor mit explizitem Ziel. Es entstehen keine unabhängig schreibenden Kopien derselben Einstellung.

Tab-Ownership und Konfigurationsscope sind verschiedene Dinge: Ein sessiongebundener Tab kann globale Plugin-Konfiguration, ein Agent-Profil oder eine ausdrücklich unterstützte Session-Option bearbeiten. Das Ziel und die Auswirkung werden sichtbar ausgewiesen. Defaultänderungen gelten für künftige Auflösungen; Laufzeit-/Kontextänderungen beachten die sichere Generationsgrenze. Plugin-spezifische Sofortänderungen sind nur mit einem expliziten, diagnostizierbaren Vertrag zulässig. Ein Sessionwechsel ändert nie das Ziel eines noch ausstehenden Saves.

Die vorhandenen Flächen werden vollständig zugeordnet:

| Bisherige Fläche | Ziel im Umbau |
|---|---|
| Context → MCP Tools; MCP-Beschreibungen und Kontextoptionen | Konfigurationsbereich unter Settings → Plugins für `pibo.mcp-cli` beziehungsweise den zuständigen MCP-Adapter; Serververwaltung, Beschreibungen, Filter und gelieferter Kontext teilen dieselbe Konfiguration. |
| Pibo Native Tooling sowie Kontextoptionen von Pibo-Toolfamilien | Konfigurationsbereich des fachlich zuständigen Plugins unter Settings → Plugins; Herkunft, Auswahl und Pflichtstatus jedes Kontextbeitrags werden mitmigriert. |
| Context → Pibo Tools (`piboTools`, installierte CLI-Tool-Snippets) | Zugehörige Tool-/CLI-Integrationsplugins; kein verbleibender zentraler Spezialkatalog. Diese CLI-Kontexte sind von Harness Built-ins und Pibo Native Tools zu unterscheiden und separat zu inventarisieren. |
| Settings → Pi Packages und Designer-Pi-Packages | Vollständig entfernen; erhalten bleibt ausschließlich der erklärte Migrationsbefund ohne ausführbare Paketverwaltung. |
| Settings für Preview, Medien, Provider und weitere extrahierte Funktionen | Mitgelieferte Settings-Views des jeweiligen Feature-Plugins; allgemeine Navigation kann dorthin verlinken, kennt aber keine fest verdrahtete Feature-Union. |
| User-Skills, User-Kontextdateien, Base-/Compaction-Prompt-Editoren, soweit unterstützt | Als mitgelieferte registrierte Views erhalten und nach Ressourceneigentümer/Runtime zuordnen. Die Nutzung eigener Dateien setzt weiterhin kein ressourcenlieferndes Drittanbieterplugin voraus. |
| Build Context | Mitgelieferter pluginregistrierter Gesamtinspector nach PLG-CTX-001; erklärt Zusammensetzung und verlinkt die zuständigen Editoren, besitzt aber keine zweite Plugin-Konfiguration. |

Sowohl Desktop-Rendering als auch die vorhandenen schmalen/Route-basierten Ansichten verwenden diese Beitragsnavigation. Eine entfernte Sonderfläche darf nicht im zweiten Renderzweig weiterleben. Bestehende Deep Links werden auf denselben sessiongebundenen Ziel-Tab mit Unteransicht migriert oder zeigen einen erklärten Migrationszustand.

## PLG-CTX-001: Build Context erklärt die gesamte Zusammensetzung

Build Context verwendet den gemeinsamen Resolver, gespeicherte Generationspläne und tatsächliche Delivery-/Ausführungsbefunde. Es baut keine getrennte Wahrheit aus aktuellen globalen Katalogen auf. Jeder vom Host registrierte Beitrag hat eine Inspector-Repräsentation; auch reine UI-/Service-Beiträge werden mit „keine Kontextwirkung“ ausgewiesen. Installiert, global aktiv, im Agent ausgewählt, für diese Generation wirksam und tatsächlich geliefert sind getrennte Zustände. Deaktivierte/ausgeschlossene Funktionen bleiben mit Grund einsehbar.

Der Inspector bildet die gesamte von Pibo kontrollierte Kette in nachvollziehbarer Reihenfolge ab:

1. Session, Room/Workspace, Profilrevision, Runtime-Instanz und Generation sowie die verwendeten Plugin-Versionen und Konfigurationsscopes.
2. Plugin-/Beitragsauswahl, Pflichtteile, Abhängigkeiten, Runtime-Voraussetzungen, Default-/Override-Auflösung und Konflikte.
3. Harness-/Base-Prompt soweit einsehbar, normale Context Discovery, Session-/Runtime-Kontext, User- und Plugin-Kontextdateien, Skills, Subagent-Definitionen, MCP-Kontext, Pibo Native/CLI-Tool-Kontext und Toolschemata.
4. Reihenfolge, Hydrierung, Zusammenführung, Deduplizierung, Kürzungen und Hook-/Input-Transformationen, soweit für den gewählten Build-/Turn-Snapshot tatsächlich erfasst; Kompaktionsanweisungen und bekannte Zusammenfassungs-/Historienanteile werden nach ihrem Einsatzzeitpunkt getrennt.
5. Adapterlieferung: Modus, Ziel, Zeitpunkt/Generation, Fidelity, Erfolg/Degradierung/Fehler und die tatsächlich gelieferte Repräsentation beziehungsweise ihr Payload-Verweis.

Pro Knoten werden stabile Beitrags-ID, Plugin-ID/Revision oder unabhängige User-/Harness-Herkunft, abhängige Vorgänger, wirksame Konfigurationsrevision, Auswahlgrund, Reihenfolge und Inhalt beziehungsweise begründet fehlender Inhalt gezeigt. Deaktiviert, unsupported, required-conflict, noch nicht geladen, fehlgeschlagen und ohne Kontextwirkung sind unterscheidbar. Ein aktiviertes Skill mit verzögert geladenem Body ist kein vollständig injizierter Skill-Text. Ein Tool-Schema und Inspector-Metadaten sind keine System-Prompt-Absätze.

**Tatsächlicher Stand versus Vorschau:** Ein gespeicherter Build-/Generationsstand bleibt nach Profiländerung oder Deinstallation erhalten und heißt nicht „aktuell neu gebaut“. Eine Vorschau auf geänderte Auswahl wird separat mit Konfigurationsrevision und Abweichungen angezeigt. Das reine Öffnen/Refresh der Ansicht führt keine Tools, Schreib-Hooks, fremden Installationsvorgänge oder Session-Neustarts aus. Falls eine exakte dynamische Stufe ohne Ausführung nicht bestimmbar ist, zeigt die Vorschau diese Grenze; der später beobachtete Stand ergänzt den Nachweis. Pibo-kontrollierte kontextverändernde Hooks müssen dafür strukturierte Herkunfts-/Transformationsbefunde liefern.

„Gesamter Kontextaufbau“ bedeutet vollständige Erklärung der Pibo-kontrollierten Zusammensetzung einschließlich expliziter Beobachtungsgrenzen. Nicht zugängliche native Harness-Prompts, interne Kompaktion oder fremde Tool-Hooks werden als nicht einsehbar gekennzeichnet, nicht aus Defaults rekonstruiert und als exakter Modellinput ausgegeben. Roh-Secrets werden nicht persistiert/exportiert; Redaktion wird markiert. Tokenwerte unterscheiden Messung und Schätzung. Copy/Export trennt belegten Modellinhalt von Inspector-Metadaten und Diagnose; eine unvollständige Projektion wird nicht als vollständiger Wire-Prompt bezeichnet.

Build Context ist selbst ein mitgelieferter UI-Beitrag mit generischem Knoten-/Provenienzvertrag. Ein späteres Plugin kann Detailrenderer hinzufügen; das Entfernen dieses Renderers lässt Herkunft, Status und textuellen Fallback lesbar. Verweise zu Einstellungen öffnen Settings → Plugins für das betreffende Plugin mit demselben ausdrücklich gebundenen Konfigurationsziel. Snapshot-Identität und asynchrone Datenwechsel folgen denselben Isolationsregeln wie alle Desktop-Tabs.

## PLG-HOOK-001: Explizite Hook-Semantik

Der gemeinsame Tool-Ausführungsdienst bietet Pre-Tool-Prüfung/Transformation und Post-Tool-Verarbeitung/Beobachtung. Routing bietet einen benannten Input-Hook; der Web-Composer bietet Paste/Drop/Send-Beiträge. Die Verträge definieren Reihenfolge, Rückgabeschema, erneute Validierung, Timeout und Cancellation.

Ein verbindlicher Pre-Hook schlägt bei Fehler geschlossen fehl; ein optionaler Beobachter darf einen bereits erfolgten externen Schreibvorgang nicht nachträglich als nie ausgeführt darstellen. Tools, die Pibo nicht kontrolliert, erhalten keine fiktive Interception. Harness-native Hooks benötigen ausdrücklich implementierte Adapterunterstützung. „Plugins können Pibo vollständig verändern“ erweitert nicht automatisch die API eines externen Harness-Prozesses.

# Installation, Updates und Deinstallation

## PLG-LIFE-001: Installations- und Updatezustände

Vorgesehene Zustände sind `staged`, `installed`, `active`, `pending-activation`, `retiring`, `failed` und `uninstalled`. Katalogsichtbarkeit, ausführbare Aktivierung und Auswahl im Agent sind getrennt. Version 1 hat pro Plugin-ID höchstens eine aktive Revision pro Host; es gibt keinen stillen Mehrversionsbetrieb.

Installation prüft Manifest, SDK-Kompatibilität, Artefakt-Hash, Abhängigkeiten und Einstiegspfade vor der Aktivierung. Eine gescheiterte Installation hinterlässt keinen aktiven Teilzustand. Deinstallierte Revisionen bleiben als Metadaten-Tombstone referenzierbar. Lokale Entwicklungsverzeichnisse werden beim Aktivieren auf einen konkreten Stand bezogen; Änderungen an Dateien führen nicht unbemerkt zu anderer Ausführung unter demselben Snapshot.

Updates werden zunächst vorbereitet und als wartend angezeigt. Bei appweiten Backend-Diensten erfolgt der Wechsel an einem kontrollierten Gateway-Neustart oder nach nachgewiesenem vollständigem Drain; ein Agent darf kein beliebiges Hot-Reload voraussetzen. Profiländerungen können für neue Generationen gelten, ohne historische Snapshots umzuschreiben. Ein späterer Marketplace implementiert nur eine weitere `PluginSourceResolver`-Quelle; Identität und Lifecycle bleiben gleich.

## PLG-LIFE-002: Auswirkungsanalyse und Bestätigung

Vor Deaktivierung/Deinstallation wird ein versionierter Auswirkungsplan erstellt. Er zählt **eindeutige Pibo Sessions**, nicht Referenzen, und unterscheidet aktive Nutzung, künftig erforderliche Beiträge, optionale Beiträge, reine historische Darstellung sowie ungeklärte Legacy-Abhängigkeiten. Abhängige Plugins, Profile, laufende Runs und Runtime-Instanzen werden ebenfalls angezeigt.

Die Anzeige sagt ausdrücklich, dass Sessions erhalten bleiben. Für eine Deinstallation bestätigt der Benutzer die angezeigte Plugin-ID durch Texteingabe. Der API-Aufruf benötigt einen serverseitigen Planbezug mit Ablaufzeit und Zustandsrevision. Ändert sich die betroffene Menge, muss die Auswirkung erneut geprüft und bei materialer Änderung neu bestätigt werden. Eine reine Browser-Bestätigung ist nicht ausreichend.

Mit Beginn des Retirement werden neue abhängige Aktivierungen gesperrt. Laufende Arbeit wird standardmäßig abgewartet. Abbruch ist eine separate bewusste Aktion über bestehende Run-/Session-Kontrollen und wird nicht aus der Deinstallationsbestätigung abgeleitet. Ein Timeout zeigt den blockierenden Zustand, statt Ressourcen gewaltsam zu entfernen. Abbrechen des Deinstallationsvorgangs stellt die vorherige Aufnahmebereitschaft nachvollziehbar wieder her.

## PLG-LIFE-003: Sessions, Daten und Wiederinstallation

Deinstallation entfernt die ausführbare Installation und neue Registrierungen, aber keine Sessions, Messages, Runtime-Bindings, Run-Ergebnisse, Plugin-Fachdaten oder User-Ressourcen. Datenbankschemata dürfen hierfür kein kaskadierendes Löschen aus dem Installationsdatensatz auslösen. Datenbereinigung bleibt ein separater bestehender beziehungsweise späterer Vorgang und ist kein Arbeitspaket dieses Plans.

Eine Session, deren erforderliche Plugin-Abhängigkeit fehlt, bleibt lesbar, kann aber nicht fortgesetzt werden. Fehlen nur optionale Funktionen, zeigt sie deren Status. Es erfolgt kein automatischer Runtime-Wechsel und keine automatische Ersatztool-Auswahl. Wiederinstallation einer passenden Revision stellt die Voraussetzung wieder her. Eine andere Version darf nur nach erklärter Kompatibilität oder expliziter Migration fortsetzen. Historische Snapshots bleiben unverändert; ein bewusstes Reconfigure erzeugt einen neuen Generations-/Konfigurationsstand.

Legacy-Sessions ohne vollständigen Snapshot werden als `unknown` bewertet, nicht als unbeeinflusst. Vor ihrer Fortsetzung erfolgt eine konservative Auflösung mit sichtbarer Erklärung. Eine unbekannte Abhängigkeit rechtfertigt keine Session-Löschung.

# Persistenz und Migration

## PLG-DATA-001: Neue Daten besitzen klare Eigentümer

AP03 konkretisiert additive Tabellen beziehungsweise vorhandene Store-Erweiterungen für:

| Daten | Eigentümer / Invariante |
|---|---|
| Installierte Plugin-Revisionen, Quelle, Hash, Zustand | Plugin-Verwaltung; historisch referenzierbar |
| Agent-Plugin-Auswahl und Beitragskonfiguration | `CustomAgentStore` beziehungsweise Profilmodell; revisionsgeprüft |
| Session-/Generations-Snapshots | Pibo Session-/Runtime-Persistenz; immutable pro Generation |
| Kontextaufbau-/Delivery-Befunde und Vorschauidentität | Session-/Generationspersistenz; Build-/Turn-Bezug, Provenienz und Payload-Referenzen statt erneuter Ausführung beim Lesen |
| Installations-/Update-/Deinstallationsoperationen | Plugin-Verwaltung; wiederaufnehmbarer Zustand und Audit |
| Plugin-Fachdaten | Zuständiger Plugin-Datendienst; bleiben bei Uninstall bestehen |
| Plugin-Settings-/Kontextkonfiguration | Zuständiger Plugin-Konfigurationsdienst; expliziter App-/Agent-/Session-Scope mit Revision, keine UI-eigene zweite Wahrheit |
| Desktop-Tabsets | Persistierte Produktdaten, projiziert durch die Web-Shell; Schlüssel `piboSessionId`, Revision, Instanzen, Reihenfolge, aktiver Tab, View-/Unterbereichszustand und Fallback |

Kein neuer Store darf die bestehenden Session- oder Run-Daten duplizieren. Änderungen, die `chat-agents.sqlite` und Pibo-Daten betreffen, sind keine atomare Einzeltransaktion. Es braucht ein Migrationsjournal mit idempotenten Etappen, eindeutigem Start-/Abschlusszustand und Restart-Recovery. Alte Bytes beziehungsweise Exporte werden vor destruktiven Schemaänderungen gesichert.

Kontextbefunde referenzieren bereits vorhandene Payloads/Dateistände, soweit deren Retention den Nachweis erhält. Große Inhalte werden begrenzt nachgeladen; Listen und Sessionwechsel laden nicht alle historischen Prompts. Fehlt ein historischer Befund, ist er als unbekannt auszuweisen. Ein Tabset-Schreibvorgang kann keine Sessionaktivierung oder Änderung der Plugin-Auswahl auslösen.

## PLG-MIG-001: Bestehende Auswahl ohne stillen Funktionszuwachs überführen

| Alt | Neu | Erhaltungsregel |
|---|---|---|
| `nativeTools` / direkt gewählte Pibo-Tools | Plugin- und Beitragsauswahl | Gleicher effektiver Tool-Satz, keine zusätzlichen Schreibtools |
| `runControl` / `pibo-run-control` | `pibo.run-control` | Bestehende Auswahl, Tool-Namen und Run-IDs erhalten |
| `goalControl` / `pibo-goal-control` | `pibo.goal-control` | Defaults und bestehende explizite Ausnahmen erhalten |
| Plugin-Skills und Plugin-Kontext in flachen Listen | Qualifizierte Plugin-Beiträge | Reihenfolge, Herkunft und Auswahl erhalten |
| User-Skills / User-Kontext | Unabhängige User-Referenzen | Dateien und Bearbeitbarkeit unverändert erhalten |
| Manuelle Subagents | Manuelle Definitionen | Zielprofil, Modelle, Limits und Overrides erhalten |
| Plugin-Subagents | Plugin-Beiträge | Herkunft und Auswahl sichtbar |
| `mcpServers` und MCP-CLI-Konfiguration | Konfiguration/Auswahl des MCP-CLI-Plugins | Server-/Toolfilter und Secret-Referenzen erhalten |
| MCP-Beschreibungen, Pibo-Native-Kontextoptionen, `piboTools`-Snippets und sonstige Feature-Settings | Konfiguration und Kontextbeiträge des jeweiligen Besitzerplugins | Werte, Geltungsbereich, Herkunft und effektive Kontextreihenfolge erhalten; keine neuen Defaults einschalten |
| `piPackages` | Migrationsbefund und gegebenenfalls explizite neue Plugin-Zuordnung | Keine alte ausführbare Aktivierung; unbekannte Inhalte bleiben gesichert/inaktiv |
| Globale Desktop-Tabs aus `pibo.chat.desktopTabs.v1` | Sessiongebundene Tabsets mit qualifizierten Views | Nur belegbare Sessionbindung automatisch übernehmen; ungebundene Alttabs nicht in alle Sessions kopieren |
| Globale `contextPanel`-/Editor-/Settings-Auswahl und alte Deep Links | Unteransicht und Editorzustand in der jeweiligen Session-Tabinstanz | Explizite Sessionbindung erhalten; unbekannte Zuordnung bleibt als wiederherstellbarer Migrationsbefund bestehen |

Passt eine alte Teilmenge nicht zu neuen Pflichtbeiträgen, darf die Migration nicht zusätzliche Funktionen aktivieren. Der Datensatz erhält einen erklärten Migrationskonflikt. Die mitgelieferten Plugin-Manifeste sollen daher zunächst nur wirklich untrennbare Bestandteile als Pflicht markieren. Konflikte werden über einen expliziten Benutzerentscheid aufgelöst, nicht über versteckte Legacy-Plugins oder dauerhaft parallel laufende Registries.

Die Migration ist wiederholbar, dry-run-fähig und prüft vor/nach der Umstellung den effektiven Beitragssatz. Alte Felder werden erst nach funktionierender Migration aus den regulären Schreib-/Lesepfaden entfernt. Historische Diagnose und zeitlich begrenztes Lesen alter Daten sind keine weitere aktive Pi-Package-Ausführung.

Tab-v1-Daten werden vor Übernahme gesichert. Eine in einer alten Route ausdrücklich gespeicherte `piboSessionId` kann eine Zuordnung belegen; `pibo.chat.lastSelection` allein beweist nicht die historische Ownership sämtlicher globaler Tabs. Für ungebundene Alttabs wird eine einmalige bewusste Übernahme in die gewählte Session angeboten. Bis dahin bleiben sie inaktiv erhalten. Teilweise Migration, ein zweiter Browser und erneuter Import dürfen keine Duplikate oder überschriebenen bereits vorhandenen Session-Tabsets erzeugen. Nicht mehr vorhandene Pi-Package-Ziele ergeben eine Entfernungserklärung statt einer wiederbelebten Paketverwaltung.

# Quellkarte für die Umsetzung

Die folgenden Pfade existieren am geprüften Commit. Sie sind Einstiegspunkte, keine abschließende Liste aller zu ändernden Stellen. Neue Dateien in Arbeitspaketen sind ausdrücklich als **neu** markiert.[^code-baseline]

| Kürzel | Bestehende Quellen und Besitz |
|---|---|
| S01 | `src/plugins/types.ts`, `registry.ts`, `builtin.ts`, `native-tooling.ts`; `src/gateway/web.ts`: Plugin-Vertrag, Katalog und Standardkomposition |
| S02 | `src/tools/contract.ts`, `session-tool-set.ts`, `session-service.ts`: Tool-Definition, Profilmaterialisierung und portable Ausführung/MCP-Zugriff |
| S03 | `src/core/profiles.ts`; `src/apps/chat/agent-store.ts`, `agent-profiles.ts`; `src/plugins/chat-custom-agents.ts`: Profilaufbau und persistierte Custom Agents |
| S04 | `src/apps/chat-ui/src/agents/AgentsView.tsx`, `agent-designer-model.ts`; `src/apps/chat-ui/src/api-agent-designer.ts`: Designer, Draft/Autosave und Client-API |
| S05 | `src/apps/chat/chat-capability-routes.ts`, `chat-api-routes.ts`, `web-app.ts`: Katalog, Mutation und Web-Dispatch |
| S06 | `src/agent-runtime/types.ts`, `registry.ts`, `resource-service.ts`; `src/agent-runtimes/pi/adapter.ts`, `codex-native/adapter.ts`, `codex-native/resource-delivery.ts`, `omp/adapter.ts`: Runtime- und Ressourcenlieferung |
| S07 | `src/core/session-router.ts`; `src/data/pibo-store.ts`, `schema.ts`, `session-store.ts`; `src/sessions/runtime-binding.ts`, `runtime-binding-persistence.ts`: Routing, Session-Persistenz und Bindings |
| S08 | `src/apps/chat-ui/src/desktop-tabs-model.ts`, `desktop-tabs.tsx`, `app-routes.ts`, `App.tsx`, `main.tsx`: Tabs, Navigation und Shell |
| S09 | `src/apps/chat-ui/src/session-views/types.ts`, `registry.tsx`, `compact-terminal/CompactTerminalSessionView.tsx`: Session-Views, Terminal-Projektion und Virtualisierung |
| S10 | `src/plugins/web-annotations.ts`; `src/web-annotations/api.ts`, `tools.ts`: Annotations als erster vollständiger Feature-Umzug |
| S11 | `src/runs/tools.ts`; `src/loops/tools.ts`; `src/subagents/tool.ts`: Run-, Goal- und Subagent-Toolfamilien |
| S12 | `src/plugins/codex-compat.ts`; `src/core/codex-compat.ts`; `src/tools/codex-compat.ts`; separat `src/plugins/codex-native.ts`: Compat und native Runtime |
| S13 | `src/mcp/index.ts`, `config.ts`, `config-command.ts`, `client.ts`, `daemon.ts`, `agent-context.ts`; S06: MCP-CLI, Konfiguration und Runtime-Übergang |
| S14 | `src/pi-packages/types.ts`, `store.ts`, `runtime.ts`; S03–S06: Paketverwaltung und exklusive Pi-Lieferung |
| S15 | `src/tools/runtime/tool.ts`, `hashline.ts`, `web-search.ts`, `codex-browser.ts`; `src/gateway/tool.ts`: vorhandene Toolfamilien |
| S16 | `src/web/types.ts`, `channel.ts`; `src/apps/chat-ui/src/VscodeArea.tsx`; `src/apps/chat-vscode/`; `src/local/client.ts`; `package.json`: Host, VS-Code-/TUI-Produktoberflächen und Build |
| S17 | `src/apps/chat-ui/src/context/types.ts`, `src/apps/chat-ui/src/context/ContextSidebar.tsx`, `src/apps/chat-ui/src/context/McpToolsView.tsx`, `src/apps/chat-ui/src/context/PiboToolsView.tsx`; `src/apps/chat-ui/src/settings/types.ts`, `src/apps/chat-ui/src/settings/SettingsSidebar.tsx`, `src/apps/chat-ui/src/settings/SettingsView.tsx`; S08: feste Context-/Settings-Paneltypen, Featureeditoren und beide Renderzweige |
| S18 | `src/apps/chat-ui/src/context/ContextBuildView.tsx`; `src/apps/chat-ui/src/api-agent-designer.ts` (`ContextBuildSnapshot`, `ContextBuildNode`, `getContextBuild`); `src/apps/chat/web-app.ts` (`buildContextBuildSnapshotForRequest`, `/api/chat/context-build`); `src/agent-runtime/context-build.ts` (`buildPortableRuntimeContextSnapshot`), `src/core/context-build.ts` (`inspectPiboContextBuild`), S06: Snapshot und tatsächliche Ressourcenlieferung |
| S19 | `src/apps/chat-ui/src/app-storage.ts`, `src/apps/chat-ui/src/app-route-selection.ts`; S08 (`desktopTabTargetKey`, `serializeDesktopTabState`, `useDesktopTabWorkspace`): bisher globale Tabpersistenz `pibo.chat.desktopTabs.v1` und davon getrennte Sessionauswahl `pibo.chat.lastSelection` |

Die Ergänzungsprüfung zu S17–S19 bestätigt am gleichen Baseline-Commit feste Context-/Settings-Fallunterscheidungen und globale Tabpersistenz ohne Tabset pro Session. Build Context besitzt bereits Runtime-/Delivery-Diagnose; diese ist als Ausgangspunkt zu erhalten, aber kein Nachweis des hier geplanten vollständigen Plugin-/Generationsmodells.

# Arbeitspakete und Reihenfolge

Ein Agent übernimmt ein abgegrenztes Paket oder einen einzelnen nummerierten Unterpunkt, wenn dessen Umfang eine Session übersteigt. Er notiert den tatsächlichen Quellcommit und seine Evidenz beim Handoff. Neue Paketnamen und Modulpfade sind geplante Ziele; sie werden nicht als existierende Implementierung ausgegeben.

| Paket | Abhängigkeiten | Hauptverantwortung |
|---|---|---|
| AP00 | keine | Baseline, Auswahlfixtures und vollständige Ownership-Inventur |
| AP01 | AP00 | Öffentliche Verträge und Schema |
| AP02 | AP01 | Registry, Dienste und Lifecycle |
| AP03 | AP01 | Additive Persistenz und Migrationsjournal |
| AP04 | AP02, AP03 | Beitragsauswahl, Pflichtteile und Kompatibilität |
| AP05 | AP02, AP03 | Installation, Quellenadapter, Operationen und CLI |
| AP06 | AP04 | Runtime-/Tool-Lieferung und vollständige Kontextaufbau-Befunde |
| AP07 | AP01, AP02 | Browser-Host und versionierter Katalog |
| AP08 | AP03, AP04, AP07 | Persistierte Session-Tabsets, Plugin-Settings und austauschbare Shell-Flächen |
| AP09 | AP06, AP07 | Terminal-Renderer, Artefakte und Hooks |
| AP10 | AP04, AP05, AP07 | Designer und Ressourcen-Konfiguration |
| AP11 | AP06, AP08, AP09, AP10 | Annotations einschließlich Settings und Build Context als vollständiger Durchstich |
| AP12 | AP06, AP10, AP11 | Built-in Toolfamilien und Codex Compat |
| AP13 | AP06, AP10, AP11 | Run-/Goal-Control und Subagents |
| AP14 | AP06, AP10, AP11 | MCP-CLI-Plugin und Adaptervertrag |
| AP15 | AP05, AP06, AP08, AP10, AP13 | Deinstallation, Updates und Wiederherstellung |
| AP16 | AP12, AP13, AP14, AP15 | Bestandsmigration und Pi-Package-Entfernung |
| AP17 | AP08, AP09, AP11 | Restliche mitgelieferte UI/Dienste und Produktscope |
| AP18 | AP16, AP17 | Alte Registrierungs-/Auswahlwege endgültig entfernen |
| AP19 | AP18 | Integrierte Akzeptanz, Paketprüfung und Dokumentation |

## AP00 — Baseline und Ownership-Inventur

**Ziel:** Jede bisher auswählbare Funktion hat einen nachvollziehbaren Zielbesitzer. Grundlage S01–S19, keine erneute breite Cordis-/Harness-Recherche.

- [ ] AP00.1 Aktuellen `upstream/dev`-Commit erfassen; Drift zu diesem Plan nach konkreten Symbolen prüfen.
- [ ] AP00.2 Tool-/Skill-/Kontext-/Subagent-/MCP-/UI-Inventar aus bestehenden Registrierungen ermitteln. Pro Beitrag alte ID, Auswahldefault, Scope, Runtime-Einschränkung, persistierte Referenzen und geplante Plugin-ID festhalten.
- [ ] AP00.3 Repräsentative alte Agent-/Session-/Tab-Konfigurationen als anonymisierte deterministische Fixtures erstellen: Standardagent, eigene Toolteilmenge, Pi-only, Codex Native, OMP, manuelle Subagents, User-Ressourcen, MCP und unbekannte Pi-Packages.
- [ ] AP00.4 Bestehende Regressionstests den Fixtures zuordnen; fehlende Tests nach den Akzeptanzfällen dieses Plans ergänzen, nicht Implementierungsdetails spiegeln.
- [ ] AP00.5 Sämtliche Context-/Settings-Flächen einschließlich MCP, Pibo Native, CLI-Tool-Snippets, Pi Packages und übriger Feature-Settings inventarisieren: alte Route, Daten-/Scope-Owner, effektiver Kontextbeitrag, Ziel-Plugin/Tab und Migrationsregel. Beide App-Renderzweige und globale Unterbereichsstates erfassen.
- [ ] AP00.6 Build-Context-Stufen gegen echte Runtime-Lieferung abgleichen. Tab-v1-Fixtures für zwei Sessions desselben Agents, unterschiedliche Plugin-Auswahl, globale Alttabs, explizite Context-Sessionroute und unabhängige User-Ressourcen sichern.
- [ ] AP00.7 Jeden Beitrag als systemweit oder agentbezogen inventarisieren; gemischte Plugins und deren bereichsübergreifende Dependencies erfassen. Goal-Systemverhalten getrennt von bisherigen Agent-Toolauswahlen als Migrationsfixture sichern.

**Fertig wenn:** Es gibt keine bekannte direkt auswählbare Pibo-Toolfamilie ohne Zielbesitzer. Die Fixtures beschreiben den vor der Migration effektiven Beitragssatz. Unbekannte native Pi-Discovery-Pfade sind als konkrete Auditaufgabe für AP16 festgehalten.

## AP01 — Plugin-SDK und Manifest

**Quellen:** S01, S02, S03, S06. **Neue Module:** beispielsweise `src/plugins/manifest.ts`, `contributions.ts`, `sdk.ts` und `schema.ts` innerhalb des bestehenden Plugin-Bereichs.

- [ ] AP01.1 PLG-CORE-001 bis -003 als serialisierbares Manifestschema und öffentliche TypeScript-Verträge implementieren; SDK-Export und Paketauflösung definieren.
- [ ] AP01.2 Pflicht-/Optional-Regeln, Beitragsabhängigkeiten, Runtime-Prädikate, Dienstversionen und explizite Ersetzungen modellieren. Appweite und Agent-Beiträge unterscheiden.
- [ ] AP01.3 Unbekannte Pflicht-Schemaversionen, doppelte IDs, unauflösbare Einstiegspfade und widersprüchliche Dependencies mit strukturierten Diagnosen ablehnen.
- [ ] AP01.4 Ein minimales lokales Plugin-Fixture mit Backend- und Client-Metadaten anlegen; noch keine Produktfunktion duplizieren.
- [ ] AP01.5 PLG-UI-001/-003 und PLG-CTX-001 in gemeinsamen Verträgen verankern: feste Session-Tabbindung, Unteransichten/Settingsscopes, Kontextwirkung jedes Beitrags und versionierte Provenienz-/Delivery-Knoten. Keine separate Settings- oder Context-Pluginregistry einführen.
- [ ] AP01.6 PLG-ACT-001 im Manifest/SDK durchgängig modellieren; System-only, Agent-only und gemischte Plugins ohne Sonderbehandlung für Built-ins prüfen.

**Fertig wenn:** Ein Paket lässt sich ohne Codeimport inspizieren; zwei unabhängige Plugins können einen eigenen Dienstvertrag und dessen Nutzung ausdrücken. SDK-Verträge sind stabil genug für AP02/AP07. **Tests neu:** `test/plugin-system-manifest.test.mjs`.

## AP02 — Gemeinsamer Host, Ownership und Lifecycle

**Quellen:** S01, S02, S16. **Neu:** `src/plugins/host.ts`, `scope.ts`, `services.ts` oder gleichwertige kleine Module.

- [ ] AP02.1 Den geprüften Aktivierungsgraphen deterministisch starten und in umgekehrter Reihenfolge stoppen; fehlende Dienste, Zyklen und doppelte Provider vor Ausführung erkennen.
- [ ] AP02.2 Registrierung und Cleanup von Tools, Services, Routen, Listenern und weiteren Domänenbeiträgen an eine Plugin-Instanz binden; Scope-Funktion für sessionbezogene Unterinstanzen schaffen.
- [ ] AP02.3 Bestehende Registry als abgeleitete Fassade migrieren. Temporäre Adapter erhalten genau einen Owner und führen kein zweites Aktivierungsregister.
- [ ] AP02.4 Fehler nach partiellem Setup, mehrfaches Stoppen, asynchrones Cleanup und Cleanup-Fehler prüfen; keine erfolgreiche Aktivierung oder Entfernung behaupten, solange der Zustand ungeklärt ist.
- [ ] AP02.5 System-Lifecycle unabhängig von Agent-/Session-Scopes starten und stoppen; keine erneute Dienstregistrierung durch eine zweite Session, kein System-Cleanup beim Ende der letzten Session.

**Fertig wenn:** Ein Plugin kann ohne verbleibende Registrierungen scheitern und neu aktiviert werden. Ein deklarierter Ersatzprovider ersetzt einen Built-in-Dienst deterministisch. **Tests:** bestehendes `test/plugin-registry.test.mjs`; neu `test/plugin-system-lifecycle.test.mjs`.

## AP03 — Persistenz für Installation, Auswahl und Snapshots

**Quellen:** S03, S07. **Neu:** Plugin-Store und versioniertes Migrationsjournal; genaue Tabellen in diesem Paket dokumentieren.

- [ ] AP03.1 Additive Speicherung für Installationsrevisionen, Agent-Plugin-Auswahl, Session-/Generations-Snapshots und Operationen implementieren. Agent-Daten bleiben in ihrem bestehenden Owner-Store.
- [ ] AP03.2 Keine Delete-Cascade zu Sessions, Historie, Runs oder Fachdaten zulassen. Fremdverweise auf deinstallierte Revisionen bleiben gültig oder werden als erhaltene Tombstones modelliert.
- [ ] AP03.3 Revisions-/CAS-Prüfung für konkurrierende Agent- und Plugin-Mutationen festlegen; Secrets ausschließlich referenzieren, nicht in Kataloge/Snapshots kopieren.
- [ ] AP03.4 Mehrstore-Migration mit Journal, Fehlerzwischenständen und Restart-Recovery testen. Legacy-Snapshots explizit als ungeklärt markieren.
- [ ] AP03.5 Session-Tabsets mit stabilen Instanz-IDs, aktivem Tab, Unteransicht, Zustandsschema und Revisionsprüfung persistieren. Getrennte Konfigurationsscopes sowie historische Kontextaufbau-/Delivery-Befunde mit vorhandener Payload-Persistenz verbinden; Uninstall löscht auch diese Daten nicht.
- [ ] AP03.6 Systemweite Aktivierung samt Revision getrennt von Installation und Agent-Auswahl persistieren; Neustart und konkurrierende Änderungen beider Ebenen prüfen.

**Fertig wenn:** Installationsmetadaten können entfernt/deaktiviert werden, ohne Sessiondaten zu löschen. Ein unterbrochener Migrationslauf ist wiederholbar. **Tests:** `test/agent-store.test.mjs`, `test/pibo-data-session-store.test.mjs`; neu `test/plugin-system-store.test.mjs`.

## AP04 — Resolver für Designer, Profile und Runtime

**Quellen:** S02–S07. **Neu:** `src/plugins/selection.ts` und `resolution.ts` oder gleichwertig.

- [ ] AP04.1 Den in PLG-SEL-001 beschriebenen Resolver als gemeinsame Serverfunktion implementieren. Preview und tatsächlicher Sessionstart verwenden dieselbe Auflösung.
- [ ] AP04.2 Unabhängige User-Skills, Kontextdateien und manuelle Subagents zusammenführen; Herkunft und Kontextreihenfolge erhalten.
- [ ] AP04.3 Pflichtteile, optionale Deaktivierung, fehlende Runtime-Unterstützung und überlappende Tool-Namen prüfen. Fehlende Plugins bleiben als Referenz im Draft erhalten.
- [ ] AP04.4 Defaults nur für neue Auswahl übernehmen; Updates verbreitern bestehende Agents nicht stillschweigend. Migration kann Konflikte ohne Datenverlust speichern.
- [ ] AP04.5 Dieselbe Auflösung für Session-Tabverfügbarkeit und Build Context verfügbar machen. Ausgeschlossene Beiträge mit Grund und Herkunft erhalten; Inspector-Vorschau und tatsächlichen Generationsplan ausdrücklich trennen.
- [ ] AP04.6 Agent-Auswahl gegen explizite Systemdienst-Abhängigkeiten prüfen, ohne Systemaktivierung oder Tool-Lieferung zu implizieren; System-Views unabhängig von Agent-Runtime-Grenzen auflösen.

**Fertig wenn:** UI und Runtime erklären dieselbe effektive Auswahl; ein API-Client kann Pflichtteile nicht umgehen. **Tests:** `test/chat-custom-agent-profiles.test.mjs`, `test/agent-profiles.test.mjs`; neu `test/plugin-system-selection.test.mjs`.

## AP05 — Installation, Quellen und Operator-CLI

**Quellen:** S01, S05, S16 und vorhandene CLI-Einstiege. **Neu:** Plugin-Installations-/Quellenmodule und CLI-Zweig.

- [ ] AP05.1 Lokale Verzeichnisse und versionierte Paketartefakte in denselben Manifest-/Hash-Vertrag auflösen. Quelle, exakte Revision und SDK-Kompatibilität speichern; spätere Registry/Marketplace-Quelle als Interface vorsehen.
- [ ] AP05.2 Stage, Prüfung, Commit und Fehler-Recovery als Operation implementieren. Plugin-Code erst im vorgesehenen Aktivierungsschritt importieren; fehlgeschlagene Downloads/Imports hinterlassen keine halbe aktive Installation.
- [ ] AP05.3 Progressive CLI für Liste, Inspektion, Installation, Aktivierungsstatus und Diagnose schaffen. Maschinenlesbare strukturierte Ausgabe sowie Dry-run/Auswirkungsplan bereitstellen; genaue Syntax im Paket festhalten.
- [ ] AP05.4 Die Deinstallationsoperation zunächst mit der späteren AP15-Policy verbinden beziehungsweise bis dahin geschlossen als noch nicht verfügbar behandeln. Kein provisorischer Löschpfad ohne Session-Auswirkungsschutz.
- [ ] AP05.5 Installation, systemweiten Aktivierungsstatus und Agent-Verbraucher getrennt inspizierbar machen; systemweite Aktivierung/Deaktivierung mit explizitem Scope und Auswirkungsplan anbieten.

**Fertig wenn:** Dasselbe Fixture lässt sich lokal und als Paket inspizieren/installieren; eine falsche SDK-Version ist erklärbar. Kein Marketplace ist erforderlich. **Tests neu:** `test/plugin-system-install.test.mjs`, `test/plugin-system-cli.test.mjs`.

## AP06 — Runtime-Lieferung, Tool-Ausführung und Kontextaufbau

**Quellen:** S02, S06, S07, S18.

- [ ] AP06.1 Den aufgelösten Plugin-Plan in Pi, Codex Native und OMP liefern; vorhandene Bridges und `PiboToolDefinition` erhalten, keine Harness-SDK-Typen in portable Plugin-Verträge ziehen.
- [ ] AP06.2 Runtime-Generation und Snapshot zusammen aktivieren. Credentials, materialisierte Dateien und Plugin-Unterinstanzen gemeinsam auslaufen lassen; laufende Turns erhalten keine veränderte Toolauswahl.
- [ ] AP06.3 Pi-only-Beiträge vor Import filtern; optionale versus erforderliche Einschränkungen in Delivery Reports und Inspector zeigen.
- [ ] AP06.4 Tool-Hooks in den gemeinsamen Ausführungspfad setzen und transportübergreifend prüfen; beobachtete Harness-Events nicht als garantierte Pre-Hooks ausgeben.
- [ ] AP06.5 Strukturierten Kontextaufbaunachweis nach PLG-CTX-001 aus Resolver und tatsächlichen Delivery-/Transformationsstufen erzeugen und persistieren. Alle Beiträge einschließlich ohne Kontextwirkung und ausgeschlossener Beiträge abdecken; User-/Harness-Herkunft, progressive Skill-Lieferung und native Beobachtungsgrenzen erhalten.
- [ ] AP06.6 `/api/chat/context-build` auf tatsächlichen gespeicherten Stand und separat markierte Vorschau umstellen. Kein Tool-/Hook-Schreibeffekt durch Inspektion; keine Rekonstruktion aktueller Defaults als angeblich historischer Prompt. Große Payloads nachladen; redigierte Exporte und Inspector-only-Metadaten getrennt halten.

**Fertig wenn:** Ein portable Tool-Fixture funktioniert über alle drei Adapter; zwei parallele Sessions teilen keine ausgewählten Tools/Credentials. Jeder Kontextbeitrag ist von Auswahl bis Lieferung erklärbar, ohne die Inspektion zur Ausführung zu machen. **Tests:** `test/pibo-tool-contract.test.mjs`, `test/pibo-tool-mcp-bridge.test.mjs`, `test/agent-runtime-resource-service.test.mjs`, `test/codex-native-resources.test.mjs`, `test/runtime-portability.test.mjs`, `test/context-build-inspector.test.mjs`; neu `test/plugin-system-runtime.test.mjs`, `test/plugin-system-context-build.test.mjs`.

## AP07 — Browser-Host und gemeinsamer Katalog

**Quellen:** S05, S08, S16. **Neu:** `src/apps/chat-ui/src/plugins/` und Backend-Katalog-/Asset-Adapter.

- [ ] AP07.1 Sicheren Transport der öffentlichen Metadaten implementieren: Plugin-ID, Revision, Asset-Hash, Client-Einstieg, Beiträge und Diagnosen. Keine Secrets oder Backend-Objekte serialisieren.
- [ ] AP07.2 Den Browser-Host über dieselben Manifest-/Beitragskonzepte aufbauen; React/SDK kontrolliert gemeinsam auflösen, Node-/Harness-Imports im Client-Build ausschließen.
- [ ] AP07.3 Fehler optionaler Plugins begrenzen; fehlende erforderliche Shell-Provider mit eigenem Boot-Diagnosezustand melden.
- [ ] AP07.4 Veraltete Kataloge, fehlende Assets und Frontend-/Backend-Revisionswechsel behandeln. Kontrollierter Reload ist in Version 1 zulässig; stilles Mischen inkompatibler Revisionen nicht.
- [ ] AP07.5 Generische Settings-/Kontextunteransichten samt Konfigurationsscope und Build-Context-Detailrenderer aus denselben Plugin-Metadaten liefern. Session-Tabkontext und Konfigurationsziel getrennt typisieren; reine Installation verleiht einem Session-Tab keine Agent-Beiträge.

**Fertig wenn:** Ein externes Client-Fixture wird ohne statischen Feature-Import in `App.tsx` erkannt und sauber entfernt. **Tests neu:** `test/plugin-system-web-catalog.test.mjs`; ergänzende Browser-Tests.

## AP08 — Session-Tabsets, Plugin-Settings und Routing

**Quellen:** S08, S17, S19 und Persistenzvertrag AP03. `DESIGN.md` und bestehende Designkonzepte vor visuellen Änderungen lesen.

- [ ] AP08.1 Qualifizierte Plugin-Tab-Ziele mit fester `piboSessionId`, Instanzidentität und View-Zustand einführen. Tabset-Persistenz aus AP03 verwenden; globalen v1-Speicher nur über die explizite Migration übernehmen.
- [ ] AP08.2 Sessionwechsel als Save/Restore zweier getrennter Tabsets umsetzen. Öffnen-Menü aus dem wirksamen Session-Pluginplan ableiten; Reihenfolge, aktiven Tab, Context-/Settings-Unteransichten, URL, Deduplizierung und Fokus pro Session erhalten.
- [ ] AP08.3 Explizite Provider für Root-Shell und benannte Flächen schaffen. Einen alternativen Root-Provider im Fixture einsetzen, ohne den Kern zu patchen.
- [ ] AP08.4 Fehlende/deaktivierte Plugins als Platzhalter erhalten; schnelle A→B→A-Wechsel, verspätete Requests/Saves, Keep-alive, zwei Browser, Deep Links und Reload prüfen. Keine generische globale Tabinstanz bleibt als Ausweichpfad.
- [ ] AP08.5 Settings-/Kontext-Unteransichten als Teil des jeweiligen Plugin-Tabs implementieren. Scope und Wirkung von Änderungen zeigen; Links aus Designer, Context und Settings öffnen den Besitzer-Tab derselben Session. Navigation-/Pending-Draft-Guards für ungespeicherte Änderungen erhalten.
- [ ] AP08.6 Den Desktop-Workspace aus dem globalen Laufzeitstore lösen und atomar im vorhandenen Session-Tabset-Controller führen. Während A/B-Ladevorgängen keine alte Sessionoberfläche zeigen; veraltete Reads/Writes und Owner-Mismatches verwerfen. Die begrenzte Controller-Aufbewahrung verwirft nie lokale Änderungen, CAS-Konflikte oder laufende Reads/Writes, auch wenn mehr als acht Sessions besucht werden; Live-Browser-Hosts bleiben davon getrennt und werden beim Sessionwechsel entsorgt.
- [ ] AP08.7 Inaktive echte Tabpanels generisch gemountet halten und nur über `active` pausieren. Einen zugänglichen Refresh pro Tab ergänzen, der die registrierten Leave-/Autosave-Guards und ausstehenden Tabset-Saves abwartet und nur bei Erfolg diesen Mount erneuert; Close bleibt die Dispose-Grenze. Sessionwechsel entsorgt die Live-Mounts der verlassenen Session.
- [ ] AP08.8 Alle Session-Erstellungsaktionen auf den App-eigenen optimistischen Client-Router-Flow führen und den bestehenden Inline-Rename-Handoff nach realer ID belegen. Kein produktiver Create-Pfad darf `location.assign` oder einen Document-Reload verwenden.

**Fertig wenn:** Zwei Sessions desselben Agents besitzen unabhängige Tabsets; zwei Agents mit unterschiedlichen Plugin-Plänen sehen nur ihre verfügbaren Funktionen. Context und Settings erfüllen denselben Bindungs-/Restore-Vertrag. Neue Sessions starten ohne echte Tabs, A→B→A stellt die exakte Oberfläche wieder her, Tabwechsel erhält Mount-State und Refresh/Close haben getrennte Lifecycle-Wirkung. **Tests:** `test/chat-ui-desktop-tabs-model.test.mjs`, `test/chat-ui-desktop-tabs-behavior.test.mjs`, `test/chat-ui-desktop-tabs-accessibility.test.mjs`, `test/chat-ui-app-routes.test.mjs`, `test/chat-ui-app-route-selection.test.mjs`, `test/chat-ui-app-storage.test.mjs`; neu `test/plugin-system-tabs.test.mjs`, `test/plugin-system-settings.test.mjs`; headful Browser-Use/CDP für Standard- und Ersatz-Shell.

## AP09 — Terminal-Renderer und Eingabe-Hooks

**Quellen:** S09, S02, S05, S08 und Composer-Einstiege aus dem bestehenden UI.

- [ ] AP09.1 Ganze Session-Views registrierbar machen; Terminal und Workflow auf dieselbe View-API umstellen.
- [ ] AP09.2 Tool-/Artefakt-Renderer und Aktionen mit versioniertem Envelope, textuellem Fallback und Fehlergrenze implementieren. Standard-Renderer werden Beiträge des Terminal-Plugins.
- [ ] AP09.3 Paste/Drop/Send-Hooks des Web-Composers und Input-Hooks des Routers klar voneinander trennen; Reihenfolge, Ergebnisprüfung und Fehlerverhalten implementieren.
- [ ] AP09.4 Streaming, Paging, Bilder, expandierende Karten, Viewwechsel und Replay prüfen. Plugin-Mount/Unmount verändert keine Reihenfolge oder historische Daten.
- [ ] AP09.5 Kontextverändernde Eingabe-/Hookstufen mit dem AP06-Provenienzvertrag verbinden. Build Context unterscheidet ausgeführte Transformation, reine Vorschau und native nicht einsehbare Stufe; Inspector-Aufruf darf keinen Hook erneut ausführen.

**Fertig wenn:** Ein Plugin zeigt dieselbe fachliche Information live und nach Reload, auch mit generischem Fallback nach Entfernen des Renderers. **Tests neu:** `test/plugin-system-terminal.test.mjs`, `test/plugin-system-hooks.test.mjs`; bestehende Terminal-/Scroll-Regressionen aus AP00 und headful Browser-Belege.

## AP10 — Agent-Designer auf Plugins umstellen

**Quellen:** S03–S05.

- [ ] AP10.1 `AgentDraft`, Save-Payload, Preview und Store um Plugin-Auswahl erweitern; Autosave/CAS, Wiederherstellung, Ordner, Modelle und Runtime-Wechsel erhalten.
- [ ] AP10.2 Plugin-Bereich mit Gesamt-Toggle, Beitragsliste, Typ/Herkunft, Pflichtkennzeichnung, optionalen Toggles und Runtime-Diagnose bauen. Appweite-only-Plugins nicht irreführend als Agent-Toolauswahl darstellen.
- [ ] AP10.3 Direkten Pibo-Toolkatalog, Built-in Pibo Tool Catalog und Packages-Bereich aus dem Designer entfernen. Die gesonderte Pi-Built-in-Toolauswahl nur für die passende Runtime erhalten.
- [ ] AP10.4 Unabhängige User-Skills, Kontextdateien und manuelle Subagent-Konfiguration erhalten; pluginbereitgestellte Ressourcen innerhalb des Plugin-Bereichs darstellen. Keine doppelte widersprüchliche Auswahloberfläche.
- [ ] AP10.5 Fehlende Plugins und Migrationskonflikte im Draft sichtbar halten. Speichern anderer Felder darf ungelöste Referenzen nicht löschen.
- [ ] AP10.6 Aus der Plugin-Auswahl zu dessen Settings-/Kontext-Tab für die ausgewählte Session navigieren. Bei Bearbeitung eines anderen Agents Zielprofil und Scope explizit anzeigen; weder Kontext noch ausstehende Saves an einen zufälligen Sessionwechsel binden. MCP-Auswahl als Plugin-Beiträge darstellen und Beschreibungs-/Kontexteditoren dorthin verlagern.
- [ ] AP10.7 Designer-Schalter auf die Agent-Seite begrenzen; Systemstatus und fehlende System-Abhängigkeiten erklären. Reine System-Plugins erhalten keinen Agent-Aktivierungsschalter.

**Fertig wenn:** Die vorherigen Designer-Szenarien bleiben nutzbar; Pflichtbeiträge sind sichtbar gesperrt und serverseitig geprüft. **Tests:** `test/chat-ui-agent-designer-autosave.test.mjs`, `test/chat-ui-agent-designer-runtime-switch.test.mjs`, `test/chat-ui-agent-designer-subagents.test.mjs`, `test/chat-ui-agent-designer-catalog-selection-accessibility.test.mjs`, `test/chat-ui-app-agent-catalog-mutations.test.mjs`; neue Verhaltensfälle für Plugin-Auswahl und User-Ressourcen.

## AP11 — Vollständiger Feature-Durchstich mit Web Annotations

**Quellen:** S10 und AP06–AP10.

- [ ] AP11.1 Annotations als versioniertes Plugin mit Tools, Skill, API, Tab und repräsentativem Terminal-Beitrag verpacken. Bestehende IDs und Daten erhalten.
- [ ] AP11.2 Agent-Konfiguration und Runtime-Lieferung auf Plugin-Beiträge umstellen; den separaten Capability-Package-Eintrag entfernen.
- [ ] AP11.3 Im Docker-Worker über den gewöhnlichen Plugin-Installationsweg laden. Standard-Agent auswählen, Annotation erfassen/lesen und im Tab sowie Terminal darstellen.
- [ ] AP11.4 Fehlerhafte Aktivierung, fehlender Renderer und erneute Installation mit erhaltenen Daten prüfen; denselben Kandidaten auf Pibo2 abnehmen.
- [ ] AP11.5 Plugin-eigene Einstellungen und Kontextoptionen im Annotations-Tab liefern; Build-Context-UI selbst als registrierten mitgelieferten Beitrag auf AP06 aufsetzen. Annotation-Beiträge, User-Ressource, optionale Ausschlüsse und Runtime-Grenzen vollständig erklären; keine neue statische Settings-/Context-Fallunterscheidung.
- [ ] AP11.6 Mit zwei Sessions Tabset, Unteransicht, Aktivierungsunterschied und A→B→A-Restore belegen. Eine Einstellungsänderung in A erscheint in As separater Vorschau, verändert aber weder einen gespeicherten Build-Stand noch unbemerkt Bs laufende Generation.
- [ ] AP11.7 Vor breiter Extraktion die drei Aktivierungsformen mit gewöhnlich installierten Fixtures durch Host, Designer/API, Runtime und Browser prüfen (A38–A41); Goal-Produktparität folgt in AP13.

**Fertig wenn:** Das Feature benötigt keinen neuen Sonderfall im Katalog, Designer, Router, Terminal, Context oder Settings. Session-Tabs, Plugin-Konfiguration und Build Context sind gemeinsam belegt. Erst danach beginnen die breiten Feature-Extraktionen AP12–AP14. Ein nur funktionierender statischer Import erfüllt diesen Meilenstein nicht. **Tests zusätzlich:** `test/chat-ui-context-build-origin.test.mjs`, neue Plugin-Settings-/Build-Context-Fälle und headful Durchstich.

## AP12 — Built-in Toolfamilien und Codex Compat extrahieren

**Quellen:** S01, S12, S15. Tool-Namen erhalten; Ownership in Manifeste übertragen.

| Ziel-Plugin-ID | Anfangs zugeordnete vorhandene Funktion |
|---|---|
| `pibo.code-runtime` | Persistentes Python/Node-Tool `runtime` |
| `pibo.file-editing` | Hashline-Werkzeuge; Pi Built-ins bleiben Harness-Werkzeuge |
| `pibo.web-search` | Bestehendes Web-Suchtool |
| `pibo.browser-tools` | Bestehende Browser-/Node-REPL-Toolfamilie aus `codex-browser.ts` |
| `pibo.gateway-tools` | `pibo_gateway_send` und dazugehöriger Kontext |
| `pibo.codex-compat` | Compat-Tools, Base Prompt und Pi-spezifische Compat-Integration |

- [ ] AP12.1 AP00-Inventar gegen diese Startaufteilung abgleichen; weitere tatsächlich vorhandene Tools einem Besitzer zuordnen. Keine unbekannte Familie kommentarlos weglassen.
- [ ] AP12.2 Plugin-Manifeste, passende Kontexte/Skills und Runtime-Erklärungen schaffen; optionale Teilmengen so modellieren, dass alte Agent-Auswahlen ohne Mehrbefugnisse migrierbar sind.
- [ ] AP12.3 Hartcodierte Sonderlieferung aus Built-in-/Session-Tool-Zusammenstellung entfernen, sobald die betreffende Familie umgezogen ist.
- [ ] AP12.4 Codex Compat strikt von `codex-native` trennen. Native Modellschleife, Prompt und native Tools nicht durch Compat ersetzen; keine neue `codex`-Aliasgleichsetzung.
- [ ] AP12.5 Pibo-Native- und CLI-Tool-Kontextoptionen einschließlich `PiboToolsView`/Snippets dem jeweiligen Plugin zuordnen und im zugehörigen Tab liefern. Auch nicht textuelle Tools/Services in Build Context mit ihrer tatsächlichen Kontextwirkung ausweisen; keinen zentralen „Pibo Native“-Settings-Sonderweg belassen.

**Fertig wenn:** Jede bisherige Toolfamilie besitzt einen Plugin-Eintrag, einen getesteten Runtime-Status und keine parallele direkte Designer-Auswahl. **Tests:** `test/codex-compat.test.mjs`, `test/codex-browser-interface.test.mjs`, `test/gateway-tool.test.mjs`, `test/pibo-tool-contract.test.mjs` und family-spezifische Tests aus AP00.

## AP13 — Run-/Goal-Control und Subagent-Integration

**Verbindlicher Mischfall:** Goal als ein Plugin mit systemweiter, standardmäßig aktiver App-Funktion und getrenntem Agent-Tooling extrahieren. A38–A42 und PLG-ACT-001 belegen unabhängige Aktivierung, Neustart und erhaltene laufende Arbeit. Die Migration erhält die bisherige appweite Goal-Verfügbarkeit, auch wenn kein Profil Goal-Tools gewählt hatte.

**Quellen:** S11, S02, S07.

- [ ] AP13.1 `pibo.run-control` als Plugin mit Run-Dienst, Tools, Kontext, API und passenden UI-Beiträgen bereitstellen. `pibo_run_*`-Namen und Run-IDs stabil halten.
- [ ] AP13.2 `pibo.goal-control` mit Goal-Tools und expliziter Loop-/Run-Integration bereitstellen. Getrennte Dienste und Integrationsbeiträge vermeiden zyklische Startabhängigkeiten.
- [ ] AP13.3 `pibo.subagents` beziehungsweise den im Inventar festgelegten Besitzer für Subagent-Tools/Beiträge schaffen. Manuelle Zielprofil-Konfiguration unverändert unterstützen; plugindefinierte Subagents zusätzlich anbieten.
- [ ] AP13.4 Persistenz, Reminders, Cancellation, Thread-Reuse und Lebensdauer vom UI-Mount entkoppelt erhalten. Parent und Child behalten getrennte Runtime-Auflösung.
- [ ] AP13.5 Feste Run-/Goal-Katalogeinträge und reguläre `runControl`-/`goalControl`-Schreiblogik ablösen; Altdaten werden nur durch die Migration gelesen.
- [ ] AP13.6 Bestehende Einstellungen und Context-Beiträge dieser Familien in deren Tabs aufnehmen. Generierte Run-/Goal-Tools, Subagent-Kontext und ihre Herkunft in Build Context nachweisen; Inspector-Metadaten nicht in den Modellprompt kopieren.

**Fertig wenn:** Plugin-Auswahl ersetzt Packages, ohne aktive Runs, Tool-Zielprüfung oder Subagent-Semantik zu verändern. **Tests:** `test/runs.test.mjs`, `test/loop-goal-tools.test.mjs`, `test/chat-ui-agent-designer-subagents.test.mjs`, `test/codex-native-subagents.test.mjs` und Cancellation-/Reuse-Regressionen aus AP00.

## AP14 — MCP-CLI als Plugin und austauschbare MCP-Adapter

**Quellen:** S13, S06, S17, S18.

- [ ] AP14.1 Bestehende Konfiguration, CLI-Aufrufe, Toolfilter, Beschreibung und Agent-Kontext als `pibo.mcp-cli` bereitstellen. Das Plugin liefert seinen Tab mit Server-/Settings-/Kontext-Unteransichten; den fest verdrahteten Context→MCP-Tools-Pfad auflösen und alte Links dorthin migrieren.
- [ ] AP14.2 Einen dokumentierten MCP-Beitrags-/Liefervertrag definieren, den ein zweiter Fixture-Adapter implementiert. Kein neuer allgemeiner MCP-Paketmanager neben dem Plugin-System.
- [ ] AP14.3 Bestehende Secret-Referenzen, isolierte Umgebungen, Daemon-Ownership und Credential-Lebensdauer erhalten. Plugin-ID und ausgewählte Server/Tools bis zum Delivery Report verfolgen.
- [ ] AP14.4 Native externe MCP-Lieferung von Pibos interner Tool-MCP-Bridge unterscheiden. Das Entfernen des MCP-CLI-Plugins darf nicht automatisch die für andere Plugin-Tools notwendige interne Codex-Bridge entfernen.
- [ ] AP14.5 MCP-Kontext-/Beschreibungsänderung vom Plugin-Tab über gespeicherten Scope und Resolver bis zum Build-Context-Befund und tatsächlicher Runtime-Lieferung verfolgen. Zweiten Adapter über dieselben Settings-/Inspector-Verträge darstellen, ohne neuen Context-/Settings-Unionfall.

**Fertig wenn:** Ein zweiter Adapter funktioniert über denselben Vertrag ohne Kern-Sonderfall; die bekannte OMP-Einschränkung bleibt erklärbar. **Tests:** `test/mcp-cli.test.mjs`, `test/mcp-config-filter.test.mjs`, `test/mcp-config-merge.test.mjs`, `test/mcp-daemon-ownership.test.mjs`, `test/mcp-agent-context.test.mjs`, `test/agent-runtime-resource-service.test.mjs`.

## AP15 — Deinstallation, Updates und erhaltene Sessions

**Quellen:** AP03/AP05 und S03, S05, S07, S08, S11.

- [ ] AP15.1 Auswirkungsabfrage über Profile, persistierte Generationen, aktive Sessions/Runs und abhängige Plugins implementieren. Eindeutig zählen; historische-only und unbekannte Beziehungen getrennt ausweisen.
- [ ] AP15.2 Web- und CLI-Flow mit Plugin-ID-Texteingabe, Planrevision, Ablaufzeit und erneutem Servercheck umsetzen. Materiale Änderung zwischen Preview und Commit fordert erneute Bestätigung.
- [ ] AP15.3 Retirement sperrt neue abhängige Arbeit; vorhandene Arbeit drainen. Kein implizites Abort, keine automatische Löschung, kein stiller Wechsel auf eine andere Runtime.
- [ ] AP15.4 Fehlende Abhängigkeiten in Session-Liste/Inspector/Composer darstellen; Lesen und historischer Fallback funktionieren. Passende Wiederinstallation repariert Fortsetzbarkeit.
- [ ] AP15.5 Updatepfad mit kompatibler und inkompatibler Revision, unterbrochener Operation, Neustart und nicht sauber beendetem Plugin testen.
- [ ] AP15.6 Session-Tabsets einschließlich Settings-Unteransichten, Plugin-Konfiguration und historische Build-Context-Befunde bei Deinstallation erhalten. Fehlende Views als Platzhalter darstellen, laufende Autosaves/Abonnements korrekt beenden und nach kompatibler Wiederinstallation denselben Zustand wiederherstellen.

**Fertig wenn:** Alle Fälle A17–A21 unten bestehen und kein Uninstall-Pfad Sessiondaten entfernt. **Tests neu:** `test/plugin-system-uninstall.test.mjs`, `test/plugin-system-session-recovery.test.mjs`; bestehende Run-/Session-Persistenztests und headful Bestätigungsflow.

## AP16 — Bestandsmigration und vollständige Pi-Package-Entfernung

**Quellen:** S03–S07, S14, S17–S19, AP00-Fixtures.

- [ ] AP16.1 Dry-run mit exakter Alt-/Neu-Auswahl, Konflikten und Sicherungsreferenz implementieren. Wiederholte Durchführung verändert das Ergebnis nicht.
- [ ] AP16.2 Agent-, Profil-, MCP- und Tab-Daten journalisiert migrieren; Default-, Teilmengen- und User-Ressourcen-Fälle prüfen. Keine automatische Aktivierung zusätzlicher Tools.
- [ ] AP16.3 `src/pi-packages/`, exklusive CLI/API/UI-Pfade, Katalogfelder und reguläre Profilfelder nach erfolgreicher Migration entfernen. Nur ausdrücklich benannter read-only Migrationsleser darf befristet bleiben.
- [ ] AP16.4 Alle tatsächlichen nativen Pi-Extension-Discovery-Pfade ermitteln und innerhalb Pibo unterbinden. Ein negatives Fixture in einem User-/Workspace-Discovery-Verzeichnis darf nicht laufen; derselbe ausdrücklich registrierte Pi-Plugin-Beitrag muss funktionieren.
- [ ] AP16.5 Unbekannte Pakete bleiben gesichert und inaktiv. Es wird kein offizieller exklusiver Pi-Package-Importer gebaut. Dritte können einen über die allgemeinen Plugin-Verträge entwickeln.
- [ ] AP16.6 Pi-Package-Settings, Panel-/Route-Typen, Navigation, Zähler und beide App-Renderzweige entfernen. Feature-Settings, MCP-/Pibo-Native-Kontextoptionen und CLI-Snippets mit ihren alten Werten/Scopes in die Besitzerplugins migrieren.
- [ ] AP16.7 Globales Tab-v1-Format gesichert und idempotent nach PLG-MIG-001 übernehmen. Unklare Ownership nur durch bewusste Zuordnung auflösen; globale `contextPanel`-/Editorstates nicht mehr quer über Sessions teilen. Historische Build-Context-Lücken als unbekannt erhalten.

**Fertig wenn:** Es existiert kein produktiver Pi-Package-Aktivierungspfad mehr. Skills/Kontext und Pi-Harness selbst funktionieren weiter. **Tests:** `test/pi-packages.test.mjs` in explizite Migrations-/Entfernungstests überführen; `test/resources-cli.test.mjs`, `test/profile-cli.test.mjs`, `test/profile-default-compat.test.mjs`; neu `test/plugin-system-migration.test.mjs`.

## AP17 — Übrige Produktkomposition und UI vollständig umstellen

**Quellen:** S01, S08, S09, S16–S19 und AP00-Inventar.

- [ ] AP17.1 Standard-Shell, Terminal-/Workflow-Views, Navigation, Composer und übrige mitgelieferte UI als Manifest-/Provider-Beiträge registrieren. Kein Feature erhält eine privilegierte statische Renderer-Abkürzung.
- [ ] AP17.2 Übrige Dienste und Integrationen wie Preview, Cron, Loops, Workflows, Auth-/Medienprovider nach Ownership-Inventar über denselben Plugin-Host zusammensetzen. Fachlogik erhalten; keine neue Produktfunktion miterledigen.
- [ ] AP17.3 Echte VS-Code-Erweiterung und eigenständige TUI aus Produktcode, Paketexports, Builds, Tests und aktueller Dokumentation entfernen. Gemeinsame Routing-/CLI-Dienste nur entfernen, wenn sie keine verbleibenden Nutzer haben.
- [ ] AP17.4 VS Code Web/code-server aus der Standard-App entfernen; ein späteres Plugin darf es über allgemeine Tab-/API-Verträge wieder anbieten. Für externe TUI-/VS-Code-Clients dokumentierte Session/Event/Command-Verträge erhalten.
- [ ] AP17.5 Alternativen Shell-/Service-Provider als Akzeptanzfixture aktivieren. Wechsel zurück zur Standardzusammenstellung muss über Konfiguration funktionieren, ohne Kernänderung.
- [ ] AP17.6 Context, Settings und Build Context vollständig als mitgelieferte Views über dieselben Plugin-/Session-Tabverträge betreiben. Feste `ContextPanel`-/`SettingsPanel`-Featurefälle ablösen; globale Produktpräferenzen und unabhängige User-Skills/-Kontextdateien erreichbar erhalten. Feature-Settings liegen in den Besitzer-Tabs, zentral allenfalls generische Links.

**Fertig wenn:** Das vollständige Standardprodukt wird deklarativ über Plugins zusammengesetzt. Build-/Typecheck-Skripte benötigen keine entfernten VS-Code-/TUI-Targets. **Tests:** bestehende Web-/Routing-Regressionen, SDK-/Provider-Fixtures und Paketprüfung.

## AP18 — Übergangsbrücken und alte Oberflächen entfernen

- [ ] AP18.1 Alle Altregistrierungen aus AP00 als migriert oder ausdrücklich entfernt markieren. Keine neue Funktion darf den Legacy-Registrar verwenden.
- [ ] AP18.2 Reguläre API-/UI-Felder für direkte Pibo-Tools, Packages und Pi-Packages entfernen. Alte Payload-Versionen werden explizit migriert oder mit Versionsfehler abgewiesen, nicht still ignoriert.
- [ ] AP18.3 Nicht mehr benötigte globale Tool-/Package-Sonderfälle, Aliase, Helper und Imports löschen. Interne Tool-Projektionen bleiben zulässig, wenn sie ausschließlich aus dem Plugin-Plan abgeleitet sind.
- [ ] AP18.4 Öffentliche SDK-Exports, CLI-Hilfe, aktuelle Skills und Dokumentation aktualisieren; historische Quellen bleiben historische Quellen.
- [ ] AP18.5 AP00-Context-/Settings-Inventar vollständig schließen. Keine zurückgelassenen MCP-/Pi-Package-/Pibo-Native-Editoren in Sidebar, Deep Links, zweitem Renderzweig oder API; keine globale v1-Tab-Wahrheit und kein unabhängiger statischer Build-Context-Katalog. Legitime Migrationsleser und User-Ressourcen bleiben ausdrücklich zugeordnet.

**Fertig wenn:** Es gibt einen Installations-, Aktivierungs- und Auswahlweg. Das Inventar hat keinen ungeklärten Eintrag. Explizite User-Ressourcen und Pi Built-ins sind die vorgesehenen Ausnahmen, keine vergessenen Altwege.

## AP19 — Integrierte Abnahme und Handoff

- [ ] AP19.1 Gesamten Kandidaten bauen/typechecken/testen; Paketinhalt, Plugin-Manifeste, Assets und Ressourcen nach Installation außerhalb des Quell-Checkouts prüfen.
- [ ] AP19.2 Headful Standardpfade, Ersatz-Shell, Designer, Tabs, Terminal und Deinstallation mit demselben Kandidaten abnehmen; Konsole/Netzwerk/DOM sowie Scroll/Fokus festhalten.
- [ ] AP19.3 Auf Pibo2 echte portable Tool-Ausführung unter Pi, Codex Native und OMP nachweisen; Pi-only- und MCP-Negativfälle sowie Erhalt nach Deinstallation prüfen. Kein realer GitHub-Schreibvorgang ist für den Test erforderlich.
- [ ] AP19.4 Upgrade von AP00-Fixtures, unterbrochene Migration, Neustart, Wiederinstallation und Rollbackgrenzen dokumentieren.
- [ ] AP19.5 Implementierte Verträge in aktuelle Domain-Spezifikationen übernehmen, Glossar/Guides aktualisieren, diesen Plan erst nach vollständigem Abschluss archivieren.
- [ ] AP19.6 Session-Tabset-Persistenz, Plugin-Settings und vollständigen Build Context nach A29–A37 mit dem integrierten Kandidaten prüfen: zwei Sessions desselben Agents, unterschiedliche Plugin-/Runtime-Pläne, Reload/Neustart, Migration und erhaltene Befunde nach Uninstall.
- [ ] AP19.7 Testdiff und Runner-/Discovery-Diff seit der ursprünglichen Baseline prüfen. Für jede geänderte/entfernte Bestandsprüfung Testname, Grund und erhaltenen/ersetzten Verhaltensnachweis dokumentieren; alle zwölf Handoff-Fehler einzeln klären und bestehenden plus neuen Gesamtumfang ausführen. Keine verdeckte Verringerung der Regressionserfassung.

**Fertig wenn:** Die gesamte Abnahmematrix ist bestanden oder ein konkret verbleibender Punkt verhindert ausdrücklich die Gesamtfreigabe. Ein einzelner Feature-PR oder grüner Healthcheck zählt nicht als Abschluss dieses Plans.

# Abnahmematrix

Jeder Nachweis benennt Commit/Kandidat, Fixture oder Ausgangsdaten, beobachtetes Ergebnis und die Grenze der Aussage. Die folgende Matrix ist ein Mindestumfang; zusätzliche Fälle entstehen nur aus konkreten Risiken oder Fehlern. „Alle Runtimes“ bedeutet Pi, Codex Native und OMP. Unsupported ist ein geprüftes Ergebnis, kein übersprungener Test.

| Fall | Szenario und erwartetes Ergebnis | Verantwortliche Pakete |
|---|---|---|
| A01 | Ungültiges Manifest, doppelte Beitrags-ID, fehlende Pflichtabhängigkeit oder Zyklus: Aktivierung scheitert mit Herkunft und Dependency-Pfad, ohne halbfertige Registrierung. | AP01, AP02 |
| A02 | Aktivierung scheitert nach mehreren Registrierungen: Listener, Tools, Timer und Dienste werden in umgekehrter Reihenfolge freigegeben; wiederholtes Dispose bleibt wirkungslos; ein Cleanup-Fehler verhindert übriges Cleanup nicht. | AP02 |
| A03 | Zwei Provider beanspruchen denselben exklusiven Dienst: explizite Auswahl erforderlich; die konfigurierte Ersetzung funktioniert unabhängig von Importreihenfolge. | AP02, AP17 |
| A04 | Agent deaktiviert die Agent-Seite eines Plugins oder einen optionalen Agent-Beitrag: der Beitrag fehlt in Ressourcen, Tool-Liste und tatsächlicher Ausführung; direkte API-Manipulation umgeht die Auswahl nicht. Pflichtbeitrag lässt sich nicht allein deaktivieren. | AP04, AP06, AP10 |
| A05 | Plugin mit portablem Tool, optionalem Pi-Beitrag und erforderlichem Pi-Beitrag: optionaler Beitrag entfällt erklärt auf den anderen Runtimes; die erforderliche Variante blockiert dort die betreffende Aktivierung. Kein Import von Pi-Code im fremden Adapter. | AP04, AP06 |
| A06 | Ein reales Modell ruft dasselbe harmlose portable Testtool unter allen drei Runtimes auf. Eingabe, Ergebnis, Fehler und Abbruch erreichen die vorhandenen Runtime-Verträge. Keine Simulation als Provider-Nachweis ausgeben. | AP06, AP19 |
| A07 | User-Skill und Kontextdatei ohne Plugin bleiben auswählbar; gleichnamige Plugin-Ressource und User-Ressource haben erkennbare Herkunft, deterministische Reihenfolge und erklärte Konflikte. | AP04, AP10, AP16 |
| A08 | Manueller und pluginbereitgestellter Subagent funktionieren mit eigener Auswahl; ein Kind erhält keine zusätzlichen Beiträge allein wegen Aktivierung im Eltern-Agent. | AP06, AP10, AP13 |
| A09 | Designer zeigt Plugin, Beiträge, Pflichtstatus, Runtime-Grund und wirksame Auswahl. Autosave, Runtime-Wechsel, API-Roundtrip und bestehende Profile verlieren keine Konfiguration. Direkter Pibo-Tool-Katalog und Packages fehlen; Pi Built-ins bleiben. | AP10, AP16, AP18 |
| A10 | GitHub-Demoplugin stellt einen Tab und sessionbezogene Ereignisse bereit. In A geöffnet bleibt der Tab A zugeordnet; Wechsel zu B zeigt Bs eigenes Tabset und Rückwechsel stellt A wieder her. Reload und erneutes Öffnen zeigen nur Ereignisse der jeweiligen Session. Fixture-Ereignisse reichen; keine externen Schreibaktionen. | AP07, AP08 |
| A11 | Mehrere Tabs eines Plugins und Tabs verschiedener Plugins behalten getrennte Instanzzustände innerhalb ihrer Session. Entferntes/deaktiviertes Plugin hinterlässt erklärten Platzhalter samt gespeichertem Zustand; defekter Renderer beeinträchtigt nicht die übrige Shell. | AP07, AP08, AP15 |
| A12 | Terminal-Beitrag rendert live und nach historischem Reload dieselben strukturierten Daten. Fehlender Renderer zeigt lesbaren Fallback. Rehydration führt keine Aktion erneut aus und stört Scroll-Anker nicht. | AP09 |
| A13 | Pre-Tool darf einen Pibo-eigenen Aufruf nach Vertrag verändern/ablehnen; Post-Tool beobachtet Ergebnis/Fehler. Reihenfolge, Timeout, Cancel und Hook-Fehler sind deterministisch. Nicht unterstützte native Harness-Hooks werden nicht als verfügbar gemeldet. | AP06, AP09 |
| A14 | Paste-/Composer-Hook behandelt Texteingabe und Dateien in definierten Phasen. Fokus, Tastatur, IME und vorhandene Uploadpfade bleiben funktionsfähig; ein fehlgeschlagener Hook erzeugt einen sichtbaren, zugeordneten Fehler. | AP09, AP17 |
| A15 | Pibo Run und Goal Control liefern ihre bisherigen Ergebnisse über Plugins; wartende Runs, Kind-Sessions und Zielzustand überstehen Neustart. Plugin-Deaktivierung beendet laufende Arbeit nicht implizit. | AP13, AP15 |
| A16 | CLI-MCP-Plugin übernimmt bestehende Konfiguration. Unterstützte Runtimes erhalten die vereinbarten Beiträge; OMP ohne erforderlichen externen MCP-Vertrag meldet den konkreten Konflikt. Codex-interne Tool-Bridge benötigt keine neue User-MCP-Konfiguration. | AP14 |
| A17 | Deinstallationsvorschau zählt eindeutige Sessions, laufende Arbeit und betroffene Agent-Profile getrennt, mit required/optional/historical/unknown. Falsche Texteingabe, abgelaufener Plan oder veränderte Revision mutieren nichts. | AP15 |
| A18 | Zwischen Vorschau, Bestätigung und Entfernen entsteht ein neuer Verbraucher: serverseitige Revalidierung verhindert einen veralteten Vollzug. Retiring verhindert weitere Aktivierungen und erlaubt vorhandener Arbeit den vereinbarten Abschluss. | AP15 |
| A19 | Deinstallation eines von alten Sessions benötigten Plugins: Sessions, Nachrichten, Toolresultate, Bindings und Plugin-Daten bleiben erhalten. Fehlende erforderliche Abhängigkeit blockiert Fortsetzung erklärt; lesbare Historie und Export funktionieren. | AP15 |
| A20 | Nach Deinstallation wird dieselbe festgehaltene Revision erneut installiert: kompatible Session kann fortgesetzt werden. Andere Version mit inkompatiblem Beitrag reaktiviert sie nicht still. Fehlende optionale/historische Beiträge blockieren nicht pauschal jede Session. | AP15 |
| A21 | Absturz während Staging, Drain, Aktivierungswechsel oder Deinstallation: Journal-Recovery erreicht einen erklärbaren Zustand ohne gelöschte Session und ohne zwei aktive Revisionen. Abbruch von Runs erfordert eine getrennte ausdrückliche Aktion. | AP15 |
| A22 | Plugin-Update fügt Tool/Pflichtbeitrag hinzu: bestehende Agent-Auswahl wächst nicht automatisch; unvereinbare Auswahl wird als Konflikt angezeigt. Bereits gestartete Generation behält ihren Snapshot bis zur sicheren Grenze. | AP04, AP15 |
| A23 | Migration realitätsnaher Altprofile mit nativen Tools, Run-/Goal-Packages, MCP, User-Ressourcen, Feature-Settings, Kontextoptionen und Tabs erhält wirksame Auswahl und Scopes. Wiederholte Migration ist idempotent; Prozessabbruch zwischen beiden Stores ist wiederaufnehmbar. | AP03, AP16 |
| A24 | Alte Pi-Packages sowie implizit entdeckte ausführbare Pi-Erweiterungen werden nicht mehr geladen. Expliziter Pi-Beitrag eines Pibo-Plugins funktioniert. Gewöhnliche Kontextdateien und unabhängige User-Skills bleiben verfügbar. | AP06, AP16 |
| A25 | Installiertes Paket außerhalb des Repositories enthält Manifeste, vorgebaute Browser-Assets, Skills und Kontext. Version und Inhaltsdigest sind nachvollziehbar; defekte Integrität oder inkompatible SDK-Version verhindert Aktivierung. | AP05, AP19 |
| A26 | Alternative Shell und Ersatz eines Produktdienstes werden ausschließlich als Plugins aktiviert. Standard-UI selbst läuft über dieselben Verträge. Recovery funktioniert auch bei defektem Shell-Plugin. | AP17 |
| A27 | Produktpaket, Build, CLI/API und aktive Dokumentation enthalten keine unterstützte Pi-Package-, Capability-Package-, eigenständige TUI- oder VS-Code-Erweiterungsoberfläche. Context/Settings, Sidebars, direkte URLs und beide App-Renderzweige enthalten keine alten Feature-Editoren neben den Plugin-Tabs. Migrationsdiagnostik und historische Berichte bleiben eindeutig erkennbar. | AP16, AP17, AP18 |
| A28 | Bestehender Web-Sessionfluss von Agent-Auswahl bis Stream, Cancel, Reload und Fortsetzung funktioniert mit der finalen Standard-Plugin-Komposition unter allen Runtimes. Lokaler Build und Pibo2 prüfen denselben Kandidaten. | AP19 |
| A29 | Zwei Sessions desselben Agents öffnen verschiedene Tabs/Unteransichten mit anderer Reihenfolge und aktivem Tab. A→B→A, Browser-Reload und Gateway-Neustart stellen jeweils das passende Tabset einschließlich View-Zustand wieder her. Kein Agent-/Room-globaler Tabstore ersetzt die Sessionidentität. | AP03, AP08, AP19 |
| A30 | A aktiviert GitHub, B nicht oder mit nicht unterstütztem Pflichtbeitrag: Öffnen-Menü und Aktionen folgen jeweils dem effektiven Session-Plan. A behält seinen Tab; B übernimmt ihn nicht. Ein bestehender Tab wird nach Deaktivierung zum Platzhalter. Context/Settings bleiben als deklarierte Infrastruktur zugänglich. | AP04, AP08, AP15 |
| A31 | Während A→B wechseln späte Queryantwort, Event, Settings-Autosave und Tab-Persistenzantwort ein. Jede bleibt an A und ihren Konfigurationsscope gebunden; B wird nicht verändert. Zwei Browser schreiben mit Revisionskonflikt statt verlorenen Updates; Deep Link/Back/Forward mit A-ID wechselt zuerst zu A. Ohne ausgewählte Session entsteht kein ungebundener Tab. | AP03, AP07, AP08 |
| A32 | Plugin liefert Einstellungen und Kontextoptionen in seinem Tab. Links aus Designer/Build Context öffnen die richtige Unteransicht derselben Session. MCP-Beschreibung, Toolfilter sowie Pibo-Native-/CLI-Kontextoptionen behalten Werte und Scope; keine zweite Schreiboberfläche bleibt im zentralen Context-/Settings-Bereich. User-Dateien/Skills ohne Plugin funktionieren weiter. | AP08, AP10, AP12, AP13, AP14, AP17 |
| A33 | Build Context erklärt einen gemischten Plan aus zwei Plugins, Pflicht-/Optionalbeiträgen, deaktiviertem Beitrag, purem UI-Beitrag, User-Kontext, progressivem Skill, Subagent und MCP. Reihenfolge, Hydrierung/Deduplizierung, bekannte Hook-Transformation und Delivery werden gegen die tatsächliche Fixture-Lieferung verglichen; kein registrierter Beitrag bleibt ohne Status/Kontextwirkung. | AP04, AP06, AP09, AP11 |
| A34 | Unter Pi, Codex Native und OMP trennt Build Context delivered/degraded/unsupported/failed, bekannte Native-Information und nicht einsehbare Harness-Bestandteile. Noch nicht geladene Skill-Bodies gelten nicht als injiziert. Inspector-Metadaten und redigierte Geheimnisse gelangen nicht in „Modellinhalt kopieren“; geschätzte Tokens sind markiert. | AP06, AP11, AP14, AP19 |
| A35 | Nach Änderung von Plugin-Settings bleibt der gespeicherte Generations-/Build-Stand unverändert; separate Vorschau zeigt Revision/Differenz und spätere wirksame Lieferung. Öffnen, Refresh und Copy führen keine Tools/Schreib-Hooks aus. Nach Deinstallation bleiben Herkunft, Status, Fallback und gesicherter Kontextbefund lesbar. | AP06, AP09, AP11, AP15 |
| A36 | Globale Tab-v1-Daten enthalten einen explizit an A gebundenen Context-Tab und ungebundene Settings-/Feature-Tabs. Migration übernimmt nur belegbare Ownership automatisch; bewusster Import ordnet den Rest einer Session zu. Wiederholung, zweiter Browser und Abbruch erzeugen keine Duplikate oder Überschreibung bestehender Tabsets. Entfernte Pi-Package-URL öffnet keine alte Verwaltung. | AP03, AP08, AP16 |
| A37 | Der vollständige Context-/Settings-Inventarvergleich weist für jeden alten Editor, Kontextschalter, CLI-Snippet und Build-Schritt einen Besitzer, einen Erhaltungs-/Entfernungsnachweis und einen Session-Tabpfad aus. Standard- und Ersatz-Shell erfüllen das; Desktop- und schmale Ansicht, API, Copy/Export und installierter Kandidat enthalten keine statische Parallelwahrheit. | AP11, AP16, AP17, AP18, AP19 |
| A38 | Nur systemweites Plugin wird ohne existierende Session gestartet und nach Neustart wiederhergestellt. Zwei Sessions und deren Ende verändern die Dienstinstanz nicht; der Designer liefert keine Agent-Tools und keinen wirkungslosen Aktivierungsschalter. | AP01, AP02, AP03, AP10, AP11, AP17 |
| A39 | Nur agentbezogenes Plugin funktioniert ohne fachliche Systemaktivierung. A wählt es, B nicht: nur As neue Generation erhält Beiträge; B kann sie auch per manipuliertem Tool-API-Aufruf nicht ausführen. | AP01, AP04, AP06, AP10, AP11 |
| A40 | Gemischtes Plugin ist systemweit aktiv, Agent-Tooling nur für A ausgewählt. System-View und reguläre App-Aktionen sind in A und B verfügbar, Tools/Kontext nur in A. A deaktiviert sein Tooling und beginnt eine neue Generation: der Dienst und Bs App-Nutzung bleiben aktiv. | AP04, AP06, AP08, AP10, AP11, AP13 |
| A41 | Erforderlicher Systemdienst fehlt: Agent-Auswahl scheitert erklärt, ohne Systemaktivierung durch Designer/API. Ein nicht unterstützter Agent-Runtime-Beitrag lässt unabhängige System-Views und Dienste verfügbar. Ein globaler Aktivierungswechsel liefert keine zusätzlichen Agent-Tools. | AP01, AP04, AP06, AP11 |
| A42 | Goal-Systemseite bleibt bei null ausgewählten Goal-Agent-Beiträgen aktiv; Migration und Neustart erhalten dies und getrennte Agent-Auswahlen. Explizite System-Deaktivierung/Update/Uninstall weist laufende Goals, Runs und abhängige Generationen aus, drainiert sicher oder meldet Konflikt; kein impliziter Abbruch oder Datenverlust. | AP03, AP13, AP15, AP16, AP19 |
| A43 | In einer Room wird aus der Sessions-Sidebar und aus dem Agent Designer je eine neue Session erstellt. In beiden Fällen bleibt dieselbe Document-/PWA-Instanz aktiv; die temporäre Zeile und ihr leeres Inline-Rename-Feld erscheinen fokussiert, bevor der Create-POST abgeschlossen ist. Entwurf und Bestätigung überleben die Übergabe an die reale ID; höchstens ein Title-PATCH geht ausschließlich an diese reale ID. Pending-Aktionen sind gesperrt, Create-/Rename-Fehler bleiben recoverbar, und eine während POST oder PATCH gewählte andere Session oder Room bleibt ausgewählt. Nur bei fortbestehender Ownership wechselt die URL per Client-Router zur realen Session-ID; spätere Hydration bleibt auf den Ursprungs-Cache begrenzt. | AP08, AP17, AP19 |
| A44 | In Session A werden zwei echte Workspace-Tabs geöffnet. Ein zustandsbehafteter View behält nach A1→A2→A1 seine Component-Instanz und lokalen Zustand. Refresh von A1 wartet auf dessen registrierten Leave-/Autosave-Guard und einen verzögerten Tabset-Save; bei Erfolg remountet nur A1 und A2 bleibt identisch, bei Fehler bleibt A1 unverändert gemountet. Close von A1 führt seinen Cleanup aus und entfernt ihn dauerhaft. Dasselbe gilt generisch ohne Plugin-ID-/Settings-Sonderfall. | AP07, AP08, AP15, AP19 |
| A45 | Session A besitzt drei Tabs und Tab 2 ist aktiv; die zuvor leere Session B sowie neue Sessions C/D besitzen kein Tabset. Schnelle und um 2,5 Sekunden verzögerte Wechsel auf Desktop und schmalem Viewport dürfen As noch sichtbare aktive Route weder in ein bereits bereites noch in ein verzögert geladenes leeres Zieltabset übernehmen. A→B/C/D→A zeigt nie fremde Tabs, stellt As drei Tabs mit Tab 2 aktiv wieder her und schreibt keine Antwort zu einem fremden Owner. Mit absichtlich vertauscht abgeschlossenen Reads/Saves gilt dieselbe Isolation; ein separat gespeichertes Tabset von B behält entsprechend seine eigene Reihenfolge und aktive Auswahl. Nach einem fehlgeschlagenen Save bleibt der lokale Entwurf beim Besuch von mehr als acht weiteren Sessions im Controller-Cache erhalten; bereinigte Controller dürfen verdrängt werden, Live-Browser-Hosts der verlassenen Sessions jedoch nicht weiterlaufen. Browser-Reload stellt A beziehungsweise B exakt aus PluginStore wieder her; der globale v1-Key wird nicht als Laufzeit-Fallback gelesen oder beschrieben. | AP03, AP08, AP16, AP19 |

## Validierungsstufen und ausführbare Einstiegspunkte

Die folgenden Befehle beschreiben die spätere Implementierungsprüfung im Docker-Worker. Sie sind keine Behauptung, dass dieser Dokumentationsauftrag Code gebaut oder Runtime-Verhalten geprüft hat.

1. Pro Paket: vorhandene Regressionen gemäß PLG-TEST-001 möglichst unverändert über die Plugin-Implementierung ausführen; die oben benannten neuen verhaltensbezogenen Tests ergänzen sie. Neue Tests prüfen Außenverträge und Fehlerszenarien, nicht bloß interne Registry-Arrays.
2. Pro Code-PR: erforderlicher Build/Typecheck und relevante vollständige Tests nach den Pibo-Skills; anschließend passende Pibo2-Prüfung desselben Kandidaten. Ein reiner Backend-PR braucht keinen sachfremden UI-Parcours, aber seinen tatsächlichen integrierten API-/Runtime-Pfad.
3. AP11: vollständiger erster Durchstich, bevor Toolfamilien breit migriert werden.
4. AP19: gesamtes integriertes Produkt, Upgrade und installierter Paketinhalt. Frühere Einzel-PR-Nachweise ersetzen diese Prüfung nicht.

Bestehende Einstiegspunkte am Quellstand:

```bash
npm run typecheck
npm run build
node scripts/run-test-suite.mjs test/plugin-registry.test.mjs test/agent-runtime-resource-service.test.mjs test/runtime-portability.test.mjs
npm test
```

Der gezielte Testaufruf setzt den erforderlichen Build voraus. `npm test` enthält am Ausgangsstand selbst einen Build; Coding-Agents vermeiden unnötige Wiederholungen, sofern die vorgeschriebenen Gates erfüllt sind. AP17 passt bestehende Build-/Typecheck-Skripte an die entfernten VS-Code-Targets an. Neue Tests werden anschließend über denselben Test-Runner ausgeführt; keine ungeschützten produktiven HOME-/Datenpfade verwenden.

Für Browser-Abnahme: headful Browser Use mit authentifiziertem Worker/Pibo2-Zugang, gekoppelt mit DevTools/CDP. Desktop-Flows bei 1440×1000 und breiter Ansicht prüfen; eine schmale Regression bei 390×844 prüft Erreichbarkeit/Fallbacks, legt aber kein neues Mobile-Tab-Konzept fest. Insbesondere Sessionwechsel, Fokus nach Tab-Schließen, Keyboard-Navigation, Terminal-Scrollposition, Composer-Eingabe und Fehlergrenzen belegen. Zwei Sessions desselben Agents und ein Agent mit abweichender Plugin-Auswahl sind Pflichtfixtures: Context, Settings und Plugin-Settings öffnen, Unteransicht ändern, A→B→A wechseln, Browser neu laden, Deep Link öffnen und gespeicherte Kontextbefunde vergleichen. Globale Settings-Wirkung muss trotz sessiongebundenem Tab explizit bleiben. Konsole, Netzwerk und Plugin-ID/Revision müssen bei Fehlern korrelierbar sein.

Für Runtime-Abnahme: pro Adapter die tatsächlich gelieferte Tool-/Ressourcenliste sowie mindestens eine echte harmlose Ausführung prüfen. Plugin-Aktivierung allein ist kein Beleg für Modellzugriff. Keine beliebigen Pre-/Post-Hooks für fremde Harness-Tools zusagen, nur weil eine Pibo-Tool-Fixture funktioniert.

Für Build Context die Inspector-Projektion mit demselben Generations-/Buildstand vergleichen, der an den Adapter ging. Vorschau und tatsächliche Lieferung sind getrennte Testeingaben. Vollständigkeit wird am AP00-Inventar und an registrierten Beitrags-IDs geprüft, nicht daran, ob die bisherige statische Anzeige weiterhin denselben Text rendert. Vorhandene Kontext-/Tabtests bleiben Regressionseinstiege; neue Semantik braucht die Szenarien A29–A37.

Dokumentationsänderungen folgen der OKF-Struktur und den vorhandenen Validatoren:

```bash
npm run docs:indexes:write
npm run docs:validate
npm run docs:validate:okf
npm run docs:validate:migration
npm run docs:indexes:check
npm run docs:log:check
npm run docs:validator:test
```

# Zusammenarbeit und Übergabe zwischen Coding-Agents

Ein Agent übernimmt ein benanntes Arbeitspaket und dessen konkrete Abnahmeszenarien. Er gleicht vor Beginn Pfade und Verträge mit aktuellem `upstream/dev` ab. Ein Fortschrittsvermerk nennt Status, Branch/Commit, erfüllte Unterpunkte, Nachweise und verbleibende Abhängigkeiten. Statuswerte: offen, in Arbeit, blockiert mit Ursache, abgenommen.

**Mögliche Parallelisierung:** Nach AP01 können Host (AP02) und Datenmodell (AP03) parallel entstehen. Der Browser-Host AP07 benötigt zusätzlich AP02. AP08 wartet auch auf Session-Tabpersistenz aus AP03 und Verfügbarkeitsauflösung aus AP04. AP08/AP09/AP10 können danach anhand ihrer Voraussetzungen getrennt bearbeitet werden, stimmen aber SDK, Auswahlmodell und Revisionen ab. AP12–AP14 beginnen erst nach bestandenem AP11 einschließlich Settings-/Build-Context-Durchstich. Die finale Migration wartet auf AP15; Altwege werden erst nach Ersatz und Migration entfernt.

Für gemeinsam genutzte Verträge gibt es jeweils einen verantwortlichen Agent: Manifest/SDK in AP01, Host-Lifecycle in AP02, Schema/Journal in AP03, Resolver in AP04 und Browser-Vertrag in AP07. Andere Pakete schlagen Änderungen dort vor und integrieren den abgestimmten Commit. Keine parallel erfundenen Manifestfelder, Runtime-Namen oder Persistenzmodelle. Datenbankmigrationen erhalten nach Integration eindeutige Reihenfolge; Konflikte werden nicht durch bloßes Umnummerieren ohne Fixture-Prüfung gelöst.

Kontextaufbau-Befunde gehören AP06, deren generische UI AP11 und der Session-Tab-/Settings-Host AP08. AP12–AP14 liefern ihre fachlichen Views/Befunde über diese Verträge. AP16 besitzt die Altdatenmigration, AP17 die verbleibende Produktkomposition; Änderungen an denselben Context-/Settings-/App-Dateien werden sequenziell integriert. Es gibt keinen separaten „Build-Context-Resolver“ pro Feature.

Jede Übergabe enthält:

- Erreichtes Verhalten und welche AP-/A-IDs es erfüllt.
- Commit und verwendeten Ausgangsstand; nötige Vorläufer-Commits.
- Neue/geänderte öffentliche Verträge und Migrationswirkung.
- Ausgeführte Prüfungen mit Ergebnis und Artefaktpfaden; ausgelassene Gates mit konkretem Grund.
- Offene Fehler, Rollbackgrenze und nächsten ausführbaren Schritt.

Ein Agent erweitert den Umfang nicht nebenbei um Marketplace, neue MCP-Protokolle, Mobile-Neudesign oder Harness-Forks. Entdeckt er eine bisher unbekannte produktive Erweiterungsfläche, ergänzt er AP00 und ordnet sie einem Paket zu. Er erklärt sie nicht still zum „Core“, um das Plugin-Ziel zu umgehen.

## Technische Entscheidungen während der Umsetzung

Die Produktentscheidungen oben werden nicht wieder geöffnet. Folgende Implementierungsentscheidungen dürfen die zuständigen Pakete anhand eines kleinen Prototyps und konkreter Tests treffen:

| Entscheidung | Verantwortlich | Entscheidungskriterium |
|---|---|---|
| Exakte SDK-Typen, Manifestversion und Ablage der Beiträge | AP01 | Manifest ohne Codeausführung prüfbar; stabile IDs; getrennte Browser-/Backend-Einstiege; keine Runtime-Imports im gemeinsamen Vertrag. |
| Scope-API, synchrones/asynchrones Cleanup und Fehleraggregation | AP02 | Deterministische Ownership, idempotentes Dispose, nachvollziehbare Fehler und Recovery. |
| Speicheraufteilung, Transaktions-/Journal-Protokoll | AP03 | Bestehende getrennte Stores bleiben konsistent und nach Prozessabbruch reparierbar. |
| Browser-Bundling, Asset-Routen, React-Abhängigkeitsvertrag | AP07 | Installierbares vorgebautes UI, passende Revision, dokumentierte Framework-Kompatibilität, keine doppelten inkompatiblen React-Instanzen. |
| Tabset-Schema, Konfliktbehandlung und Detailzustandsmigration | AP03, AP08 | Feste Session-Ownership; produktpersistierte Tabsets; kein Verlust bei A→B→A, konkurrierenden Browsern oder v1-Import. |
| Kontextbefund-Schema, Payload-Verweise und tatsächlicher/vorgeschauter Stand | AP01, AP06, AP11 | Vollständige Provenienz aller Beiträge, Side-effect-freie Inspektion, erkennbare Harness-Grenzen und begrenzte Inhaltsladung. |
| Welche konkreten Dienste eine bewiesene Drain-Grenze besitzen | AP15 | Keine Referenzen aktiver Verbraucher auf entladenen Code. Wenn nicht beweisbar: kontrollierter Neustart mit vorgeschaltetem Drain. |
| Exakte Aufteilung übriger Built-ins | AP12, AP17 | Zusammenhängende Nutzerfunktion, verständliche Pflichtteile, keine Feature-Sonderregistrierung und keine künstlichen Kleinstplugins. |

Neue Produktentscheidung ist nur nötig, wenn die Untersuchung einen tatsächlichen Widerspruch zur gewünschten Funktion zeigt, etwa wenn ein Harness eine erforderliche Kontrolle nicht ermöglicht. Dann konkrete Fähigkeit, betroffene Runtime, beobachtete Grenze und Optionen vorlegen. Fehlende Unterstützung nicht durch irreführendes „best effort“ verdecken.

# Risiken, Migration und Rückkehrpfad

**Größtes Risiko: zwei Systeme bleiben dauerhaft bestehen.** Übergangsprojektionen erhalten klare Besitzer und werden in AP18 entfernt. Datenmigration darf Altwerte lesen; produktive Aktivierung darf am Ende nur den gemeinsamen Resolver verwenden.

**Zweites Risiko: Auswahl und Ausführung driften auseinander.** Ein unveränderlicher Aktivierungsplan mit Herkunft und Revision verbindet Designer, Runtime, UI und Lifecycle. Debug-Ausgabe muss erklären können, warum ein Beitrag ausgewählt, ausgeschlossen oder blockiert ist, ohne Geheimnisse aus Plugin-Konfigurationen auszugeben.

**Drittes Risiko: vollständige Austauschbarkeit erzeugt Zyklen.** Der Kernel enthält nur Bootstrap, Host-/Vertragsmechanik und Recovery. Produktfeatures hängen über deklarierte Dienste zusammen; ein Plugin darf nicht seinen eigenen Installer benötigen, bevor Recovery möglich ist. AP00/AP02 prüfen diesen Graphen vor der flächigen Extraktion.

**Viertes Risiko: ein Paketwechsel beschädigt vorhandene Historie.** Sessions und fachliche Daten gehören der Persistenz, nicht der Lebensdauer eines Plugin-Objekts. Historische Renderer und Tools erhalten Fallbacks; ihre Nichtverfügbarkeit ist keine Löschbegründung. Ein späteres separates Datenlöschkonzept ist nicht Bestandteil dieses Umbaus.

**Fünftes Risiko: globale UI-Zustände umgehen die Sessiongrenze.** Tab-Ownership, Settingsscope und Plugin-Auswahl werden getrennt gespeichert, aber über feste IDs verbunden. Die alten `contextPanel`-/Editorstates und globale Tab-Deduplizierung dürfen nicht im neuen Host fortleben. Delayed Saves und Deep Links sind ausdrücklich Teil der Isolationstests.

**Sechstes Risiko: Build Context wird zum plausiblen, aber falschen Kontextabbild.** Der Inspector liest den tatsächlichen Aufbau und markiert nicht einsehbare Teile. Er führt keine fremden Effekte erneut aus und vermischt weder neue Defaults mit historischen Generationen noch Tool-/Diagnosemetadaten mit gesendetem Prompttext.

**Rückkehrpfad:** Vor der ersten persistierenden Migration werden beide relevanten Stores und zugehörige Dateidaten konsistent gesichert. Additive Schemas und ein Migrationsjournal ermöglichen Wiederaufnahme. Ein Code-Rollback ist nur zulässig, wenn der alte Stand das neue Schema nachweislich lesen darf; andernfalls erfolgt Restore in einer kontrollierten Umgebung. Ein Restore darf seit dem Backup hinzugekommene Sessions nicht still verlieren. Ein Plugin-Rollback aktiviert eine festgehaltene kompatible Revision erst an derselben sicheren Grenze wie ein Update. Keine automatische Versionsrückstufung einer laufenden Generation.

Falls Migration oder Aktivierung scheitert, bleiben vorheriger Installationsstand und Rohkonfiguration diagnostizierbar. Die App/CLI erklärt den Zustand und bietet Wiederholung oder Wiederherstellung; sie weicht nicht heimlich auf Pi-Packages, einen anderen Agent oder eine andere Runtime aus.

# Definition des abgeschlossenen Umbaus

Der Umbau ist erst abgeschlossen, wenn alle AP00–AP19 abgenommen sind, A01–A42 belegt sind, keine produktive alte Erweiterungsfläche einschließlich Context/Settings im Inventar offen bleibt und die aktuelle Dokumentation das tatsächlich implementierte System beschreibt. Das Standardprodukt entsteht durch dieselben Plugin-Verträge wie Drittanbieterfunktionen. Alle Desktop-Tabs werden pro Session wiederhergestellt, Plugin-Settings/Kontextoptionen liegen im Besitzer-Tab und Build Context erklärt die gesamte Pibo-kontrollierte Zusammensetzung. Agent-Designer, unabhängige User-Ressourcen und manuelle Subagents bleiben nutzbar; Sessions bleiben nach Deinstallation erhalten.

Dieser Plan selbst verändert keine Runtime und enthält keine bereits erfüllten Implementierungszusagen. Geschätzte Kalendertermine werden erst nach AP00/AP11 anhand des tatsächlichen Umfangs festgelegt; die Abhängigkeitsreihenfolge ist die Grundlage für die Agent-Zuteilung.

[^owner-decisions]: Produktvorgaben im zugehörigen Gespräch bis 2026-09-11: Plugin-Komposition einschließlich Built-ins, vertrauensbasierte vollständige Austauschbarkeit, Designer-/Ressourcenerhalt, Runtime-Unterstützung pro Beitrag, Entfernung der alten Erweiterungssysteme, Sessionerhalt bei Deinstallation sowie die anschließende Präzisierung zu plugin-eigenen Settings/Kontextoptionen, vollständigem Build Context und persistierten Desktop-Tabsets pro Session.
[^planning-direction]: Nachfolgende Architekturabwägung zum [ersten Bericht](/reports/cordis-plugin-architecture-feasibility-2026-09-11.md): eigenes Pibo-System entlang der benötigten Cordis-Prinzipien weiterentwickeln. Dies ist die technische Arbeitsgrundlage dieses angeforderten Plans, keine Behauptung einer bereits erfolgten Implementierung.
[^code-baseline]: Bestehende Pfade und Testeinstiege wurden am [Pibo-Commit cac4dcd](https://github.com/Pascapone/pibo/tree/cac4dcd03945b9754db7be9ab2ab4324f10c335c) geprüft. Die Quellkarte benennt vorhandene Eingriffspunkte; neue SDK-/Testnamen im Plan sind ausdrücklich Zielentwürfe.

[^activation-scopes]: Produktpräzisierung des Auftraggebers vom 2026-09-12: Plugins dürfen ausschließlich agentbezogen, ausschließlich systembezogen oder gemischt sein; beim Goal-/Goal-Loop-Beispiel bleibt die App-Funktion systemweit aktiv, während das Tooling pro Agent konfiguriert wird.

[^test-preservation]: Der Auftraggeber präzisierte am 2026-09-12: vorhandene Tests möglichst unangetastet lassen und nach dem Plugin-Umbau nutzen, um gleiches Pibo-Verhalten nachzuweisen; neue Tests sind ergänzend und gelegentliche notwendige Anpassungen bestehender Tests begründungspflichtig.

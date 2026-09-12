---
type: "Investigation Report"
title: "Pibo auf Cordis: Machbarkeit, Plugin-Zielmodell und Migrationsanalyse"
description: "Untersucht Cordis und DeepSeek Harness als Grundlage eines einheitlichen Pibo-Plugin-Systems für Backend, drei Agent Runtimes, Web-Tabs und Terminal-Beiträge."
tags: ["architecture", "plugins", "cordis", "runtime", "web", "migration"]
status: "draft"
authority: "informative"
generated:
  by: "openai-codex/gpt-6"
  at: "2026-09-11T19:12:22Z"
sources:
  - id: "pibo-baseline"
    resource: "https://github.com/Pascapone/pibo/tree/cac4dcd03945b9754db7be9ab2ab4324f10c335c"
    title: "Pibo upstream/dev, geprüfter Quellstand"
  - id: "previous-report"
    resource: "scope:controller checkout /root/code/pibo/docs/reports/pibo-extension-systems-current-state-2026-09-10.md; uncommitted investigation input"
    title: "Vorherige Ist-Analyse als Rechercheausgangspunkt, nicht aktuelle Code-Autorität"
  - id: "cordis-source"
    resource: "https://github.com/cordiverse/cordis/tree/f8ea3cd50f1a5724e8e715995bcde131c9c12b2c"
    title: "Cordis, lokal geklonter und geprüfter Quellstand"
  - id: "cordis-paper"
    resource: "https://arxiv.org/abs/2608.25512v1"
    title: "A Programming Paradigm for Spatiotemporal Composability"
  - id: "deepseek-source"
    resource: "https://github.com/deepseek-ai/deepseek-harness/tree/c291e7961a515f6d7af9304e7fd1d257929aef26"
    title: "DeepSeek Harness, lokal geklonter und geprüfter Quellstand"
---

# Ergebnis und Lesepfad

**Fortschreibung nach den Produktentscheidungen vom 2026-09-11:** Der [detaillierte Umbauplan](/plans/unified-plugin-system-rebuild.md) verwendet als technische Arbeitsgrundlage ein weiterentwickeltes eigenes Pibo-Plugin-System, inspiriert von Cordis, ohne Cordis als Abhängigkeit. Er konkretisiert außerdem vollständig austauschbare mitgelieferte UI/Dienste, unabhängige User-Skills/Kontextdateien und den Erhalt von Sessions bei Deinstallation. Seine Zielentscheidungen gehen den ursprünglichen Empfehlungen dieses ersten Berichts vor. Die folgenden Quellbefunde und der ursprüngliche Vergleich bleiben als Forschungsstand erhalten; sie beschreiben keine bereits implementierte Umstellung.

**Eine vollständige Umstellung der Pibo-Erweiterungsarchitektur auf Cordis ist technisch plausibel und für das gewünschte Produkt sinnvoll.** Cordis kann die gemeinsame Grundlage für Plugin-Komposition, Dienstabhängigkeiten und Lifecycle werden. Die größten Arbeiten liegen in Pibos Eigentums- und Lebensdauergrenzen, der Web-Integration und der Migration bestehender Konfiguration. Der Austausch einer Registry allein erreicht das Ziel nicht.

Empfohlen wird ein **einziger Pibo-Plugin-Vertrag auf Cordis**. Ein Plugin kann Backend-Dienste, Tools, Skills, Kontext, Runtime-Integrationen, Web-Tabs und Terminal-Renderer bündeln. Auch mitgelieferte Produktfunktionen werden über diesen Vertrag aktiviert. Pi-Packages und eigenständige Capability Packages entfallen als Erweiterungsmodelle. Der Begriff einer Runtime-Fähigkeit bleibt als technische Kompatibilitätsbeschreibung erhalten.

Ein Plugin darf nur Pi unterstützen. Ein anderes darf alle drei Runtimes unterstützen, mit gemeinsamen portablen Beiträgen oder getrennten Implementierungen. Eine runtimeunabhängige Oberfläche kann verfügbar bleiben, obwohl einzelne Agent-Funktionen nicht unterstützt werden. Cordis hebt die Grenzen der Harness-Protokolle nicht auf.

Die wesentlichen Empfehlungen:

1. Cordis übernimmt Komposition und Lifecycle; Pibo stellt typisierte Produktdienste bereit.
2. Backend und Browser besitzen getrennte Cordis-Kontexte unter derselben Plugin-Identität.
3. Die Web-App erhält eine allgemeine Tab-Registry und gezielte Terminal-Slots.
4. Pibo Run wird ein Plugin mit Dienst, Tools und UI; seine dauerhaften Daten behalten ihre fachliche Bedeutung.
5. Plugin-Auswahl, Runtime-Kompatibilität und tatsächlich gelieferte Beiträge werden getrennt ausgewiesen.
6. Der erste Durchstich verwendet Web Annotations und einen kleinen Demonstrationsbeitrag für die Terminal View.
7. Produktives Entladen während laufender Sessions wird zunächst begrenzt; kontrolliertes Drain und klare Generationsgrenzen kommen vor beliebigem Hot-Reload.

Dieser erste Bericht ist **informative Forschung und ein Architekturvorschlag**. Er ist keine implementierte Spezifikation und keine fertige Aufwandsschätzung. Für einen schnellen Einstieg reichen Ergebnis, Zielmodell, Web-Integration und Migrationsetappen. Die übrigen Abschnitte erläutern Quellen, Grenzen und Prüfbedarf.

# Auftrag, Produktscope und Untersuchungsmethode

Untersucht wird die gewünschte Konsolidierung: Plugins sind der einzige Weg, Pibo zu erweitern. Das umfasst Funktionalität und passende UI. Pi, Codex Native und OMP bleiben Agent Runtimes. Pi-Packages verschwinden aus dem Pibo-Produkt. Pibo Run und ähnliche Pakete werden normale Plugin-Beiträge.

Die **Terminal View** wird als bestehende browserbasierte Session-Darstellung verstanden. Sie ist heute eine React-Ansicht über normalisierter Pibo-Historie. Eine eigenständige TUI und eine eigene VS-Code-Erweiterung bleiben entsprechend der vorausgegangenen Produktvorgabe außerhalb des Zielprodukts. Die Operator-CLI bleibt erforderlich. Eine code-server-Einbettung ist von der echten VS-Code-Erweiterung zu unterscheiden; auch sie soll keine privilegierte Kernintegration mehr benötigen.

## Reproduzierbare Ausgangsstände

| Projekt | Lokaler Checkout | Geprüfter Commit | Einordnung |
|---|---|---|---|
| Pibo | `/root/code/pibo-cordis-analysis` | `cac4dcd03945b9754db7be9ab2ab4324f10c335c` | Separater Worktree auf abgerufenem `upstream/dev` |
| Cordis | `/root/code/cordis` | `f8ea3cd50f1a5724e8e715995bcde131c9c12b2c` | Angeforderter Clone, Tiefe 1 |
| DeepSeek Harness | `/root/code/deepseek-harness` | `c291e7961a515f6d7af9304e7fd1d257929aef26` | Angeforderter Clone, Tiefe 1 |
| Paper | arXiv `2608.25512v1` | Eingereicht 26.08.2026 | Abstract sowie ausgewählte Implementierungs- und Diskussionsabschnitte |

Der Haupt-Checkout `/root/code/pibo` steht auf `2cd45f171ca615c11927a8719819aff05f20e1fd` und enthält nicht eingecheckte Dokumentationsarbeit. Er wurde nicht als aktueller Implementierungsstand behandelt. Der vorherige Bericht war ein Ausgangspunkt; aktuelle Aussagen wurden anhand des Analyse-Worktrees geprüft. Versionsfelder im Pibo-Entwicklungszweig werden nicht als Release-Nachweis verwendet.[^pibo-baseline][^previous-report]

Ein Researcher hat repräsentative Quellstellen in den drei Checkouts ermittelt. Danach wurden zentrale Verträge direkt gelesen: Cordis Context, Service, Registry, Effects und Events; DeepSeek Browser-Boot, Slot-Typen, Layout-Registrierung und Plugin-Metadaten; Pibo Plugin-API, Capability-Katalog, Runtime-Deskriptoren, Pi-Package-Übergang, Desktop-Tabs und Session-Views. Die vollständigen Repositories wurden nicht auditiert. Externe Anwendungen wurden weder installiert noch gestartet; es gibt keine Performance-Messung oder Funktionsvalidierung eines Cordis-basierten Pibo.

# Was Cordis tatsächlich beiträgt

## Einordnung des Papers

Das Paper unterscheidet zeitliche Komponierbarkeit, also das Zurücknehmen komponenteneigener Effekte, und räumliche Komponierbarkeit, also die reaktive Verwaltung von Abhängigkeiten. Ein gemeinsamer Kontext vermittelt beide Seiten. Abschnitt 5 trennt Core, Loader und darauf aufbauende Anwendungsframeworks. Abschnitt 6.5 behandelt zyklische Abhängigkeiten und die Zerlegung von Integrationen. Für Pibo folgt daraus eine Orientierung für Lifecycle und Dienste, kein fertiges Web- oder Agent-Framework. Die formalen Ergebnisse ersetzen keine Prüfung unserer Ressourcenadapter und Fehlerpfade. Insbesondere wurde die mathematische Beweisführung hier nicht vollständig nachvollzogen.[^cordis-paper]

## Beobachtete Mechanismen im Code

| Cordis-Mechanismus | Beleg im geklonten Cordis | Bedeutung für Pibo |
|---|---|---|
| Kontext und vermittelte Dienstauflösung | `packages/core/src/context.ts:36`, `reflect.ts:58` | Plugin-Code erhält Dienste über einen definierten Kontext. |
| Dienste als eigene Beiträge | `packages/core/src/service.ts:18`, `reflect.ts:177` | Ein Plugin kann einen Dienst bereitstellen, andere können ihn deklarativ benötigen. |
| Plugin-Formen und Dependency-Deklarationen | `packages/core/src/registry.ts:63` | Funktion, Klasse oder Objekt mit `apply`; deklarierte `inject`-/`provide`-Beiträge. |
| Effektgebundenes Aufräumen | `packages/core/src/fiber.ts:275` | Disposer und asynchrone Effekte werden gesammelt; Aufräumen erfolgt in umgekehrter Reihenfolge. |
| Reaktion auf geänderte Dependencies | `packages/core/src/fiber.ts:385` | Instanzen können abhängig von verfügbaren Providern geladen und entladen werden. |
| Service-Isolation und Konfigurations-Interception | `packages/core/src/context.ts:65` | Abgeleitete Kontexte können unterschiedliche Dienstbindungen erhalten. |
| Ereignisse mit mehreren Dispatch-Formen | `packages/core/src/events.ts:14` | Beobachtung, parallele oder serielle Verarbeitung; konkrete Hook-Semantik bleibt eine Domänenentscheidung. |
| Deklarative Modulaktivierung | `packages/loader/src/config/entry.ts:146`, `tree.ts:131` | Importierte Module werden als Plugin-Instanzen aktiviert. |

Diese Mechanismen passen zu Pibos Bedarf. Beispielsweise kann ein GitHub-Plugin einen Dienst bereitstellen; Tool-Beiträge und UI-Integration hängen von diesem Dienst beziehungsweise von seiner Browser-Projektion ab. Listener, Routen und Registrierungen müssen dabei über effektgebundene Pibo-Dienste angelegt werden. Ein beliebiges `Map.set()` oder ein außerhalb des Kontexts gestarteter Prozess wird durch den Austausch des Frameworks nicht automatisch korrekt verwaltet.[^cordis-source]

Wichtig ist die Unterscheidung zwischen **Plugin-Modul**, **installiertem Pibo-Plugin** und **aktiver Instanz**. Cordis normalisiert Plugin-Callbacks und verwaltet Fibers. Pibo benötigt darüber eine stabile Produkt-ID, Version, Konfiguration und Herkunft. Eine Callback-Identität ersetzt keine installierbare Plugin-Identität.

## Grenzen, die Pibo selbst lösen muss

Cordis liefert in den geprüften Kernverträgen keinen Pibo-Tab, keinen Agent-Tool-Vertrag, keine Session-Historie und keinen installationsfertigen Pibo-Plugin-Katalog. Pibo muss diese Domänendienste implementieren und deren Registrierungen an Cordis binden.

Die Isolation von Service-Bindungen ist außerdem **keine Prozess- oder Sicherheits-Sandbox**. Vertrauenswürdiger Plugin-Code im selben Node-Prozess kann weiterhin auf dessen Ressourcen zugreifen. Ebenso macht ein Browser-Kontext aus fremdem JavaScript keinen isolierten UI-Prozess.

Auch `intercept()` darf nicht mit einem universellen Pre-Tool-Hook verwechselt werden: Die geprüfte Methode beeinflusst Service-Konfiguration. Ein Tool-Interception-Vertrag braucht einen tatsächlichen Aufruf in der Tool-Ausführung und klar definierte Rückgabewerte.

## Versionsentscheidung vor einer Umsetzung

Der Cordis-Checkout enthält `cordis` **4.0.0-rc.10** und `@cordisjs/plugin-loader` **1.0.0-rc.7**. Das README nennt die API ausdrücklich instabil. DeepSeek Harness verwendet dagegen die vendorte Variante **`@deepseek-ai/cordis` 4.0.2** und passende Pakete unter eigenem Scope. Das sind keine automatisch austauschbaren Abhängigkeiten. Das vendorte README enthält sogar Beispiele mit ungescopten Imports; für eine Übernahme sind tatsächliche Paketmetadaten und Implementierung maßgeblich.[^cordis-source][^deepseek-source]

**Vorschlag:** Die angeforderte upstream-Cordis-Linie als erste Kandidatin prüfen und exakt pinnen. Ein kleiner `pibo`-SDK-Einstieg exportiert den gewählten Cordis-Kontext und Pibos Diensttypen. Er soll keine zweite Dependency-Engine bauen, sondern die Versions- und Importgrenze zusammenhalten. Falls zwingende Funktionen nur in DeepSeeks Variante funktionieren, folgt daraus eine explizite Variantenentscheidung mit nachvollziehbarer Begründung. Beide Varianten gleichzeitig im Plugin-Graphen zu mischen ist kein geeignetes Ziel.

# Was wir aus DeepSeek Harness übernehmen können

## Backend und Browser verwenden dasselbe Kompositionsprinzip

Der untersuchte DeepSeek-Stand setzt das Plugin-Prinzip tatsächlich bis in die Oberfläche um. Der Host ermittelt Client-Module aus aktiven Loader-Einträgen und `dsh.client`-Metadaten. Der Browser erstellt einen eigenen Cordis-Root, aktiviert den Loader, erzeugt Manifest-Einträge und prüft, ob sie aktiv geworden sind. Anschließend wird die Anwendung gemountet. Das ist mehr als eine Backend-Registry mit fest importierten React-Seiten.[^deepseek-source]

Besonders aussagekräftige Stellen:

- `packages/client/modules/src/index.ts`: Host-seitiger Client-Modulkatalog und Boot-Informationen.
- `packages/client/modules/src/client/manifest.ts`: getrennte Modul- und Plugin-Beschreibungen.
- `packages/client/web/src/boot-client.ts:35`: Loader-Aktivierung, Erstellen der Einträge, Warten und Aktivitätsprüfung.
- `packages/client/web/src/boot.ts:40`: Browser-Root, Boot und Mount.
- `packages/bundle/web-app/cordis.patch.yml`: deklarative Zusammensetzung aus Host- und Browser-Modulen.

Für Pibo ist vor allem die **gemeinsame Plugin-Identität bei getrennten Ausführungsorten** übertragbar. Ein Backend-Objekt oder React-Element wird nicht über die Netzwerkgrenze übertragen. Übertragen werden Modulbeschreibungen, Zustände und Daten; beide Seiten aktivieren ihren eigenen Code.

## Das UI-Slot-System ist zusätzliche Anwendungsarchitektur

DeepSeek ergänzt Cordis um Slots mit den Kardinalitäten `single`, `list`, `keyed` und `chain` sowie den Kontexten `root`, `session-maybe` und `session`. Ein Besitzer deklariert seine Child-Slots. Registrierungen leben mit ihrem aufrufenden Plugin-Fiber und ihren Deklarationen. Renderer übernehmen Dispatch, Kontextbindung und Error Boundaries.

Die Layout-Implementierung registriert `AppFrame` im Root-Slot und deklariert Sidebar, Hauptbereich, rechten Bereich und Overlay. Das Chat-Plugin registriert weitere Conversation- und Node-Beiträge. Damit ist der im Auftrag gewünschte Zusammenhang zwischen Funktion und UI an einem realen Projekt belegbar.[^deepseek-source]

**Übertragbare Prinzipien:** deklarierte UI-Flächen, klarer Besitzer, definierter Datenkontext, begrenzte Render-Berechtigung, Lifecycle-Cleanup und Fehlerbegrenzung pro Beitrag.

**Nicht blind übernehmen:** DeepSeeks gesamte Slot-Typenwelt, Boot-Bundler und Session-Stores. Diese hängen an seiner eigenen Architektur. Das geprüfte Renderer-Paket deklariert React 18; Pibo verwendet React 19.2.5. Ein direktes Einhängen wäre daher schon auf Dependency-Ebene gesondert zu prüfen. Eine Pibo-eigene kleine Slot-Schicht ist voraussichtlich verständlicher als das Importieren des vollständigen DeepSeek-Frontends.

DeepSeek-Hooks wie `agent/pre-step` sind Beispiele aus dessen eigener Agent-Loop. Sie sind kein Beleg, dass Pibo denselben Eingriff in einem externen Codex- oder OMP-Prozess erhält. Cordis zu übernehmen erfordert auch nicht, Pibos drei Harnesses durch DeepSeek Harness zu ersetzen.

# Aktuelle Pibo-Architektur und Umbaugrenzen

## Bestehende Stärken

Pibo hat bereits runtimeunabhängige Session-Identitäten, Adapter, normalisierte Ausgaben, portable Tool-Verträge, Ressourcenlieferung und Delivery Reports. Diese fachlichen Verträge sind wertvoll und sollten unter Cordis weiterverwendet werden. Die Umstellung betrifft zunächst ihre Komposition und Eigentümerschaft, nicht ihre vollständige Neuerfindung.[^pibo-baseline]

Die Registry kann bereits viele zusammengehörige Beiträge bündeln: Tools, Skills, Kontext, Profile, Subagents, Gateway-Aktionen, Channels, Web-Apps, Runtime-Driver und weitere Dienste. Web Annotations liefert beispielsweise Tools, Skill und API in einem Plugin.

## Heutige Brüche

| Bereich | Beobachteter Ist-Zustand | Erforderliche Veränderung |
|---|---|---|
| Plugin-Einstieg | `register(api): void`, getrennte Maps in `PiboPluginRegistry` | Cordis-Aktivierung mit eindeutiger Ownership und rücknehmbaren Registrierungen |
| Produktkomposition | Überwiegend explizit importierte Plugin-Zusammenstellung | Deklarative Standardzusammenstellung plus allgemeiner Plugin-Loader |
| Capability Packages | Eigener Katalog; Run und Goal werden fest hinzugefügt | Plugin-eigene Beiträge und Auswahlgruppen ohne eigenes Paketmodell |
| Pi-Packages | Eigener Store, Installation, Profilreferenzen und Pi-Loader-Seam | Entfernen und explizite Überführung geeigneter Inhalte |
| Web-App-Registrierung | HTTP-/WebSocket-Anwendung mit Mount- und API-Präfix | Beibehalten als Host-Dienst, zusätzlich Client-Module und UI-Beiträge |
| Desktop-Tabs | Feste Target-Union, Titel und bekannte Session-Tools | Generische Plugin-Ziele, registrierte Metadaten und View-Auflösung |
| Terminal/Session-Views | `terminal` und `workflow` aus statischer Registry | Registrierte Session-Views und kleinere Beiträge innerhalb der Terminal View |
| Runtime-Abhängigkeiten | Gute Capability-Matrix, teilweise Sonderverdrahtung | Plugin-Beiträge über denselben Auswahl- und Lieferpfad |

Belege: `src/plugins/types.ts:254`, `src/plugins/registry.ts:199` und `:684`, `src/pi-packages/runtime.ts:13`, `src/apps/chat-ui/src/desktop-tabs-model.ts:10`, `src/apps/chat-ui/src/session-views/registry.tsx:17`.

Im aktuellen Tab-Modell gibt es fünf feste Session-Tools und ein Limit von 24 Tabs. Inaktive Mounts werden heute für bestimmte bekannte Ziele besonders behandelt. Ein Plugin-System muss diese vorhandenen Bedienungs- und Ressourcenregeln generalisieren; ein zusätzlicher String in der Union wäre weiterhin eine Kernänderung pro Feature.

Die Terminal View verwendet Compact-Rows und Virtuoso. Sie verarbeitet unter anderem Tools, Reasoning, Compaction und Delegation sowie verschiedene Session-Aktionen. Sie ist deshalb kein frei austauschbares HTML-Feld. Streaming, stabile Row-Identität und Scroll-Verhalten sind bestehende Produktverträge.

# Vorgeschlagenes Zielmodell

Alle Namen und Strukturen in diesem Abschnitt sind Vorschläge, keine existierenden neuen APIs.

## Eine Erweiterungseinheit, mehrere Beitragsarten

Ein Pibo-Plugin ist eine versionierte installierbare Einheit. Es besitzt eine ID, deklarierte Abhängigkeiten und optional mehrere Einstiegspunkte. Beiträge können unabhängig voneinander bedingte Voraussetzungen haben.

```text
Pibo-Bootstrap
  └─ Cordis + Loader + deklarierte Standardzusammenstellung
      ├─ Infrastruktur-Plugins: Daten, Auth, Routing, Ereignisse
      ├─ Runtime-Plugins: Pi, Codex Native, OMP
      ├─ Produkt-Plugins: Run, Goals, Subagents, Annotations, ...
      └─ Web-Host-Plugin
          └─ versionierter Client-Katalog
              └─ Browser-Cordis-Root
                  ├─ Web-Shell und Navigation
                  ├─ Terminal-View und Standard-Renderer
                  └─ Plugin-Tabs, Renderer und Aktionen
```

Der Bootstrap darf klein und fest sein: Prozessstart, Laden der Konfiguration, Erzeugen des Cordis-Roots und ein minimaler Diagnosepfad für fehlgeschlagenen Start. Alles Fachliche wird über Plugins zusammengesetzt. Mitgelieferte, für die Standard-App erforderliche Plugins verwenden denselben Vertrag wie optionale Erweiterungen. „Plugin“ bedeutet nicht, dass jeder Benutzer jede notwendige Infrastruktur im laufenden Betrieb gefahrlos abschalten können muss.

Ein Plugin darf Dienste für andere Plugins bereitstellen und eigene Erweiterungsstellen anbieten. Damit wird die heutige zentrale, immer länger werdende Liste von `registerX()`-Methoden vermieden. Beispielsweise stellt das Web-Shell-Plugin einen Tab-Dienst bereit, während das Terminal-Plugin einen Renderer-Dienst bereitstellt. Es bleiben typisierte Domänenregister; sie sind Dienste im selben System und keine zusätzlichen Plugin-Loader.

## Manifest, Auflösung und Installation

Das Manifest sollte mindestens folgende Informationen unterscheiden:

- stabile Plugin-ID und Paketversion;
- kompatible Pibo-SDK-/Cordis-Linie;
- Backend- und Browser-Einstiegspunkte mit versionierten Assets;
- erforderliche und optionale Dienste beziehungsweise Plugin-Abhängigkeiten;
- unterstützte Runtime-Beiträge und deren Voraussetzungen;
- Konfigurationsschema, Datenmigrationen und Aktivierungsverhalten;
- Herkunft und Vertrauens-/Ausführungsmodell.

**Eine Quelle ist ausreichend:** Paketmetadaten und Einstiegsmodule bilden den deklarativen Input; daraus wird der UI-/Tool-Katalog abgeleitet. Ein zusätzlicher manuell gepflegter Capability-Package-Katalog entfällt.

Installation, globale Aktivierung und Auswahl für ein Profil sind verschiedene Zustände. Installieren eines GitHub-Plugins darf nicht automatisch dessen Schreibtools in jeder Session aktivieren. Profile wählen Plugin-Beiträge aus; die Plugin-Verwaltung bestimmt, welche Versionen grundsätzlich verfügbar sind.

Ein Inhalts-Hash oder Lockfile hält den installierten Stand fest. Node- und Browser-Code müssen dieselbe Plugin-Revision meinen. Ein Paketmanager kann Artefakte beschaffen; Cordis aktiviert die aufgelösten Module. Diese Beschaffung ist ein Infrastrukturteil des einen Plugin-Systems und kein zweites Erweiterungsmodell.

Skills, MCP-Server und kuratierte CLI-Programme bleiben sinnvolle Beitragsarten oder Protokolle. Wenn sie Pibo erweitern, soll ein Pibo-Plugin sie besitzen. Benutzerdateien können weiterhin durch ein mitgeliefertes Ressourcen-Plugin verwaltet werden; Benutzer müssen dafür nicht für jede Markdown-Datei ein npm-Paket bauen. Native Projekterkennung eines Harnesses ist eine zu deklarierende Adaptereigenschaft und kein zweiter Pibo-Installationskatalog.

## Dienste und Abhängigkeitsrichtung

Geeignete Dienstgrenzen sind beispielsweise Storage, Session-Routing, Product Events, Tool-Ausführung, Runtime-Katalog, Run-Verwaltung, Web-Routen und UI-Beiträge. Implementierungen werden durch Plugins bereitgestellt; Verträge liegen in kleinen SDK-Modulen.

Bei gegenseitigem Bedarf wird die Integration abgetrennt. Beispiel: Der Run-Dienst darf den Router nicht allein deshalb global voraussetzen, weil ein Subagent-Run eine Session benötigt. Ein Integrationsbeitrag hängt von beiden Diensten ab und registriert diesen Run-Typ. So wird vermieden, dass Run und Router erst aufeinander warten und nie aktiv werden.

Nicht jede interne Klasse benötigt ein eigenes installierbares Paket. Ein Plugin darf intern mehrere Cordis-Komponenten besitzen. Die Granularität richtet sich nach eigenständigem Lifecycle und fachlichen Grenzen, nicht nach Dateizahl.

# Runtime-Unterstützung pro Plugin

## Aktuelle Lieferwege

| Beitrag | Pi | Codex Native | OMP |
|---|---|---|---|
| Portable Pibo-Tools | Direkt | Sessionbezogene MCP-Bridge | Direkte Host-Tool-Brücke |
| Skills | Native Lieferung | Materialisierung über Extra Roots | Materialisierte eigene Verzeichnisse |
| Kontext | Native Lieferung | Projekterkennung und Developer Instructions | Projekterkennung und angehängter System-Prompt |
| Ausgewählte externe MCP-Server | Materialisierte Pibo-MCP-Konfiguration | MCP-Konfiguration | Aktuell nicht verdrahtet |
| Native Tool-Inspektion | Nativ deklariert | Eingeschränkt, beobachtete Runtime-Items | Eingeschränkt |
| Harness-native Tools als Pibo Yielded Runs | Unterstützt deklariert | Nicht unterstützt | Nicht unterstützt |

Diese Tabelle beschreibt die **aktuellen Pibo-Adapter**, keine universellen Eigenschaften der drei Produkte. Pi-MCP-Lieferung hat zusätzlich die vorhandene Bash-Voraussetzung. Eine allgemein identische Hook- oder Cancellation-Semantik wurde nicht end-to-end verifiziert. Belege: `src/agent-runtimes/pi/adapter.ts:108`, `codex-native/adapter.ts:193`, `omp/adapter.ts:107` und die zuvor ermittelte Ressourcenlieferung.[^pibo-baseline]

## Drei Ebenen der Kompatibilität

1. **Deklarierte Unterstützung:** Für welche Adapter oder Fähigkeiten wurde der Beitrag geschrieben?
2. **Aktuelle Verfügbarkeit:** Ist die gewählte Runtime aktiv, passend konfiguriert und stehen notwendige Dienste bereit?
3. **Tatsächliche Lieferung:** Wurde der Beitrag in dieser Runtime-Generation geliefert, eingeschränkt geliefert oder mit Fehler abgewiesen?

Ein Plugin-eigenes `supports: [pi, codex, omp]` allein wäre zu grob. Ein gemeinsames GitHub-Tool kann portable Tool-Ausführung verlangen; ein zusätzlicher Pi-Hook verlangt explizit eine Pi-Integration und eine passende Adapter-API. Diese Bedingungen werden pro Beitrag geprüft. Die bestehenden Delivery Reports können dafür weiterverwendet werden.

Bei optionalen Beiträgen bleibt das Plugin teilweise nutzbar. Bei einer erforderlichen Funktion verhindert ein klarer Kompatibilitätsfehler deren Aktivierung. Die UI zeigt den Grund. Es darf keinen stillen Wechsel von einem blockierenden Hook zu bloßer Ereignisbeobachtung geben.

## Scope und Lebensdauer

Es sind mindestens vier Identitäten zu unterscheiden: installiertes Plugin, aktive Backend-Instanz, Pibo Session und Runtime-Generation. Die Browser-View besitzt zusätzlich eine eigene Mount-Lebensdauer.

Runtime-Beiträge werden für die ausgewählte Session und Generation instanziiert. Session A kann Pi verwenden, Session B Codex, und ein Subagent wiederum OMP. Globale Verfügbarkeit eines Pi-Dienstes darf daher nicht dazu führen, dass ein Pi-Hook in allen Sessions aktiv wird.

Cordis-Service-Isolation oder separate kontrolliert verbundene Kontextwurzeln können diese Trennung tragen. Ein bloßes `ctx.extend({ sessionId })` ist noch kein Nachweis isolierter Dienste. Die konkrete Scope-Konstruktion benötigt einen Test mit zwei gleichzeitigen Sessions, verschiedenen Profilen und einem Generationstausch. Bestehende Tool-Credentials bleiben an Session, ausgewählte Tools und Generation gebunden.

Ein profilweiter Plugin-Wechsel gilt standardmäßig für den nächsten definierten Aktualisierungspunkt. Bereits gestartete Arbeit behält ihre aufgelöste Version, soweit die gewählte Update-Strategie das garantiert. Die UI darf historische Daten weiterhin anzeigen, auch wenn die aktuell ausgewählte Runtime den damaligen Beitrag nicht mehr ausführen könnte.

# Web-Tabs und Terminal-Beiträge

## Backend und Browser sind getrennte Hosts

Ein Cordis-Kontext wird nicht über HTTP geteilt. Der Backend-Host stellt einen authentisierten Plugin-Katalog, Asset-Verweise und fachliche APIs bereit. Der Browser-Host aktiviert die dazu passenden Client-Module und verbindet sie mit Browser-Diensten.

Der Katalog benötigt eine Revision. Aktivierungsänderungen erzeugen eine neue Revision; ein Browser reconciliert sie oder fordert kontrolliert einen Reload an. Bei inkompatiblen Frontend-/Backend-Versionen wird eine verständliche Fehlermeldung gezeigt. Ein fehlgeschlagenes optionales Plugin sollte nicht die gesamte Web-App am Boot hindern; notwendige Shell-Dienste müssen dagegen eindeutig als fehlend gemeldet werden.

Browser-Bundles dürfen keine Node- oder Harness-Abhängigkeiten mitschleppen. React und das SDK müssen in einem direkten Modulmodell kontrolliert gemeinsam aufgelöst werden. Für den ersten Prototyp genügen vorgebaute, eindeutig versionierte Client-Assets; ein frei programmierbarer Laufzeit-Bundler ist keine Voraussetzung.

## Allgemeiner Tab-Vertrag

Ein Tab-Beitrag benötigt ID, Titel, Icon, View-Einstieg, Kontextbindung und Regeln für Sichtbarkeit und Mount-Lebensdauer. Ein gespeichertes Tab-Ziel enthält mindestens Plugin-ID, View-ID und serialisierbaren Zustand mit Schemaversion.

Die Kontextbindung muss explizit sein:

- **Global:** etwa eine Integrationskonfiguration.
- **Ausgewählte Session:** folgt der aktuellen Auswahl.
- **Gebundene Session:** bleibt auch bei Navigation auf derselben Pibo Session.

Für den GitHub-Tab sind beide Session-Varianten sinnvoll. Ein asynchrones Ergebnis für A darf nach einem Wechsel zu B nicht in dessen Tab erscheinen. Der Host liefert einen typisierten Session-Kontext und Lifecycle-Signale; Plugins lesen nicht unkontrolliert globale React-Stores.

URL, Tab-Deduplizierung, Wiederherstellung, Breitenbegrenzung, Schließen, Fokus und Tastaturbedienung bleiben Aufgaben der Shell. Ein Plugin kann begründet Keep-alive anfordern; der Host setzt Ressourcenlimits durch. Unbekannte oder deaktivierte Tab-Ziele werden zu wiederherstellbaren Platzhaltern. Persistierter Zustand wird nicht allein wegen einer temporär fehlenden Registrierung gelöscht.

**Erfolgsmaßstab:** Ein neu installiertes Beispiel-Plugin erscheint ohne Änderung an `App.tsx`, Routen-Unions oder einer fest importierten Feature-Liste im Tab-Menü und lässt sich öffnen, schließen und wiederherstellen.

## Terminal View: vollständige Views und kleine Beiträge

Es sollten zwei Verträge entstehen:

1. **Session-View-Registrierung:** ersetzt die statische Auswahl ganzer Ansichten wie Terminal und Workflow.
2. **Terminal-Beiträge:** ergänzen die bestehende Terminal View an benannten Stellen, ohne deren gesamte Projektion zu ersetzen.

Als erster Umfang reichen ein Renderer für strukturierte Tool-Ergebnisse beziehungsweise Plugin-Artefakte und eine Aktionsfläche an solchen Ergebnissen. Später können Session-Header, Composer-Aktionen und zusätzliche fachliche Zeilentypen hinzukommen. Die Standardelemente der Terminal View können selbst mitgelieferte Registrierungen sein.

Der Renderer erhält ein begrenztes View Model: stabile Event-/Tool-Call-ID, Pibo Session ID, Schema-Version, Zustand und freigegebene Aktionen. Er erhält keinen schreibenden Zugriff auf Transcript-Arrays. Der Terminal-Host besitzt Sortierung, Paging, Virtualisierung, Scroll-Anker und Streaming-Zusammenführung.

Plugin-spezifische Daten müssen serialisierbar sein. Ein vorgeschlagener Envelope könnte Plugin-ID, Beitragstyp, Schema-Version, Objektverweis und einen textuellen Fallback enthalten. Persistiert werden Daten, keine React-Komponenten oder ausführbarer Code. Bei fehlendem Plugin bleibt die Historie als generische Karte oder Text lesbar. Ein GitHub-Renderer darf einen bereits gespeicherten Erfolg darstellen, ohne GitHub erneut schreibend aufzurufen.

Jeder Beitrag benötigt Fehlerbegrenzung. Ein fehlerhafter Renderer darf weder Nachbarzeilen noch die Session lahmlegen. Größenänderungen müssen mit dem vorhandenen Virtualisierer zusammenarbeiten. Bilder, expandierende Karten und Streaming-Inhalte sind deshalb Teil der Akzeptanzprüfung.

Gemeinsam verwendet werden sollen fachliche Daten, View Models und geeignete Aktionen. **Visuelle Gleichheit zwischen einem GitHub-Tab und seiner kompakten Terminal-Karte ist nicht das Ziel.** Beide zeigen dieselben Objektidentitäten und Zustände, aber unterschiedliche Informationsdichte. Eine externe TUI würde Daten und Aktionen über APIs verwenden und ihren eigenen Renderer liefern.

## Direkte React-Module oder iframe?

| Modell | Geeignet für | Grenzen |
|---|---|---|
| Vertrauenswürdiges React-Modul im Web-Host | Kleine Terminal-Renderer, Shell-Aktionen, eng integrierte Tabs | Gemeinsamer Vertrauensraum, SDK-/React-Abhängigkeit, CSS- und Ressourcenregeln nötig |
| Isolierte eingebettete Anwendung | Größere eigenständige Plugin-Oberflächen | Nachrichtenbrücke, Fokus, Theme, Größenanpassung und Session-Kontext müssen explizit übertragen werden |

**Empfehlung für den ersten Durchstich:** direkte Module für mitgelieferte und ausdrücklich vertrauenswürdige Plugins, weil Terminal-Integration damit realistisch erprobt werden kann. Eine isolierte Oberfläche kann später ein Renderer-Typ desselben Plugin-Systems sein. „Beliebiger fremder Code ist sicher“ wird damit nicht behauptet. Ein iframe mit gemeinsamen weitreichenden Rechten wäre ebenfalls keine ausreichende Isolation.

Diese Empfehlung präzisiert die frühere Überlegung eines iframe-Einstiegs: Für einen einzelnen eigenständigen Tab ist er brauchbar; für viele kleine Terminal-Beiträge ist er als alleiniger UI-Vertrag unpassend.

# Hooks unter dem Plugin-Schirm

| Eingriff | Geeigneter Eigentümer | Geplante Reichweite |
|---|---|---|
| Beobachtung von Pibo- und Plugin-Ereignissen | Event-Dienst | Runtimeunabhängig, soweit Ereignisse vorliegen |
| Vor einem Pibo-Tool | Gemeinsamer Tool-Ausführungsdienst | Prüfen, verändern, ablehnen; gleicher Vertrag für direkte und gebrückte Ausführung |
| Nach einem Pibo-Tool | Gemeinsamer Tool-Ausführungsdienst | Ergebnisprojektion und Beobachtung; tatsächliche Nebenwirkung bleibt dokumentiert |
| Vor Send/Steering | Pibo-Eingangs-/Routingdienst | Kanalübergreifende Regeln mit ausdrücklich benannten Ausnahmen |
| Paste, Drop, Composer-Aktion | Browser-Composer-Plugin | Web-spezifisch, unabhängig vom Harness |
| Harness-native Tools oder Loop-Schritte | Unterstützte Adapter-Integration | Nur bei tatsächlich vorhandenem Eingriffspunkt |

Aktuell bietet `PiboPluginApi` Ereignisbeobachtung, aber keine allgemeine Pre-/Post-Tool- oder Paste-API. Cordis liefert die Mechanik zur Verwaltung von Listenern; Pibo muss den Zeitpunkt und die Wirkung der Hooks festlegen.

Für verändernde Hooks braucht es Reihenfolge, Typprüfung nach Transformation, Timeout, Cancellation und Fehlerverhalten. Ein Audit-Hook darf einen erfolgreichen externen Schreibvorgang nicht nachträglich als „nie erfolgt“ umdeuten. Fehler einer optionalen Anzeige sind anders zu behandeln als Fehler einer verbindlichen Prüfung vor Ausführung.

Pi-spezifische Erweiterungen können als Pi-Beitrag eines Plugins existieren. Das ist mit der Abschaffung von Pi-Packages vereinbar, wenn Installation, Auswahl und Lifecycle ausschließlich über Pibo-Plugins laufen. Die Adapter-Bridge ist intern runtimeabhängig. Für Codex-/OMP-native Tools darf der Host keine universelle Interception versprechen, die das jeweilige Protokoll nicht zulässt.

# Pibo Run und weitere bestehende Pakete migrieren

## Run wird ein Plugin mit einem Dienst

Der aktuelle Katalog trägt Run- und Goal-Control ausdrücklich ein. Das Plugin-Ziel sollte diese Sonderfälle entfernen. Ein mitgeliefertes Run-Plugin stellt den Run-Dienst, `pibo_run_*`-Tools, Benutzungskontext, APIs und gegebenenfalls Tab-/Terminal-Beiträge bereit. Subagents oder andere Funktionen deklarieren ihre benötigte Run-Integration.

Die vorhandene Run-Implementierung muss dafür nicht sofort neu geschrieben werden. Sie kann zunächst hinter einem Cordis-Dienst liegen. Tool-Namen und laufende Run-IDs sollten möglichst stabil bleiben. Was entfällt, ist die zweite Installations-/Auswahllogik und die fest eingetragene Katalogausnahme.

Run-Daten, Leases, Cancellation, Reminders und terminale Ergebnisse bleiben fachliche Zustände. Sie werden nicht beim Entfernen einer Tool-Registrierung gelöscht. Ein langlebiger Run darf auch nicht vom geöffneten Run-Tab abhängig sein. Das Run-Plugin kann für eine Standardinstallation erforderlich sein; „Plugin“ bedeutet auch hier keine beliebige Abschaltbarkeit während aktiver Nutzung.

## Andere Kandidaten

| Bestand | Ziel |
|---|---|
| Goal-Control | Plugin-Beiträge beziehungsweise eigenes Goal-Plugin mit expliziter Run-/Loop-Integration |
| Web Annotations | Bestehendes Backend-Plugin um Client-Einstieg, Tab und Terminal-Beiträge ergänzen |
| Preview | Host-/Proxy-Dienst und Tab-Beitrag unter derselben Plugin-Identität |
| Loops, Cron, Workflows | Dienste, Konfiguration und UI über denselben Plugin-Vertrag |
| Subagents | Plugin mit Runtime-neutraler Session-/Run-Integration |
| Skills und Kontextverwaltung | Ressourcen-Plugin plus Plugin-eigene Dateien |
| MCP und kuratierte CLI-Integrationen | Protokoll-/Tool-Beiträge mit Plugin-Ownership |
| VS Code Web | Optionales Plugin oder aus Standardzusammenstellung entfernen |

Es wird kein weiterer „Capability-Package“-Loader eingeführt. Eine benannte Gruppe mehrerer Tools ist weiterhin als Datenstruktur innerhalb eines Plugins möglich, etwa eine Auswahl „GitHub lesen“ gegenüber „GitHub schreiben“. Sie besitzt keinen eigenen Lifecycle neben dem Plugin.

# Pi-Packages vollständig aus Pibo entfernen

## Was tatsächlich verschwindet

Der Paketpfad betrifft den Store, Installation und Diagnosen, CLI/API/UI, Profilreferenzen und die Runtime-Übergabe. Der aktuell geprüfte Übergang sammelt ausgewählte Pakete und liefert `additionalExtensionPaths` an Pi. Diesen Pfad nur umzubenennen würde das alte Erweiterungsmodell erhalten.

Das Ziel umfasst deshalb:

- keine Pi-Package-Verwaltung in Pibo-Katalog, Designer oder Einstellungen;
- keine neue Persistierung von `piPackages`-Auswahlen;
- keinen Pibo-Installations- und Discovery-Pfad für Pi-Pakete;
- keine zusätzliche Aktivierung über den bisherigen Package-Loader;
- Aktualisierung von Beispielen, Skills, CLI-Hilfen und aktuellen Spezifikationen;
- eine endliche, ausdrücklich versionierte Migration vorhandener Konfiguration.

Pi als Harness bleibt bestehen. Seine SDK-Abhängigkeit wird durch diese Produktentscheidung nicht automatisch entfernt. Falls Pi native User-/Workspace-Extensions selbst entdeckt, muss der Pi-Adapter diese Pfade für den neuen Pibo-Vertrag kontrollieren oder ihre Grenzen offenlegen. **Diese native Discovery wurde hier nicht vollständig auditiert**; sie ist ein eigener Abschlusstest, damit keine versteckte zweite Pibo-Erweiterungsroute übrigbleibt.

## Behandlung vorhandener Inhalte

| Inhalt | Migrationsansatz |
|---|---|
| Skills/Kontext mit bekanntem Format | Als Beitrag eines Ressourcen- oder Feature-Plugins übernehmen |
| Portable Tools | In Pibo-Tool-Verträge überführen |
| Pi-spezifische Extension | Expliziter Pi-Beitrag eines Pibo-Plugins; kein stiller Portabilitätsanspruch |
| Terminal-Themes und eigenständige Pi-TUI-UI | Nicht Bestandteil des Web-Produkts; bei Bedarf externe Umsetzung |
| Unbekanntes oder inkompatibles Paket | Als nicht migriert ausweisen; nicht automatisch ausführen |

Migration muss bestehende Auswahlen erfassen, sichern und nachvollziehbar zuordnen. Unbekannte Inhalte dürfen nicht lautlos verschwinden. Der erste Upgrade-Schritt kann alte Daten read-only zur Migration erkennen, ohne den alten Plugin-Pfad weiter zu aktivieren. Spätere Versionen entfernen den Migrationsleser nach einem definierten Zeitfenster. Bereits gespeicherte Historie bleibt lesbar.

# GitHub als durchgängiges Beispiel

Ein GitHub-Plugin kann gemeinsame Tools und einen Backend-Dienst anbieten, einen sessionbezogenen Tab registrieren und strukturierte Ergebnisse in der Terminal View darstellen. Optional kann es runtimeabhängige Beiträge besitzen. Dafür braucht es keine Pi-Package-Installation und keinen zusätzlichen Capability-Katalog.

Ein vorgeschlagener Ablauf:

1. Das Plugin wird installiert und aktiviert; die Browser-Hälfte wird aus dem passenden Katalog geladen.
2. Ein Profil wählt GitHub-Beiträge aus. Beim Sessionstart löst Pibo sie gegen den Runtime-Adapter auf.
3. Ein Plugin-Tool erstellt einen PR und speichert Repository, GitHub-Objekt-ID, Aktion, URL, Zeitpunkt und Pibo Session ID.
4. Ein Produkt-Ereignis aktualisiert Tab und Terminal-Projektion.
5. Webhook oder Polling aktualisieren später den PR-Zustand, ohne die ursprüngliche Aktion erneut auszuführen.
6. Bei Navigation zu einer anderen Session wechselt ein folgender Tab kontrolliert seinen Kontext; ein gebundener Tab bleibt unverändert.
7. Nach Deaktivierung bleibt das Ergebnis historisch lesbar; neue Aktionen sind nicht mehr verfügbar.

**Grenze der Vollständigkeit:** Wenn der Agent beliebige `gh`-Kommandos über ein harness-eigenes Shell-Tool ausführt, kennt das GitHub-Plugin nicht automatisch deren verlässliche Session-Zuordnung. Vollständige Erfassung braucht einen unterstützten Wrapper, strukturierte Tool-Ergebnisse oder eine explizite nachträgliche Zuordnung. UI-Plugins allein lösen dieses Beobachtungsproblem nicht.

# Lifecycle, dauerhafte Daten und Fehlerfälle

## Drei unterschiedliche Arten von Wirkung

| Art | Beispiele | Umgang bei Deaktivierung |
|---|---|---|
| Registrierungen und flüchtige Ressourcen | Listener, Route, Tab-Beitrag, Timer | Zurücknehmen und Ressourcen freigeben |
| Laufende Arbeit | Tool-Aufruf, Runtime-Session, Yielded Run, Stream | Aufnahme stoppen, laufende Arbeit nach erklärter Policy drainen oder abbrechen |
| Dauerhafte Ergebnisse | Session-Historie, Run-Ergebnis, PR, Plugin-Daten | Erhalten; Löschung oder fachliche Kompensation sind separate Aktionen |

Diese Unterscheidung ist eine Pibo-Designentscheidung. Ein Datenbank-Insert oder externer API-Schreibvorgang wird nicht automatisch zu einem reversiblen Registrierungseffekt, nur weil der auslösende Code in einem Cordis-Plugin lebt.

## Vorschlag für die erste Produktionsregel

Updates von Plugins mit aktiven Runtime- oder Run-Abhängigkeiten werden zunächst als **wartend auf sichere Aktivierung** behandelt. Neue Arbeit wird nach einer definierten Grenze aufgenommen; laufende Arbeit behält den alten Stand oder wird kontrolliert beendet. Wo das gleichzeitige Halten zweier Versionen noch nicht implementiert ist, wird die Aktualisierung bis zur Freigabe beziehungsweise zu einem geplanten Neustart verschoben.

Eine Rohoperation „Cordis-Fiber jetzt entladen“ darf nicht die einzige Benutzeroperation sein. Pibos Plugin-Verwaltung prüft zunächst aktive Abhängigkeiten. Erst danach wird die gewählte Cordis-Operation ausgeführt. Dies ist Produktpolicy über demselben Lifecycle, kein konkurrierender Lifecycle-Manager.

Browser- und Backend-Aktivierung sind keine atomare Transaktion über das Netzwerk. Ein Client kann während eines Updates offline sein. Revisionsprüfung, alte Asset-Verfügbarkeit, kompatible API-Fenster und verständliche Reload-Aufforderungen sind deshalb notwendig. Ein Frontend-Fehler darf keine Backend-Run-Daten zerstören.

## Diagnostik und Betrieb

Die Plugin-Verwaltung sollte installierte Version, aktive Instanzen, fehlende Dependencies, betroffene Sessions, gelieferte Beiträge und ausstehende Aktualisierungen anzeigen. Logs und Metriken erhalten Plugin-ID und Instanz-/Generationsbezug. Ein fehlgeschlagener Core-Start benötigt einen Diagnoseweg außerhalb der normalen Web-Shell.

Die CLI bleibt iterativ entdeckbar. Ein möglicher Zielpfad ist `pibo plugins` mit vertiefenden `list`, `show`, `doctor` und Beitrags-/Runtime-Inspektion. Das sind vorgeschlagene Befehle. Ihre Hilfe soll keine gesamte Plugin-Dokumentation auf einmal ausgeben.

# Migrationsetappen und Abnahmekriterien

Die folgende Reihenfolge ist eine Empfehlung für einen späteren ausführbaren Plan. Sie ist keine Behauptung, dass die Arbeit bereits begonnen oder genehmigte Architekturdetails vollständig festgelegt seien.

| Etappe | Inhalt | Konkreter Abschlussnachweis |
|---|---|---|
| 0: Verträge und Cordis-Linie | Version pinnen, Plugin-/Instanz-/Session-Scope definieren, Typen für Beiträge und Delivery Reports festlegen | Zwei Plugins mit Dienstabhängigkeit; Aktivieren, fehlende Dependency, Wiederaktivieren und Cleanup reproduzierbar |
| 1: Backend-Komposition | Cordis-Bootstrap und Domain-Dienste; bestehende Implementierungen hinter Dienste setzen | Annotations-Backend ohne manuelle neue Gateway-Importliste aktivierbar; keine doppelten Routen/Tools nach Reaktivierung |
| 2: Web-Durchstich | Browser-Root, versionierter Katalog, Tab-Registry und Beispiel-Plugin | Tab erscheint ohne Kern-Codeänderung; Sessionwechsel, Restore, Entfernen und Fehlerzustände funktionieren |
| 3: Terminal-Beiträge | Tool-/Artefakt-Renderer und Aktion; Standard-Fallback | Live-Streaming und Replay zeigen dieselbe Objektidentität; fehlendes Plugin bleibt lesbar; Scroll-Anker bleibt stabil |
| 4: Runtime-Auflösung | Beiträge pro Profil und Generation; portable und adaptergebundene Implementierungen | Dasselbe portable Tool unter Pi/Codex/OMP; Pi-only-Beitrag nur in Pi; OMP-MCP-Lücke explizit sichtbar |
| 5: Run und weitere Sonderfälle | Run-/Goal-Plugins, Subagent-Integration, Entfernung harter Katalogeinträge | Run-IDs, Cancellation, Reminders und Ergebnisse bleiben korrekt; keine separate Package-Auswahl nötig |
| 6: Pi-Package-Entfernung | Datenmigration, CLI/API/UI und Loader entfernen | Upgrade mit bekannten und unbekannten Auswahlen; keine alte Ausführung; bestehende Sessions/Historie bleiben nachvollziehbar |
| 7: Produktscope und Betriebsabschluss | Übrige Kernfeatures komponieren; VS-Code-/TUI-Produktoberflächen entfernen; Updatepolicy und Diagnose vervollständigen | Standardprodukt bootet vollständig über Plugin-Zusammenstellung; externe Clients benötigen keine internen Imports |

Eine zeitweilige Legacy-Brücke ist für die Migration möglich, aber nur mit klarer Eigentümerschaft und Enddatum. Jede Ressource darf zu jedem Zeitpunkt genau einem Registrierungsweg gehören. Nach Abschluss gibt es keinen zweiten öffentlichen Plugin-Registrar und keine parallele Pi-Package-Ausführung.

## Tests, die vor einer breiten Umstellung nötig sind

1. Plugin-Setup scheitert nach der ersten Registrierung: keine halbfertigen Tools, Routen oder Listener bleiben zurück.
2. Dependency verschwindet und kehrt zurück: Beiträge werden genau einmal entfernt und wieder aufgebaut.
3. Zwei Sessions mit unterschiedlichen Runtimes und Profilen: keine Tool-, Credential- oder Kontext-Leaks.
4. Eine Runtime-Generation wird ersetzt: alte Tool-Credentials und Materialisierungen werden unbrauchbar beziehungsweise entfernt.
5. Ein Run ist aktiv, während sein Plugin deaktiviert werden soll: Policy ist sichtbar und es entsteht kein verwaister Run.
6. Ein Browser hat einen alten Katalog oder fehlende Assets: verständlicher Zustand statt kaputter Shell.
7. Ein Plugin-Renderer wirft oder wächst während Streaming: Nachbarzeilen, Tastaturfokus und Scroll-Verhalten bleiben nutzbar.
8. Ein historisches Plugin-Artefakt hat keinen passenden Renderer: textueller Fallback funktioniert ohne externe Schreibaktion.
9. Pi-only-Plugin unter Codex/OMP: kein versehentlicher Import der Pi-Implementierung und keine stille Aktivierung.
10. Bestehende Pi-Package-Auswahl wird migriert: bekannte Zuordnungen sind sichtbar, unbekannte Inhalte bleiben gesichert und inaktiv.
11. Doppelte Plugin-/Beitrags-IDs: deterministische Ablehnung mit Herkunft statt zufälligem Überschreiben.
12. Wiederholte Aktivierungszyklen: Listener-, Timer-, Prozess- und Browser-Ressourcen wachsen nicht unbegrenzt.

Für Codeänderungen folgen diese Prüfungen Pibos normalem Weg: isolierte lokale Docker-Validierung, relevante Builds und Tests, danach derselbe Kandidat auf Pibo2. UI-Annahmen brauchen headful Browser-Use-Prüfungen und CDP-Evidenz. Ein reiner Healthcheck oder ein Cordis-Unit-Test beweist keine korrekte Session-/Terminal-Integration. Für diesen Dokumentationsbericht wurde kein Runtime-Deployment vorgenommen.

# Risiken, Alternativen und offene Entscheidungen

## Wesentliche Risiken

| Risiko | Auswirkung | Begrenzung |
|---|---|---|
| Instabile Cordis-API und abweichende DeepSeek-Variante | SDK-Brüche, inkompatible Beispiele | Exakter Pin, eine Framework-Identität, kleiner SDK-Einstieg und Vertragstests |
| Bestehende Singleton-/Seiteneffekte | Unvollständiges Cleanup trotz Cordis | Ownership-Inventur pro migriertem Dienst; Registrierungen ausschließlich über verwaltete APIs |
| Zu grobe Plugin-Abhängigkeiten | Zyklen oder unnötige Deaktivierung ganzer Features | Kleine Dienstverträge und optionale Integrationskomponenten |
| Session-/Plugin-Lifecycle vermischt | Abbruch laufender Arbeit, Credential-Leaks | Generationen, Drain-Policy, getrennte UI- und Backend-Lebensdauer |
| Zu offene UI-Flächen | Instabile Shell, CSS-/React-Konflikte | Benannte Slots, klare Besitzer, begrenzte Props, Fehlergrenzen |
| Zu große Framework-Neuerfindung | Mehr Komplexität als zuvor | Cordis als echte Engine nutzen; Pibo implementiert nur Domänenverträge |
| Unvollständige Migration | Verlorene Auswahl oder versteckte alte Ausführung | Upgrade-Matrix, Sicherung, explizite inkompatible Beiträge |
| Große Zahl aktivierter Module | Langsamer Boot, Bundle- und Speicherwachstum | Lazy-Laden, kontrolliertes Keep-alive, Messungen vor breiter Extraktion |

Ein Rollback nach Datenmigration kann mehr als einen Code-Rollback erfordern. Daher zunächst additive Änderungen und nachvollziehbare Konfigurationssicherungen; irreversible Schemaentfernung erst nach geprüftem Upgradepfad. Die bestehende App bleibt während der Etappen nutzbar.

## Bewertete Alternativen

**Bestehende Registry nur erweitern:** geringerer erster Eingriff, aber Lifecycle, Dependency-Auflösung und UI-Komposition müssten zusätzlich entwickelt werden. Für das ausdrücklich gewählte Cordis-Ziel wäre das höchstens eine kurzlebige Brücke.

**DeepSeek Harness komplett übernehmen:** liefert ein anschauliches Plugin-Produkt, ersetzt aber wesentlich mehr als Pibos Komposition. Seine Agent-, Daten- und UI-Verträge entsprechen nicht automatisch Pibos Session-/Runtime-Modell. Dafür gibt es im Auftrag keinen notwendigen Grund.

**Cordis nur im Backend:** verbessert Dienste, lässt aber eine andere Lebensdauer- und Erweiterungslogik im Frontend bestehen. Als Zwischenetappe brauchbar; als Endzustand für „alles auf Plugins“ unvollständig.

**Cordis in Backend und Browser mit Pibo-Domänendiensten:** erfüllt die gewünschte Richtung am besten. Es erfordert eigene UI-Verträge, kann aber vorhandene Session-, Tool- und Runtime-Logik erhalten. Das ist die Empfehlung dieses Berichts.

## Vor einer normativen Zielarchitektur zu entscheiden

- Welche Cordis-Linie wird gepinnt, und welche konkrete SDK-Kompatibilität wird garantiert?
- Sind zunächst nur mitgelieferte/vertrauenswürdige Plugins vorgesehen, oder gehört isolierte Drittanbieter-Ausführung bereits zur ersten Version?
- Welche minimalen Terminal-Slots werden öffentlich stabil, welche bleiben interne Implementierung?
- Wie werden Plugin-Beiträge im Profil ausgewählt und optionale Runtime-Funktionen angezeigt?
- Welche Plugins sind in der Standardzusammenstellung erforderlich, und welche dürfen während aktiver Nutzung deaktiviert werden?
- Welche native Pi-Discovery bleibt Harness-Verhalten, und wie wird ein unbeabsichtigter zweiter Erweiterungsweg verhindert?
- Welche Updategrenzen gelten zunächst: neue Session, neuer Turn, Drain oder geplanter Prozessneustart?
- Wie lange werden alte Plugin-Datenschemata, Assets und Pi-Package-Migrationsdaten unterstützt?

Diese Fragen verhindern den ersten technischen Durchstich nicht. Sie sollten aber geklärt sein, bevor ein öffentliches Plugin-SDK und ein dauerhaftes Installationsformat versprochen werden.

# Quellenverzeichnis und Verifikation

## Primärstellen zum Weiterarbeiten

Die Pfade gelten jeweils am oben genannten Commit. Die Links zeigen auf unveränderliche Quellstände.

| Aussage | Primärquelle |
|---|---|
| Pibo-Plugin-SPI ohne allgemeine UI-Registrierung | [Pibo Plugin-Typen](https://github.com/Pascapone/pibo/blob/cac4dcd03945b9754db7be9ab2ab4324f10c335c/src/plugins/types.ts#L254) |
| Fest eingetragene Run-/Goal-Pakete | [Pibo Capability-Katalog](https://github.com/Pascapone/pibo/blob/cac4dcd03945b9754db7be9ab2ab4324f10c335c/src/plugins/registry.ts#L684) |
| Statische Desktop-Ziele | [Desktop-Tabs](https://github.com/Pascapone/pibo/blob/cac4dcd03945b9754db7be9ab2ab4324f10c335c/src/apps/chat-ui/src/desktop-tabs-model.ts#L10) |
| Statische Terminal-/Workflow-Ansichten | [Session-Views](https://github.com/Pascapone/pibo/blob/cac4dcd03945b9754db7be9ab2ab4324f10c335c/src/apps/chat-ui/src/session-views/registry.tsx) |
| Pi-Package-Lieferweg | [Pi-Package Runtime](https://github.com/Pascapone/pibo/blob/cac4dcd03945b9754db7be9ab2ab4324f10c335c/src/pi-packages/runtime.ts) |
| Bestehendes Annotations-Plugin | [Web Annotations](https://github.com/Pascapone/pibo/blob/cac4dcd03945b9754db7be9ab2ab4324f10c335c/src/plugins/web-annotations.ts) |
| Cordis-Kontext und Service-Isolation | [Context](https://github.com/cordiverse/cordis/blob/f8ea3cd50f1a5724e8e715995bcde131c9c12b2c/packages/core/src/context.ts) |
| Effektgebundenes Cleanup | [Fiber](https://github.com/cordiverse/cordis/blob/f8ea3cd50f1a5724e8e715995bcde131c9c12b2c/packages/core/src/fiber.ts#L275) |
| Cordis-Eventmechanik | [Events](https://github.com/cordiverse/cordis/blob/f8ea3cd50f1a5724e8e715995bcde131c9c12b2c/packages/core/src/events.ts) |
| Instabilität des Upstream-API | [Cordis README](https://github.com/cordiverse/cordis/blob/f8ea3cd50f1a5724e8e715995bcde131c9c12b2c/README.md) |
| Abweichende DeepSeek-Cordis-Paketidentität | [Vendorte Metadaten](https://github.com/deepseek-ai/deepseek-harness/blob/c291e7961a515f6d7af9304e7fd1d257929aef26/vendor/cordis/package.json) |
| Browserseitige Cordis-Aktivierung | [DeepSeek Client Boot](https://github.com/deepseek-ai/deepseek-harness/blob/c291e7961a515f6d7af9304e7fd1d257929aef26/packages/client/web/src/boot-client.ts) |
| UI-Slots als eigene Anwendungsarchitektur | [Slot-Verträge](https://github.com/deepseek-ai/deepseek-harness/blob/c291e7961a515f6d7af9304e7fd1d257929aef26/packages/client/ui-slots/src/index.ts#L97) |
| Konkretes UI-Plugin mit Disposal | [Layout-Registrierung](https://github.com/deepseek-ai/deepseek-harness/blob/c291e7961a515f6d7af9304e7fd1d257929aef26/packages/client/ui-layout/src/client/index.ts#L122) |
| Fibergebundene Slot-Registrierungen | [Renderer Registry](https://github.com/deepseek-ai/deepseek-harness/blob/c291e7961a515f6d7af9304e7fd1d257929aef26/packages/client/ui-renderer/src/client/registry.ts) |

## Aussagekraft der Untersuchung

**Geprüft:** Existenz und Form der beschriebenen repräsentativen APIs; statische Pibo-UI-Grenzen; Run-/Goal-Katalogausnahmen; aktuelle Adapter-Capability-Deklarationen; Cordis-/DeepSeek-Versionen und relevante Browser-Komposition. Die beiden angeforderten Clones wurden erstellt. Der Researcher lieferte eine Quellenkarte; die entscheidenden Verträge wurden direkt gegengelesen.

**Nicht geprüft:** vollständige native Extension-/Hook-Matrix aller Harnesses, vollständige Pi-Discovery, ausführbare Migration, alle Cordis-HMR-Pfade, externe Plugin-Installation, Browser-Verhalten der Referenzanwendungen, Performance, Sicherheitsisolation und Kompatibilität eines unverändert übernommenen DeepSeek-UI-Pakets. Dazu wurden keine Tests, Builds oder Deployments behauptet.

**Dokumentationsvalidierung am 11.09.2026:** `npm run docs:validate` (Strict), `npm run docs:validate:okf`, `npm run docs:validate:migration`, `npm run docs:indexes:check` und `npm run docs:log:check` bestanden. Strict und Migration prüften 799 Markdown-Pfade und 799 Ledger-Einträge ohne Fehler oder Warnungen. `npm run docs:validator:test` bestand mit 84 von 84 Tests. `git diff --check` meldete keine Probleme. Die 15 unveränderlich verlinkten Quellpfade der Tabelle wurden mit `git cat-file -e` gegen ihre lokalen Commit-Objekte geprüft; kein Pfad fehlte.

Für diese reinen Dokumentationsprüfungen verwendete der Worktree die bereits vorhandenen Node-Abhängigkeiten über einen lokalen `node_modules`-Symlink. Der erste Index-Aufruf vor dieser Bereitstellung scheiterte an fehlendem `yaml`; der anschließende Lauf bestand. Es wurden keine Runtime-Abhängigkeiten neu installiert. Die Prüfungen bestätigen Dokumentstruktur und Referenzkonsistenz, nicht die Funktionsfähigkeit der vorgeschlagenen Architektur.

Ein nachfolgender Plan sollte das hier empfohlene Zielmodell in konkrete Entscheidungen und abnehmbare Arbeitspakete überführen. Der erste nachweisbare Meilenstein ist ein vollständig plugin-eigenes Feature mit Backend, Tab, Terminal-Beitrag und sauberem Lifecycle, bevor die gesamte Produktkomposition migriert wird.

[^pibo-baseline]: Pibo-Quellen am Commit `cac4dcd03945b9754db7be9ab2ab4324f10c335c`; konkrete Stellen sind im Text und in der Primärquellentabelle angegeben.
[^previous-report]: Nicht eingecheckter Ausgangsbericht vom 10.09.2026 im Haupt-Checkout; aktuelle Tatsachen wurden am neuen Analyse-Stand abgeglichen.
[^cordis-source]: Cordis-Quellen am Commit `f8ea3cd50f1a5724e8e715995bcde131c9c12b2c`, insbesondere `packages/core/src/`, `packages/loader/src/`, Paketmetadaten und README.
[^cordis-paper]: Shi, Zhang und Cui, [A Programming Paradigm for Spatiotemporal Composability](https://arxiv.org/abs/2608.25512v1), Abstract sowie Abschnitte 5 und 6.5 als konzeptionelle Einordnung; keine vollständige Beweisprüfung.
[^deepseek-source]: DeepSeek Harness am Commit `c291e7961a515f6d7af9304e7fd1d257929aef26`, insbesondere `vendor/cordis`, Client-Boot, Module, Slots, Renderer und Layout-Plugin.

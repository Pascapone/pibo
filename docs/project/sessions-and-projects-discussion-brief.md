# Pibo Sessions und Projects: Diskussions-Briefing

Stand: 2026-05-09

Dieses Dokument fasst den relevanten Kontext für ein Gespräch über das geplante Projects-Feature zusammen. Der Fokus liegt auf dem bereits gebauten Sessions-Modul in der Chat Web App und auf der Produktidee, Projects als getrenntes, aber zunächst nahezu identisches Modul mit zusätzlichem Workflow-Konzept zu bauen.

## 1. Was Pibo insgesamt ist

Pibo ist die Produktschicht um Pi Coding Agent. Pi Coding Agent bleibt der innere Agent-Harness: Modell-Turns, Tool-Aufrufe, Streaming, Pi-Session-Dateien und Kompaktierung. Pibo ergänzt die Produktgrenze darum herum:

- Profile und Agent-Konfigurationen
- Plugin-Registrierung
- Tools, Skills, Subagents und Context Files
- Pibo Sessions als stabile Produkt-Sessions
- Session Router und Gateway
- Chat Web App
- Auth, Owner Scopes und Zugriffskontrolle
- Räume, Session-Navigation, Traces und Read Models

Das wichtigste Prinzip: Pibo soll nicht den inneren Agenten ersetzen. Pibo macht Agent-Arbeit bedienbar, nachvollziehbar, routbar und produktfähig.

## 2. Zentrale Begriffe

### Pi Session

Eine Pi Session ist die technische Session des inneren Pi Coding Agent. Sie speichert den eigentlichen Agent-Transcript und ist für den Runtime-Harness wichtig.

### Pibo Session

Eine Pibo Session ist die stabile Produkt-Session. Sie hat eine eigene ID, verweist auf eine Pi Session und trägt Produkt-Metadaten:

- `id` als Pibo Session ID
- `piSessionId` als technische Pi Session ID
- `channel`
- `kind`
- `profile`
- `ownerScope`
- `parentId` für echte Hierarchie, z. B. Subagents
- `originId` für Fork/Clone-Beziehungen
- `workspace`
- `title`
- `activeModel`
- `metadata`

Die Chat Web App arbeitet mit Pibo Sessions, nicht direkt mit Pi Sessions.

### Agent Profile

Ein Agent Profile beschreibt, welche Fähigkeiten ein Agent bekommt. Dazu gehören:

- Modell-/Provider-Auswahl
- native Pibo Tools
- Built-in Pi Tools wie `read`, `bash`, `edit`, `write`
- Skills
- Context Files
- Subagents
- MCP-Server
- capability packages wie `pibo-run-control`

Das aktuelle wichtige Profil ist `codex-compat-openai-web`. Es fühlt sich für Coding-Aufgaben Codex-ähnlich an, bleibt aber eine Pibo/Pi-Runtime.

### Custom Agents

Die Chat Web App hat einen Agent Designer. Benutzer können Custom Agents erstellen, bearbeiten, archivieren, wiederherstellen und löschen. Custom Agents werden als dynamische Profile registriert und können für neue Sessions ausgewählt werden.

### Subagents

Profile können Subagents aktivieren. Pibo stellt sie dem Agenten als generierte Tools bereit, z. B. `pibo_subagent_explorer` oder `pibo_subagent_worker`. Wenn ein Agent so ein Tool aufruft, erzeugt Pibo eine Child Session. Diese Child Session hängt über `parentId` unter der Main Session und erscheint in der Session-Hierarchie.

## 3. Das bestehende Sessions-Modul

Das Sessions-Modul ist der aktuelle Hauptbereich der Chat Web App. Es ist unter `/apps/chat` erreichbar und hat aktuell die Top-Level-Bereiche:

```text
Sessions | Agents | Context | Settings
```

Der Sessions-Bereich ist ein kompletter Chat-Arbeitsbereich. Er besteht nicht nur aus einem Nachrichtenfenster. Er kombiniert:

- Personal Chat
- Räume
- Sessions pro Raum
- Subagent-Session-Baum
- Terminal-/Transcript-Ansicht
- Trace-Daten
- Composer
- Agent-Profil-Auswahl
- Modell-/Thinking-Anzeige
- Slash Commands
- Archivieren, Wiederherstellen und Löschen
- unread/status badges
- mobile Sidebar-Verhalten

## 4. Personal Chat und Räume

Jeder Benutzer bekommt automatisch einen gesperrten `Personal Chat` Raum. Dieser Raum steht oben in der Sessions-Sidebar. Er ist besonders:

- Er wird automatisch erstellt.
- Er kann nicht umbenannt werden.
- Er kann nicht archiviert oder gelöscht werden.
- Er dient als Standardort für persönliche Sessions.

Unter dem Personal Chat gibt es normale Rooms. Ein Room ist ein Container für Sessions. User-created Rooms können:

- erstellt werden
- ausgewählt werden
- umbenannt werden
- mit Topic und Workspace versehen werden
- archiviert werden
- wiederhergestellt werden
- nach Bestätigung dauerhaft gelöscht werden

Archivierte Räume bleiben lesbar, sind aber read-only. In archivierten Räumen können keine neuen Sessions, Nachrichten oder Runtime-Aktionen gestartet werden.

## 5. Sessions innerhalb eines Raums

Ein Room enthält viele Pibo Sessions. Die Sidebar zeigt aktive Sessions und optional archivierte Sessions. Sessions können:

- erstellt werden
- ausgewählt werden
- umbenannt werden
- archiviert werden
- wiederhergestellt werden
- nach Archivierung dauerhaft gelöscht werden
- geforkt oder geklont werden
- Sub-Sessions enthalten

Eine Session gehört über `metadata.chatRoomId` zu einem Room. Subagent-Sessions erben diese Room-Zugehörigkeit, damit Room-Views und Room-Löschung die ganze Session-Familie erfassen.

## 6. Main Sessions, Sub-Sessions und Derived Sessions

Das Sessions-Modul unterscheidet mehrere Beziehungen:

- `parentId`: echte Hierarchie. Das wird für Subagents verwendet.
- `originId`: Ableitung. Das wird für Forks und Clones verwendet.

Subagent-Sessions erscheinen als Kinder der Main Session. Sie sind eigenständige Pibo Sessions mit eigener Pi Session und eigenem Runtime-Verlauf, bleiben aber in der UI unter der Parent Session sichtbar.

Forks und Clones sind keine Kinder im gleichen Sinn. Sie entstehen aus einer bestehenden Session oder aus einer Stelle im Transcript, werden aber als abgeleitete Sessions behandelt.

## 7. Der ausgewählte Session-Bereich

Wenn eine Session ausgewählt ist, zeigt die Hauptfläche nicht nur Chat-Bubbles. Die Hauptfläche ist eine Session-Arbeitsfläche:

- Header mit Agent/Profile/Model/Status-Information
- Breadcrumbs für Session-Hierarchie
- Terminal- oder Trace-Ansicht
- laufende Tool-Aufrufe
- Thinking-/Reasoning-Anteile, soweit aktiviert
- Fehlermeldungen
- Fork-/Open-Session-Aktionen
- Composer unten

Der Composer sendet Nachrichten in die ausgewählte Pibo Session. Slash Commands lösen Session Actions aus, z. B. Fork, Clone, Abort, Compact, Thinking, Fast Mode oder Download.

## 8. Terminal View und Trace View

Die aktuelle aktive Session View ist die kompakte Terminal View. Sie rendert denselben Trace-Datenstrom in einer Codex-artigen Terminal-Oberfläche.

Wichtig:

- Die Terminal View ist eine Darstellung der Session-Ausführung.
- Sie ersetzt nicht die Pibo Session.
- Sie liest aus dem Pibo Session Trace View.
- Sie zeigt Assistant-Text, Tool-Calls, Tool-Ergebnisse, Fehler, Thinking-Abschnitte und Status.
- Sie ist virtualisiert, damit lange Sessions bedienbar bleiben.

Die ältere verschachtelte Trace View existiert weiterhin als inaktive/dormant View. Das Datenmodell dahinter bleibt wichtig: Pibo rekonstruiert aus Events und Pi-Transcript eine geordnete Trace-Struktur.

## 9. Traces und Events

Pibo normalisiert Runtime-Ausgaben in Produkt-Events. Beispiele:

- `message_queued`
- `message_started`
- `assistant_delta`
- `tool_execution_started`
- `tool_execution_updated`
- `tool_execution_finished`
- `subagent_session`
- `message_finished`
- `session_error`

Die Chat Web App speichert und projiziert diese Events in Read Models. Daraus entstehen:

- Session-Navigation
- Statuswerte
- Unread-Zähler
- Trace-Bäume
- Terminal-Zeilen
- Raw-Event-Debugging

Das ist wichtig für Projects: Ein Project Session darf diesen normalen Trace-/Terminal-Mechanismus nicht verlieren. Workflow-Status kommt zusätzlich dazu.

## 10. Workspaces im Sessions-Modul

Rooms können einen Workspace speichern. Neue Sessions in einem Room starten im Room-Workspace. Wenn kein Workspace gesetzt ist, wird der Default-Pibo-Workspace verwendet.

Für normale Sessions ist das bereits nützlich. Für Projects wird es zentraler: Ein Project soll an einen konkreten Projektordner gebunden sein. Aus diesem Projektordner können später isolierte Worktrees und Docker-Worker für Project Sessions entstehen.

## 11. Warum Projects nicht nur ein anderer Name für Sessions ist

Projects soll am Anfang wie Sessions aussehen und sich fast genauso bedienen. Trotzdem soll es ein eigenes Modul sein.

Das ist der Kernpunkt:

```text
Sessions: allgemeiner Chat-/Agent-Arbeitsbereich
Projects: coding-projektbezogener Arbeitsbereich mit Workflows
```

Projects soll also nicht nur ein Filter über die gleichen Rooms und Sessions sein. Wenn ein Benutzer in den Projects-Tab geht, soll er nicht dieselben Sessions sehen wie im Sessions-Tab. Es sollen getrennte Datenräume sein:

- Sessions-Tab: Personal Chat, Rooms, Sessions
- Projects-Tab: Personal Chat convenience entry, Projects, Project Sessions

Die UI-Struktur ist gleich. Die Produktmodule sind getrennt.

## 12. Gewünschtes Projects-V1-Modell

Projects V1 soll eine 1:1-Kopie des Sessions-Moduls sein, ergänzt um Workflow-Metadaten.

Gewünschte Navigation:

```text
Sessions | Projects | Agents | Context | Settings
```

Gewünschte Projects-Sidebar:

```text
Personal Chat

Projects
  Project A
  Project B
  Archived Projects

Project Sessions
  Main Project Session
    Sub-Session
```

Wichtig: Die Personal-Chat-Zeile soll wie in Sessions oben erscheinen. Sie macht Projects aber nicht zu demselben Datenmodul wie Sessions. Sie ist ein vertrauter Einstiegspunkt und UI-Anker.

## 13. Routes und Datenisolation für Projects

Projects braucht eigene Routes. Beispiele:

```text
/apps/chat/projects
/apps/chat/projects/:projectId
/apps/chat/projects/:projectId/sessions/:piboSessionId
```

Project-Aktionen dürfen nicht in Sessions-Routen springen:

- nicht nach `/rooms/:roomId`
- nicht nach `/sessions/:piboSessionId`
- nicht in den Sessions-Tab

Auch die Daten müssen getrennt sein. Dafür gibt es mehrere mögliche Implementierungen:

1. Eigene Project- und ProjectSession-Tabellen.
2. Wiederverwendung der Room-/Session-Tabellen mit einem harten `module`- oder `area`-Discriminator.
3. Separate IDs/Prefixe plus Discriminator.
4. Separate Store-Datei für Projects, wenn das die Migration erleichtert.

Die wichtigste Regel ist unabhängig von der technischen Lösung: Rooms/Sessions aus dem Sessions-Tab und Projects/Project Sessions aus dem Projects-Tab dürfen sich nicht versehentlich vermischen.

## 14. Der Workflow-Gedanke

Projects fügt dem normalen Session-Konzept einen Workflow hinzu. Eine Project Session basiert auf einem Workflow. Ein Workflow kann sehr einfach oder komplex sein.

Der einfachste Workflow ist `simple-chat`:

```text
chat
```

Das ist ein One-Node-Workflow. Er tut praktisch nichts außer die normale Session-Oberfläche bereitzustellen. Wenn jede Project Session `simple-chat` nutzt, ist Projects eine getrennte Kopie von Sessions.

Komplexere Workflows können später Graphen mit Zuständen, Entscheidungen und Aktionen definieren. Beispiel:

```text
specs -> plan -> implementation -> agent_test -> human_review -> cleanup -> completed
                         ^                 |
                         |                 v
                    needs_changes      discarded
```

Das wäre ein `standard-project` Workflow für Feature-/Bugfix-Arbeit.

## 15. Was Workflow-UI nicht tun darf

Workflow darf die normale Session-Oberfläche nicht ersetzen.

Falsch wäre:

- Projects als reine Statuskarten-Seite
- Projects als Settings-/Context-Files-artige Verwaltungsseite
- ein Workflow-Dashboard ohne Composer
- ein Workflow-Dashboard ohne Terminal/Transcript
- ein Project Session View ohne normale Trace-Inspektion

Richtig ist:

- normaler Project Session Header
- Terminal/Transcript wie bei Sessions
- Composer wie bei Sessions
- Session Tree mit Sub-Sessions wie bei Sessions
- zusätzlich Workflow-Chips, Workflow-Auswahl, Workflow-State, Review-/Cleanup-Aktionen

Workflow ist eine zusätzliche Produktschicht über der Session, nicht der Ersatz für Chat.

## 16. Standard-Project als erster komplexer Workflow

`standard-project` ist der erste sinnvolle komplexe Workflow. Er soll eine typische Coding-Aufgabe abbilden:

1. Specs klären oder aktualisieren
2. Plan erstellen
3. Implementieren
4. Agent testet selbst
5. Mensch reviewt
6. Mensch akzeptiert, schickt zurück oder verwirft
7. Cleanup und Abschluss

Der Workflow soll später Zustände, Transitionen, Retry-Zähler, Review-Gründe und Cleanup-Entscheidungen dauerhaft speichern.

## 17. Agent Profile im Zusammenhang mit Projects

Project Sessions sollen weiterhin normale Agent Profile verwenden. Ein Project sagt nicht automatisch, welche Tools ein Agent hat. Das Profil bestimmt die Fähigkeiten.

Beispiele:

- Ein Project Session kann mit dem Codex-kompatiblen Profil laufen.
- Ein Project Session kann mit einem Custom Agent laufen.
- Subagents können aus einer Project Session heraus gestartet werden.
- Der Workflow bestimmt den Prozess, nicht die komplette Runtime-Fähigkeit.

Das trennt zwei Fragen:

```text
Agent Profile: Was kann der Agent?
Workflow: In welchem Prozess arbeitet diese Project Session?
```

## 18. Docker-Worker und Worktrees

Für echte Coding-Workflows soll eine Project Session isoliert arbeiten. Das geplante Ziel:

- Project hat einen Quell-Projektordner.
- Jede execution-fähige Main Project Session bekommt einen eigenen Worktree.
- Jede execution-fähige Project Session bekommt einen Docker Compute Worker.
- Sub-Sessions können ebenfalls eigene isolierte Workspaces bekommen.
- Builds, Tests, Browserchecks und Gateway-Restarts laufen im Worker, nicht im Host-Checkout.
- Cleanup hilft später beim Entscheiden, was behalten, verworfen, gepusht oder gemergt wird.

Für `simple-chat` muss das nicht zwingend sofort passieren. Für `standard-project` ist es ein wichtiger Produktteil.

## 19. Aktueller Stand im Repository

Aktuell existiert die Projects-Idee vor allem in Specs und alten Artefakten:

- `spec/spec-product-projects-area.md` ist die zentrale Projects-Spec.
- Diese Spec wurde jetzt präzisiert: Projects soll ein getrenntes, session-artiges Modul sein, mit eigener Route-/Datenisolation und `simple-chat` als Baseline-Workflow.
- Alte Stash-Artefakte enthalten frühere Workflow- und Projects-Ansätze.
- Der aktuelle aktive Source enthält noch keinen fertigen Projects-Tab.
- Alte Build-Artefakte unter `dist/workflows/*` zeigen, dass es schon Workflow-Prototypen gab.
- Die Dev-Datenbank enthielt alte `standard-project` Workflow Runs, aber diese Implementierung ist nicht mehr aktiv in der aktuellen App.

Für die Diskussion sollte man also zwischen drei Dingen unterscheiden:

1. dem bestehenden Sessions-Modul, das real funktioniert,
2. der Product-Spec für Projects,
3. alten Workflow-Prototypen, die nicht als aktueller Implementierungsstand gelten.

## 20. Wichtige Designentscheidung für das Gespräch

Die zentrale offene Designfrage ist nicht, ob Projects wie Sessions aussehen soll. Das soll es ausdrücklich.

Die zentrale Frage ist, wie Projects als getrenntes Produktmodul modelliert wird, ohne die vorhandene Sessions-Architektur zu duplizieren oder zu zerbrechen.

Mögliche Leitfrage:

> Wie bauen wir Projects so, dass es V1 wie ein separater Sessions-Tab mit `simple-chat` Workflow funktioniert, aber später komplexe Workflow-Graphen, Worktrees, Docker-Worker, Review und Cleanup aufnehmen kann?

## 21. Diskussionsfragen

Diese Fragen sollten im Gespräch geklärt werden:

1. Soll Projects eigene Datenbanktabellen bekommen, oder reicht ein harter `module = "projects"` Discriminator in bestehenden Room-/Session-Tabellen?
2. Soll der Personal Chat im Projects-Tab echte Sessions-Daten zeigen oder nur als Navigations-/Convenience-Entry zurück in den normalen Personal Chat führen?
3. Ist `simple-chat` der Default für neue Project Sessions, oder soll der Benutzer beim Erstellen den Workflow wählen?
4. Wann wird ein Project als konfiguriert betrachtet: sofort bei Erstellung oder erst nach Auswahl eines Projektordners?
5. Soll `standard-project` schon in V1 sichtbar sein, oder erst nach der isolierten Worker-/Worktree-Integration?
6. Wie hängen Workflow Runs an Pibo Sessions: nur über Metadata, über eigene Link-Tabelle, oder beides?
7. Wie sollen Sub-Sessions in komplexen Workflows behandelt werden: nur delegierte normale Sessions oder eigene Workflow-Knoten?
8. Welche Actions gehören in den ersten Workflow-State: nur manuelle State-Wechsel oder echte agentische Ausführung?
9. Wie viel Cleanup-Automation ist sicher, bevor der Benutzer explizit bestätigen muss?
10. Welche Teile des bestehenden Sessions-Codes sollten extrahiert werden, damit Sessions und Projects dieselbe UI-Struktur nutzen, aber getrennte Daten laden?

## 22. Kurze Zielbeschreibung

Projects soll kein neues Dashboard sein. Projects soll ein zweites Sessions-artiges Modul sein.

In der einfachsten Form ist eine Project Session eine normale Chat Session mit dem `simple-chat` Workflow. Dadurch kann Projects als getrenntes Modul mit denselben UX-Qualitäten wie Sessions starten. Danach kann Pibo komplexere Workflows wie `standard-project` ergänzen, ohne den Chat-, Terminal-, Trace- und Subagent-Kern zu verlieren.

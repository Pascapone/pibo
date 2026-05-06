# Codex Harness Analyse fuer Pibo Agent-Experience-Paritaet

Stand: Analyse des lokalen Repos `~/code/codex` am 2026-05-01.

## Ziel

Dieses Dokument beschreibt, wie Codex als Agent-Harness aufgebaut ist, welche model-sichtbaren Tools und Agent-Mechanismen standardmaessig vorhanden sind, und welche davon fuer Pibo wirklich relevant sind. Das Ziel ist bewusst enger als ein Codex-Klon: Ein auf Codex getrimmtes Modell soll sich in Pibo moeglichst wie in Codex fuehlen, ohne dass Pibo das gesamte Codex-Oekosystem, Planmode, Marketplace-Plugins oder die komplette TUI/Approval-UX nachbauen muss.

## Kurzfazit

Fuer euer Ziel ist nicht die gesamte Codex-Architektur entscheidend, sondern fast nur das, was das Modell tatsaechlich sieht:

1. einen vertrauten Prompt-Rahmen
2. vertraute Toolbeschreibungen auf Pibo-Run-Basis
3. Pibo-Subagent-Semantik mit Codex-aehnlichem Arbeitsgefuehl
4. dasselbe Skill-Modell auf `SKILL.md`-Basis
5. Projektinstruktionen wie `AGENTS.md`, `RULES.md`, `GLOSSARY.md`
6. einen expliziten Laufzeitkontext

Der zentrale Punkt ist deshalb nicht "Codex komplett nachbauen", sondern "die agent-sichtbare Welt von Codex in Pibo glaubwuerdig spiegeln".

Was dafuer primaer nachgebaut werden sollte:

- `bash` aus dem Pibo Run-Paket als Shell-Oberflaeche
- `apply_patch`
- `view_image`
- `web_search`
- Subagents ueber Pibos generierte `pibo_subagent_*`- und `pibo_run_*`-Tools
- dieselben Agent-Rollen `default`, `explorer`, `worker`
- derselbe Skills-Contract mit `SKILL.md`
- hierarchische Projektinstruktionen und expliziter Environment-Context

Was fuer dieses Ziel nicht primaer noetig ist:

- Codex-Plugin-/Marketplace-Oekosystem
- Codex-Planmode
- Codex-App-Server-Parity
- Codex-TUI-Popups, Tooltip-Boxen und Approval-UX im Detail
- MCP-Parity ueber den Codex-Weg, wenn Pibo dafuer bereits einen eigenen Pfad hat

## 0. Engere Zieldefinition fuer Pibo

Die bisherige breite Analyse ist als Referenz nuetzlich, aber sie setzt den Schwerpunkt etwas falsch. Fuer Pibo geht es hier nicht um Harness-Parity im Vollsinn, sondern um agent-visible parity.

Pragmatisch heisst das:

- Der Agent muss in einer vertrauten, aber Pibo-nativen Toolwelt arbeiten.
- Der Agent muss dieselben Kernkonzepte sehen: Tools, Subagents, Runs, Skills, Repo-Instruktionen, Environment.
- Alles, was nur fuer Menschen, Clients oder Marketplace-Verwaltung existiert, ist nachrangig, solange es nicht als Prompt- oder Tooloberflaeche beim Modell ankommt.

Das ist fuer Pibo besonders passend, weil eure bestehende Architektur bereits genau die richtige Trennung hat:

- Pi Coding Agent bleibt die innere Engine.
- Pibo besitzt den aeusseren Produkt-Rahmen.
- Profiles in `src/core/profiles.ts` selektieren bereits Tools, Skills, Subagents und Context Files.
- `src/core/runtime.ts` baut bereits eine Runtime aus Profil plus Custom-Tools plus Skill-Pfaden.

Das bedeutet: Ihr muesst keinen Codex-Klon bauen. Ihr muesst vor allem einen Codex-kompatiblen Profil-, Prompt- und Tool-Surface bauen.

## 1. Architekturueberblick

Die wichtigsten Schichten im Repo:

- `codex-rs/core`: Promptaufbau, Session/Turn-Steuerung, Skills, Plugins, Agent-Control, Tool-Handler.
- `codex-rs/tools`: Tooldefinitionen und Tool-Registry-Plan.
- `codex-rs/tui`: CLI/TUI-UX, Notifications, Tooltips, Popups, Statusflaechen.
- `codex-rs/app-server`: JSON-RPC-Server fuer IDEs und andere Clients.
- `codex-rs/skills`: gebuendelte System-Skills, die nach `CODEX_HOME/skills/.system` installiert werden.
- `sdk/python` und `sdk/typescript`: SDKs fuer die App-Server-Schnittstelle.

Wichtig fuer Pibo: In Codex ist der "Agent" nicht nur der Responses-Loop. Die eigentliche Nutzbarkeit entsteht durch die Kombination aus:

- Tool-Schema
- passende Developer Instructions
- Repo-spezifische User Instructions
- Environment-Context
- UI/Event-Layer

## 2. Prompt- und Kontext-Harness

Die eigentliche Agent-Persoenlichkeit wird aus mehreren Bausteinen zusammengesetzt. In `core/src/codex.rs` werden pro Turn Developer- und Contextual-User-Sections gebaut.

### 2.1 Developer-Instructions-Quellen

Codex aggregiert u.a.:

- Permissions-/Sandbox-Instruktionen
- globale `developer_instructions`
- Memory-Tool-Instruktionen
- Collaboration-Mode-Instruktionen
- Personality-Instruktionen
- Apps-Sektion
- Skills-Sektion
- Plugins-Sektion
- Git-Commit-Attribution-Instruktionen

Das ist wichtig: Tools allein reichen nicht. Das Modell bekommt gleichzeitig Erklaerungen dazu, wann und wie diese Mechanismen zu verwenden sind.

### 2.2 User-/Projekt-Instruktionen

`core/src/project_doc.rs` liest hierarchisch `AGENTS.md` entlang des Pfads von Projekt-Root bis CWD. Optional koennen Fallback-Dateinamen genutzt werden. Diese Projekt-Dokumente werden als User-Instructions in den Prompt eingebaut.

Das Verhalten ist also aehnlich zu dem, was ihr in Pibo mit `RULES.md`, `GLOSSARY.md`, `AGENTS.md` etc. wollt.

### 2.3 Environment Context

Codex injiziert optional einen XML-artigen `<environment_context>`-Block mit:

- `cwd`
- `shell`
- `current_date`
- `timezone`
- `network` mit allow/deny domains
- `subagents`

Das ist ein zentraler Parity-Punkt. Ein Codex-trainiertes Modell erwartet oft explizite Laufzeitkontext-Bloecke, nicht nur "stillschweigend vorhandene" Umgebung.

## 3. Default Tool Surface

Die Quelle der Wahrheit fuer den Tool-Surface ist `codex-rs/tools/src/tool_registry_plan.rs`.

### 3.1 Default-Tools unter aktuellen Stable Defaults

Die Tests in `core/src/tools/spec_tests.rs` zeigen fuer aktuelle Defaults unter `Features::with_defaults()` typischerweise:

- Shell-Tool-Variante:
  - `shell` bei manchen Modellen
  - `shell_command` bei neueren Codex-/GPT-5.1-Varianten
- `update_plan`
- `request_user_input`
- `apply_patch` bei Modellen/Setups, die es unterstuetzen
- `web_search`
- `view_image`
- Pibo Run Control:
  - `pibo_run_*`
  - `pibo_subagent_*`

Wichtig: Der konkrete Shell-Toolname ist modell- und featureabhaengig. Ein Pibo-Plugin sollte deshalb entweder dieselben Namen anbieten oder sauber aliasen.

### 3.2 Shell/Run-Familie

Codex kennt mehrere Shell-Backends:

- `shell`
- `local_shell`
- `shell_command`

Die Auswahl erfolgt ueber `ToolsConfig`:

- Legacy/default shell
- `shell_command`

Fuer Pibo ist die Zielentscheidung anders: Das Codex-Compat-Profil nutzt das native Pibo-Run-`bash`-Tool. Langlaeufer, Status, Lesen, Abbrechen und Notifications gehoeren in Pibos Run-Control-Schicht.

### 3.3 Plan/User-Input

- `update_plan`: interne Fortschritts-/Plan-Checkliste.
- `request_user_input`: strukturierte Rueckfrage mit 1-3 kurzen Fragen.

Wichtig: Das Tool existiert grundsaetzlich, aber seine Verfuegbarkeit haengt teilweise vom Collaboration Mode bzw. Feature-Gating ab.

### 3.4 Edit-/Patch-Tools

- `apply_patch`

Es gibt Freeform- und Function-Varianten. Die Freeform-Variante ist fuer Codex-typisches Patchen sehr wichtig. Das Modell ist oft explizit auf diesen Patch-Flow ausgerichtet.

### 3.5 Search- und Wahrnehmungs-Tools

- `web_search`
- `view_image`
- optional `image_generation`

`view_image` ist ein lokales Bild-Wahrnehmungstool. `detail: "original"` kann feature- und modellabhaengig verfuegbar sein.

### 3.6 MCP-/Dynamic-/Discovery-Tools

Optional registrierbar:

- `list_mcp_resources`
- `list_mcp_resource_templates`
- `read_mcp_resource`
- direkte MCP-Tools
- `tool_search`
- `tool_suggest`
- Dynamic Tools aus Laufzeitdefinitionen

Das ist fuer Pibo sehr relevant: Codex behandelt "zusatzliche Faehigkeiten" nicht nur als Plugincode, sondern als einheitlich in denselben Tool-Raum eingespielte Capabilities.

### 3.7 Weitere optionale Tools

Feature-gated bzw. optional:

- `request_permissions`
- `js_repl`
- `js_repl_reset`
- `code_mode` + `wait`
- `list_dir`
- `test_sync_tool`
- Agent-Jobs fuer CSV-basierte Parallelisierung und Ergebnis-Reporting

## 4. Multi-Agent-System

Codex hat ein eingebautes Subagent-System, nicht nur "ein Tool, das irgendwas extern startet".

### 4.1 Pibo-Zielbild

Pibo bildet dieses Thema nicht ueber Codex-Lifecycle-Tools nach. Das Codex-Compat-Profil nutzt:

- `pibo_subagent_*` fuer rollenbasierte Child-Agents
- `pibo_run_*` fuer yielded Runs, Status, Lesen, Warten, Abbruch und Acknowledgement

Die Interface-Namen bleiben damit Pibo-nativ. Das gewuenschte Codex-Feeling kommt ueber Toolbeschreibungen, Prompt-Hinweise und aehnliche Arbeitsablaeufe, nicht ueber eine zweite Agent-Lifecycle-Schicht.

### 4.2 Codex-Referenzmodell

Codex arbeitet mit Agent-IDs und klassischem Request/Wait. Fuer Pibo relevant sind die Verhaltensmuster:

- Agent starten
- Zusatzinput senden
- bounded wait
- geschlossene Agenten wieder aufnehmen
- Agenten schliessen

### 4.3 V2-Referenzmodell

Unter `MultiAgentV2` wird auf Task-Pfade umgestellt:

- Task starten
- Nachricht senden
- Follow-up-Task erzeugen
- bounded wait
- Task schliessen
- Agents listen

Statt Agent-ID steht der kanonische Task-Name im Zentrum, z.B. `<HOME>/task_1/subtask_a`.

Wichtige V2-Eigenschaften:

- Child-Agents haben dieselben Tools wie der Parent.
- Child-Agents koennen selbst weitere Child-Agents spawnnen.
- Kommunikation laeuft ueber Mailbox-/Inter-Agent-Communication statt nur ueber direkte Blocking-Calls.
- Wait liefert in V2 absichtlich nur Mailbox-/Status-Summaries und nicht direkt den Final-Content.

### 4.4 Built-in Agent Roles

Standardmaessig existieren mindestens:

- `default`
- `explorer`
- `worker`

`explorer`:

- fuer eng umrissene Read-/Codebase-Fragen
- schnell, autoritativ
- parallelisierbar
- soll moeglichst keine redundante Exploration wiederholen

`worker`:

- fuer produktive Teilimplementierungen
- soll klaren Ownership-Scope bekommen
- soll wissen, dass andere Agents parallel im Code arbeiten

Wichtig: Es gibt eine eingebaute Rollen-Semantik, nicht nur freie Agent-Namen. Wenn ihr Codex-Parity wollt, solltet ihr genau diese Agent-Typen und ihre semantische Bedeutung uebernehmen.

### 4.5 Spawned-Agent-Kontext

Bei Spawn fuegt Codex zusaetzliche Developer Instructions fuer Child-Agents hinzu:

- du bist ein neu gespawnter Agent in einem Team
- du darfst selbst weitere Subagents spawnen
- deine `final`-Antwort wird an den Parent geliefert
- geerbte History ist nur Hintergrundkontext

Auch das ist ein wichtiger Parity-Punkt: Der Child-Agent ist promptseitig anders gerahmt als der Root-Agent.

## 5. Skills-System

Codex hat ein echtes Skills-System, nicht nur lose Prompt-Fragmente.

### 5.1 Struktur

Ein Skill basiert auf `SKILL.md` plus optionalen Assets, Referenzen, Scripts und `agents/openai.yaml`.

System-Skills werden aus `codex-rs/skills/src/assets/samples` nach `CODEX_HOME/skills/.system` installiert.

Im Repo sichtbare gebuendelte Skills:

- `openai-docs`
- `skill-creator`
- `skill-installer`
- `imagegen`
- `plugin-creator`

### 5.2 Skill-Aktivierung

Es gibt zwei Hauptpfade:

- explizite Skill-Mention
- implizite Skill-Aktivierung, z.B. anhand erkannter Befehle/Kommandos

Codex baut Skill-Injections in den Prompt ein und trackt sogar implizite Skill-Invocations analytisch.

### 5.3 Skill-Abhaengigkeiten

Codex kann fuer Skills zusaetzliche Abhaengigkeiten behandeln:

- benoetigte Env Vars
- benoetigte MCP-Server

Wenn erforderlich, wird der Nutzer ueber `request_user_input` nach fehlenden Skill-Env-Variablen gefragt. Es gibt auch Logik, fehlende MCP-Dependencies fuer Skills zu installieren oder vorzuschlagen.

### 5.4 Skill-Watching

Es gibt einen Skills-Watcher fuer lokale Aenderungen. Das zeigt: Skills sind als laufzeitnahe, aenderbare Runtime-Ressourcen gedacht.

## 6. Plugin-System

Codex-Plugins sind lokale Bundles aus Skills, MCP-Servern und Apps.

### 6.1 Manifest

Das Plugin-Manifest liegt unter:

- `.codex-plugin/plugin.json`

Wichtige Felder:

- `skills`
- `mcpServers`
- `apps`
- `interface.*` fuer UI/Marketplace-Darstellung

### 6.2 Laufzeitsemantik

Plugins werden nicht "direkt" aufgerufen. Stattdessen machen sie Capabilities sichtbar:

- Skills
- MCP-Tools
- Apps/Connectors

Codex rendert fuer den Agenten sogar explizite Plugin-Instruktionen:

- welche Plugins verfuegbar sind
- dass Plugin-Skills mit `plugin_name:` gepraefixt sein koennen
- dass der Agent bei Plugin-Mention bevorzugt Plugin-Capabilities verwenden soll

### 6.3 Wichtig fuer Pibo

Das ist nah an eurer Zielrichtung. Ein Codex-aehnliches Pibo-Plugin sollte deshalb nicht nur Tools registrieren, sondern moeglichst dieselbe abstrakte Plugin-Semantik liefern:

- Plugin als Bundle
- Plugin nicht direkt callen
- darunterliegende Skills/MCP/Apps callen
- Plugin-spezifische Discovery- und Preference-Hinweise in den Prompt injizieren

## 7. App-Server und Runtime-Modell

`codex app-server` ist die zentrale Schnittstelle fuer reiche Clients wie VS Code.

### 7.1 Kernobjekte

Der App-Server arbeitet mit drei Primitiven:

- `Thread`
- `Turn`
- `Item`

Das ist eine saubere, persistierbare Agent-Runtime-Struktur und fuer Pibo sehr lehrreich.

### 7.2 Protokoll

- JSON-RPC 2.0 aehnlich MCP
- `stdio` default
- optional WebSocket

### 7.3 Relevante API-Familien

- Thread/Turn-Lifecycle
- `command/exec*`
- `fs/*`
- `model/list`
- `skills/list`
- `plugin/list`, `plugin/read`, `plugin/install`
- `app/list`
- `mcpServer/*`
- `config/*`
- `tool/requestUserInput`
- Realtime / Voice / Experimental APIs

Fuer euer Ziel heisst das: Codex denkt Client-Integration nicht als TUI-only, sondern als allgemeine Agent-Runtime mit stabilem RPC-Modell.

## 8. Notifications, Tooltip-Boxen und UX

Der von dir angesprochene "Notification / Education Box"-Teil ist real und mehrschichtig vorhanden.

### 8.1 Desktop-/Terminal-Notifications

Im TUI gibt es Notification-Typen wie:

- `agent-turn-complete`
- `approval-requested`
- `plan-mode-prompt`
- `user-input-requested`

Die Auslieferung erfolgt ueber:

- OSC 9
- BEL
- optional externes `notify`-Command aus der Config

Es gibt auch Fokusbedingungen wie "nur wenn Terminal unfocused".

### 8.2 Startup-Tooltips / Announcement Box

Codex hat eine dedizierte Tooltip-/Announcement-Mechanik:

- zufaellige Tooltips
- plan-/os-/version-spezifische Announcement-Tips
- remote geladen aus `announcement_tip.toml`

Das ist sehr wahrscheinlich genau die "Education Box", die du meinst. Sie ist kein zufaelliges UI-Detail, sondern ein eigenes Subsystem.

### 8.3 Approval- und Input-Popups

Die TUI hat eigene Views fuer:

- Exec-Approval
- Edit-Approval
- MCP-Elicitation
- `request_user_input`
- Skills/Plugins/Apps-Popups
- Model-/Reasoning-/Personality-Auswahl

Das Codex-Gefuehl kommt also stark davon, dass Modellfaehigkeiten sichtbar und interaktiv gerahmt werden.

## 9. Collaboration Modes

Codex verwendet eingebaute Collaboration-Mode-Presets, die als Developer Instructions injiziert werden.

Aktuell sichtbar:

- `Plan`
- `Default`

Die Templates kommen aus `collaboration-mode-templates/templates/*.md`.

### 9.1 Default Mode

Kerngedanke:

- vernunftvolle Annahmen treffen
- ausfuehren statt zu blockieren
- Rueckfragen nur wenn noetig

### 9.2 Plan Mode

Kerngedanke:

- explorieren statt mutieren
- Fragen ueber `request_user_input`
- finalen Plan in `<proposed_plan>` rendern

Fuer Pibo ist das relevant, weil Codex nicht nur "ein allgemeiner Agent" ist, sondern deutlich modengesteuert promptet.

## 10. Mechanismen, die das Codex-Gefuehl stark praegen

Wenn ihr nur dieselben Toolnamen nachbaut, fehlt ein grosser Teil des Verhaltens. Diese Mechanismen sind aus meiner Sicht die wichtigsten:

### 10.1 Hierarchische Projektinstruktionen

- `AGENTS.md` entlang des Repo-Pfads
- zusaetzliche Config-Instruktionen
- optional JS-REPL-Abschnitte

### 10.2 Expliziter Laufzeitkontext

- `<environment_context>`
- sichtbare Sandbox-/Approval-Hinweise
- bekannte Shell / CWD / Datum / Netzregeln

### 10.3 Tool-Surface mit klaren Rollen

- plan/update
- shell/exec
- patch
- input elicitations
- image perception
- search
- subagents

### 10.4 Promptseitige Guidance fuer Toolbenutzung

Subagent- und Run-Tools sind nicht nur Funktionsschemata; sie tragen viel Policy/Gebrauchsanweisung im Tool-Description-Text.

### 10.5 Mailbox- und Completion-Mechanik fuer Agents

Subagents liefern nicht nur rohe Outputs; sie werden in den Parent-Flow ueber Mailbox, Notifications und strukturierte Waiting-Semantik eingebettet.

### 10.6 UX-Hinweise

- Notifications
- Announcement-/Tooltip-Boxen
- Popups fuer menschliche Entscheidungen
- Statusflaechen fuer laufende Prozesse

## 11. Was ihr fuer Pibo nachbauen solltet

Wenn das Ziel "fast wie Codex aus Sicht des Modells" ist, wuerde ich die Parity in drei Prioritaetsstufen sehen.

### 11.1 Muss-Parity

- vertraute Toolbeschreibungen fuer die Kern-Tools
- Pibo Run-`bash` als einzige Shell-Oberflaeche
- `apply_patch`
- `view_image`
- `web_search`
- Pibo-native Subagent- und Run-Control-Tools
- Agent-Rollen `default`, `explorer`, `worker`
- Skills weiter als `SKILL.md`-Bundles
- AGENTS.md/RULES/GLOSSARY als User-/Project-Instructions
- expliziter Environment-Context im Prompt
- ein Codex-aehnlicher System-/Developer-Prompt-Rahmen

Hinweis: `update_plan` und `request_user_input` sind nur dann Muss-Parity, wenn ihr das Modell exakt auf den heutigen Codex-Tool-Surface trimmen wollt. Fuer eure engere Zielsetzung koennen beide auch bewusst fehlen, solange Prompt und Toolwelt klar machen, dass der Agent direkt ausfuehren soll und Rueckfragen normal als Chattext stellt.

### 11.2 Sollte-Parity

- Toolbeschreibungen moeglichst nah an Codex formulieren, nicht nur Toolnamen
- Child-Agent-Prompting nah an Codex:
  - neuer Agent in Team
  - darf selbst weitere Agents spawnen
  - Final-Output geht an Parent
- Shell-Verhalten moeglichst PTY-nah, damit Langlaeufer und Interaktion vertraut wirken
- Plugin-/Skill-Injektionen als Prompt-Sektionen, falls ihr Plugin-Kontext dem Modell sichtbar machen wollt
- selektive Uebernahme statischer Codex-Systemprompt-Teile, sofern sie produktneutral sind

### 11.3 Spaeter wertvoll

- `update_plan`
- `request_user_input`
- Multi-Agent v2 mit Task-Pfaden und Mailbox
- `tool_search` / `tool_suggest`
- systemweite gebuendelte Skills
- feinere Notifications fuer Subagent-Completion
- App-Server-aehnliche JSON-RPC-Laufzeit fuer mehrere Clients
- Codex-nahe UX-Elemente fuer Menschen, wenn spaeter auch die Bedienoberflaeche angleichen soll

## 12. Konkrete Design-Implikationen fuer euren Plugin-Plan

Fuer ein spaeteres Pibo-Plugin, das einem Codex-optimierten Modell vertraut vorkommt, wuerde ich Folgendes empfehlen:

1. Baut zunaechst ein schmales `codex-compat`-Profil, nicht ein komplettes Codex-Subsystem.
2. Nutzt die bestehende Pibo-Profilstruktur in `src/core/profiles.ts` als Selektionsschicht fuer die sichtbare Codex-Welt:
   - native Tools mit Codex-kompatiblen Namen
   - sichtbare Skills
   - sichtbare Subagents
   - sichtbare Context Files
3. Nutzt `src/core/runtime.ts` als eigentlichen Docking-Punkt:
   - Skill-Pfade laden
   - Custom-Tools registrieren
   - Builtins bei Bedarf abschalten
   - Codex-kompatiblen Prompt-Rahmen injizieren
4. Fuegt dieselben eingebauten Agent-Rollen hinzu: `default`, `explorer`, `worker`.
5. Spiegelt die Prompt-Struktur nur soweit sie modellrelevant ist:
   - statischer Base-Systemprompt
   - Project docs
   - Environment context
   - Skills
   - optional sichtbarer Plugin-Kontext
6. Fuehrt Plugins nicht als neue mentale Tool-Art ein. Fuer das Modell zaehlen sichtbare Capabilities, nicht euer internes Plugin-Management.
7. Behandelt MCP explizit als out of scope fuer diese Parity-Arbeit, wenn Pibo dafuer bereits einen eigenen funktionierenden Pfad hat.

Die wichtigste praktische Konsequenz ist: Der groesste Teil der Arbeit liegt wahrscheinlich nicht in Pi oder in der Session-Runtime, sondern im Prompt-Builder und in einer sauberen Codex-kompatiblen Tool-/Subagent-Expose-Schicht.

## 12.1 Systemprompt-Uebernahme: ja, aber selektiv

Der frueher extrahierte Codex-Systemprompt ist wahrscheinlich nuetzlich, aber nur als Teil des Bildes.

Wichtig ist:

- Der statische Basisprompt praegt Stil, Tool-Nutzungsdisziplin und Delegationsverhalten.
- Das eigentliche Codex-Gefuehl kommt aber stark aus den konkreten Tool-Descriptions, den Developer-Instruktionen und dem sichtbaren Environment.
- Ein transplantierter Basisprompt ohne passende Toolwelt fuehlt sich fuer das Modell nicht wirklich wie Codex an.

Deshalb ist die sinnvolle Reihenfolge:

1. zuerst Toolnamen, Toolbeschreibungen, Subagent-Semantik, Skills und Environment angleichen
2. dann den statischen Codex-Basisprompt selektiv uebernehmen
3. dabei alles streichen, was sich auf Planmode, Approval-UX, Marketplace oder andere fuer Pibo irrelevante Produktteile bezieht

## 13. Wichtigste Quelldateien

Wenn ihr spaeter tiefer nachbauen wollt, sind das die wichtigsten Einstiegsdateien:

- Tool-Plan: `~/code/codex/codex-rs/tools/src/tool_registry_plan.rs`
- Tool-Definitionen: `~/code/codex/codex-rs/tools/src/lib.rs`
- Spawn-/Wait-Agent-Tools: `~/code/codex/codex-rs/tools/src/agent_tool.rs`
- Tool-Handler-Verdrahtung: `~/code/codex/codex-rs/core/src/tools/spec.rs`
- Tool-Router: `~/code/codex/codex-rs/core/src/tools/router.rs`
- Tool-Orchestrator: `~/code/codex/codex-rs/core/src/tools/orchestrator.rs`
- Prompt-/Context-Aufbau: `~/code/codex/codex-rs/core/src/codex.rs`
- Projektinstruktionen: `~/code/codex/codex-rs/core/src/project_doc.rs`
- Environment Context: `~/code/codex/codex-rs/core/src/environment_context.rs`
- Agent-Rollen: `~/code/codex/codex-rs/core/src/agent/role.rs`
- Multi-Agent v2 Spawn: `~/code/codex/codex-rs/core/src/tools/handlers/multi_agents_v2/spawn.rs`
- Skills Runtime: `~/code/codex/codex-rs/core/src/skills.rs`
- System-Skills Installation: `~/code/codex/codex-rs/skills/src/lib.rs`
- Plugin-Manifest: `~/code/codex/codex-rs/core/src/plugins/manifest.rs`
- Plugin-Manager: `~/code/codex/codex-rs/core/src/plugins/manager.rs`
- Plugin-Prompt-Injektion: `~/code/codex/codex-rs/core/src/plugins/render.rs`
- App-Server Ueberblick: `~/code/codex/codex-rs/app-server/README.md`
- TUI Notifications: `~/code/codex/codex-rs/tui/src/notifications/mod.rs`
- TUI Tooltips/Announcements: `~/code/codex/codex-rs/tui/src/tooltips.rs`
- Announcement-Konfiguration: `~/code/codex/announcement_tip.toml`

## 14. Zusammenfassung in einem Satz

Fuer euer Ziel braucht Pibo keinen Codex-Klon, sondern eine glaubwuerdige Codex-aehnliche agent-sichtbare Welt aus Prompt-Rahmen, Toolnamen, Subagent-Semantik, Skills, Projektinstruktionen und Environment-Context.

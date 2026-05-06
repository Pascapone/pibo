# Association Architecture Report

Stand: 2026-05-02.

Dieses Dokument haelt die bisherigen Erkenntnisse zur Association-Idee fest. Es ist bewusst eine Research- und Architektur-Notiz, kein Implementierungsspec.

## Idee

Association meint hier einen optionalen zusaetzlichen Wissenseinschub rund um Tool Calls.

Das Zielbild ist:

- ein Tool wird normal aufgerufen
- Pibo erkennt den Kontext dieses Tool Calls
- zusaetzlich werden relevante Informationen aus weiteren Wissensquellen geholt
- diese Informationen koennen beobachtbar, model-sichtbar oder nur spaeter abrufbar gemacht werden

Der gedankliche Kern ist nicht "noch ein separates Memory-System", sondern ein kontextsensitiver Erweiterungsmechanismus am Tool- und Runtime-Rand.

Beispiele:

- ein Bash-/Exec-Tool startet, und parallel wird semantisch nach relevanten Projekt-Dokumenten gesucht
- ein Read-/Grep-/Find-Tool laeuft, und Pibo liefert dazu verwandte Files, Specs oder historische Session-Hinweise
- ein Tool Result wird durch kompaktes Zusatzwissen angereichert
- ein Curator-Subagent entscheidet, welche der gefundenen Assoziationen wirklich sinnvoll genug fuer den Agenten sind

## Was wir gelernt haben

Die wichtigste Erkenntnis ist die Boundary-Frage:

- Pi Coding Agent sollte die innere Engine bleiben
- Pibo sollte die Association-Logik als Product-Boundary-Schicht besitzen

Die Idee passt also gut zu Pibo, aber nicht als breite Ausweitung des Pi-Cores.

Die zweite wichtige Erkenntnis:

- Ein zusaetzliches Feld in Pibo-Events allein reicht nicht, wenn der Agent das Wissen wirklich sehen soll
- model-sichtbare Association muss in den Tool-Result-Content, in eine spaetere Service-Message oder in einen weiteren Agent-Schritt gelangen

Die dritte wichtige Erkenntnis:

- "random" Injection ohne Policy waere architektonisch gefaehrlich
- Reproduzierbarkeit, Tokenbudget, Trust und Debuggability brauchen klare Modi und klare Grenzen

Association sollte deshalb nie ein unsichtbarer globaler Side Effect sein, sondern ein explizit konfigurierbarer Runtime-Mechanismus.

## Bestehende Hebel in Pibo

Pibo besitzt bereits mehrere gute Anschlussstellen:

- Profile waehlen Tools, Skills, Context Files und Subagents aus
- `src/core/runtime.ts` baut daraus Pi-`customTools`
- `src/core/routed-session.ts` normalisiert Toolcall- und Toolresult-Ereignisse in Pibo-Events
- `src/plugins/registry.ts` besitzt bereits Plugin- und Event-Registry-Strukturen
- Pibo hat bereits Subagents und yielded runs als native Konzepte

Das bedeutet:

- wir muessen keinen voellig neuen Runtime-Typ erfinden
- wir brauchen eher eine neue Hook-/Provider-Schicht fuer Tool-kontextuelle Wissensanreicherung

## Relevante Code-Stellen

Die folgenden Stellen sind fuer eine spaetere Umsetzung zentral:

- [src/core/runtime.ts](<HOME>/code/pibo/src/core/runtime.ts:105)
  Hier werden die aktiven `ToolDefinition[]` zusammengesetzt.

- [src/core/runtime.ts](<HOME>/code/pibo/src/core/runtime.ts:224)
  Hier werden die `customTools` an Pi uebergeben.

- [src/core/routed-session.ts](<HOME>/code/pibo/src/core/routed-session.ts:105)
  Hier wird aus Pi-Events ein Pibo-`tool_call` Event.

- [src/core/routed-session.ts](<HOME>/code/pibo/src/core/routed-session.ts:127)
  Hier werden `tool_execution_*` Events normalisiert.

- [src/core/events.ts](<HOME>/code/pibo/src/core/events.ts:235)
  Hier liegen die heutigen Pibo-Tool-Events. Aktuell gibt es noch kein Association-spezifisches Event oder Metadata-Feld.

- [src/plugins/types.ts](<HOME>/code/pibo/src/plugins/types.ts:172)
  Die Plugin-API kann heute Tools, Skills, Context Files und Event Listener registrieren, aber noch keine mutierenden Association-Provider oder Tool-Hooks.

- [src/plugins/registry.ts](<HOME>/code/pibo/src/plugins/registry.ts:310)
  Plugin-Events sind aktuell observe-only.

- [src/core/session-router.ts](<HOME>/code/pibo/src/core/session-router.ts:487)
  Hier werden Pibo-Output-Events an Plugins und Listener verteilt.

## Relevante Hebel in Pi

Pi selbst besitzt bereits Tool-Hooks, die fuer Built-in-Tools spaeter wichtig werden:

- [agent-session.ts](<HOME>/code/pi-mono/packages/coding-agent/src/core/agent-session.ts:372)
  `beforeToolCall`

- [agent-session.ts](<HOME>/code/pi-mono/packages/coding-agent/src/core/agent-session.ts:396)
  `afterToolCall`

Diese Hooks laufen ueber die Pi-Extension-Schicht.

Wichtige Schlussfolgerung:

- fuer Pibo-native `customTools` kann Pibo selbst wrappen
- fuer Pi-Built-ins wie `read`, `grep`, `find`, `bash` ist spaeter wahrscheinlich zusaetzlich eine Pi-Extension noetig, wenn wirklich jede Tool-Familie Associations bekommen soll

## Empfohlene Kernarchitektur

Die sauberste Form ist eine kleine Association-Schicht mit klaren Interfaces:

```text
Tool Call
  -> Association trigger
  -> Association runner
    -> semantic search provider
    -> knowledge graph provider
    -> session memory provider
    -> tool docs provider
    -> optional curator agent
  -> ranking / budget / policy
  -> injection or event emission
```

Der wichtigste neue Baustein waere ein `AssociationRunner`.

Er sollte:

- Trigger entgegennehmen
- passende Provider auswaehlen
- deren Ergebnisse zusammenfuehren
- nach Relevanz und Budget begrenzen
- entscheiden, ob diese Ergebnisse nur beobachtbar oder auch model-sichtbar werden

## Sinnvolle Interface-Richtung

Eine passende V1-Form waere ungefaehr:

```ts
type AssociationTrigger = "before_tool" | "after_tool" | "tool_error" | "message_finished";

type AssociationRequest = {
  piboSessionId: string;
  eventId?: string;
  toolCallId: string;
  toolName: string;
  args: unknown;
  result?: unknown;
  isError?: boolean;
  cwd: string;
  profileName: string;
  signal?: AbortSignal;
};

type Association = {
  id: string;
  title?: string;
  text: string;
  source: "semantic" | "graph" | "session" | "tool-docs" | "agent";
  score?: number;
  metadata?: Record<string, unknown>;
};

type AssociationProvider = {
  name: string;
  triggers: AssociationTrigger[];
  retrieve(request: AssociationRequest): Promise<Association[]>;
};
```

Das ist absichtlich klein. Die Schicht sollte am Anfang keine breite Plugin-Orgie werden.

## Injection-Modi

Association braucht klare Betriebsmodi. Mindestens diese Modi sind sinnvoll:

- `off`
  Keine Association.

- `observe`
  Nur Debug-/UI-/Event-Sichtbarkeit. Der Agent sieht nichts.

- `tool_result_append`
  Assoziationen werden als kompakter Block an den Tool-Result-Content angehaengt.

- `service_message`
  Nach dem Tool Result wird eine normale Pibo-Service-Message eingereiht.

- `background`
  Association wird als spaet abrufbarer Run oder Subagent im Hintergrund gestartet.

- `curated`
  Ein gesonderter Curator-Agent oder Curator-Provider filtert vor der Injection.

Die wichtigste V1-Erkenntnis dazu:

- `tool_result_append` ist der pragmatischste erste Modus
- er ist lokal, gut debugbar und direkt model-sichtbar

## Provider-Typen

Die Idee laesst mehrere Wissensquellen zu:

- Semantic Search / Embeddings / RAG
- Knowledge Graph
- Session Memory / frühere Arbeitskontexte
- Tool-spezifische Dokumentation
- repo-spezifische Specs oder Glossare
- Curator-Agent oder Subagent

Empfohlene Reihenfolge:

1. semantic search
2. tool docs / specs / context files
3. session memory
4. knowledge graph
5. curator agent

Reasoning:

- Semantic Search und Tool-Doku liefern den schnellsten Wert
- Knowledge Graph ist maechterig, aber deutlich teurer im Aufbau
- ein Curator-Agent sollte nicht V1-Default werden, weil sonst die Architektur sofort agentischer und schwerer testbar wird

## V1-Umsetzungsrichtung

Die beste erste Umsetzung waere:

1. ein neues Plugin, z. B. `pibo.associations`
2. ein `AssociationRunner`
3. Wrapping der Pibo-`customTools` in `src/core/runtime.ts`
4. ein kleiner Policy-/Config-Typ im Profil
5. ein kompakter Injection-Block im Tool-Result

Das Wrapping sollte auf der Pibo-Seite passieren, bevor die Tools an Pi uebergeben werden.

Konzeptuell:

```text
original tool.execute(...)
  -> execute original tool
  -> associationRunner.afterTool(...)
  -> append compact association block to result.content
  -> store structured association metadata in result.details
```

Damit waeren direkt abgedeckt:

- native Pibo-Tools
- Subagent-Tools
- Codex-Compat-Tools
- yielded run wrapper tools

Nicht automatisch abgedeckt waeren Pi-Built-ins. Dafuer braucht es spaeter die Pi-Extension-Ergaenzung.

## Erweiterung der Plugin-API

Heute ist die Pibo-Plugin-API noch zu schmal fuer diesen Fall.

Sinnvolle spaetere Erweiterungen:

```ts
registerAssociationProvider(provider)
registerToolHook(hook)
```

Ein moeglicher Pibo-Hook-Typ:

```ts
type PiboToolHook = {
  beforeToolCall?(ctx): Promise<void | ToolDecision>;
  afterToolCall?(ctx): Promise<void | ToolAssociationPatch>;
};
```

Wichtig ist dabei:

- Hooks muessen klein und testbar bleiben
- Provider und Hook-Entscheidungen duerfen nicht direkt in die Session-Router-Logik zerfliessen
- die Policy-Schicht sollte zentral sein, nicht pro Plugin wild verteilt

## Event-Modell

Pibo sollte wahrscheinlich neben den bestehenden Tool-Events ein eigenes Association-Event kennen.

Moegliche Richtung:

```ts
type PiboAssociationEvent = {
  type: "association";
  piboSessionId: string;
  eventId?: string;
  toolCallId?: string;
  toolName?: string;
  associations: Association[];
  visibleToModel: boolean;
  delivery: "event" | "tool_result" | "service_message" | "background";
};
```

Das trennt zwei Dinge sauber:

- observability / UI / debug
- model-sichtbare Injection

Diese zwei Ebenen duerfen nicht verwechselt werden.

## Agent Designer und Profil-Konfiguration

Association sollte spaeter profilierbar sein.

Das bedeutet:

- global aus/an
- pro Profil aus/an
- nur bestimmte Provider
- nur fuer bestimmte Tools
- Budgetgrenzen
- sichtbare Delivery-Strategie

Eine spaetere Profilform koennte etwa enthalten:

```ts
type AssociationPolicy = {
  enabled: boolean;
  providers: string[];
  injectIntoModel: boolean;
  maxAssociations: number;
  maxChars: number;
  timeoutMs: number;
  includeForTools?: string[];
  excludeForTools?: string[];
  delivery?: "tool_result" | "service_message" | "background";
};
```

Der Agent Designer koennte das spaeter als optionales Capability-Paket oder Profilsektion fuehren.

## Risiken und Bugs, die wir vermeiden muessen

Die Discovery hat mehrere Risikoklassen gezeigt:

- fehlende Reproduzierbarkeit
  Zufalls-Injection ohne Policy fuehrt zu schwer debugbarem Agentverhalten.

- Token-Fresser
  Ein RAG-Layer auf jedem Tool Call kann den Turn unverhaeltnismaessig aufblasen.

- vermischte Wahrheiten
  Tool-Result und Association duerfen nicht so zusammengemischt werden, dass der Agent Zusatzwissen fuer den eigentlichen Tool Output haelt.

- Trust und Secrets
  Association-Provider brauchen klare Source-Klassifikation und spaeter evtl. Access Rules.

- Parallelitaet
  Tool Calls koennen parallel laufen. Association muss pro `toolCallId` isoliert, timeout-begrenzt und abort-faehig sein.

- unklare Ownership
  Wenn jede Plugin-Schicht selbst Knowledge injiziert, zerfaellt das System. Die zentrale Policy ist Pflicht.

## Was explizit nicht V1 sein sollte

Diese Dinge sollten in V1 bewusst nicht hinein:

- vollstaendiger Knowledge Graph Builder als Pflichtbestandteil
- automatischer Curator-Subagent fuer jeden Tool Call
- globale Injection fuer alle Pi-Built-ins ohne klare Policy
- nicht deterministische Zufalls-Injection
- breit verteilte Plugin-Side-Effects ohne zentrales Budgeting

V1 sollte bewusst klein bleiben.

## Empfohlene naechste Schritte

1. Einen kleinen Spec fuer `pibo.associations` schreiben.
2. V1 auf `after_tool` fuer Pibo-native `customTools` begrenzen.
3. Nur zwei Provider vorsehen:
   `semantic-search` und `tool-docs`.
4. Delivery zuerst nur als `tool_result_append`.
5. Ein eigenes `association` Output Event einfuehren.
6. Danach pruefen, ob Pi-Built-ins ueber eine Pi-Extension dieselbe Schicht bekommen sollen.

## Endfazit

Die Association-Idee ist architektonisch tragfaehig und passt gut zur Pibo-Richtung, solange sie als Pibo-eigene Hook-/Provider-Schicht gebaut wird.

Der richtige Kern ist nicht ein monolithisches Memory-System, sondern:

- Tool-kontextuelle Trigger
- Provider fuer zusaetzliches Wissen
- zentrale Policy, Budgetierung und Delivery
- klare Trennung zwischen beobachtbaren Events und model-sichtbarer Injection

Wenn diese Grenzen sauber gehalten werden, kann Association spaeter sowohl RAG als auch Graph, Session-Memory und agentische Kuratierung aufnehmen, ohne dass Pibo seine Architekturgrenzen verliert.

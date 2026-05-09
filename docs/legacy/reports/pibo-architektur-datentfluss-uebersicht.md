# Pibo Architektur – Datenfluss Übersicht

> Persönliches Dokument. Kein Fluff. Nur Code und Datenflüsse.

---

## 1. Gateway Startup

```ts
// src/gateway/web.ts

async function runWebGatewayServer(options) {
    const pluginRegistry = createWebPiboPluginRegistry(options);
    // Plugins: BetterAuth, WebHost, ContextFiles, ChatWeb
    
    const server = new PiboGatewayServer({ ...options, pluginRegistry });
    await server.start();
    // Server startet TCP-Socket auf Port 4788 (default)
}

// src/gateway/server.ts
class PiboGatewayServer {
    async start() {
        this.sessionStore = await createGatewaySessionStore(options);
        this.router = new PiboSessionRouter(this.sessionStore);
        
        // Starte alle Channels aus der Plugin-Registry
        for (const channel of this.pluginRegistry.channels) {
            await channel.start();
            this.startedChannels.push(channel);
        }
        
        // TCP-Server für Gateway-Protokoll
        this.server = createServer((socket) => {
            this.handleConnection(socket);
        });
    }
}
```

**Wichtig:** Der Gateway ist ein TCP-Server (nicht HTTP!). Plugins registrieren sich und bringen ihre eigenen HTTP-Server mit.

---

## 2. Plugin-Registry & Web-Host

```ts
// src/plugins/registry.ts

class PiboPluginRegistry {
    plugins: PiboPlugin[] = [];
    channels: PiboChannel[] = [];
    
    registerPlugin(plugin) {
        this.plugins.push(plugin);
        if (plugin.channel) this.channels.push(plugin.channel);
    }
}

// src/plugins/web.ts – WebHost Plugin

function createPiboWebHostPlugin(options) {
    return {
        name: "web-host",
        channel: {
            async start() {
                // Startet HTTP-Server (z.B. auf localhost:4789)
                this.httpServer = createServer(this.handleRequest);
                this.httpServer.listen(options.port, options.host);
            },
            
            async handleRequest(req, res) {
                // Routet an registrierte WebApps
                for (const app of registeredWebApps) {
                    if (req.url.startsWith(app.mountPath)) {
                        return app.handle(req, res, context);
                    }
                }
            }
        }
    };
}
```

**Datenfluss:**
```
Browser → HTTP → WebHost Plugin → ChatWebApp → Handler
```

---

## 3. Chat Web App Lifecycle

```ts
// src/apps/chat/web-app.ts

const CHAT_WEB_MOUNT_PATH = "/apps/chat";
const CHAT_WEB_API_PREFIX = "/api/chat";

function createChatWebApp(context, state) {
    // State ist SINGLETON pro Gateway-Instanz
    return {
        name: CHAT_WEB_APP_NAME,
        mountPath: CHAT_WEB_MOUNT_PATH,
        
        async init() {
            state.readModel = createDefaultChatWebReadModel();
            state.eventLog = createDefaultChatEventLog();
            state.roomStore = createDefaultPiboRoomStore();
            state.agentStore = createDefaultCustomAgentStore();
            state.liveListeners = new Set();  // ← SSE-Listener
            state.traceCache = new Map();
        },
        
        async start(context) {
            // Subscribt auf den Channel-Context (wo die Pi-Coding-Agent Events hereinkommen)
            subscribeToChannel(context, state);
        },
        
        async handle(request, context) {
            // Routing:
            // GET /api/chat/bootstrap → bootstrapHandler
            // GET /api/chat/trace/:id → traceHandler
            // GET /api/chat/events → createEventStream (SSE!)
            // POST /api/chat/rooms/:id/messages → sendMessageHandler
            // ...
        }
    };
}
```

---

## 4. Event Flow: Backend → Frontend

```ts
// 4a. Pi Coding Agent produziert ein Event
// (irgendwo im Pi Coding Agent Core)

const event: PiboOutputEvent = {
    type: "assistant_delta",
    piboSessionId: "chat:abc123",
    eventId: "turn-1",
    text: "Hello",
};

// 4b. Channel-Context emittiert das Event
// → Alle Subscriber bekommen es

// 4c. Chat Web App ist Subscriber
// src/apps/chat/web-app.ts:687

function subscribeToChannel(context, state) {
    state.unsubscribe = context.channelContext.subscribe((event) => {
        const session = context.channelContext.getSession(event.piboSessionId);
        const room = session ? ensureSessionRoom(state, context, session) : undefined;
        
        // 1. Event in EventLog speichern (SQLite, mit streamId)
        const stored = state.eventLog.appendOutputEvent(event, {
            roomId: room?.id,
            actorId: session?.ownerScope,
        });
        
        // 2. Event in ReadModel speichern (web_chat_events Tabelle)
        state.readModel.recordEvent(event, session, stored.streamId);
        
        // 3. Event an ReliabilityStore (für Retries/Recovery)
        state.reliabilityStore.append({ ... });
        
        // 4. Event an ALLE aktiven SSE-Listener weitergeben
        for (const listener of state.liveListeners) {
            listener(stored);  // ← Das ist der LIVE-PUSH!
        }
    });
}
```

**Datenfluss Backend:**
```
Pi Agent → ChannelContext.emit() → ChatWebApp.subscribe()
    → eventLog.appendOutputEvent()      [chat_events Tabelle]
    → readModel.recordEvent()           [web_chat_events Tabelle]
    → reliabilityStore.append()         [reliability Tabelle]
    → liveListeners.forEach(l => l(stored))  [SSE-Push]
```

---

## 5. SSE Stream Flow

```ts
// src/apps/chat/web-app.ts:1507

function createEventStream({ roomId, piboSessionId, context, state, cursor }) {
    const streamId = randomUUID();
    
    return new ReadableStream({
        start(controller) {
            // 1. Sende "ready" Event
            writeSse(controller, "pibo", { type: "ready", piboSessionId });
            
            // 2. Sende alle bestehenden Events aus dem EventLog
            //    (für Reconnects: ab "cursor" weitersenden)
            for (const stored of state.eventLog.listEvents({
                roomId, piboSessionId,
                afterStreamId: cursor ? cursor.streamId - 1 : undefined,
                limit: 1000,
            })) {
                writeStoredChatEventFrames(controller, stored, streamState, cursor);
            }
            
            // 3. Registriere Listener für NEUE Events
            const listener = (stored) => {
                if (!storedEventMatches(stored, { roomId, piboSessionId })) return;
                writeStoredChatEventFrames(controller, stored, streamState);
            };
            state.liveListeners.add(listener);
            
            // 4. Heartbeat alle 25 Sekunden
            heartbeat = setInterval(() => writeSseComment(controller, "heartbeat"), 25000);
        },
        
        cancel() {
            state.liveListeners.delete(listener);
            clearInterval(heartbeat);
        }
    });
}
```

**Wichtig:** `liveListeners` ist ein `Set` im globalen App-State. Jeder SSE-Stream fügt einen Listener hinzu. Wenn ein Event hereinkommt, wird es an **alle** verbundenen Clients gepusht.

---

## 6. Stream-Adapter: PiboOutputEvent → ChatStreamEvent

```ts
// src/apps/chat/stream.ts

function chatStreamFramesFromOutputEvent(event, state): ChatStreamEvent[] {
    const frames = [];
    
    switch (event.type) {
        case "assistant_delta":
            const messageId = textMessageIdFromOutputEvent(event);
            ensureTextMessageStarted(frames, state, messageId, eventId);
            frames.push({
                type: "TEXT_MESSAGE_CONTENT",
                messageId, runId: eventId, delta: event.text
            });
            break;
            
        case "assistant_message":
            frames.push({ type: "TEXT_MESSAGE_END", messageId, runId: eventId, finalText: event.text });
            break;
            
        case "thinking_delta":
            frames.push({ type: "REASONING_MESSAGE_CONTENT", messageId, runId: eventId, delta: event.text });
            break;
            
        case "tool_call":
            ensureToolCallStarted(frames, state, event.toolCallId, event.toolName, event.args, eventId);
            frames.push({ type: "TOOL_CALL_ARGS", toolCallId: event.toolCallId, args: event.args, argsComplete: event.argsComplete });
            break;
            
        case "tool_execution_finished":
            frames.push({ type: "TOOL_CALL_RESULT", toolCallId: event.toolCallId, result: event.result, isError: event.isError });
            break;
    }
    
    return frames;
}
```

**Ein PiboOutputEvent kann MEHRERE ChatStreamEvents erzeugen.**

**Beispiel:**
```
assistant_delta { text: "hel" }
→ [TEXT_MESSAGE_START, TEXT_MESSAGE_CONTENT]

assistant_delta { text: "lo" }
→ [TEXT_MESSAGE_CONTENT]

assistant_message { text: "hello" }
→ [TEXT_MESSAGE_END]
```

---

## 7. Trace Engine Flow

```ts
// src/shared/trace-engine.ts

function buildTraceViewFromEvents(input: TraceBuildInput): PiboSessionTraceView {
    // 1. Transcript-Einträge aus der Pi Session laden
    const entries = projectTranscriptEntries(input.transcriptEntries, sessionStatus, openEventIds);
    
    // 2. Nodes aus Transcript-Einträgen bauen
    const nodes = traceNodesFromEntries(session.id, entries);
    //    → user.message, assistant.message, tool.call, etc.
    
    // 3. Event-Log Events verarbeiten
    for (const storedEvent of input.events) {
        const payload = storedEvent.payload as PiboOutputEvent;
        
        if (payload.type === "assistant_delta") {
            mergeAssistantDeltaEvent(nodes, byId, payload, ...);
        } else if (payload.type === "thinking_delta") {
            mergeThinkingDeltaEvent(nodes, byId, payload, ...);
        } else {
            const node = traceNodeFromEvent(session.id, payload, ...);
            if (node) {
                // Deduplizierung: agent.turn, assistant.message, tool.call
                upsertOrMergeNode(nodes, byId, node);
            }
        }
    }
    
    // 4. Kinder zu Parent-Nodes nesten
    const nestedNodes = nestTraceNodes(nodes);
    
    // 5. Async-Agent-Run Status reconcilieren
    reconcileAsyncAgentRunStatuses(nestedNodes);
    
    // 6. Sortieren
    sortTraceNodes(nestedNodes);  // ← DOPPELT (nestTraceNodes sortiert auch)
    
    return {
        piboSessionId: input.session.id,
        nodes: nestedNodes,
        rawEvents: input.events.slice(-limit),
        ...
    };
}
```

**Wichtige Datenstrukturen:**

```ts
// PiboTraceNode
{
    id: "event:assistant_delta:abc123",
    piboSessionId: "chat:abc123",
    type: "assistant.message",  // | "agent.turn" | "tool.call" | ...
    title: "Agent Message",
    status: "running",  // | "done" | "error"
    summary: "Hello world",
    output: "Hello world",
    orderKey: { sourceRank: 1, turnSeq: 42, phaseRank: 8, ... },
    children: [],  // ← nested hierarchy
    ...
}
```

**Sortierung:** `compareTraceOrder` vergleicht zuerst `turnSeq`, dann `transcriptIndex`, dann `eventSequence`, dann `streamId`, dann `streamFrameIndex`, dann `phaseRank`, dann `sourceRank`.

---

## 8. Frontend State Flow (3-Schichten-Modell)

```ts
// src/apps/chat-ui/src/App.tsx – SessionTracePane (nach Refactor)

function SessionTracePane({ selectedPiboSessionId, ... }) {
    const [allEvents, setAllEvents] = useState<ChatWebStoredEvent[]>([]);
    
    // 1. Lade Trace aus API (React Query)
    const traceQuery = useQuery({
        queryKey: chatTraceQueryKey(selectedPiboSessionId, { includeRawEvents: true, rawEventsLimit: 10000 }),
        queryFn: () => loadTraceQueryData(queryClient, selectedPiboSessionId, { includeRawEvents: true, rawEventsLimit: 10000 }),
    });
    
    // 2. Initialisierung / Refresh: Events vom Backend übernehmen
    useEffect(() => {
        if (traceQuery.data) {
            setAllEvents(traceQuery.data.rawEvents);
        }
    }, [traceQuery.data]);
    
    // 3. SSE-Stream für Live-Events
    useEffect(() => {
        const events = new EventSource(`/api/chat/events?piboSessionId=${selectedPiboSessionId}&since=${latestStreamId}`);
        
        events.addEventListener("pibo", (message) => {
            const event = chatStreamEvent(message);
            // Nur RAW_EVENT-Frames werden dem allEvents-Array hinzugefügt
            if (event.type === "RAW_EVENT") {
                setAllEvents(current => [...current, adaptRawEvent(event)]);
            }
        });
    }, [latestStreamId]);
    
    // 4. Shared Engine: Baue TraceView bei JEDER Änderung komplett NEU
    //    Kein inkrementelles Patching mehr. Der gleiche Code wie im Backend.
    const currentTraceView = useMemo(() => {
        return buildTraceViewFromEvents({
            session: selectedSession,
            events: allEvents,
            transcriptEntries: selectedSession?.entries,
            status: selectedSession?.status,
        });
    }, [allEvents, selectedSession]);
    
    // 5. Render-Vorbereitung: Mappe auf Span-Modell (ohne Neusortierung!)
    const selectedTrace = useMemo(() => {
        if (!currentTraceView) return null;
        return adaptTrace(currentTraceView.piboSessionId, currentTraceView.title, currentTraceView.nodes);
    }, [currentTraceView]);
}
```

**Datenfluss Frontend (3 Schichten):**
```
Schicht B (Transport):
  EventSource (SSE) → chatStreamEvent() → RAW_EVENT extrahieren → allEvents[]

Schicht A (Shared Engine):
  allEvents[] → buildTraceViewFromEvents() → PiboSessionTraceView
  (IDENTISCHER Code wie im Backend)

Schicht C (Render):
  PiboSessionTraceView → adaptTrace() → processSpanTree() → flattenVisibleSpans() → Virtuoso → DOM
```

**Wichtig:**
- `applyChatStreamEvent`, `upsertTraceNode`, `mergeAssistantDeltaEvent` wurden entfernt.
- `adaptTrace` + `processSpanTree` sortieren nicht mehr neu (`compareSpans` entfernt).
- `buildTraceViewFromEvents` lebt in `src/shared/trace-engine.ts` und wird von Backend UND Frontend importiert.

---

## 9. Datenbank-Schema (vereinfacht)

```sql
-- web_chat_sessions
CREATE TABLE web_chat_sessions (
    pibo_session_id TEXT PRIMARY KEY,
    pi_session_id TEXT NOT NULL,
    status TEXT,  -- "idle" | "running" | "error"
    last_activity_at TEXT,
    ...
);

-- web_chat_events
CREATE TABLE web_chat_events (
    id TEXT PRIMARY KEY,
    pibo_session_id TEXT NOT NULL,
    event_sequence INTEGER,      -- ← NEU im Refactor
    event_id TEXT,
    stream_id INTEGER,           -- ← NEU im Refactor
    type TEXT NOT NULL,
    created_at TEXT NOT NULL,
    payload_json TEXT NOT NULL
);

-- chat_events (EventLog – separat von web_chat_events!)
CREATE TABLE chat_events (
    stream_id INTEGER PRIMARY KEY AUTOINCREMENT,
    room_id TEXT,
    pibo_session_id TEXT,
    event_id TEXT,
    event_type TEXT,
    retention_class TEXT,  -- "live_delta" | "trace_event" | ...
    payload_json TEXT,
    ...
);
```

**Wichtig:** Es gibt ZWEI Event-Tabellen:
1. `chat_events` – EventLog (für SSE-Stream, mit `stream_id` als Auto-Increment)
2. `web_chat_events` – ReadModel (für Trace-View, mit `event_sequence` pro Session)

**Warum zwei?**
- `chat_events` ist der "Wahrheits-Stream" – chronologisch global, für SSE
- `web_chat_events` ist die "Trace-Datenbank" – pro Session, für Trace-API

---

## 10. Kompletter Request-Flow: User sendet Nachricht

```
1. Browser: POST /api/chat/rooms/:id/messages
   Body: { text: "Hello" }

2. ChatWebApp.handle() → sendMessageHandler()
   → context.channelContext.emit({ type: "message", ... })
   → Event wird an Pi Coding Agent geschickt

3. Pi Coding Agent verarbeitet Nachricht
   → Produziert Events:
      message_started { eventId: "turn-1" }
      thinking_delta { eventId: "turn-1", text: "Let me think..." }
      assistant_delta { eventId: "turn-1", text: "Hello!" }
      tool_call { toolCallId: "call-1", toolName: "search" }
      tool_execution_finished { toolCallId: "call-1", result: "..." }
      assistant_delta { eventId: "turn-1", text: " Here is the result." }
      message_finished { eventId: "turn-1" }

4. ChannelContext.emit(event) → ChatWebApp.subscribe()
   → Für JEDES Event:
      a) eventLog.appendOutputEvent()  → chat_events Tabelle
      b) readModel.recordEvent()       → web_chat_events Tabelle
      c) liveListeners.forEach(l => l(stored))  → SSE-Push

5. Browser empfängt über EventSource:
   pibo: { type: "RUN_STARTED", runId: "turn-1" }
   pibo: { type: "REASONING_MESSAGE_CONTENT", messageId: "turn-1:thinking:0", delta: "Let me think..." }
   pibo: { type: "TEXT_MESSAGE_CONTENT", messageId: "turn-1", delta: "Hello!" }
   pibo: { type: "TOOL_CALL_START", toolCallId: "call-1", toolName: "search" }
   pibo: { type: "TOOL_CALL_RESULT", toolCallId: "call-1", result: "..." }
   pibo: { type: "TEXT_MESSAGE_CONTENT", messageId: "turn-1", delta: " Here is the result." }
   pibo: { type: "TEXT_MESSAGE_END", messageId: "turn-1", finalText: "Hello! Here is the result." }
   pibo: { type: "RUN_FINISHED", runId: "turn-1" }

6. Frontend verarbeitet jedes SSE-Event:
   a) RAW_EVENT wird extrahiert
   b) Zu allEvents hinzugefügt (mit neuer eventSequence)
   c) useMemo triggert → buildTraceViewFromEvents() auf ALLEN Events
   d) React re-rendert die Timeline

7. User refreshed den Trace manuell (oder Window-Focus-Refetch):
   → React Query fetched /api/chat/trace
   → Backend baut TraceView über buildTraceViewFromEvents(web_chat_events)
   → Frontend: setAllEvents(traceQuery.data.rawEvents)
   → Live-Events sind nun enthalten (streamId wird persistiert)
```

---

## 11. Key Files & Abhängigkeiten

```
src/
├── shared/
│   ├── trace-engine.ts          ← Zentrale Engine (1300 Zeilen)
│   ├── trace-types.ts           ← Shared Typen
│   └── trace-order.ts           ← Sortierlogik
│
├── apps/
│   ├── chat/
│   │   ├── web-app.ts           ← HTTP Routes, SSE, Event-Routing
│   │   ├── trace.ts             ← Backend-Wrapper für Engine
│   │   ├── read-model.ts        ← web_chat_events DB-Zugriff
│   │   ├── event-log.ts         ← chat_events DB-Zugriff (SSE-Stream)
│   │   └── stream.ts            ← PiboOutputEvent → ChatStreamEvent Adapter
│   │
│   └── chat-ui/
│       ├── src/
│       │   ├── App.tsx          ← React App, State, SSE-Client
│       │   ├── cache.ts         ← React Query Keys
│       │   ├── tracing/
│       │   │   ├── adapt.ts     ← PiboTraceNode → Span Mapping
│       │   │   └── traceTree.ts ← Span Tree Processing
│       │   └── api.ts           ← HTTP Client
│       │
│       └── vite.config.ts       ← Build-Config
│
├── gateway/
│   ├── web.ts                   ← Gateway Startup, Plugin-Registry
│   └── server.ts                ← TCP-Server, Session-Router
│
└── plugins/
    ├── registry.ts              ← Plugin-System
    ├── web.ts                   ← WebHost Plugin (HTTP-Server)
    ├── chat-web.ts              ← ChatWeb Plugin Registration
    └── better-auth.ts           ← Auth Plugin
```

---

---

## 12. Zoom: Das 3-Schichten-System (aktueller Stand)

> Der Refactor `shared-trace-state-machine` (Commit `7dd8b3d`, 2026-05-04) hat die Architektur von 5 Schichten auf 3 reduziert.

### Übersicht

```
┌─────────────────────────────────────────────────────────────────────────┐
│  SCHICHT A: Shared Trace Engine                                         │
│  src/shared/trace-engine.ts                                             │
│  Backend + Frontend nutzen IDENTISCHEN Code                             │
│  Input: ChatWebStoredEvent[] → Output: PiboSessionTraceView             │
├─────────────────────────────────────────────────────────────────────────┤
│  SCHICHT B: Transport                                                   │
│  API (HTTP / JSON) + SSE (Server-Sent Events)                           │
│  Bewegt Roh-Events und Snapshots zwischen Server und Browser            │
├─────────────────────────────────────────────────────────────────────────┤
│  SCHICHT C: Render                                                      │
│  React / Virtuoso                                                       │
│  Mappt PiboTraceNode[] auf Span-Tree und flache VisibleSpanRow[]        │
└─────────────────────────────────────────────────────────────────────────┘
```

---

### Schicht A: Shared Trace Engine

**Wo:** `src/shared/trace-engine.ts`

**Einstiegspunkt:**
```ts
export function buildTraceViewFromEvents(input: TraceBuildInput): PiboSessionTraceView {
    const entries = projectTranscriptEntries(input.transcriptEntries, sessionStatus, openEventIds);
    const nodes = traceNodesFromEntries(session.id, entries);
    
    for (const storedEvent of input.events) {
        const payload = storedEvent.payload as PiboOutputEvent;
        if (payload.type === "assistant_delta") {
            mergeAssistantDeltaEvent(nodes, byId, payload, ...);
        } else if (payload.type === "thinking_delta") {
            mergeThinkingDeltaEvent(nodes, byId, payload, ...);
        } else {
            const node = traceNodeFromEvent(session.id, payload, ...);
            if (node) upsertOrMergeNode(nodes, byId, node);
        }
    }
    
    const nestedNodes = nestTraceNodes(nodes);
    sortTraceNodes(nestedNodes);
    reconcileAsyncAgentRunStatuses(nestedNodes);
    
    return { piboSessionId: input.session.id, nodes: nestedNodes, rawEvents: input.events.slice(-limit), ... };
}
```

**Was passiert hier (und NUR hier):**
- Transcript-Einträge werden zu `PiboTraceNode[]` projiziert.
- Events werden verarbeitet, Deltas gemerged, Nodes dedupliziert.
- Kinder werden zu Parent-Nodes genestet.
- Der gesamte Baum wird sortiert (`compareTraceOrder`).
- Async-Agent-Run-Status wird reconciliert.

**Wichtig:** Diese Funktion läuft im **Backend** (für `/api/chat/trace`) und im **Frontend** (in `useMemo` bei jeder Änderung von `allEvents`). Es gibt keine inkrementelle Patch-Logik mehr.

---

### Schicht B: Transport

**Besteht aus zwei Teilströmen:**

**B1: SSE-Live-Stream**
```
Backend: eventLog.appendOutputEvent() → stored (mit streamId)
         → readModel.recordEvent(event, session, stored.streamId)
         → writeStoredChatEventFrames() → SSE-Frames → Browser

Browser: EventSource → chatStreamEvent() → RAW_EVENT extrahieren
         → setAllEvents([...allEvents, newEvent])
```

**B2: Trace-API (Snapshot)**
```
Frontend: GET /api/chat/trace?piboSessionId=...
Backend:  buildTraceViewFromEvents({ session, events: web_chat_events })
          → PiboSessionTraceView → JSON
Frontend: setAllEvents(traceQuery.data.rawEvents)
```

**Was der Transport bewegt:**
- Roh-Events (`PiboOutputEvent` als JSON in `RAW_EVENT`)
- Komplette Trace-Snapshots (`PiboSessionTraceView`)

**Was der Transport NICHT mehr bewegt:**
- Inkrementelle Delta-Patches (`TEXT_MESSAGE_CONTENT`, `TOOL_CALL_ARGS`, etc. wurden reine UI-Dekoration; der Trace wird aus `RAW_EVENT` neu gebildet)

---

### Schicht C: Render

**Wo:** `src/apps/chat-ui/src/tracing/adapt.ts` + `src/apps/chat-ui/src/tracing/traceTree.ts` + `TraceTimeline.tsx`

```ts
// C1: Adaptierung (nur Mapping, keine Sortierung!)
function adaptNode(node: PiboTraceNode): Span {
    return {
        id: node.id,
        name: spanName(node),
        spanType: adaptSpanType(node.type),   // "assistant.message" → "model.response"
        startTime: toMicros(node.startedAt),
        endTime: toMicros(node.completedAt),
        durationUs: node.durationMs ? node.durationMs * 1000 : undefined,
        attributes: spanAttributes(node),
        status: adaptStatus(node.status),
        children: node.children?.map(adaptNode),
        pibo: { traceNodeType: node.type, traceOrder: node.orderKey, stableKey: node.stableKey },
    };
}

// C2: Tree-Processing (nur Filterung, keine Sortierung!)
function processSpanTree(spans: Span[]): Span[] {
    // filtert z.B. model.request aus, zieht agent.run-Kinder hoch
    // vertraut darauf, dass Input bereits korrekt sortiert ist
}

// C3: Flattening + Virtualisierung
function flattenVisibleSpans(spans, expansionDepth, expandThinking, expansionOverrides): VisibleSpanRow[] {
    // expandiert den Baum zu einer flachen Liste für Virtuoso
}
```

**Wichtig:**
- `adaptTrace` und `processSpanTree` sortieren **nicht mehr neu**.
- `compareSpans` wurde entfernt.
- Die Render-Schicht vertraut darauf, dass `PiboTraceNode[]` bereits korrekt sortiert ist (garantiert durch Schicht A).

---

### Vergleich: Vorher (5 Schichten) vs. Jetzt (3 Schichten)

| Vorher | Jetzt | Unterschied |
|--------|-------|-------------|
| Schicht 1: Backend `buildTraceView()` | **Schicht A** | Gleicher Code, jetzt shared |
| Schicht 2: API Transport | **Schicht B** | Unverändert |
| Schicht 3: Frontend `applyChatStreamEvent()` + eigene `sortTraceNodes()` | **— entfernt —** | Kein inkrementelles Patching mehr |
| Schicht 4: Frontend `adaptTrace()` + `processSpanTree()` + `compareSpans()` | **Schicht C** | Sortierung entfernt, nur noch Mapping/Filter |
| Schicht 5: `flattenVisibleSpans()` + Virtuoso | **Schicht C** | Unverändert |

---

*Dokument erstellt aus Code-Analyse. Verkürzt auf Datenflüsse und Architektur.*

# Chat Runtime Call Stack

Last reviewed: 2026-05-18.

This note traces one normal Chat Web message from the composer to Pi Coding Agent and back. The matching Mermaid diagram lives in [`chat-runtime-flow.mmd`](./chat-runtime-flow.mmd).

## Short version

```ts
Composer.submit
  -> postMessage("/api/chat/message")
  -> WebHostChannel.handleRequest
  -> ChatWebApp.handleRequest
  -> sendChatMessage
  -> channelContext.emit
  -> PiboSessionRouter.emit
  -> RoutedSession.enqueueMessage
  -> RoutedSession.drain
  -> AgentSessionRuntime.session.prompt
  -> AgentSession.prompt
  -> Agent.prompt
  -> runAgentLoop
  -> pi-ai provider stream
  -> RoutedSession.normalizePiEvent
  -> PiboSessionRouter.emitOutput
  -> ChatWeb ensureEventIndexing
  -> pibo.sqlite + pibo-events.sqlite + SSE
  -> Chat UI live trace
```

## Main flow

1. **React UI**
   - `Composer.submit()` reads the textarea.
   - Slash commands go to `POST /api/chat/action`.
   - Normal messages go to `POST /api/chat/message`.

2. **HTTP Web Gateway**
   - `WebHostChannel.handleRequest()` accepts HTTP.
   - Auth runs through `requireWebSession()`.
   - The request is routed to `ChatWebApp.handleRequest()`.

3. **Chat API**
   - `sendChatMessage()` validates session, room, duplicate transaction id, annotations, and file attachments.
   - It stores the accepted user event before runtime execution.
   - It then calls `context.channelContext.emit({ type: "message", ... })`.

4. **Gateway / Router**
   - `PiboGatewayServer.createChannelContext().emit()` calls `PiboSessionRouter.emit()`.
   - The router finds or creates a `RoutedSession`.

5. **Runtime creation**
   - `createRoutedSession()` resolves the Pibo session, profile, active model, context, and telemetry extension.
   - `createPiboRuntime()` builds Pi Coding Agent runtime services, skills, context files, tools, extensions, and `AgentSessionRuntime`.

6. **RoutedSession queue**
   - `enqueueMessage()` pushes the input into the queue.
   - It emits `message_queued` immediately.
   - `drain()` processes the queue asynchronously.

7. **Pi Runtime**
   - `processQueuedMessage()` emits `message_started`.
   - It expands inline skills.
   - It calls `runtime.session.prompt()`.
   - Pi Coding Agent runs `AgentSession.prompt()`, then Pi Agent Core runs `Agent.prompt()` and `runAgentLoop()`.

8. **Provider and tools**
   - `runAgentLoop()` calls `streamAssistantResponse()`.
   - `pi-ai` streams from the active provider.
   - If the model requests a tool, Pi Agent Core executes the tool and continues the loop with the tool result.

9. **Return path**
   - `RoutedSession.bindRuntimeSession()` receives Pi events.
   - `normalizePiEvent()` converts them to Pibo output events.
   - `PiboSessionRouter.emitOutput()` records telemetry, updates signals, notifies plugins, and publishes to subscribers.
   - Chat Web indexes output events, stores them, and forwards them over SSE.
   - The UI consumes `/api/chat/events` and updates the live trace.

## Abstract TypeScript model

```ts
// src/apps/chat-ui/src/App.tsx

class Composer {
  async submit() {
    const text = textarea.value.trim();

    if (text.startsWith("/")) {
      return onCommand(text); // -> /api/chat/action
    }

    return onSend(text); // -> /api/chat/message
  }
}

class ChatPanel {
  async handleComposerSend(text: string) {
    addOptimisticEvent("message_queued");

    await postMessage({
      piboSessionId,
      text,
      clientTxnId,
      roomId,
      webAnnotationIds,
      fileAttachmentPaths,
    });

    await refetchTrace();
  }
}
```

```ts
// src/apps/chat-ui/src/api.ts

async function postMessage(input: ChatMessageInput) {
  return fetch("/api/chat/message", {
    method: "POST",
    body: JSON.stringify(input),
  });
}
```

```ts
// src/web/channel.ts

class WebHostChannel {
  async handleRequest(nodeRequest: IncomingMessage) {
    const request = nodeRequestToWebRequest(nodeRequest);

    if (request.path.startsWith("/api/auth")) {
      return auth.handleRequest(request);
    }

    const app = findWebApp(request.path); // Chat Web App
    return app.handleRequest(request, createAppContext(channelContext));
  }
}
```

```ts
// src/apps/chat/web-app.ts

class ChatWebApp {
  async handleRequest(request: Request, context: PiboWebAppContext) {
    ensureEventIndexing(state, context); // subscribes to router output

    if (request.path === "/api/chat/message") {
      const webSession = await requireSession(request, context);
      const body = await readJsonBody(request);

      return sendChatMessage({ state, context, webSession, body });
    }
  }
}

async function sendChatMessage(input: SendChatMessageInput) {
  const text = normalizeMessageText(input.body.text);
  const session = resolveRequestedSession(...);
  const room = ensureSessionRoom(...);

  const accepted = state.eventCommands.appendEvent({
    eventType: "user.message.accepted",
    retentionClass: "chat_message",
    payload: { text, piboSessionId: session.id, roomId: room.id },
  });

  state.ingestService.ingestUserMessageAccepted({
    session,
    roomId: room.id,
    text,
    legacyEvent: accepted,
  });

  state.liveListeners.forEach(listener => listener(accepted));

  const output = await input.context.channelContext.emit({
    type: "message",
    piboSessionId: session.id,
    id: randomUUID(),
    text,
    source: "user",
  });

  return { output, event: accepted };
}
```

```ts
// src/gateway/server.ts

class PiboGatewayServer {
  private router = new PiboSessionRouter(...);

  createChannelContext(): PiboChannelContext {
    return {
      emit: event => this.router.emit(event),
      subscribe: listener => this.router.subscribe(listener),
      getSession: id => sessionStore.get(id),
      createSession: input => sessionStore.create(input),
      getWebApps: () => pluginRegistry.getWebApps(),
    };
  }

  // TCP/JSONL gateway clients use this path.
  async handleLine(frame: GatewayFrame) {
    const output = await this.router.emit(frame.event);
    socket.send({ type: "res", payload: output });
  }
}
```

```ts
// src/core/session-router.ts

class PiboSessionRouter {
  async emit(event: PiboInputEvent): Promise<PiboOutputEvent> {
    const session = await this.getOrCreateSession(event.piboSessionId);

    if (event.type === "message") {
      return session.enqueueMessage(event);
    }

    return session.executeAction(event);
  }

  private async createRoutedSession(id: string): Promise<RoutedSession> {
    const piboSession = sessionStore.get(id) ?? sessionStore.create(...);
    const profile = pluginRegistry.createProfile(piboSession.profile);

    const runtime = await createPiboRuntime({
      profile,
      activeModel,
      sessionContext: {
        piboSessionId: piboSession.id,
        ownerScope: piboSession.ownerScope,
        piboRoomId: piboSession.metadata.chatRoomId,
      },
      subagentRunner,
      runToolController,
      runtimeToolController,
      extensionFactories: [providerTelemetryExtension],
    });

    return new RoutedSession(
      piboSession.id,
      runtime,
      this.emitOutput,
      pluginRegistry,
    );
  }

  private emitOutput(event: PiboOutputEvent) {
    telemetryRecorder.recordOutput(event);
    signalRegistry.project(event);
    pluginRegistry.notifyEvent(event);

    for (const listener of listeners) {
      listener(event);
    }
  }
}
```

```ts
// src/core/routed-session.ts

class RoutedSession {
  enqueueMessage(event: PiboMessageEvent): PiboOutputEvent {
    queue.push(event);

    emit({
      type: "message_queued",
      piboSessionId,
      eventId: event.id,
      text: event.text,
    });

    void drain();
    return queuedOutput;
  }

  private async drain() {
    while (queue.length) {
      await processQueuedMessage(queue.shift());
    }
  }

  private async processQueuedMessage(event: PiboMessageEvent) {
    emit({ type: "message_started", eventId: event.id });

    const expandedText = expandInlineSkills(event.text, skills);

    await runtime.session.prompt(expandedText, {
      source: "interactive",
    });

    emit({ type: "message_finished", eventId: event.id });
  }

  private bindRuntimeSession() {
    runtime.session.subscribe(piEvent => {
      const event = normalizePiEvent(piboSessionId, piEvent);
      if (event) emit(withActiveMessage(event));
    });
  }
}
```

```ts
// src/core/runtime.ts

async function createPiboRuntime(options): Promise<AgentSessionRuntime> {
  const sessionManager = await createSessionManager(
    cwd,
    profile,
    persistSession,
  );

  const services = await createAgentSessionServices({
    resourceLoaderOptions: {
      additionalSkillPaths,
      extensionFactories,
      systemPrompt,
      agentsFilesOverride: base => ({
        agentsFiles: [
          ...base.agentsFiles,
          runtimeSessionContextFile,
          profileContextFiles,
          installedToolContextFile,
          mcpContextFile,
        ],
      }),
    },
  });

  const customTools = getEnabledToolDefinitions(profile, ...);

  return createAgentSessionRuntime(async runtimeInput => {
    return createAgentSessionFromServices({
      services,
      sessionManager,
      model,
      thinkingLevel,
      customTools,
      tools: builtinToolAllowlist,
    });
  });
}
```

```ts
// @mariozechner/pi-coding-agent

class AgentSession {
  async prompt(text: string, options: PromptOptions) {
    await runExtensionInputHandlers();

    const expanded = expandSkillsAndTemplates(text);

    assertModelAndAuthConfigured();
    await maybeCompactBeforePrompt();
    await extensionRunner.emitBeforeAgentStart();

    const messages = buildUserMessages(expanded);

    await agent.prompt(messages); // Pi Agent Core
  }
}
```

```ts
// @mariozechner/pi-agent-core

class Agent {
  async prompt(messages: AgentMessage[]) {
    await runAgentLoop(
      messages,
      createContextSnapshot(),
      createLoopConfig(),
      emitAgentEvent,
      abortSignal,
      streamFn,
    );
  }
}

async function runAgentLoop(...) {
  emit("agent_start");
  emit("turn_start");

  while (true) {
    const assistant = await streamAssistantResponse(...);

    if (assistant.hasToolCalls()) {
      const toolResults = await executeToolCalls(...);
      continue; // next provider turn with tool result
    }

    emit("agent_end");
    return;
  }
}

async function streamAssistantResponse(...) {
  const llmMessages = convertToLlm(context.messages);

  return streamFn(model, {
    systemPrompt,
    messages: llmMessages,
    tools,
  });
}
```

## Storage points

| Point | Storage |
|---|---|
| Session and room exist | `~/.pibo/pibo.sqlite`: `sessions`, `rooms`, `room_members` |
| User sends message | `pibo.sqlite`: `event_log`, `chat_messages`, `session_navigation` |
| Large payload | `~/.pibo/payloads` |
| Runtime output | `pibo.sqlite`: `event_log`, `observations`, optional `chat_messages` |
| Runtime telemetry | `pibo.sqlite`: `telemetry_turns`, `telemetry_phases`, `telemetry_provider_requests`, `telemetry_provider_events`, `telemetry_tool_calls` |
| Reliability/replay | `~/.pibo/pibo-events.sqlite` |
| Pi transcript | Pi `SessionManager` JSONL session file |
| Web annotations | `~/.pibo/web-annotations.sqlite` |

## Important branches

- **Slash command:** `/api/chat/action`, not `/api/chat/message`.
- **Duplicate send:** `clientTxnId` prevents duplicate accepted user events.
- **Attachments:** Web annotations and file uploads are appended to model context.
- **Runtime cache miss:** The router creates a new `RoutedSession` and Pi runtime.
- **Tool call:** Provider requests a tool; Pi executes it; the loop continues with the tool result.
- **Subagent:** A generated subagent tool calls the same router with a child Pibo session.
- **Compaction:** Emits `compaction_start` and `compaction_end`.
- **Live response:** `POST /api/chat/message` returns queued output; the real response streams over `/api/chat/events`.

# Chat Live Model Response Debug Handoff

## Goal

Debug the remaining live-rendering bug in Chat Web:

- During streaming, assistant/model response rows sometimes appear too high, directly after the user message.
- Intermediate assistant text segments can replace or hide each other.
- After the run finishes and the trace reloads/reprojects, the final order becomes correct.
- Thinking spans and tool calls are currently much more stable; focus on assistant/model response ordering.

Use this prompt with `pibo-minimal` in a new session:

```text
Lese fünf Dateien deiner Wahl. Denke gut darüber nach, welche du liest, um dein Wissen zu maximieren über dieses Projekt. Denke. sinnvoll guck dir erst mal den Ordner an was für Dateien gibt es welche sind gute Kandidaten bewerte sie und dann fang an zu lesen
```

## Fast Browser Setup

The useful Chrome instance was already running with DevTools Protocol:

```bash
curl -s http://127.0.0.1:56663/json/list
```

Pick the Chat Web target that is actually authenticated and has a composer textarea. Do not assume the first target is usable. In the previous run:

- `http://4788.192.168.0.204.sslip.io/apps/chat` showed `Unauthenticated`.
- `http://4790.192.168.0.204.sslip.io/apps/chat/...` was the usable logged-in/debug Chat tab with `debug@example.test`.

Quick CDP inspection script pattern:

```bash
node <<'NODE'
const WebSocket = require("ws");
const ws = new WebSocket("ws://127.0.0.1:56663/devtools/page/<TARGET_ID>");
let id = 0;
const pending = new Map();
function send(method, params = {}) {
  return new Promise((resolve, reject) => {
    const requestId = ++id;
    pending.set(requestId, { resolve, reject });
    ws.send(JSON.stringify({ id: requestId, method, params }));
  });
}
ws.on("message", (data) => {
  const message = JSON.parse(data);
  if (!message.id || !pending.has(message.id)) return;
  const callback = pending.get(message.id);
  pending.delete(message.id);
  message.error ? callback.reject(new Error(JSON.stringify(message.error))) : callback.resolve(message.result);
});
ws.on("open", async () => {
  await send("Runtime.enable");
  await send("Page.enable");
  const result = await send("Runtime.evaluate", {
    returnByValue: true,
    expression: `(() => ({
      url: location.href,
      text: document.body.innerText.slice(0, 3000),
      textareas: [...document.querySelectorAll("textarea")].map((t, i) => ({ i, placeholder: t.placeholder, disabled: t.disabled, value: t.value }))
    }))()`,
  });
  console.log(JSON.stringify(result.result.value, null, 2));
  ws.close();
});
NODE
```

## MCP / Browser Notes

User-requested command for DevTools/MCP:

```bash
npm run dev -- mcp
```

If MCP resources are not visible in Codex, use direct Chrome CDP on `127.0.0.1:56663`. Browser-use is installed, but avoid spending time with fresh profiles unless the existing tab is unusable:

```bash
eval "$(npm run --silent dev -- tools env browser-use)"
browser-use --session <name> state
```

The quickest reliable path is direct CDP against the already-open Chat Web tab.

## Current Server State To Check

Check ports first:

```bash
ss -ltnp | rg ':(4788|4789|4790|4791|56663)\b'
```

Expected from the previous run:

- Real gateway: web `4788`, gateway `4789`.
- Chrome CDP: `56663`.
- Debug fake-auth gateway may need to be restarted on web `4790`, gateway `4791` if using the existing debug tab.

If the existing debug tab is on `4790` but the server is down, restart a fake-auth debug gateway from the current worktree. Prefer reusing the existing command in shell history if available; otherwise build a small `node --import tsx/esm --input-type=module -e '...'` runner that registers:

- `createDefaultPiboPlugins()`
- fake auth returning `debug@example.test`
- `createPiboWebHostPlugin({ host: "0.0.0.0", port: 4790 })`
- `createPiboContextFilesPlugin()`
- `createPiboChatWebPlugin()`
- `PiboGatewayServer({ host: "127.0.0.1", port: 4791, persistSession: true, sessionDbPath: ".pibo/debug-pibo-sessions.sqlite" })`

## Debug Plan

1. In the existing authenticated Chat tab, create a new session with profile `pibo-minimal`.
2. Send the prompt above through the UI.
3. While it streams, record:
   - SSE `lastEventId` / frame ids for `TEXT_MESSAGE_START`, `TEXT_MESSAGE_CONTENT`, `TEXT_MESSAGE_END`.
   - DOM order of compact terminal rows every 300-500 ms.
   - `traceView.nodes` order if accessible through React/query cache or by calling `/api/chat/trace`.
4. Compare live assistant row position with final trace position after `RUN_FINISHED`.

Primary suspicion:

- Assistant text nodes have live IDs segmented by `contentIndex`, but the final `assistant_message` may only close/update the last text part.
- Some live assistant nodes may use a phase/order key that places them after the turn but before later thinking/tool nodes, or updates may preserve an old `orderKey`.
- The terminal row builder flattens sorted trace children; if a live assistant node is inserted before its true later tool/thinking siblings, it will appear too high until the trace refresh rebuilds from event-log/transcript.

Files most likely involved:

- `src/apps/chat-ui/src/App.tsx`
- `src/apps/chat-ui/src/session-views/compact-terminal/terminalRows.ts`
- `src/apps/chat/stream.ts`
- `src/apps/chat/trace.ts`
- `src/shared/trace-order.ts`
- `src/core/routed-session.ts`

Useful existing tests:

```bash
npx tsc -p tsconfig.json
npm run chat-ui:typecheck
node --test test/chat-trace.test.mjs test/web-channel.test.mjs test/session-actions.test.mjs
npm run chat-ui:build
git diff --check
```

Do not stage `image.png`.

# Browser Use and MCP Debugging Report

## Context

This report summarizes practical findings from debugging Chat Web live rendering with Browser Use, Chrome DevTools Protocol, and the intended MCP DevTools workflow.

The concrete debugging task was a live UI ordering bug:

- During streaming, assistant/model response rows sometimes appeared too high in the terminal view.
- Thinking spans and tool calls were mostly stable.
- Once the run finished and the trace was rebuilt from persisted state, the order became correct.

The main lesson is that browser automation was not hard in principle, but the tool surface made it too easy to spend time on setup instead of observing the already-open authenticated browser.

## What Worked

Direct Chrome DevTools Protocol worked well once the correct Chrome target was identified.

Useful commands:

```bash
curl -s http://127.0.0.1:56663/json/version
curl -s http://127.0.0.1:56663/json/list
```

The `/json/list` output exposed all open tabs, including:

- the real `4788` Chat Web tab
- a debug `4790` Chat Web tab
- blank or stale tabs

Direct CDP via the `ws` npm package was reliable for:

- inspecting `location.href`
- reading `document.body.innerText`
- checking whether the page was authenticated
- finding composer textareas and buttons
- preparing DOM snapshots for row-order debugging

The fastest useful inspection pattern was:

```js
(() => ({
  url: location.href,
  text: document.body.innerText.slice(0, 3000),
  textareas: [...document.querySelectorAll("textarea")].map((t, i) => ({
    i,
    placeholder: t.placeholder,
    disabled: t.disabled,
    value: t.value,
  })),
}))()
```

This quickly revealed whether the selected tab was actually usable.

## What Did Not Work Well

The biggest failure mode was assuming the first Chrome target was the right browser tab.

In this case, the first target was:

```text
http://4788.192.168.0.204.sslip.io/apps/chat
```

but it showed:

```text
Unauthenticated
Sign in with Google
```

The usable tab was a different target:

```text
http://4790.192.168.0.204.sslip.io/apps/chat/rooms/.../sessions/...
```

It was already logged in as:

```text
debug@example.test
```

Browser Use also caused friction when it tried to launch or connect to a profile instead of reusing the known working Chrome tab. The persistent profile had a `SingletonLock`, and Browser Use attempts could fail with Chrome profile locking errors. Fresh profiles avoided the lock but were unauthenticated, which was not useful for this task.

A particularly costly mistake was starting to build a separate fake-auth gateway before fully using the existing authenticated tab. That created extra setup work and consumed context without increasing understanding of the UI bug.

## MCP Findings

The intended user command was:

```bash
npm run dev -- mcp
```

During this session, MCP resources were not visible through the available Codex MCP resource API. That may mean the MCP server was not running in the current agent environment, was not connected to Codex, or exposes browser tools through another interface.

Fallback strategy:

1. Use `curl http://127.0.0.1:<cdp-port>/json/list`.
2. Pick the already-open authenticated Chat Web target.
3. Connect directly to the target WebSocket.
4. Use `Runtime.evaluate`, `Page`, `Network`, and DOM inspection through CDP.

This fallback was good enough for debugging and should be treated as the baseline escape hatch whenever MCP visibility is unclear.

## Recommended Debugging Strategy

Start with the browser that already exists.

Do not open a new Browser Use profile unless there is no usable existing tab.

Recommended sequence:

1. List Chrome targets:

```bash
curl -s http://127.0.0.1:56663/json/list
```

2. Inspect each Chat Web target with CDP and classify it:

- authenticated or unauthenticated
- real gateway or debug gateway
- has composer textarea or only login screen
- selected session URL
- visible profile and selected view

3. Use the authenticated tab directly.

4. Only if the tab's backend is down, restart the matching gateway port.

5. For streaming bugs, capture both transport and DOM:

- SSE event id, especially `<stream_id>:<frame_index>`
- frame type, especially `TEXT_MESSAGE_*`
- message id and run id
- terminal row order
- trace node ids and order keys if accessible

6. Compare live order to final order after `RUN_FINISHED`.

## Browser Use Guidance

Browser Use is useful for high-level interaction when the session is healthy:

```bash
eval "$(npm run --silent dev -- tools env browser-use)"
browser-use --session <name> state
browser-use --session <name> click <index>
browser-use --session <name> input <index> "text"
browser-use --session <name> keys "Enter"
```

But it is less ideal for low-level debugging when:

- the browser profile is locked
- a fresh profile loses authentication
- the target browser already exists outside Browser Use's session registry
- exact SSE/DOM timing matters

For those cases, direct CDP is better.

A good rule:

- Use Browser Use for human-like actions.
- Use CDP for debugging state, network, event timing, and DOM snapshots.

## DevTools/CDP Techniques That Should Be Promoted

Useful CDP domains for this kind of bug:

- `Runtime.evaluate` for DOM and app-state snapshots.
- `Network.enable` and network events for SSE and API calls.
- `Page.reload` to reproduce reload-during-run issues.
- `DOMSnapshot` or direct DOM evaluation for rendered row order.

Useful page-side probes:

```js
[...document.querySelectorAll("textarea")].map((t, i) => ({
  i,
  placeholder: t.placeholder,
  disabled: t.disabled,
  value: t.value,
}))
```

```js
document.body.innerText
```

```js
[...document.querySelectorAll("button")].map((button, i) => ({
  i,
  text: button.innerText,
  title: button.title,
  aria: button.getAttribute("aria-label"),
  disabled: button.disabled,
}))
```

For terminal row order, the UI should ideally expose stable row attributes such as:

```html
data-terminal-row-id
data-terminal-row-kind
data-trace-node-id
data-order-key
```

Without these attributes, debugging has to infer row boundaries from text, which is fragile.

## Product Improvement Ideas

### 1. Make The Correct Browser Target Obvious

This has since been implemented as a command that prints active Chrome targets with authentication hints:

```text
pibo tools browser-use targets
```

Suggested output:

```text
id                                    url                         auth              textarea  title
4C0FF752D0D87359E9689D4DFED46BC2      http://4788.../apps/chat    unauthenticated   no        Pibo Web Chat
14ABFF5E75F4791A615B7727F80EEC5E      http://4790.../sessions/... debug@example     yes       Pibo Web Chat
```

The command could internally use CDP and a small `Runtime.evaluate` probe.

### 2. Add A "Use Existing Target" Shortcut

This has since been implemented as a shortcut for the common debugging workflow:

```bash
pibo tools browser-use attach-chat
```

It should find the best existing Chat Web target and export:

```bash
PIBO_CDP_TARGET_ID=...
PIBO_CDP_TARGET_WS=...
PIBO_CHAT_URL=...
```

### 3. Improve MCP Visibility

When the user says "use MCP DevTools", the agent needs an immediate discovery path.

Useful commands or docs should answer:

- Is the MCP server running?
- Which browser URL is it attached to?
- Which Chrome CDP port is it using?
- Which tools are available?
- How do I select an existing tab?

If MCP resources are unavailable in Codex, the docs should explicitly say to fall back to CDP and show the exact commands.

### 4. Add Debug Attributes To Chat UI

The compact terminal should expose stable diagnostics in the DOM. This would make Browser Use, CDP, Playwright, and screenshots much more useful.

Recommended attributes:

```html
data-pibo-terminal-row
data-row-id
data-row-kind
data-row-status
data-trace-node-id
data-event-id
data-run-id
data-order-source
data-order-stream-id
data-order-frame-index
```

This would turn row-order debugging from text scraping into structured inspection.

### 5. Add A Live Stream Debug Overlay Or Endpoint

For streaming bugs, a small debug endpoint would be valuable:

```text
/api/chat/debug/live?session=<id>
```

It could show:

- latest SSE frames
- raw event-log events
- live reducer pending queue
- trace query latest stream id
- rendered row ids in order

This should be gated to local/dev mode.

## Prompting Guidance For Future Agents

Good prompt:

```text
Use the already-open Chrome tab. First run curl http://127.0.0.1:56663/json/list and identify the authenticated Chat Web tab by checking document.body.innerText and textarea presence. Do not open a fresh browser profile unless no authenticated tab exists. Use direct CDP if MCP resources are unavailable.
```

Avoid:

```text
Open the app in a new browser and log in.
```

That often creates a fresh unauthenticated profile and wastes time.

Also avoid:

```text
Use Browser Use
```

without specifying whether to attach to an existing session or create a new one.

## Concrete Lessons

- Browser setup should start from target discovery, not from launching a new browser.
- "First tab" is ambiguous; the first CDP target may be unauthenticated or stale.
- Authentication state is the key gate. Always verify it before debugging.
- Browser Use is good for interaction but not always for low-level state capture.
- Direct CDP is the most reliable fallback.
- UI debug attributes would dramatically reduce token and time cost.
- A Pibo-specific target discovery command would prevent most of the setup churn.

## Suggested Next Tooling Work

Completed:

- Add `pibo tools browser-use targets`.
- Add `pibo tools browser-use attach-chat`.
- Document direct CDP fallback in `pibo tools guide browser-use browser-use`.

Still useful:

1. Add structured debug attributes to compact terminal rows.
2. Add a dev-only stream/order debug endpoint.
3. Make MCP startup advertise the attached browser URL, CDP port, and active tabs.

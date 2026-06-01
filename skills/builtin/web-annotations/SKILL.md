# Web Annotations Setup Guide

## Overview

Web Annotations let a user mark elements on a live web page and send structured feedback to the current Pibo Session. The agent receives precise target metadata (selector, DOM path, bounding box, source hints) instead of vague text descriptions.

## How It Works

1. The user opens **Web Annotations** from Chat Web (Bug icon in the header).
2. A browser target is bound to the current Pibo Session via Chrome DevTools Protocol (CDP).
3. An overlay is injected into the page, letting the user click elements or place pins and write notes.
4. Annotations are stored session-scoped and can be attached to messages.
5. The agent sees structured context and can update annotation status via tools.

## Prerequisites: A CDP-enabled Browser

Web Annotations requires a Chrome/Chromium instance with an active remote debugging port. Without this, the "Refresh targets" button shows an error.

### Local Development (User runs `pibo gateway` or `pibo gateway:web`)

The user is already in a browser viewing Chat Web, but that browser tab is the **Chat UI itself**, not the target page to annotate. The user must either:

**Option A: Start Chrome with remote debugging**
```bash
# macOS
/Applications/Google\ Chrome.app/Contents/MacOS/Google\ Chrome \
  --remote-debugging-port=9222 \
  --user-data-dir=/tmp/pibo-chrome-profile

# Linux
chromium --remote-debugging-port=9222 \
  --user-data-dir=/tmp/pibo-chrome-profile

# Windows
chrome.exe --remote-debugging-port=9222
```

Then in Chat Web:
- Open the **Web Annotations** panel (Bug icon).
- Enter `http://localhost:9222` in the **CDP URL** field (optional if auto-detected).
- Click **Refresh** to list targets.
- Click **Annotate URL** and enter the page to annotate, or attach an existing tab.

**Option B: Use the Browser Use daemon (if running)**

If a Browser Use worker is active (e.g., for Ralph jobs), it already runs Chromium with `--remote-debugging-port`. The CDP URL may differ from the default. Check `ps aux | grep remote-debugging-port` on the server or ask the operator for the active CDP port.

**Option C: Docker Compute Worker**

Docker workers typically expose their browser CDP endpoint. The operator should ensure the worker's CDP port is reachable from the gateway host. The CDP URL can then be entered in the panel.

### Production (Remote Server)

In production, the operator should configure a persistent Chrome instance or use a managed browser pool. The CDP URL can be set as a default via config or environment variable.

## Using the Overlay

Once a binding is created and injected:

1. **Annotate mode** (default): Hover over elements to see a blue highlight. Click an element to open a note popup.
2. **Pin mode**: Click anywhere on the page to mark a point.
3. Write a note and click **Submit**.
4. Return to Chat Web. The annotation appears in the session panel.
5. Click **Attach** on the annotation chip before sending a message.

## Agent Tools

When the profile selects the `web-annotation-agent-tools` capability package, these tools are available:

- `web_annotations_list` – list annotations for the current session.
- `web_annotations_get` – inspect one annotation with full target metadata.
- `web_annotations_watch` – wait briefly for new annotations.
- `web_annotations_acknowledge` – mark an annotation as seen.
- `web_annotations_resolve` – mark work as complete.
- `web_annotations_dismiss` – close an irrelevant annotation.

## Troubleshooting

| Symptom | Cause | Fix |
|---------|-------|-----|
| "CDP unavailable" or "fetch failed" | No browser with `--remote-debugging-port` is running. | Start Chrome with `--remote-debugging-port=9222` (see Option A above). |
| "No attachable browser targets found" | Chrome is running but has no open tabs/pages. | Open a page in Chrome, or use **Annotate URL** to open one automatically. |
| "Target not found" | The selected tab was closed. | Refresh targets and select again, or re-inject the binding. |
| "Injection failed" | The page blocked script evaluation or the target reloaded. | Reload the page and re-inject from Chat Web. |
| Overlay disappears after reload | The overlay is runtime-only. | Re-inject via Chat Web for the same binding. |
| Cross-origin iframe cannot be inspected | Browser security prevents top-level overlay from accessing frame content. | Annotate the iframe element itself, or open the framed page directly. |

## Important Notes

- Annotations are app resources keyed by Pibo Session ID and annotated page/resource metadata. They are visible through shared app access and are not partitioned by login account.
- The overlay does **not** modify the target page permanently. It is a runtime script injection.
- Full DOM dumps, inline screenshots, or page HTML are **not** sent to the model by default. Only bounded metadata (selector, hints, note, viewport) is included.
- The default CDP URL is `http://127.0.0.1:56663`. If your Chrome runs on a different port, enter it in the CDP URL field.

# Web Annotations Remote Architecture Assessment

**Date:** 2026-05-17
**Scope:** Evaluate how Web Annotations can work for remote users (internet-connected via nginx → Pibo gateway) and how internal apps can be exposed through Chat Web.
**Status:** Assessment / Recommendation

---

## 1. Current Architecture Summary

### 1.1 Network Topology

```
User Browser (Laptop, anywhere)
    ↓ HTTPS
nginx (dev.pibo.neuralnexus.me :443)
    ↓ HTTP proxy_pass
    proxy_set_header X-Forwarded-Host $host;
    proxy_set_header X-Forwarded-Proto $scheme;
Pibo Gateway (127.0.0.1:4808)
    ↓ Internal routing
WebHostChannel (/apps/*, /api/*, /api/auth/*)
    ↓ Plugin registry dispatch
Registered WebApps (chat, web-annotations, context-files, ...)
```

### 1.2 Authentication Flow

- **Better Auth** with Google OAuth handles authentication.
- Session cookie is set on the `dev.pibo.neuralnexus.me` domain.
- `PiboAuthService.getSession(headers)` extracts identity from the request.
- All API endpoints under `/api/*` (except `/api/auth/*`) require an authenticated session.
- `ownerScope` is derived as `user:<google-user-id>`.

### 1.3 WebApp Registration Model

```typescript
type PiboWebApp = {
    name: string;        // e.g., "pibo.chat-web"
    mountPath: string;   // e.g., "/apps/chat"
    apiPrefix: string;   // e.g., "/api/chat"
    handleRequest(request, context): Promise<Response | undefined>;
};
```

- `mountPath` serves static assets (e.g., the built Vite React app from `dist/apps/chat-ui/`).
- `apiPrefix` serves JSON API endpoints.
- Routing is done by `WebHostChannel` via prefix matching: `url.pathname.startsWith(mountPath)` or `startsWith(apiPrefix)`.

### 1.4 Web Annotations Current State

| Component | Status | Notes |
|-----------|--------|-------|
| Plugin registration | ✅ Active | `pibo.web-annotations` in `createDefaultPiboPlugins()` |
| WebApp | ✅ Running | `/apps/web-annotations`, `/api/web-annotations` |
| Agent tools | ✅ Registered | `web-annotation-agent-tools` capability package |
| Store | ✅ SQLite | `web-annotations.sqlite` in `~/.pibo/` |
| Overlay injection | ✅ CDP-based | Injects JS into a headless Chrome via DevTools Protocol |
| Skill | ✅ Added | `web-annotations` builtin skill with setup guide |
| **Remote usability** | ❌ **Broken** | CDP targets are server-local; remote user cannot see them |

### 1.5 The Core Problem

The CDP-based overlay injection assumes:
1. Chrome runs on the **same machine** as the Pibo gateway.
2. The user can see the Chrome window (or VNC into it).
3. The CDP port (`56663`, `9222`, `49203`) is reachable from the gateway.

For a remote user connected via `https://dev.pibo.neuralnexus.me`:
- Their browser is on their laptop.
- Chrome/CDP is on the server.
- These are **different machines** on **different networks**.
- Injecting JS into a server-side headless Chrome does not help the user annotate their local web app.

---

## 2. Requirements Analysis

### 2.1 Must Support

1. **Remote users** connected via internet (nginx → Pibo gateway).
2. **Internal apps** developed by us, running on the server, exposed through Chat Web.
3. **Annotations on internal apps** — the user must be able to click elements and add notes.
4. **Annotations on Chat Web itself** — the user must be able to annotate the Chat UI.
5. **Existing auth** — must reuse Better Auth / Google OAuth, no separate token system.
6. **Session-scoped storage** — annotations isolated by `ownerScope` + `piboSessionId`.

### 2.2 Should Support (Future)

1. External websites (not developed by us) — but this is V2+ and requires a different security model.

### 2.3 Must Avoid

1. **Bookmarklets** — the user explicitly does not want this. Reason: tokens/secrets in browser bookmarks, security concerns, poor UX.
2. **Separate CDP setup** — the user should not need to start Chrome with `--remote-debugging-port`.
3. **iframe-based rendering of external sites** — CORS, CSP, and clickjacking issues make this unreliable.

---

## 3. Proposed Architecture

### 3.1 High-Level Concept

The solution is a **"Hosted App" model** combined with **"Self-Annotation"** for Chat Web:

```
┌─────────────────────────────────────────────────────────────┐
│                     User Browser                            │
│  ┌─────────────────────────────────────────────────────┐   │
│  │              Chat Web (React App)                    │   │
│  │  ┌─────────────┐  ┌─────────────────────────────┐  │   │
│  │  │ Chat UI     │  │ Hosted App Panel (iframe)   │  │   │
│  │  │ (self-      │  │ (internal apps we develop)  │  │   │
│  │  │  annotate)  │  │                             │  │   │
│  │  └─────────────┘  └─────────────────────────────┘  │   │
│  └─────────────────────────────────────────────────────┘   │
└─────────────────────────────────────────────────────────────┘
                              │
                              ▼ HTTPS (same origin)
┌─────────────────────────────────────────────────────────────┐
│              nginx → Pibo Gateway (4808)                    │
│  ┌─────────────────────────────────────────────────────┐   │
│  │  WebHostChannel routes:                              │   │
│  │    /apps/chat      → Chat UI static files            │   │
│  │    /api/chat       → Chat API                        │   │
│  │    /apps/<app>     → Hosted App static files         │   │
│  │    /api/<app>      → Hosted App API                  │   │
│  │    /api/web-annotations/submissions → Overlay POST   │   │
│  └─────────────────────────────────────────────────────┘   │
└─────────────────────────────────────────────────────────────┘
```

### 3.2 Key Insight

Because **internal apps are served from the same origin** (`https://dev.pibo.neuralnexus.me/apps/my-app`), they share the **same auth session cookie** as Chat Web. This means:

- No separate tokens needed.
- No CORS issues (`Access-Control-Allow-Origin: *` can be restricted or removed).
- The overlay can `fetch('/api/web-annotations/submissions')` directly with the session cookie.
- The existing `requireWebSession()` auth check works out of the box.

### 3.3 Two Modes of Operation

#### Mode A: Hosted Internal App (iframe)

For apps we develop (e.g., a company dashboard, a tool UI, a preview page):

1. The app is built as a static site or SPA and deployed to a subdirectory on the server.
2. A plugin registers a `PiboWebApp` with `mountPath: "/apps/my-app"`.
3. Chat Web shows an iframe pointing to `/apps/my-app?piboSessionId=...&annotationMode=1`.
4. The app (or Chat Web via `postMessage`) loads the overlay script.
5. The overlay runs in the app's origin, shares the auth cookie, and submits annotations.

**Security:** Same-origin, session-cookie-based. As secure as Chat Web itself.

#### Mode B: Chat Web Self-Annotation

For annotating the Chat Web UI itself:

1. The overlay script is loaded directly into Chat Web (not an iframe).
2. It runs in the Chat Web origin (`https://dev.pibo.neuralnexus.me`).
3. It can annotate any element in the Chat UI.
4. Submissions go to `/api/web-annotations/submissions` with the same session cookie.

**Security:** Same-origin, session-cookie-based. No additional exposure.

---

## 4. Detailed Implementation Plan

### 4.1 Phase 1: Secure the `/submissions` Endpoint (Foundation)

**Current state:** The endpoint uses CORS wildcard and binding-token auth. This was designed for CDP-injected overlays on arbitrary third-party sites.

**Required change:** Add a **dual-auth mode**:

```typescript
// In handleOverlaySubmission:
// Option 1: bindingId + bindingToken (existing, for CDP mode)
// Option 2: Session cookie via requireWebSession() (new, for same-origin mode)
```

When the request comes from the **same origin** and has a **valid session cookie**, derive `ownerScope` and `piboSessionId` from the session (plus an optional `bindingId` from query params or body for grouping).

**Code change in `src/web-annotations/api.ts`:**

```typescript
async function handleOverlaySubmission(store, request, context) {
    const url = new URL(request.url);
    const origin = request.headers.get("origin");
    const isSameOrigin = origin === url.origin;

    let ownerScope: string;
    let piboSessionId: string;
    let bindingId: string | undefined;

    if (isSameOrigin) {
        // Mode: Same-origin session auth
        const webSession = await context.requireSession({ request });
        ownerScope = webSession.ownerScope;
        piboSessionId = /* from query param or body */;
        bindingId = /* from query param or body, optional */;
    } else {
        // Mode: Legacy CDP binding-token auth
        // existing logic...
    }

    // Create annotation directly (no binding token needed in same-origin mode)
    return store.createAnnotation({
        ownerScope,
        piboSessionId,
        bindingId,
        note,
        url: /* from payload */,
        targetKind,
        viewport,
        target,
    });
}
```

**Security impact:**
- Same-origin requests are protected by existing session auth.
- Cross-origin requests still require binding tokens (for CDP mode compatibility).
- CORS headers can be narrowed: `Access-Control-Allow-Origin: <request-origin>` instead of `*`.

### 4.2 Phase 2: Overlay as Injectable Script

Extract the overlay JavaScript from `cdp.ts` (`buildInjectExpression()`) into a **standalone script file** that can be served as a static asset.

**New file:** `src/web-annotations/overlay-script.ts`

This module:
1. Exports the overlay code as a string (same logic as now).
2. Removes CDP-specific assumptions (e.g., `config.apiBaseUrl` defaults to `window.location.origin`).
3. Reads configuration from `window.__piboWebAnnotationConfig` or URL params:
   - `bindingId` (optional, for grouping)
   - `piboSessionId` (required)
   - `apiBaseUrl` (defaults to `window.location.origin`)

**Build step:** The script is bundled as a standalone JS file (e.g., `dist/web-annotations-overlay.js`) and served at `/apps/web-annotations/overlay.js`.

### 4.3 Phase 3: Chat Web Self-Annotation

**UI Change:** Add an "Annotate this page" toggle in the Chat Web header (next to the Bug icon, or as a mode within it).

**Flow:**
1. User clicks "Annotate this page".
2. Chat Web dynamically injects `<script src="/apps/web-annotations/overlay.js">` into the DOM.
3. The script configures itself with the current `piboSessionId` from the React app state.
4. The overlay appears. User annotates elements in the Chat UI.
5. On submit, the overlay fetches `/api/web-annotations/submissions` with the session cookie.

**No iframe needed.** The overlay runs directly in the Chat Web page.

### 4.4 Phase 4: Hosted App Panel (iframe for internal apps)

**New Chat Web feature:** A panel/sidebar/iframe area where internal apps can be loaded.

**Plugin API Extension:**

```typescript
// New concept: "Hosted App" registration
type PiboHostedApp = {
    id: string;
    name: string;
    mountPath: string;        // e.g., "/apps/my-dashboard"
    icon?: string;
    category?: string;
};
```

A new plugin can register a hosted app:

```typescript
api.registerHostedApp({
    id: "my-dashboard",
    name: "Company Dashboard",
    mountPath: "/apps/my-dashboard",
});
```

**Chat Web UI:**
- A new section in the sidebar or a tab in the session view: "Apps".
- Lists all registered hosted apps.
- Clicking an app opens it in an iframe within Chat Web (or in a split panel).
- The iframe URL includes `?piboSessionId=<id>&annotationMode=1`.

**The Hosted App itself:**
- Is a normal web app (React, Vue, plain HTML) built and deployed to `dist/apps/my-dashboard/`.
- Can optionally include the overlay script:
  ```html
  <script src="/apps/web-annotations/overlay.js" 
          data-pibo-session-id="<%= sessionId %>"
          data-auto-init="true"></script>
  ```
- Or Chat Web can inject it via `postMessage` or by appending the script to the iframe.

### 4.5 Phase 5: Vollbildmodus (Full-screen mode)

Each hosted app must also be reachable directly (not just in an iframe):
- `https://dev.pibo.neuralnexus.me/apps/my-dashboard`

The app detects whether it is in an iframe or full-screen:
```javascript
const isInIframe = window.self !== window.top;
```

If full-screen:
- Show a "Back to Chat" link or a floating Pibo widget.
- The overlay still works (same origin, same session cookie).

---

## 5. Security Analysis

### 5.1 Threat Model

| Threat | Before (CDP-only) | After (Same-origin + Hosted Apps) |
|--------|-------------------|-----------------------------------|
| Unauthorized annotation creation | Binding token brute-force | Session cookie (Google OAuth) — much stronger |
| CSRF on `/submissions` | Possible (no SameSite check) | Mitigated by SameSite cookies + Origin check |
| XSS via annotation payload | Sanitized by validation.ts | Same sanitization |
| Token exposure in browser | Bookmarklet/CDP token | None — no tokens needed |
| Cross-origin abuse | `Access-Control-Allow-Origin: *` | Restricted to same origin or explicit allowlist |
| Session hijacking | N/A (separate token) | Standard OAuth session security |

### 5.2 Recommended Hardening

1. **Narrow CORS headers** for `/api/web-annotations/submissions`:
   - If `Origin` header matches the gateway origin → allow.
   - If `Origin` is missing or different → require binding token (legacy mode).

2. **SameSite cookie policy**:
   - Ensure auth cookies are `SameSite=Lax` or `SameSite=Strict`.
   - This prevents CSRF from external sites while allowing same-origin POSTs.

3. **URL parameter validation**:
   - When `piboSessionId` is passed via URL param to an iframe, validate that the session belongs to the authenticated user before initializing the overlay.

4. **Rate limiting**:
   - Add per-session rate limiting on annotation creation (e.g., 30 per minute).
   - Prevents accidental or malicious flooding.

5. **Content Security Policy (CSP)**:
   - For hosted apps, a CSP header can restrict where scripts can be loaded from.
   - The overlay script should be explicitly allowed: `script-src 'self' 'unsafe-inline' https://dev.pibo.neuralnexus.me`.

### 5.3 No New Attack Vectors

The proposed architecture does not introduce new attack vectors compared to the existing Chat Web:
- The overlay runs with the same privileges as the Chat Web app itself.
- It cannot access data outside the user's own session.
- It submits to the same API endpoints that the Chat Web app already uses.

---

## 6. Coding Conventions & System Fit

### 6.1 Plugin Registration

Fits the existing plugin model perfectly:

```typescript
// In a new plugin (e.g., pibo-hosted-apps)
export const piboHostedAppsPlugin = definePiboPlugin({
    id: "pibo.hosted-apps",
    name: "Pibo Hosted Apps",
    register(api) {
        api.registerWebApp(createHostedAppsWebApp());
        api.registerHostedApp({ id: "my-dashboard", name: "Dashboard", mountPath: "/apps/my-dashboard" });
    },
});
```

### 6.2 WebApp Pattern

Follows the exact `PiboWebApp` interface:
- `mountPath` for static assets.
- `apiPrefix` for API routes (if needed).
- `handleRequest` for dynamic routing.

### 6.3 Auth Integration

Reuses `requireWebSession()` from `src/web/auth.ts`. No new auth system.

### 6.4 Store Integration

Reuses the existing `WebAnnotationStore`. No new database tables.

### 6.5 UI Conventions

- Chat Web UI additions follow the existing React + Tailwind patterns.
- New icons use the existing `lucide-react` set.
- Colors follow the existing slate/cyan palette.

---

## 7. Implementation Effort Estimate

| Phase | Task | Effort |
|-------|------|--------|
| 1 | Secure `/submissions` with dual auth | 2-3 hours |
| 2 | Extract overlay to standalone script | 4-6 hours |
| 3 | Chat Web self-annotation UI | 3-4 hours |
| 4 | Hosted App registry + iframe panel | 6-8 hours |
| 5 | Full-screen mode + back-link | 2-3 hours |
| — | Tests, docs, skill update | 4-6 hours |
| **Total** | | **~3-4 days** |

---

## 8. Recommendation

**Proceed with the Same-Origin Hosted App architecture.**

This is the only approach that:
1. ✅ Works for remote users without any local setup.
2. ✅ Reuses existing Better Auth / Google OAuth.
3. ✅ Avoids bookmarklets and token-based auth.
4. ✅ Supports both self-annotation (Chat Web) and embedded app annotation.
5. ✅ Allows full-screen app usage.
6. ✅ Does not introduce new security risks.
7. ✅ Fits perfectly into the existing plugin/WebApp architecture.

**Next step:** Implement Phase 1 (dual-auth `/submissions`) and Phase 2 (standalone overlay script) as the foundation. Then iterate on the Chat Web UI integration.

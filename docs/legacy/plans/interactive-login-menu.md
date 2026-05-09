# Implementierungsplan: Interaktives Login-Menü

## Ziel
Wenn der Nutzer `/login` (oder `login.start`) im Chat eingibt, öffnet sich ein natives, interaktives Menü in der Chat Web App — kein externer Link, kein roher JSON-Output. Der Nutzer kann Provider wählen, zwischen OAuth und API Key entscheiden, und den Flow Schritt für Schritt durchlaufen.

## Design-Kontext
- **Dark Terminal** First (DESIGN.md): Deep Charcoal `#101d22`, Panel Teal Black `#1a262b`, Terminal Cyan `#11a4d4`
- **Komponenten-Stil**: Kompakt, technisch, operational — wie Trace Cards / Tool Calls
- **Modal/Overlay**: Halbtransparente Backdrop, zentriertes Panel mit 2px Radius, 1px Slate Border
- **Typografie**: Uppercase Labels, 12–13px Body, Monospace für technische Daten

---

## 1. Datenmodell & API

### 1.1 Backend: Neue Gateway Action `login`
Neue Action `login` (ohne `.start` Suffix) mit Slash-Command `/login`:
- Gibt **keine** Auth-URL zurück
- Gibt stattdessen ein strukturiertes Result, das das Frontend als "Menü-Auslöser" interpretiert:

```json
{
  "action": "show_login_menu",
  "providers": [
    {
      "id": "openai-codex",
      "name": "OpenAI (ChatGPT Plus/Pro)",
      "type": "oauth",
      "authMethods": ["oauth"]
    },
    {
      "id": "anthropic",
      "name": "Anthropic (Claude)",
      "type": "oauth",
      "authMethods": ["oauth"]
    },
    {
      "id": "github-copilot",
      "name": "GitHub Copilot",
      "type": "oauth",
      "authMethods": ["oauth"]
    },
    {
      "id": "openai",
      "name": "OpenAI (API Key)",
      "type": "api_key",
      "authMethods": ["api_key"]
    }
  ]
}
```

### 1.2 Bestehende Actions bleiben erhalten
- `login.start` → wird vom Frontend intern aufgerufen, wenn OAuth gewählt wird
- `login.complete` → wird vom Frontend aufgerufen, wenn Code + State vorliegen
- `login.apikey` → wird vom Frontend aufgerufen, wenn API Key eingegeben wurde
- `login.status` → kann vom Menü aus aufgerufen werden ("Bereits eingeloggt?")
- `logout` → bleibt wie ist

### 1.3 Neuer Endpoint (optional): `/api/auth/providers`
Damit das Frontend die Provider-Liste nicht hardcodieren muss:
```ts
GET /api/auth/providers
→ { providers: OAuthProviderInfo[] }
```
Aber fürs MVP reicht das statische Result von `login`.

---

## 2. Frontend: Chat UI Komponenten

### 2.1 Execution Result Renderer Erweiterung
In `CompactTerminalSessionView` / `TraceSessionView`:
- Wenn `execution_result.result.action === "show_login_menu"`, rendere nicht JSON sondern `LoginMenuCard`
- Diese Karte ist ein interaktives Inline-Element im Chat, kein externes Modal

### 2.2 `LoginMenuCard` Komponente
Inline-Card im Terminal-Stil:
```
┌─────────────────────────────────────────────┐
│  🔐 LOGIN                                   │  ← Header: Lock Icon + "LOGIN" (uppercase, cyan)
├─────────────────────────────────────────────┤
│  Select Provider:                           │  ← Label (uppercase, slate)
│                                             │
│  ┌──────────────┐  ┌──────────────┐        │
│  │  OpenAI      │  │  Anthropic   │        │  ← Provider Buttons
│  │  (OAuth)     │  │  (OAuth)     │        │    [Panel Teal Black bg, cyan border on hover]
│  └──────────────┘  └──────────────┘        │
│                                             │
│  ┌──────────────┐  ┌──────────────┐        │
│  │  GitHub      │  │  OpenAI      │        │
│  │  Copilot     │  │  (API Key)   │        │
│  └──────────────┘  └──────────────┘        │
│                                             │
└─────────────────────────────────────────────┘
```

**Styling (Tailwind):**
- Card: `bg-[#1a262b] border border-[#334155] rounded-sm`
- Header: `text-[#11a4d4] text-xs font-bold uppercase tracking-wider`
- Provider Button: `bg-[#151f24] border border-[#334155] hover:border-[#11a4d4] hover:text-[#11a4d4] rounded-sm p-3 text-sm`
- Active State: `border-[#11a4d4] bg-[#11a4d4]/10`

### 2.3 `OAuthFlowPanel` (Inline-Expansion)
Nach Provider-Auswahl expandiert die Card:
```
┌─────────────────────────────────────────────┐
│  🔐 LOGIN  >  OpenAI (OAuth)                │
├─────────────────────────────────────────────┤
│  Step 1: Open this URL in your browser      │
│  ┌─────────────────────────────────────┐    │
│  │ https://auth.openai.com/...         │  │  ← URL in monospace, truncate mit ellipsis
│  └─────────────────────────────────────┘    │
│  [Copy URL]  [Open in Browser]              │  ← Buttons
│                                             │
│  Step 2: Paste authorization code           │
│  ┌─────────────────────────────────────┐    │
│  │ paste code here...                  │  │  ← Input (monospace, dark bg)
│  └─────────────────────────────────────┘    │
│  [Complete Login]                           │
│                                             │
│  ─── or ───                                 │
│  Waiting for browser callback...            │  ← Auto-detect localhost:1455
│  [Cancel]                                   │
└─────────────────────────────────────────────┘
```

**Auto-Callback (optional V2):**
- Frontend pollt `http://localhost:1455/auth/callback` (CORS-Problem!)
- Alternative: Frontend öffnet Popup/Tab und lauscht auf `window.postMessage` vom Callback
- Für MVP: Manuelles Copy-Paste ist akzeptabel

### 2.4 `ApiKeyPanel` (Inline-Expansion)
```
┌─────────────────────────────────────────────┐
│  🔐 LOGIN  >  OpenAI (API Key)              │
├─────────────────────────────────────────────┤
│  Enter your API key:                        │
│  ┌─────────────────────────────────────┐    │
│  │ sk-...                              │  │  ← Password Input (type="password")
│  └─────────────────────────────────────┘    │
│  [Save API Key]                             │
│                                             │
│  Your key is stored locally in auth.json    │  ← Info-Text (slate, 11px)
└─────────────────────────────────────────────┘
```

### 2.5 State-Management im Frontend
```ts
type LoginStep =
  | { type: "provider_select" }
  | { type: "oauth_flow"; provider: string; url?: string; state?: string }
  | { type: "api_key"; provider: string }
  | { type: "success"; provider: string; method: "oauth" | "api_key" }
  | { type: "error"; message: string };
```
- State lebt in der `LoginMenuCard`-Komponente (lokal, nicht global)
- Nach Success/Error: Card zeigt Ergebnis, Nutzer kann schließen

---

## 3. Interaktions-Flow

### 3.1 Nutzer tippt `/login`
1. Frontend erkennt Slash-Command, ruft `postAction(piboSessionId, "login")` auf
2. Backend gibt `{ action: "show_login_menu", providers: [...] }` zurück
3. Frontend rendert `LoginMenuCard` mit Provider-Auswahl

### 3.2 Nutzer wählt OAuth-Provider
1. Frontend ruft `postAction(piboSessionId, "login.start", { provider })` auf
2. Backend gibt `{ url, state, provider, instructions }` zurück
3. Frontend expandiert Card zu `OAuthFlowPanel` mit URL
4. Nutzer kopiert URL oder öffnet Browser
5. Nach OAuth-Callback gibt Nutzer Code ein
6. Frontend ruft `postAction(piboSessionId, "login.complete", { provider, code, state })` auf
7. Bei Success: Card zeigt "✓ Logged in as [account]" und verblasst nach 3s

### 3.3 Nutzer wählt API Key
1. Frontend expandiert Card zu `ApiKeyPanel`
2. Nutzer gibt Key ein
3. Frontend ruft `postAction(piboSessionId, "login.apikey", { provider, apiKey })` auf
4. Bei Success: Card zeigt Bestätigung

---

## 4. Backend-Änderungen

### 4.1 Neue Gateway Action: `login`
```ts
api.registerGatewayAction({
  name: "login",
  description: "Open the interactive login menu.",
  slashCommands: ["login"],
  execute() {
    return {
      action: "show_login_menu",
      providers: [
        { id: "openai-codex", name: "OpenAI (ChatGPT Plus/Pro)", type: "oauth", authMethods: ["oauth"] },
        { id: "anthropic", name: "Anthropic (Claude)", type: "oauth", authMethods: ["oauth"] },
        { id: "github-copilot", name: "GitHub Copilot", type: "oauth", authMethods: ["oauth"] },
        { id: "openai", name: "OpenAI (API Key)", type: "api_key", authMethods: ["api_key"] },
      ],
    };
  },
});
```

### 4.2 `login.start` Default-Provider
Bereits implementiert: `provider` ist optional, Default ist `openai-codex`.

### 4.3 Neue Dateien
- `src/plugins/builtin.ts` — Action `login` hinzufügen (neben den bestehenden login.* Actions)

---

## 5. Frontend-Änderungen

### 5.1 Neue Dateien
- `src/apps/chat-ui/src/auth/LoginMenuCard.tsx` — Hauptkomponente
- `src/apps/chat-ui/src/auth/ProviderGrid.tsx` — Provider-Auswahl Grid
- `src/apps/chat-ui/src/auth/OAuthFlowPanel.tsx` — OAuth-Schritte
- `src/apps/chat-ui/src/auth/ApiKeyPanel.tsx` — API Key Eingabe

### 5.2 Geänderte Dateien
- `src/apps/chat-ui/src/session-views/compact-terminal/CompactTerminalSessionView.tsx` — Execution Result Renderer erweitern für `show_login_menu`
- `src/apps/chat-ui/src/session-views/TraceSessionView.tsx` — Gleiche Erweiterung für Trace View
- `src/apps/chat-ui/src/api.ts` — `postAction` Typen ggf. erweitern (falls noch nicht generisch)

### 5.3 Renderer-Erweiterung (Pseudocode)
```tsx
// In CompactTerminalSessionView / TraceSessionView
function renderExecutionResult(result: unknown) {
  if (isLoginMenuResult(result)) {
    return <LoginMenuCard
      providers={result.providers}
      piboSessionId={piboSessionId}
      onStartOAuth={(provider) => postAction(piboSessionId, "login.start", { provider })}
      onCompleteOAuth={(provider, code, state) => postAction(piboSessionId, "login.complete", { provider, code, state })}
      onSetApiKey={(provider, apiKey) => postAction(piboSessionId, "login.apikey", { provider, apiKey })}
    />;
  }
  // ... bestehende Rendering-Logik
}
```

---

## 6. Design-Details (nach DESIGN.md)

| Element | Farbe / Stil |
|---------|-------------|
| Card Background | `#1a262b` (Panel Teal Black) |
| Card Border | `#334155` (Technical Border Slate) |
| Header Text | `#11a4d4` (Terminal Cyan), 12px, bold, uppercase |
| Provider Button BG | `#151f24` (Header Charcoal) |
| Provider Button Border | `#334155`, hover → `#11a4d4` |
| Provider Button Text | `#e2e8f0` (Light Slate), hover → `#11a4d4` |
| Active Provider | `border-[#11a4d4] bg-[#11a4d4]/10` |
| Input BG | `#0e1116` (Near-Black Code Well) |
| Input Border | `#334155`, focus → `#11a4d4` |
| Success State | `#0bda57` (Matrix Success Green) |
| Error State | `#ef4444` (Error Red) |
| Info Text | `#64748b` (Neutral Slate), 11px |
| Backdrop (optional) | `bg-black/50` für Modal-Variante |

---

## 7. Phasen / Milestones

### Phase 1: Backend (1h)
- [ ] Neue Gateway Action `login` mit `show_login_menu` Result
- [ ] `login.start` Default-Provider bleibt wie ist
- [ ] Build & Test

### Phase 2: Frontend — LoginMenuCard (2–3h)
- [ ] `LoginMenuCard` Komponente mit Provider Grid
- [ ] `OAuthFlowPanel` mit URL-Anzeige + Code-Input
- [ ] `ApiKeyPanel` mit Password-Input
- [ ] Design nach DESIGN.md

### Phase 3: Frontend — Integration (1h)
- [ ] Execution Result Renderer in CompactTerminalSessionView erweitern
- [ ] Execution Result Renderer in TraceSessionView erweitern
- [ ] API Calls (postAction) mit korrekten Parametern

### Phase 4: Polish (1h)
- [ ] Loading States während API Calls
- [ ] Error Handling (rote Banner in der Card)
- [ ] Success States (grüne Bestätigung + Auto-Close)
- [ ] Keyboard Navigation (Enter im Input, Escape zum Schließen)

### Phase 5: Erweiterung (optional, später)
- [ ] Auto-Callback via Popup/PostMessage statt manuellem Copy-Paste
- [ ] `login.status` Integration (zeigt bereits eingeloggte Provider grün an)
- [ ] `logout` Button pro Provider im Menü

---

## 8. Offene Fragen

1. **Soll `/login` ein neuer Slash-Command sein, oder soll `/login-start` weiterhin funktionieren?**
   → `/login-start` bleibt als Low-Level API. `/login` ist das neue User-facing Kommando.

2. **Soll die Card inline im Chat erscheinen, oder als Overlay/Modal?**
   → Inline im Chat (wie eine spezielle Execution Result Card). Modal ist optional für kleine Screens.

3. **Wie werden nicht-unterstützte Provider (z.B. Anthropic OAuth) gehandhabt?**
   → Im MVP nur `openai-codex` aktiv, andere ausgegraut mit "Coming Soon" Badge. Später dynamisch aus `getOAuthProviders()`.

4. **Soll der API Key im Frontend sichtbar sein, oder immer `type="password"`?**
   → Default `password`, optional Toggle-Button zum Anzeigen (👁️ Icon).

---

## 9. Zusammenhang mit bestehenden Features

- **Websearch**: Nach Login kann `web_search` genutzt werden (OpenAI Provider required)
- **Profile-Switching**: Profile wie `pibo-kimi-coding` brauchen keine OAuth-Login, aber API Keys
- **Gateway Actions**: `login` folgt demselben Muster wie `status`, `compact`, `thinking`
- **Chat Web App**: Nutzt bestehendes `postAction` API, kein neuer Endpoint nötig

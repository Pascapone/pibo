# Plan: Provider-Authentifizierung in Settings verlagern

## Ziel
Die komplette Login-/Auth-/Provider-Konfiguration wird aus dem Chat-Input (Slash-Commands) entfernt und in ein dediziertes **Settings > Providers** Panel der Web Chat App verlagert.

---

## 1. Rückbau: Alles Inline-Login-Zeug entfernen

### 1.1 Backend — Slash-Commands entfernen
In `src/plugins/builtin.ts` werden von den bestehenden Login-Actions **alle `slashCommands` entfernt**:

| Action | Aktueller Slash-Command | Nachher |
|--------|------------------------|---------|
| `login` (neu) | `/login` | **Action komplett entfernen** |
| `login.start` | `/login-start` | `slashCommands: []` |
| `login.complete` | `/login-complete` | `slashCommands: []` |
| `login.apikey` | `/login-apikey` | `slashCommands: []` |
| `login.status` | `/login-status` | `slashCommands: []` |
| `logout` | `/logout` | `slashCommands: []` |

Die Actions selbst (`login.start`, `login.complete`, `login.apikey`, `login.status`, `logout`) bleiben im Backend erhalten, weil das Settings-Panel sie direkt über `postAction` aufruft.

### 1.2 Frontend — LoginMenuCard & Integration entfernen
Folgende Dateien werden **gelöscht**:
- `src/apps/chat-ui/src/auth/LoginMenuCard.tsx`
- `src/apps/chat-ui/src/auth/loginMenu.ts`

Folgende Dateien werden **zurückgesetzt** (Login-Integration entfernt):
- `src/apps/chat-ui/src/session-views/compact-terminal/CompactTerminalSessionView.tsx`
  - Import `LoginMenuCard` + `extractLoginMenuResult` entfernen
  - `LoginMenuCard`-Rendering-Block entfernen
- `src/apps/chat-ui/src/session-views/TraceSessionView.tsx`
  - `piboSessionId` Prop an `TraceTimeline` entfernen
- `src/apps/chat-ui/src/tracing/TraceTimeline.tsx`
  - `piboSessionId` Prop entfernen
  - `piboSessionId` nicht mehr an `TraceSpanCard` übergeben
- `src/apps/chat-ui/src/tracing/SpanNode.tsx`
  - Import `LoginMenuCard` + `extractLoginMenuResult` entfernen
  - `piboSessionId` Prop aus `SpanNodeProps` + `TraceSpanCardProps` entfernen
  - `piboSessionId` nicht mehr rekursiv an Kinder übergeben
  - `execution.command`-Login-Branch in `SpanContent` entfernen

---

## 2. Neubau: Settings-Panel "Providers"

### 2.1 Neue Route & Navigation
- `SettingsPanel` Typ erweitern: `"general" | "pi-packages" | "skills" | "providers"`
- Route `/settings/providers` hinzufügen
- `SettingsSidebar` bekommt neuen Eintrag **Providers** mit Icon `Key` o.ä.
- Navigation von `/settings` und `SettingsSidebar` erweitern

### 2.2 Neue Komponente: `ProviderSettingsView`
Pfad: `src/apps/chat-ui/src/settings/ProviderSettingsView.tsx`

**Layout** (Dark Terminal Style nach DESIGN.md):
```
┌─────────────────────────────────────────────┐
│  Providers                         [?]      │  ← Header
├─────────────────────────────────────────────┤
│  ┌───────────────────────────────────────┐  │
│  │  openai-codex              [OAuth]    │  │  ← Provider Row
│  │  OpenAI (ChatGPT Plus/Pro)            │  │
│  │  Status: Not configured               │  │
│  │  [Configure]                          │  │
│  └───────────────────────────────────────┘  │
│  ┌───────────────────────────────────────┐  │
│  │  openai                    [API Key]  │  │
│  │  OpenAI (API Key)                     │  │
│  │  Status: Configured ✓                 │  │
│  │  [Reconfigure]  [Remove]              │  │
│  └───────────────────────────────────────┘  │
│  ...                                        │
└─────────────────────────────────────────────┘
```

**Design:**
- Card Background: `#1a262b`, Border: `#334155`, Radius: `rounded-sm`
- Header: `#11a4d4`, uppercase, 12px, bold
- Provider Row: `#151f24` bg, `#334155` border, hover: cyan border
- Status "Configured": `#0bda57` (Matrix Success Green)
- Status "Not configured": `#64748b` (Neutral Slate)
- Buttons: Secondary-Style (transparent, slate text, cyan on hover)

### 2.3 Provider-Liste
Die angezeigten Provider sollen **exakt dieselben** sein, die im `modelCatalog` vorhanden sind, plus ggf. statisch definierte Auth-Only-Provider.

Minimal-Set (wie im `modelCatalog` + Auth-spezifisch):
| ID | Name | Auth-Method |
|---|---|---|
| `openai-codex` | OpenAI (ChatGPT Plus/Pro) | OAuth |
| `openai` | OpenAI (API Key) | API Key |
| `anthropic` | Anthropic (Claude) | OAuth |
| `github-copilot` | GitHub Copilot | OAuth |

Die Liste wird initial **statisch** definiert (wie `modelCatalog.providers`), kann später dynamisch aus dem Backend kommen.

### 2.4 Auth-Flow im Settings-Panel

#### OAuth-Flow (z.B. openai-codex)
1. Nutzer klickt "Configure" bei einem OAuth-Provider
2. Panel expandiert inline:
   - Step 1: URL wird angezeigt + "Copy URL" + "Open in Browser"
   - Step 2: Input-Feld für Authorization Code
   - "Complete Login"-Button
3. Frontend ruft `postAction(sessionId, "login.start", { provider })` auf
4. Dann `postAction(sessionId, "login.complete", { provider, code, state })`
5. Erfolg: Status wechselt auf "Configured", Panel klappt zu

#### API-Key-Flow (z.B. openai)
1. Nutzer klickt "Configure"
2. Panel expandiert inline:
   - Password-Input für API Key (mit Eye/EyeOff Toggle)
   - "Save API Key"-Button
3. Frontend ruft `postAction(sessionId, "login.apikey", { provider, apiKey })` auf
4. Erfolg: Status wechselt auf "Configured"

#### Status-Abfrage
Beim Öffnen des Panels ruft das Frontend `postAction(sessionId, "login.status")` auf und zeigt für jeden Provider an, ob er konfiguriert ist.

#### Logout
Pro konfiguriertem Provider ein "Remove"-Button, der `postAction(sessionId, "logout", { provider })` aufruft.

### 2.5 API-Integration
Die bestehende `postAction` Funktion in `api.ts` wird verwendet (keine neuen Endpoints nötig):
```ts
await postAction(piboSessionId, "login.start", { provider });
await postAction(piboSessionId, "login.complete", { provider, code, state });
await postAction(piboSessionId, "login.apikey", { provider, apiKey });
await postAction(piboSessionId, "login.status");
await postAction(piboSessionId, "logout", { provider });
```

Da `postAction` eine `piboSessionId` braucht, nutzt das Settings-Panel die **aktuelle Session** des Bootstrap-Data (`bootstrap.session.id` oder einen dedizierten System-Session-Context). Falls nötig, kann der Backend-Endpoint auch sessionlos aufgerufen werden (zukünftige Erweiterung).

---

## 3. Dateien & Änderungen

### Gelöscht
- `src/apps/chat-ui/src/auth/LoginMenuCard.tsx`
- `src/apps/chat-ui/src/auth/loginMenu.ts`

### Geändert (Rückbau)
| Datei | Änderung |
|-------|----------|
| `src/plugins/builtin.ts` | `login` Action entfernen; Slash-Commands von `login.start`, `login.complete`, `login.apikey`, `login.status`, `logout` entfernen |
| `src/apps/chat-ui/src/session-views/compact-terminal/CompactTerminalSessionView.tsx` | LoginMenuCard-Import + Rendering entfernen |
| `src/apps/chat-ui/src/session-views/TraceSessionView.tsx` | `piboSessionId` Prop entfernen |
| `src/apps/chat-ui/src/tracing/TraceTimeline.tsx` | `piboSessionId` Prop + Übertragung entfernen |
| `src/apps/chat-ui/src/tracing/SpanNode.tsx` | LoginMenuCard-Import, `piboSessionId` Props, execution.command Login-Branch entfernen |

### Neu
| Datei | Beschreibung |
|-------|--------------|
| `src/apps/chat-ui/src/settings/ProviderSettingsView.tsx` | Hauptkomponente für Provider-Konfiguration |

### Geändert (Neubau)
| Datei | Änderung |
|-------|----------|
| `src/apps/chat-ui/src/App.tsx` | `SettingsPanel` Typ um `"providers"` erweitern; Route-Handling; `SettingsSidebar` um Providers-Entry erweitern; `SettingsView` um `providers`-Panel erweitern |
| `src/apps/chat-ui/src/api.ts` | Keine Änderung nötig (bestehendes `postAction` wird wiederverwendet) |

---

## 4. Phasen

### Phase 1: Rückbau (30 min)
1. `src/plugins/builtin.ts`: `login` Action entfernen, Slash-Commands von Auth-Actions entfernen
2. Alle Frontend-Login-Integrationen entfernen (CompactTerminal, Trace, SpanNode)
3. `LoginMenuCard.tsx` + `loginMenu.ts` löschen
4. Build + Typecheck

### Phase 2: Settings-Panel (2–3h)
1. `SettingsPanel` Typ erweitern
2. `SettingsSidebar` neuen Entry hinzufügen
3. Routing in `App.tsx` erweitern
4. `ProviderSettingsView.tsx` erstellen mit:
   - Statische Provider-Liste
   - Status-Anzeige (via `login.status`)
   - OAuth-Expand-Panel
   - API-Key-Expand-Panel
   - Loading/Error/Success States

### Phase 3: Integration & Deploy (30 min)
1. `SettingsView` um `providers`-Panel erweitern
2. Build + Typecheck
3. Deploy to dev via `scripts/deploy-web-dev.sh`; deploy production via `scripts/deploy-web.sh` only after dev validation and approval

---

## 5. Offene Entscheidungen

1. **Session für `postAction` im Settings-Panel:**
   - Option A: Nutzt die aktuell aktive Chat-Session (wie der Rest der App)
   - Option B: Backend erlaubt sessionlose Auth-Calls (neuer Endpoint `/api/auth/providers`)
   - **Empfehlung:** Option A (einfacher, kein neuer Endpoint)

2. **Provider-Liste statisch vs. dynamisch:**
   - Option A: Statisch wie im Plan definiert (MVP)
   - Option B: Dynamisch aus `modelCatalog.providers` + Auth-Metadaten
   - **Empfehlung:** Option A für MVP

3. **OAuth Callback Handling:**
   - Option A: Manueller Copy-Paste Code (wie bisher implementiert)
   - Option B: Popup/Tab mit `window.postMessage` (V2)
   - **Empfehlung:** Option A für MVP

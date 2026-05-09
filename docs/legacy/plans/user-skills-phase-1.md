# Implementierungsplan: User Skills — Phase 1

## Ziel

User können über die Chat Web App:
1. **Eigene Skills erstellen** (Name, Description, Markdown-Instruktionen)
2. **Skills von skills.sh installieren** (via skills.sh-Link oder GitHub-Link)
3. **Skills verwalten** (Enable/Disable, Edit, Delete, View)

Ein Skill ist ein Ordner mit mindestens `SKILL.md` und optional `scripts/`, `references/`, `assets/`. Alle Dateien werden mitgenommen.

---

## 1. Speicherstruktur

```
.pibo/
├── user-skills.json                    # Metadaten-Store
└── user-skills/
    ├── my-custom-skill/
    │   ├── SKILL.md
    │   ├── scripts/
    │   │   └── helper.py
    │   └── references/
    │       └── api-docs.md
    └── frontend-design/
        ├── SKILL.md
        └── scripts/
            └── setup.sh
```

**`user-skills.json`** — enthält pro Skill:
- `id` (UUID)
- `name` (aus SKILL.md Frontmatter oder Ordnername)
- `description` (aus SKILL.md Frontmatter)
- `path` (relativer Pfad zu SKILL.md)
- `source` ("user-created" | "skills.sh" | "github")
- `sourceUrl` (optional, z.B. "https://skills.sh/anthropics/skills/frontend-design")
- `enabled: boolean`
- `createdAt`, `updatedAt`

---

## 2. Backend — Neues Modul `src/user-skills/`

### 2.1 `src/user-skills/types.ts`

```typescript
export type UserSkillSource = "user-created" | "skills.sh" | "github";

export type UserSkill = {
  id: string;
  name: string;
  description: string;
  path: string;                 // z.B. ".pibo/user-skills/my-skill/SKILL.md"
  enabled: boolean;
  source: UserSkillSource;
  sourceUrl?: string;
  createdAt: string;
  updatedAt: string;
};

export type UserSkillStoreData = {
  version: 1;
  skills: UserSkill[];
};

export type CreateUserSkillInput = {
  name: string;
  description: string;
  markdown: string;
};

export type UpdateUserSkillInput = Partial<{
  name: string;
  description: string;
  markdown: string;
  enabled: boolean;
}>;

export type InstallUserSkillInput = {
  url: string;  // skills.sh-Link oder GitHub-Link
};
```

### 2.2 `src/user-skills/store.ts`

Responsibilities:
- CRUD auf `user-skills.json`
- Dateisystem-Operationen (SKILL.md schreiben/lesen/löschen)
- Validierung: Name eindeutig, Pattern `[a-z][a-z0-9-]*`, max 64 Zeichen
- Keine Kollision mit Plugin Skills prüfen (über Registry)

Key Functions:
```typescript
loadUserSkillStore(cwd: string): UserSkillStoreData
saveUserSkillStore(data: UserSkillStoreData, cwd: string): void
listUserSkills(cwd: string): UserSkill[]
findUserSkill(idOrName: string, cwd: string): UserSkill | undefined
createUserSkill(input: CreateUserSkillInput, cwd: string): UserSkill
updateUserSkill(id: string, input: UpdateUserSkillInput, cwd: string): UserSkill
deleteUserSkill(id: string, cwd: string): void
setUserSkillEnabled(id: string, enabled: boolean, cwd: string): UserSkill
```

**Frontmatter-Handling:**
- Beim Speichern: System generiert YAML-Frontmatter aus `name` + `description` und prependet es zum Markdown-Body
- Beim Laden: Parser extrahiert Frontmatter, gibt `name`, `description`, `body` zurück
- Body = alles nach dem schließenden `---`

### 2.3 `src/user-skills/installer.ts`

Responsibilities:
- Skills von externen Quellen installieren
- URL parsen und auflösen
- GitHub API nutzen um Skill-Ordner zu finden
- Alle Dateien herunterladen (nicht nur SKILL.md)

#### URL-Parser

Unterstützte Formate:

| Format | Beispiel | Parsed |
|--------|----------|--------|
| skills.sh skill | `https://skills.sh/anthropics/skills/frontend-design` | owner=anthropics, repo=skills, skill=frontend-design |
| skills.sh repo | `https://skills.sh/anthropics/skills` | owner=anthropics, repo=skills |
| GitHub tree | `https://github.com/anthropics/skills/tree/main/skills/frontend-design` | owner=anthropics, repo=skills, path=skills/frontend-design |
| GitHub shorthand | `anthropics/skills` | owner=anthropics, repo=skills |

#### Download-Logik

```typescript
async function downloadSkillFromGitHub(
  owner: string,
  repo: string,
  path: string,       // z.B. "skills/frontend-design"
  cwd: string,
  targetName: string  // wie der Skill lokal heißen soll
): Promise<UserSkill>
```

**Algorithmus:**
1. GitHub Contents API: `GET /repos/{owner}/{repo}/contents/{path}`
2. Für jede Datei im Ordner:
   - Wenn `type === "file"`: Lade `download_url`
   - Wenn `type === "dir"`: Rekursiv dessen Inhalt laden
3. Schreibe alles unter `.pibo/user-skills/{targetName}/`
4. Lese `SKILL.md`, parse Frontmatter für `name` und `description`
5. Erstelle Eintrag in `user-skills.json`

**Fehlerbehandlung:**
- Kein SKILL.md gefunden → Error
- GitHub API Rate Limit → Error mit Hinweis
- Netzwerkfehler → Error
- Name-Kollision → Error (User muss umbenennen)

### 2.4 `src/user-skills/manager.ts`

Responsibilities:
- Bridge zwischen Store und Plugin Registry
- Synchronisiert alle User Skills in die Registry

```typescript
export class UserSkillManager {
  constructor(private registry: PiboPluginRegistry, private cwd: string);

  sync(): void;
  // Unregistriert alle bisherigen User Skills aus Registry
  // Registriert alle aktivierten User Skills aus dem Store neu

  installFromUrl(url: string): Promise<UserSkill>;
  // Parsed URL → ruft installer.ts → sync()

  create(input: CreateUserSkillInput): UserSkill;
  update(id: string, input: UpdateUserSkillInput): UserSkill;
  remove(id: string): void;
  setEnabled(id: string, enabled: boolean): UserSkill;
}
```

**Sync-Mechanismus:**
1. Manager merkt sich registrierte User Skill Namen in einem internen Set
2. Bei `sync()`: Für alle in `user-skills.json` mit `enabled=true`:
   - Falls noch nicht registriert: `registry.registerSkill({ name, path, enabled: true })`
3. Für alle bisher registrierten User Skills, die nicht mehr im Store sind:
   - `registry.unregisterSkill(name)`

---

## 3. Backend — Erweiterungen bestehender Module

### 3.1 `src/plugins/registry.ts`

**Neue Methoden:**

```typescript
unregisterSkill(name: string): boolean;
// Entfernt Skill aus Map. Gibt true zurück wenn gelöscht.
// Kein Error wenn Skill nicht existiert.

getRegisteredSkillNames(): string[];
// Gibt alle registrierten Skill-Namen zurück
```

**Keine Änderung an `getCapabilityCatalog()` nötig** — User Skills erscheinen automatisch, da sie in `this.skills` landen.

### 3.2 `src/plugins/types.ts`

```typescript
export type PiboSkillInfo = {
  name: string;
  path: string;
  source?: "plugin" | "user";   // ← NEU
};
```

`source` wird vom Registry gesetzt: Plugin Skills → `"plugin"`, User Skills → `"user"`.

### 3.3 `src/apps/chat/web-app.ts`

#### Neue REST-Endpunkte

| Methode | Route | Body | Response |
|---------|-------|------|----------|
| GET | `/api/chat/user-skills` | — | `{ skills: UserSkill[] }` |
| POST | `/api/chat/user-skills` | `{ name, description, markdown }` | `{ skill: UserSkill }` |
| GET | `/api/chat/user-skills/:id` | — | `{ skill: UserSkill, markdown: string }` |
| PATCH | `/api/chat/user-skills/:id` | `{ name?, description?, markdown?, enabled? }` | `{ skill: UserSkill }` |
| DELETE | `/api/chat/user-skills/:id` | — | `{ removedSkillId: string }` |
| POST | `/api/chat/user-skills/install` | `{ url }` | `{ skill: UserSkill }` |

**Auth:**
- Alle erfordern `requireSession`
- Mutations erfordern `requireSameOriginJsonRequest`

**Nach jeder Mutation:**
```typescript
userSkillManager.sync();
```

#### `buildAgentCatalog` Erweiterung

```typescript
async function buildAgentCatalog(context) {
  const catalog = context.channelContext.getCapabilityCatalog?.() ?? { ... };
  return {
    ...catalog,
    mcpServers: await listMcpServerInfos(),
    piPackages: listPiPackages(),
    userSkills: listUserSkills(),  // ← NEU
  };
}
```

#### Server-Start

Beim Bootstrap des Chat Web Servers:
```typescript
const userSkillManager = new UserSkillManager(pluginRegistry, process.cwd());
userSkillManager.sync();
// Speichere userSkillManager im App-Context für Endpunkt-Handler
```

---

## 4. Frontend

### 4.1 Typen (`src/apps/chat-ui/src/types.ts`)

```typescript
export type UserSkill = {
  id: string;
  name: string;
  description: string;
  path: string;
  enabled: boolean;
  source: "user-created" | "skills.sh" | "github";
  sourceUrl?: string;
  createdAt: string;
  updatedAt: string;
};

export type AgentCatalog = {
  // ... bestehende Felder
  userSkills: UserSkill[];
};
```

### 4.2 API (`src/apps/chat-ui/src/api.ts`)

```typescript
export async function listUserSkills(): Promise<UserSkill[]> {
  return (await requestJson<{ skills: UserSkill[] }>("/api/chat/user-skills")).skills;
}

export async function getUserSkill(id: string): Promise<{ skill: UserSkill; markdown: string }> {
  return requestJson(`/api/chat/user-skills/${encodeURIComponent(id)}`);
}

export async function createUserSkill(input: { name: string; description: string; markdown: string }): Promise<UserSkill> {
  return (await requestJson<{ skill: UserSkill }>("/api/chat/user-skills", {
    method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(input),
  })).skill;
}

export async function updateUserSkill(
  id: string,
  input: Partial<{ name: string; description: string; markdown: string; enabled: boolean }>
): Promise<UserSkill> {
  return (await requestJson<{ skill: UserSkill }>(`/api/chat/user-skills/${encodeURIComponent(id)}`, {
    method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify(input),
  })).skill;
}

export async function deleteUserSkill(id: string): Promise<{ removedSkillId: string }> {
  return requestJson(`/api/chat/user-skills/${encodeURIComponent(id)}`, { method: "DELETE" });
}

export async function installUserSkill(url: string): Promise<UserSkill> {
  return (await requestJson<{ skill: UserSkill }>("/api/chat/user-skills/install", {
    method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ url }),
  })).skill;
}
```

### 4.3 Bootstrap Integration

In `normalizeBootstrap` (`api.ts`):
```typescript
agentCatalog: payload.agentCatalog ? {
  ...payload.agentCatalog,
  userSkills: payload.agentCatalog.userSkills ?? [],
} : payload.agentCatalog
```

### 4.4 UI: Neuer Settings-Panel "Skills"

**Ort:** Settings als drittes Panel `skills` (neben `general` und `pi-packages`).

```typescript
type SettingsPanel = "general" | "pi-packages" | "skills";
```

#### `UserSkillsSettings` Komponente

Layout angelehnt an `PiPackagesSettings`:

**Header-Bereich:**
- Button "Create Skill" → öffnet Create-Modal
- Button "Install from URL" → öffnet Install-Modal
- Zähler: `{total} skills / {enabled} enabled`

**Skill-Liste:**
- Karten-Layout (wie Pi Package Cards)
- Pro Skill:
  - Name (fett)
  - Description (truncate)
  - Source-Badge: `"user"` | `"skills.sh"` | `"github"`
  - Status-Badge: `enabled` | `disabled`
  - Buttons: Edit, Toggle Enabled, Delete
- Expand-Detail zeigt Markdown-Preview (read-only)

**Create/Edit Modal:**
```
┌─────────────────────────────┐
│  Create / Edit Skill        │
├─────────────────────────────┤
│  Name: [frontend-design  ]  │
│  Description: [Short desc ] │
│                             │
│  Content:                   │
│  ┌─────────────────────┐    │
│  │# My Skill           │    │
│  │                     │    │
│  │Instructions here... │    │
│  └─────────────────────┘    │
│                             │
│  [Cancel]    [Save]         │
└─────────────────────────────┘
```

**Install Modal:**
```
┌─────────────────────────────┐
│  Install Skill              │
├─────────────────────────────┤
│                             │
│  skills.sh or GitHub URL:   │
│  [https://skills.sh/... ]   │
│                             │
│  Supports:                  │
│  • skills.sh/<owner>/<repo> │
│  • github.com/<owner>/<repo>│
│  • <owner>/<repo>           │
│                             │
│  [Cancel]    [Install]      │
└─────────────────────────────┘
```

### 4.5 Agent Designer Integration

**Keine Code-Änderung nötig** — User Skills erscheinen automatisch in `catalog.skills`.

**Aber:** Wir sollten visuell unterscheiden. Erweiterung in `CatalogToggle`:

```tsx
<CatalogSection title="Skills">
  {catalog?.skills.map((skill) => (
    <CatalogToggle
      key={skill.name}
      checked={draft.skills.includes(skill.name)}
      title={skill.name}
      description={skill.path}
      badge={skill.source === "user" ? "user" : undefined}
      onToggle={() => toggleName(skill.name)}
    />
  ))}
</CatalogSection>
```

Wenn `badge="user"`, zeige ein kleines User-Icon neben dem Namen.

---

## 5. Runtime / Prompt Assembly

**Keine Änderung nötig.**

Der Flow:
1. `createCustomAgentProfileDefinition` → `context.getSkill(skillName)` → findet User Skill (Registry)
2. `InitialSessionContextBuilder.addSkill(skill)` → packt `SkillProfile` in Context
3. `createPiboRuntime` → `getEnabledSkillPaths()` → `additionalSkillPaths` → Pi Resource Loader
4. Pi Resource Loader lädt `SKILL.md` + alle referenzierten Dateien

---

## 6. Datenfluss

```
User (Browser)
    │
    ├── Create Skill ──→ POST /user-skills ──→ Store ──→ Registry ──→ Catalog
    │
    ├── Edit Skill ────→ PATCH /user-skills/:id ──→ Store ──→ Registry ──→ Catalog
    │
    ├── Delete Skill ──→ DELETE /user-skills/:id ──→ Store ──→ Registry ──→ Catalog
    │
    ├── Toggle Enable ─→ PATCH /user-skills/:id ──→ Store ──→ Registry ──→ Catalog
    │
    └── Install URL ───→ POST /user-skills/install ──→ GitHub API ──→ Download
                                                           │
                                                           ▼
                                                       Store ──→ Registry ──→ Catalog
```

---

## 7. Dateien & Änderungen

### Neue Dateien

| Datei | Lines (geschätzt) | Beschreibung |
|-------|-------------------|--------------|
| `src/user-skills/types.ts` | ~40 | Typen für User Skills |
| `src/user-skills/store.ts` | ~200 | JSON-Store CRUD + Frontmatter-Parsing |
| `src/user-skills/installer.ts` | ~150 | GitHub API Download + URL-Parser |
| `src/user-skills/manager.ts` | ~80 | Sync mit Plugin Registry |

### Geänderte Dateien

| Datei | Änderung |
|-------|----------|
| `src/plugins/registry.ts` | `unregisterSkill()`, `getRegisteredSkillNames()` |
| `src/plugins/types.ts` | `PiboSkillInfo.source?: "plugin" \| "user"` |
| `src/apps/chat/web-app.ts` | 6 neue Endpunkte, `buildAgentCatalog` erweitert, Manager-Instanziierung |
| `src/apps/chat-ui/src/types.ts` | `UserSkill` + `AgentCatalog.userSkills` |
| `src/apps/chat-ui/src/api.ts` | 6 neue API-Funktionen + `normalizeBootstrap` erweitert |
| `src/apps/chat-ui/src/App.tsx` | Settings Panel "skills", 3 Modals, Agent Designer Badge |

---

## 8. Design-Entscheidungen

### 8.1 Namenskonflikte

**Regel:** User Skills dürfen nicht denselben Namen wie ein Plugin Skill haben.

**Validierung:** Beim `create`/`update` prüft der Store gegen `registry.getRegisteredSkillNames()` (nur Plugin Skills, nicht User Skills). Bei Kollision: Error.

### 8.2 Frontmatter-Handling

**Regel:** Das System generiert das Frontmatter. Der User editiert nur den Body.

**Beim Speichern:**
```markdown
---
name: {name}
description: {description}
---

{user-markdown-body}
```

**Beim Laden:**
- Parse YAML-Frontmatter zwischen `---` Delimitern
- Extrahiere `name`, `description`
- Body = alles nach dem zweiten `---`
- Wenn kein Frontmatter: name = Ordnername, description = "", body = gesamter Inhalt

### 8.3 Multi-File Skills bei Download

**Regel:** Alle Dateien im Skill-Ordner werden rekursiv heruntergeladen.

**Algorithmus:**
1. GitHub Contents API liefert Dateien und Ordner
2. Für `type === "file"`: Lade `download_url`
3. Für `type === "dir"`: Rekursiver Aufruf
4. Lokale Ordnerstruktur wird gespiegelt

### 8.4 Source-Diskriminierung

| Source | Beschreibung | Editable? | Deletable? |
|--------|--------------|-----------|------------|
| `user-created` | User hat selbst erstellt | ✅ Ja | ✅ Ja |
| `skills.sh` | Von skills.sh installiert | ✅ Ja (Content) | ✅ Ja |
| `github` | Von GitHub direkt installiert | ✅ Ja (Content) | ✅ Ja |

Alle User Skills sind prinzipiell editierbar und löschbar.

---

## 9. Offene Punkte (nach Implementierung klären)

1. **GitHub API Rate Limiting** — ohne Auth sind es 60 Requests/hour. Reicht das? Sollten wir einen GitHub Token unterstützen?
2. **skills.sh API** — aktuell kein öffentlicher API-Zugang. Wir parsen die URLs und gehen direkt zu GitHub. Falls skills.sh später eine API anbietet, können wir umstellen.
3. **Skill-Updates** — Wenn ein Skill auf GitHub aktualisiert wird, wie bekommt der User das mit? Phase 2: "Update verfügbar"-Indikator.

---

## 10. Implementierungs-Reihenfolge

1. **`src/user-skills/types.ts`** — Typen definieren
2. **`src/plugins/registry.ts`** — `unregisterSkill()` hinzufügen
3. **`src/user-skills/store.ts`** — Store + Frontmatter-Parsing
4. **`src/user-skills/installer.ts`** — URL-Parser + GitHub Download
5. **`src/user-skills/manager.ts`** — Registry-Sync
6. **`src/apps/chat/web-app.ts`** — REST-Endpunkte + Manager-Instanziierung
7. **Frontend Typen + API** — `types.ts`, `api.ts`
8. **Frontend UI** — Settings Panel "skills" in `App.tsx`
9. **Frontend Integration** — Agent Designer Badge, Bootstrap
10. **Testing** — E2E: Create → Edit → Enable → Use in Agent → Delete

---

## Anhang: Frontmatter Parser

```typescript
function parseSkillMd(content: string): { name: string; description: string; body: string } {
  const trimmed = content.trim();
  if (!trimmed.startsWith("---")) {
    return { name: "", description: "", body: trimmed };
  }
  const endIdx = trimmed.indexOf("---", 3);
  if (endIdx === -1) {
    return { name: "", description: "", body: trimmed };
  }
  const frontmatter = trimmed.slice(3, endIdx).trim();
  const body = trimmed.slice(endIdx + 3).trimStart();
  const parsed = yaml.parse(frontmatter) as Record<string, unknown>;
  return {
    name: typeof parsed.name === "string" ? parsed.name : "",
    description: typeof parsed.description === "string" ? parsed.description : "",
    body,
  };
}

function buildSkillMd(name: string, description: string, body: string): string {
  return `---\nname: ${name}\ndescription: ${description}\n---\n\n${body}`;
}
```

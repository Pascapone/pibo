# Implementierungsplan: User Skills

## Ziel
User können eigene Skills über die Chat Web App UI erstellen, bearbeiten, aktivieren/deaktivieren und löschen. Diese Skills werden vom Agenten genauso behandelt wie Plugin Skills (z.B. `pi-agent-harness`) — sie erscheinen im Agent Designer, im Catalog und werden zur Runtime in den Kontext geladen.

---

## 1. Architektur-Entscheidungen

### 1.1 Skill-Format
Ein User Skill ist eine Markdown-Datei (`SKILL.md`) mit optionalem YAML-Frontmatter. Das System speichert automatisch:

```markdown
---
name: my-skill
description: Was dieser Skill tut
---

# My Skill

[User-edierter Inhalt]
```

Das Format ist kompatibel mit dem Agent Skills Standard (`agentskills.io`). Der Pi Resource Loader verarbeitet die Datei wie jeden anderen Skill.

### 1.2 Speicherstruktur
```
.pibo/
├── user-skills.json              # Metadaten-Store (JSON)
└── user-skills/
    ├── my-custom-skill/
    │   └── SKILL.md
    └── another-skill/
        └── SKILL.md
```

- **Dateisystem**: `.pibo/user-skills/<name>/SKILL.md` — der eigentliche Skill-Inhalt
- **Metadaten**: `.pibo/user-skills.json` — enthält `id`, `name`, `description`, `enabled`, `path`, Timestamps

Warum JSON statt SQLite? Konsistent mit `pi-packages.json`. User Skills sind Konfiguration, keine relationalen Daten.

### 1.3 Integration in bestehende Systeme
User Skills werden **zur Laufzeit in die Plugin Registry injiziert**. Das bedeutet:
- Sie erscheinen transparent im `PiboCapabilityCatalog.skills`
- Der Agent Designer sieht sie als normale Skills
- `context.getSkill(name)` löst sie auf
- Die Runtime lädt sie wie Plugin Skills über `additionalSkillPaths`

Dafür wird `PiboPluginRegistry` um `unregisterSkill()` erweitert.

---

## 2. Backend

### 2.1 Neues Modul: `src/user-skills/`

#### `src/user-skills/types.ts`
```typescript
export type UserSkill = {
  id: string;
  name: string;
  description: string;
  path: string;        // relativer Pfad zu SKILL.md
  enabled: boolean;
  createdAt: string;
  updatedAt: string;
};

export type UserSkillStoreData = {
  version: 1;
  skills: UserSkill[];
};

export type UserSkillInput = {
  name: string;
  description: string;
  markdown: string;
  enabled?: boolean;
};
```

#### `src/user-skills/store.ts`
- `loadUserSkillStore(cwd)` / `saveUserSkillStore(data, cwd)`
- `listUserSkills(cwd)`
- `findUserSkill(idOrName, cwd)`
- `upsertUserSkill(input, cwd)` — validiert Namen, schreibt SKILL.md + JSON
- `removeUserSkill(id, cwd)` — löscht SKILL.md und Metadaten
- `setUserSkillEnabled(id, enabled, cwd)`
- Name-Validierung: `^[a-z][a-z0-9]*(?:-[a-z0-9]+)*$`, max 64 Zeichen, keine Kollisionen mit Plugin Skills

#### `src/user-skills/manager.ts`
```typescript
export class UserSkillManager {
  constructor(private registry: PiboPluginRegistry, private cwd: string);
  sync(): void;           // Unregister alle, dann re-register aus Store
  add(skill: UserSkillInput): UserSkill;
  update(id: string, input: Partial<UserSkillInput>): UserSkill;
  remove(id: string): void;
  setEnabled(id: string, enabled: boolean): void;
}
```
- Ruft `registry.unregisterSkill()` und `registry.registerSkill()` auf
- Wird beim Serverstart instanziiert und syncet alle Skills in die Registry

### 2.2 Plugin Registry Erweiterung

#### `src/plugins/registry.ts`
Neue Methoden:
```typescript
unregisterSkill(name: string): boolean;
unregisterTool(name: string): boolean;
unregisterSubagent(name: string): boolean;
```
- Entfernt Einträge aus den internen Maps
- Gibt `true` zurück wenn etwas entfernt wurde
- Kein Error wenn Name nicht existiert (idempotent)

### 2.3 Chat Web Server (`src/apps/chat/web-app.ts`)

#### Erweiterung `buildAgentCatalog`
```typescript
async function buildAgentCatalog(context) {
  return {
    ...context.channelContext.getCapabilityCatalog(),
    mcpServers: await listMcpServerInfos(),
    piPackages: listPiPackages(),
    userSkills: listUserSkills(),   // ← NEU
  };
}
```

#### Neue REST-Endpunkte
| Methode | Route | Beschreibung |
|---------|-------|--------------|
| GET | `/api/chat/user-skills` | Liste aller User Skills |
| POST | `/api/chat/user-skills` | Neuen Skill erstellen (Body: `{name, description, markdown}`) |
| GET | `/api/chat/user-skills/:id` | Einzelnen Skill lesen (inkl. Markdown-Content) |
| PATCH | `/api/chat/user-skills/:id` | Skill aktualisieren (Body: `{name?, description?, markdown?, enabled?}`) |
| DELETE | `/api/chat/user-skills/:id` | Skill löschen |

- Alle Endpunkte erfordern Session (`requireSession`)
- POST/PATCH/DELETE erfordern Same-Origin JSON (`requireSameOriginJsonRequest`)
- Nach jeder Mutation wird `userSkillManager.sync()` aufgerufen
- Der Catalog wird implizit über die Registry aktualisiert

### 2.4 Server-Start-Integration
In `src/apps/chat/web-app.ts` (oder wo der Server die Plugin Registry aufbaut):
```typescript
const userSkillManager = new UserSkillManager(pluginRegistry, process.cwd());
userSkillManager.sync();
```

---

## 3. Frontend

### 3.1 Typen (`src/apps/chat-ui/src/types.ts`)
```typescript
export type UserSkill = {
  id: string;
  name: string;
  description: string;
  path: string;
  enabled: boolean;
  createdAt: string;
  updatedAt: string;
};

export type AgentCatalog = {
  // ... bestehende Felder
  userSkills: UserSkill[];   // ← NEU
};
```

### 3.2 API (`src/apps/chat-ui/src/api.ts`)
```typescript
export async function listUserSkills(): Promise<UserSkill[]>;
export async function getUserSkill(id: string): Promise<UserSkill & { markdown: string }>;
export async function createUserSkill(input: { name: string; description: string; markdown: string }): Promise<UserSkill>;
export async function updateUserSkill(id: string, input: Partial<{ name: string; description: string; markdown: string; enabled: boolean }>): Promise<UserSkill>;
export async function deleteUserSkill(id: string): Promise<void>;
```

### 3.3 UI: Neuer Settings-Panel "Skills"

**Ort:** Unter `Settings` als neues Panel `skills` (neben `general` und `pi-packages`).

**Warum Settings und kein Haupt-Tab?**
- Pi Packages sind auch in Settings
- Skills sind Konfiguration, keine primäre Navigation
- Weniger UI-Überladung

**Komponenten:**

#### `UserSkillsSettings` (in `App.tsx` oder eigene Datei)
Angelehnt an `PiPackagesSettings`:

1. **Header-Bereich**
   - Button "Create Skill" → öffnet Modal
   - Anzahl Skills (total / enabled)

2. **Skill-Liste**
   - Karten-Layout (wie Pi Package Cards)
   - Pro Skill:
     - Name
     - Description
     - Badge: `enabled` / `disabled`
     - Buttons: Edit, Toggle Enabled, Delete
   - Expand-Detail zeigt den Markdown-Inhalt (read-only preview)

3. **Create/Edit Modal**
   - Formularfelder:
     - Name (Text-Input, validiert)
     - Description (Text-Input)
     - Markdown-Content (Textarea, monospaced, min-height 300px)
   - Buttons: Save, Cancel
   - Validierung: Name required, eindeutig, Pattern `[a-z][a-z0-9-]*`

### 3.4 Integration Bootstrap
In `normalizeBootstrap` (`api.ts`):
```typescript
agentCatalog: payload.agentCatalog ? {
  ...payload.agentCatalog,
  userSkills: payload.agentCatalog.userSkills ?? [],
} : payload.agentCatalog
```

### 3.5 Integration Agent Designer
**Keine Code-Änderung nötig!**
Da User Skills über die Plugin Registry in `agentCatalog.skills` gemischt werden, erscheinen sie automatisch in der bestehenden `CatalogSection title="Skills"`.

Allerdings müssen wir unterscheiden, welche Skills "read-only" (Plugin) und welche "managed" (User) sind. Das ist für den User wichtig.

**Option A:** Der Agent Designer zeigt alle Skills zusammen, User Skills bekommen ein kleines Icon/Label (z.B. ein User-Icon).

**Option B:** Zwei separate Sections: "Plugin Skills" und "User Skills".

Ich empfehle **Option A** mit einem visuellen Hinweis, weil es für den Agent-Designer-Flow egal ist, woher ein Skill kommt. Der User will einfach Skills auswählen.

Dafür erweitern wir `PiboSkillInfo` und die UI leicht:
```typescript
export type PiboSkillInfo = {
  name: string;
  path: string;
  source?: "plugin" | "user";   // ← NEU
};
```

Im Agent Designer:
```tsx
<CatalogSection title="Skills">
  {catalog?.skills.map((skill) => (
    <CatalogToggle
      key={skill.name}
      checked={draft.skills.includes(skill.name)}
      title={skill.name}
      description={skill.path}
      badge={skill.source === "user" ? "user" : undefined}
      ...
    />
  ))}
</CatalogSection>
```

---

## 4. Runtime / Prompt Assembly

**Keine Änderung nötig.**

Der Flow bleibt identisch:
1. `createCustomAgentProfileDefinition` ruft `context.getSkill(skillName)` auf
2. Da User Skills über `UserSkillManager.sync()` in die Plugin Registry injiziert wurden, wird der Lookup erfolgreich sein
3. `InitialSessionContextBuilder.addSkill()` packt das `SkillProfile` in den Context
4. `createPiboRuntime` extrahiert `getEnabledSkillPaths()` und übergibt sie als `additionalSkillPaths` an den Pi Resource Loader

---

## 5. Datenfluss-Diagramm

```
User (Browser)
    │
    ▼
┌─────────────────────┐
│  UserSkillsSettings │  ← Create / Edit / Toggle / Delete
│  (Chat Web UI)      │
└─────────────────────┘
    │
    ▼ API Calls
┌─────────────────────┐
│  Chat Web Server    │  ← POST/GET/PATCH/DELETE /api/chat/user-skills
│  (web-app.ts)       │
└─────────────────────┘
    │
    ▼
┌─────────────────────┐
│  UserSkillManager   │  ← Schreibt .pibo/user-skills.json
│  (user-skills/)     │    Schreibt .pibo/user-skills/<name>/SKILL.md
└─────────────────────┘
    │
    ▼
┌─────────────────────┐
│  PiboPluginRegistry │  ← registerSkill() / unregisterSkill()
│  (plugins/registry) │
└─────────────────────┘
    │
    ▼
┌─────────────────────┐
│  Agent Catalog      │  ← getCapabilityCatalog() liefert Skills
│  (Bootstrap)        │
└─────────────────────┘
    │
    ▼
┌─────────────────────┐
│  Agent Designer     │  ← User wählt Skills aus
│  (Chat Web UI)      │
└─────────────────────┘
    │
    ▼
┌─────────────────────┐
│  CustomAgentProfile │  ← context.getSkill(name) → SkillProfile
│  (agent-profiles.ts)│
└─────────────────────┘
    │
    ▼
┌─────────────────────┐
│  PiboRuntime        │  ← additionalSkillPaths → Pi Resource Loader
│  (core/runtime.ts)  │
└─────────────────────┘
```

---

## 6. Dateien & Änderungen

### Neue Dateien
| Datei | Beschreibung |
|-------|--------------|
| `src/user-skills/types.ts` | Typen für User Skills |
| `src/user-skills/store.ts` | JSON-Store CRUD |
| `src/user-skills/manager.ts` | Sync mit Plugin Registry |

### Geänderte Dateien
| Datei | Änderung |
|-------|----------|
| `src/plugins/registry.ts` | `unregisterSkill()`, `unregisterTool()`, `unregisterSubagent()` |
| `src/plugins/types.ts` | `PiboSkillInfo.source?: "plugin" \| "user"` |
| `src/apps/chat/web-app.ts` | Neue Endpunkte, `buildAgentCatalog` erweitert, UserSkillManager Instanziierung |
| `src/apps/chat-ui/src/types.ts` | `UserSkill` Typ, `AgentCatalog.userSkills` |
| `src/apps/chat-ui/src/api.ts` | API-Functions für User Skills |
| `src/apps/chat-ui/src/App.tsx` | Settings Panel "skills", `normalizeBootstrap` erweitert, Agent Designer Badge |

---

## 7. Offene Design-Entscheidungen

### 7.1 Namenskonflikte
Was passiert, wenn ein User Skill denselben Namen wie ein Plugin Skill hat?

**Vorschlag:** Der Store validiert beim Erstellen/Bearbeiten, dass der Name nicht mit einem Plugin Skill kollidiert. Wenn doch: Error mit Hinweis.

### 7.2 Skill-Inhalt: Frontmatter-Handling
Soll der User das YAML-Frontmatter selbst schreiben, oder generiert das System es automatisch?

**Vorschlag:** Das System generiert das Frontmatter automatisch aus den Formularfeldern (Name, Description) und prependet es zum Markdown. Der User sieht im Editor nur den "Body". Beim Speichern wird das Frontmatter neu generiert. Beim Laden wird das Frontmatter geparst und vom Body getrennt, sodass der Editor nur den Body zeigt.

### 7.3 Multi-File Skills
Soll ein User Skill auch `scripts/`, `references/`, `assets/` Unterordner unterstützen?

**Vorschlag:** Nein, nicht in Phase 1. Ein User Skill ist eine einzelne `SKILL.md`. Das reicht für 90% der Use-Cases. Wenn später Bedarf besteht, kann man den Editor erweitern.

### 7.4 Import von externen Skills (z.B. GitHub)
Soll der User Skills von außen importieren können (z.B. `npx skills add` equivalent)?

**Vorschlag:** Nein, nicht in Phase 1. Phase 1 ist "Create & Edit eigene Skills". Import/Export oder GitHub-Integration ist Phase 2.

---

## 8. Implementierungs-Reihenfolge

1. **Backend Foundation**: `src/user-skills/types.ts`, `store.ts`, `manager.ts`
2. **Registry Erweiterung**: `unregisterSkill()` etc. in `registry.ts`
3. **Server API**: Endpunkte in `web-app.ts`, Integration beim Start
4. **Frontend Typen & API**: `types.ts`, `api.ts`
5. **Frontend UI**: Settings Panel in `App.tsx`
6. **Frontend Integration**: `normalizeBootstrap`, Agent Designer Badge
7. **Testing**: Skill erstellen, Agent Designer öffnen, Skill auswählen, Session starten

---

Soll ich mit der Implementierung beginnen, oder möchtest du zuerst Anpassungen am Plan?
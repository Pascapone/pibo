---
type: "Historical Record"
title: "Implementierungsplan: Inline-Skill-Expansion mit $"
description: "Preserves the original body as a deprecated historical record without promoting historical claims."
tags: ["historical","legacy","migration"]
status: "deprecated"
authority: "historical"
migration_lineage:
  source_path: "docs/legacy/inline-skill-expansion-plan.md"
  source_commit: "0cd6a73449e1b555fa6e590d839d7e03c8dc98bf"
  baseline_commit: "2aef244301f5d181624662fdad53e18e83e80bd9"
  baseline_blob_oid: "307fa5daef10dc7b2d1ec0cb8e073a1811bdcdf7"
  source_bytes: 5760
  source_sha256: "2d7592bea0dfcc3c0d8c46cd34d74ab5fd1968d361e20d47f053df0cd15c9bfd"
  source_body_sha256: "2d7592bea0dfcc3c0d8c46cd34d74ab5fd1968d361e20d47f053df0cd15c9bfd"
generated:
  by: "process:pibo-okf-c-legacy"
  at: "2026-09-01T09:50:26Z"
---
# Implementierungsplan: Inline-Skill-Expansion mit `$`

**Ziel:** `$skill-name` überall im Nachrichtentext erkennen, den Originaltext unverändert lassen, und die Skill-Inhalte als Appendix am Ende anhängen.

**Beispiel:**
```
Nutze $pibo-docker-system und $skill-creator, um ...
```
wird zu:
```
Nutze $pibo-docker-system und $skill-creator, um ...

---

$pibo-docker-system
# Pibo Docker System
...

---

$skill-creator
# Skill Creator
...
```

---

## Phase 1: Frontend – Composer-Trigger-Refactoring

**Ziel:** Das `$`-Menü funktioniert an jeder Cursor-Position, nicht nur am Nachrichtenanfang.

**Geänderte Datei:** `src/apps/chat-ui/src/App.tsx`

### 1.1 Trigger-Bedingung ändern
- **Von:** `trimmed.startsWith("$")` prüft nur den Anfang.
- **Nach:** Prüfe, ob direkt vor dem Cursor ein `$` steht.
- **Implementierung:** Nutze `selectionStart` des `<textarea>`-Elements. Wenn das Zeichen bei `selectionStart - 1` ein `$` ist (und kein `\` davor), ist der Skill-Trigger aktiv.

### 1.2 Filter-Logik anpassen
- Wenn der Trigger aktiv ist, extrahiere das Wort direkt nach dem `$` ab der Cursor-Position (oder bis zum nächsten Leerzeichen/Zeilenumbruch).
- Filtere die Skill-Liste gegen dieses Wort (`skill.name.toLowerCase().startsWith(query)`).

### 1.3 Dropdown-Position
- **Von:** Fix unter dem Composer.
- **Nach:** Relativ zur Cursor-Position im Text.
- **Implementierung:** Berechne die Cursor-Position im `<textarea>` mittels `getBoundingClientRect()` des Textbereichs oder nutze eine einfache Heuristik (unterhalb der aktuellen Zeile basierend auf Zeilenanzahl und Zeichen pro Zeile).

### 1.4 Einfüge-Logik
- **Von:** Ersetzt den gesamten Text mit `/skill:name `.
- **Nach:** Füge `$skill-name` an der Cursor-Position ein.
- **Implementierung:**
  1. Text vor dem Cursor + `$skill-name` + Text nach dem Cursor zusammensetzen.
  2. Cursor nach dem eingefügten Skill-Namen positionieren.

### 1.5 Escape-Unterstützung
- `\$` soll nicht triggern. Der Trigger-Check muss prüfen, ob das `$` escaped ist.

### 1.6 Placeholder-Update
- Ändere den Placeholder auf: `"Message selected session, type / for commands or $ for inline skills"`.

---

## Phase 2: Backend – Skill-Expansion Preprocessor

**Ziel:** Vor dem Senden an den Coding Agent alle `$skill-name`-Referenzen auflösen und als Appendix anhängen.

**Neue Datei:** `src/core/skill-expansion.ts`

### 2.1 `expandInlineSkills(text, skills)`
```typescript
export function expandInlineSkills(text: string, skills: Skill[]): string {
  // Regex: $name, aber nicht \$name
  const pattern = /(?<!\\)\$([a-z0-9-]+)/g;
  const matches = [...text.matchAll(pattern)];

  const seen = new Set<string>();
  const toExpand: Skill[] = [];

  for (const match of matches) {
    const name = match[1];
    if (seen.has(name)) continue;
    const skill = skills.find(s => s.name === name);
    if (!skill) continue; // Unbekannte Skills werden ignoriert
    seen.add(name);
    toExpand.push(skill);
  }

  if (toExpand.length === 0) return text;

  const appendices = toExpand.map(skill => {
    const content = readFileSync(skill.filePath, "utf-8");
    const body = stripFrontmatter(content).trim();
    return `---\n\n$${skill.name}\n${body}`;
  });

  return `${text}\n\n${appendices.join("\n\n")}`;
}
```

### 2.2 `stripFrontmatter(content)`
- Wiederverwendung aus `@mariozechner/pi-coding-agent` oder eigene einfache Implementierung:
  - Entfernt YAML-Frontmatter (`---\n...\n---\n`) vom Anfang der Datei.

### 2.3 Integration in `RoutedSession`
**Geänderte Datei:** `src/core/routed-session.ts`

In der `drain()`-Methode, direkt vor `await this.runtime.session.prompt(event.text)`:
```typescript
const expandedText = expandInlineSkills(
  event.text,
  this.runtime.session.resourceLoader.getSkills().skills
);
// ... dann: await this.runtime.session.prompt(expandedText)
```

---

## Phase 3: Rückwärtskompatibilität

| Feature | Verhalten |
|---------|-----------|
| `/skill:name` | Bleibt funktional. Der Coding Agent (`pi-coding-agent`) expandiert es intern weiterhin zu einem `<skill>`-Block. |
| `$skill-name` | Wird vom Pibo-Gateway vor dem Prompt zu Appendix expandiert. |
| Gemischte Nutzung | Möglich, aber nicht empfohlen. Reihenfolge: Pibo-Expansion läuft zuerst, dann die interne Coding-Agent-Expansion für `/skill:`. |
| Unbekannte `$name` | Wird ignoriert (kein Fehler, der Text bleibt `$name`). |

---

## Phase 4: Optionale Verbesserungen (Post-MVP)

1. **Syntax-Highlighting:** `$skill-name` im Composer visuell hervorheben (z.B. grüner Hintergrund), wenn der Name ein bekannter Skill ist.
2. **Hover-Info:** Tooltip mit Skill-Beschreibung beim Darüberfahren über `$skill-name` im Composer.
3. **Auto-Complete:** Nach `$` + 2 Zeichen automatisch Vorschläge filtern, auch ohne explizites Menü öffnen zu müssen.

---

## Zusammenfassung der Dateiänderungen

| Datei | Änderung |
|-------|----------|
| `src/apps/chat-ui/src/App.tsx` | Trigger-Logik von `startsWith` auf Cursor-Position umstellen, Dropdown relativ positionieren, `$skill-name` statt `/skill:name` einfügen, Escape-Handling. |
| `src/core/skill-expansion.ts` (neu) | `expandInlineSkills()` + `stripFrontmatter()` Helper. |
| `src/core/routed-session.ts` | Vor `prompt()`: Text durch `expandInlineSkills()` schicken. |

---

## Nächste Schritte

1. **Frontend:** `App.tsx` Composer-Logik anpassen.
2. **Backend:** `skill-expansion.ts` erstellen und in `routed-session.ts` integrieren.
3. **Testen:** Typecheck (`npm run chat-ui:typecheck`), Build (`npm run build`), Dev-Deploy (`scripts/deploy-web-dev.sh`). Production-Deploy (`scripts/deploy-web.sh`) erst nach Freigabe.
4. **Validierung:** Im Browser testen, dass `$` überall im Text funktioniert und mehrere Skills expandiert werden.

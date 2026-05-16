# Web Annotation Feedback Tools: Agentation + Open Design

Datum: 2026-05-16

Untersuchte Repos:

- `/root/code/agentation` — `benjitaylor/agentation`, Commit `7dc5d65378fa901e6eead81d4e2bb62950d49f0b`
- `/root/code/open-design` — `nexu-io/open-design`, Commit `6bf865a43beb8149c8f64a0af297c09c313f9a4a`

Ziel: verstehen, wie Nutzer im Frontend konkrete Stellen markieren und dem Agenten maschinenlesbar mitteilen können, worüber gesprochen wird. Fokus: Selektoren, Element-Metadaten, Kommentare, visuelle Markierungen und Agenten-Übergabe.

## TL;DR

Agentation ist das passendere Grundkonzept für Pibo: ein kleines Overlay, das im laufenden Frontend Elemente anklickbar macht, dazu Kommentar und technische Zielinformationen sammelt und als strukturierten Kontext an den Agenten übergibt. Es ist agentenagnostisch, leicht einzubauen und besitzt bereits ein Server/MCP-Konzept mit Pending/Acknowledge/Resolve-Workflow.

Open Design ist größer und produktnäher. Es macht zwei Dinge besser als Agentation: Erstens erzeugt es für vom System gerenderte Artefakte stabile Ziel-IDs (`data-od-id`, `data-screen-label`) statt nur CSS-/DOM-Heuristiken. Zweitens koppelt es Markierungen direkt an den Chat-Flow: gespeicherte Kommentare, Status (`open`, `attached`, `applying`, `needs_review`, `resolved`, `failed`), Pod-/Multi-Element-Auswahl, Screenshot-Kritzeleien und promptseitige `<attached-preview-comments>`.

Für Pibo wäre die beste Richtung eine Mischung:

1. **Agentation-artiges Browser Overlay** für beliebige Pibo-Webdev-Ziele.
2. **Open-Design-artiger Comment/Attachment-Flow** in Chat Web: Markierungen werden als strukturierte Anhänge an die nächste User-Nachricht gehängt.
3. **Debug-Web-Integration** statt separatem Tool-Silo: CDP kann Snapshot, Screenshot, Selector-Resolve und Artefakt-Speicherung übernehmen.
4. **Agent Workflow** mit Status-Lifecycle: `pending/open → acknowledged/attached → applying → resolved/needs_review`.

## Agentation: Grundidee

Agentation liefert eine React-Komponente `Agentation`, die als Floating Toolbar ins Frontend eingebaut wird:

```tsx
import { Agentation } from 'agentation';

function App() {
  return (
    <>
      <YourApp />
      <Agentation />
    </>
  );
}
```

Die Toolbar erlaubt:

- Klick auf ein Element → Popup für Kommentar.
- Textauswahl → Kommentar zu spezifischem Text.
- Multi-Select per Drag oder Cmd+Shift+Click.
- Area Selection für leere/visuelle Regionen.
- Animations-Freeze für schwer zu treffende UI-Zustände.
- Markdown-Ausgabe oder direkte Callback-/Server-Integration.

Die Kernidee ist nicht „Screenshot mit Pfeil“, sondern „Screenshot/Position plus DOM-/Code-Hinweis“. Agenten sollen nicht raten müssen, was „der blaue Button links“ meint, sondern bekommen z. B. Elementname, DOM-Pfad, Klassen, Bounding Box, Textkontext und optional React-Komponenten-/Source-Info.

## Agentation: Datenmodell

Das zentrale TypeScript-Modell ist `Annotation` in `package/src/types.ts`. Wichtige Felder:

- `id`, `comment`, `timestamp`
- `x`, `y`, `boundingBox`
- `element`, `elementPath`
- `selectedText`, `nearbyText`, `nearbyElements`
- `cssClasses`, `computedStyles`, `fullPath`, `accessibility`
- `isMultiSelect`, `elementBoundingBoxes`
- `reactComponents`, `sourceFile`
- Server-Felder: `sessionId`, `url`, `intent`, `severity`, `status`, `thread`, `resolvedAt`, `resolvedBy`

Das ist für Agenten wertvoll, weil mehrere Identifikationsstrategien parallel geliefert werden:

1. Menschlich lesbar: `button "Save"`, `paragraph: "..."`.
2. DOM-nah: `elementPath`, `fullPath`, `cssClasses`.
3. Layout-nah: Bounding Box und Viewport-Koordinaten.
4. Kontextuell: nearby text/elements, selected text.
5. Framework-nah: React component chain und Source File, soweit verfügbar.

## Agentation: Element-Erkennung

`package/src/utils/element-identification.ts` baut bewusst robuste, aber simple Heuristiken:

- Shadow-DOM-aware Parent Traversal.
- `getElementPath()` erzeugt kurze Pfade mit IDs oder sinnvollen Klassen.
- `identifyElement()` leitet Namen aus Tag, Text, ARIA, Rollen, Alt-Text und Klassen ab.
- `getFullElementPath()` liefert einen längeren Forensic-DOM-Pfad.
- `getElementClasses()` entfernt CSS-Module-Hashes.
- `getComputedStylesSnapshot()`, `getDetailedComputedStyles()` und `getForensicComputedStyles()` erfassen relevante Styles.
- `getAccessibilityInfo()` sammelt Role/ARIA/Focusable-Informationen.

Interessant: Agentation erzeugt nicht primär einen perfekten `querySelector`, sondern eine Kombination aus `elementPath`, `fullPath`, Klassen und Kontext. Das ist agentenfreundlich, weil echte Frontend-Codebasen oft instabile CSS-Module, generierte Klassen oder identische Elemente haben.

## Agentation: React- und Source-Detection

Agentation enthält zusätzlich React-Fiber-Erkennung:

- `react-detection.ts` extrahiert Komponentennamen aus React-Fiber-Strukturen.
- `source-location.ts` versucht Source-Dateien und Zeilen aus `_debugSource`, React-19-Fallbacks oder Stack-Probing abzuleiten.

Das funktioniert nur in passenden Dev-Builds zuverlässig, ist aber genau die Art Zusatzsignal, die für Agenten stark ist: „dieses DOM-Element gehört vermutlich zu `<Sidebar> <PrimaryButton>` in `src/Button.tsx:42`“ ist oft nützlicher als ein langer CSS-Selector.

## Agentation: Output und Agenten-Übergabe

`generate-output.ts` erzeugt Markdown in Detailstufen:

- `compact`: kurze Liste.
- `standard`: Element, Location, Source, React, Feedback.
- `detailed`: zusätzlich Klassen, Position, Kontext.
- `forensic`: Full DOM Path, Position, Styles, Accessibility, Nearby Elements, Source, React.

Beispielstruktur:

```md
## Page Feedback: /settings
**Viewport:** 1440×900

### 1. button "Save"
**Location:** .settingsPanel > .actions > button
**Source:** src/components/SettingsForm.tsx:88
**React:** <App> <SettingsForm> <Button>
**Feedback:** Make this primary and move it right.
```

Für Pibo ist wichtig: Das Format kann entweder als Nachrichtentext angehängt werden oder als strukturierter Attachment-Block im Session/Event-System bleiben.

## Agentation: Server/MCP-Konzept

Das `mcp/`-Paket macht Agentation zu einem richtigen Agenten-Feedback-Kanal:

- Browser Toolbar sendet Annotationen an HTTP-Server.
- Server speichert Sessions/Annotations in SQLite oder Memory.
- MCP-Server stellt Tools für Agenten bereit.
- SSE erlaubt Watch Mode.
- Annotationen haben Status und Thread-Replies.

MCP Tools:

- `agentation_list_sessions`
- `agentation_get_session`
- `agentation_get_pending`
- `agentation_get_all_pending`
- `agentation_acknowledge`
- `agentation_resolve`
- `agentation_dismiss`
- `agentation_reply`
- `agentation_watch_annotations`

Der Watch-Loop ist besonders relevant: Der Agent blockt auf neue Annotationen, verarbeitet sie batchweise, acknowledged/resolved sie und kann weiter zuhören. Das ist genau das Modell für „ich markiere im Browser, du verstehst sofort, was ich meine“.

## Agentation: Stärken

- Sehr klares Produktkonzept.
- Kleine Integrationsfläche: React-Komponente plus optionale Callbacks/Server.
- Agentenagnostisch: Clipboard, callback, webhook, HTTP, MCP.
- Gutes Datenschema für Agenten.
- Multi-Select und Area Selection sind schon gedacht.
- Animations-Freeze ist für UI-Debugging praktisch.
- React-Komponenten-/Source-Erkennung ist für Codeagenten wertvoll.

## Agentation: Schwächen / Risiken

- CSS-/DOM-Pfade bleiben heuristisch. Ohne stabile IDs können Selektoren brechen.
- Framework-Fokus ist React; für andere Frameworks bleiben nur DOM-Signale.
- Als eingebettete Komponente muss sie in die Ziel-App eingebaut werden. Für fremde Apps oder bereits laufende Pibo-Preview-Sessions bräuchte man Injection über CDP/Bookmarklet/Snippet.
- Datenschutz/Sicherheit: Forensic Output kann viel DOM/Text/Styles enthalten; braucht klare Scoping- und Redaction-Regeln.
- Lizenz ist PolyForm Shield, also nicht Apache/MIT; Codeübernahme sollte vermieden werden. Konzept nachbauen ist sicherer als Copy/Paste.

## Open Design: Vergleichbares Konzept

Open Design hat ein viel größeres Produkt: Design-Canvas, Chat, Agent-Runner, Artefakt-Preview in sandboxed iframe, Skills, Design Systems, lokale Daemon-Architektur. Das Agentation-ähnliche Stück steckt vor allem in:

- `apps/web/src/runtime/srcdoc.ts` — Selection/Comment/Inspect Bridge im Preview-iframe.
- `apps/web/src/comments.ts` — Preview-Kommentare werden zu Chat-Attachments und Prompt-Kontext.
- `packages/contracts/src/api/comments.ts` — Comment-Datenmodell.
- `packages/contracts/src/api/chat.ts` — `ChatCommentAttachment`.
- `apps/web/src/components/FileViewer.tsx` — Board Mode, Hover/Click, Pod Selection, Overlay UI.
- `apps/web/src/components/PreviewDrawOverlay.tsx` — Screenshot + red strokes + click target.
- `apps/web/src/edit-mode/*` — Manual Edit/Inspect mit source-mappable IDs.
- `apps/daemon/src/db.ts` und `apps/daemon/src/server.ts` — Persistence/API/Prompt-Hints.

## Open Design: Selection Bridge

Open Design rendert Artefakte in einem sandboxed iframe und injiziert einen Bridge-Script in das `srcdoc`. Dieser Bridge kann:

- Comment Mode aktivieren/deaktivieren.
- Inspect Mode aktivieren/deaktivieren.
- Hover-Targets posten.
- Click-Targets posten.
- Alle sichtbaren Targets broadcasten.
- Pod-Strokes als Punktlisten an den Host schicken.
- Scroll-Positionen synchronisieren.
- Style-Overrides für Inspect Mode anwenden.

Die Bridge sendet Zielobjekte an den Host:

```ts
{
  type: 'od:comment-target',
  elementId,
  selector,
  label,
  text,
  position: { x, y, width, height },
  htmlHint,
  style
}
```

Open Design bevorzugt explizite, stabile Attribute:

- `data-od-id`
- `data-screen-label`

Wenn diese fehlen, gibt es für Comment Mode einen DOM-Fallback, der `body > tag:nth-of-type(...)`-Selektoren und synthetische `dom:` IDs baut. Außerdem gibt es eine Free-Pin-Fallback-Markierung, wenn keine sinnvolle DOM-Auswahl möglich ist.

## Open Design: Was besser ist als Agentation

### 1. Stabile IDs statt nur Heuristiken

Open Design markiert generierte Artefakte mit stabilen IDs und source-mappable Attributen. Das ist robuster als CSS-Klassen- oder `nth-of-type`-Pfade. Für Pibo wäre das die wichtigste Lehre: Wenn wir die Preview/App kontrollieren, sollten wir eigene Debug-IDs injizieren oder vorhandene Test-/Component-IDs bevorzugen.

### 2. Kommentar ist Teil des Chat-Flows

Open Design speichert Preview-Kommentare und verwandelt sie in `ChatCommentAttachment`s. Diese hängen an der User-Nachricht und werden im Prompt als `<attached-preview-comments>` gerendert. Der Agent bekommt dadurch strukturierten Kontext, ohne dass der User Markdown kopieren muss.

### 3. Status-Lifecycle

Preview-Kommentare haben Status:

- `open`
- `attached`
- `applying`
- `needs_review`
- `resolved`
- `failed`

Das passt besser zur Agentenarbeit als reines Clipboard. Man sieht, welche Markierungen schon in Arbeit sind und welche geprüft werden müssen.

### 4. Pod Selection

Pod Mode ist eine freie Stroke-Auswahl, aus der der Host alle darunter liegenden Targets sammelt und zu einem Multi-Target-Kommentar macht. Das ist UX-stärker als nur Rechteck-Multi-Select: Der User kann „diese Gruppe hier“ einkreisen.

### 5. Visual Annotation mit Screenshot

`PreviewDrawOverlay` kann Screenshot plus rote Strokes plus blauen Fokusrahmen erzeugen. Daraus wird ein Attachment mit `selectionKind: 'visual'`, `screenshotPath`, `markKind` und `intent`. Das hilft, wenn DOM-Selektion nicht reicht: Abstände, Alignment, visuelle Hierarchie, Farbe, Leerraum.

### 6. Inspect/Edit als Nachbarfähigkeit

Open Design koppelt Commenting mit Inspect/Manual-Edit. Das ist für Pibo interessant, weil ein markiertes Element nicht nur Kommentar, sondern auch Live-Style-Debugging oder Patch-Vorschläge ermöglichen kann.

## Open Design: Schwächen / Grenzen

- Das System funktioniert besonders gut, weil Open Design die Artefakte selbst rendert und eigene IDs injizieren kann. Für beliebige fremde Webapps ist das schwerer.
- Die Bridge ist eng an iframe/srcdoc und Open-Design-UI gekoppelt.
- Es gibt keinen agentenagnostischen MCP-Feedback-Kanal wie bei Agentation; der Flow geht primär durch Open Designs eigenen Chat/Daemon.
- Viele Funktionen sind produktverflochten. Für Pibo sollte man das Konzept extrahieren, nicht die Architektur kopieren.

## Relevanz für Pibo

Pibo hat bereits `pibo debug web`:

- `targets`
- `attach-chat`
- `snapshot`
- `diff`
- `watch`
- `scenario`

Das ist aktuell agentenseitig: Der Agent kann Browserzustand über CDP inspizieren. Was fehlt, ist die Gegenrichtung: Der Mensch markiert visuell im Browser, und der Agent bekommt daraus direkt strukturierten Kontext.

Ein Pibo-Feature sollte deshalb nicht nur ein neues Screenshot-Tool sein, sondern ein Mensch-Agent-Referenzkanal:

- Mensch wählt Element/Region/Text im Browser.
- Pibo speichert ein Annotation Artifact.
- Die nächste User Message oder ein Agent-Watch-Tool referenziert dieses Artifact.
- Agent kann per Tool Details nachladen, Status setzen und nach Umsetzung Review anfordern.

## Empfohlene Pibo-Architektur

### 1. Neuer Debug-Web-Befehl: Annotation Bridge

Mögliche CLI-Oberfläche:

```bash
pibo debug web annotate --target <id|ws> --scope <selector> --session <ps_...>
pibo debug web annotations list --session <ps_...>
pibo debug web annotations export --session <ps_...> --format markdown|json
pibo debug web annotations watch --session <ps_...>
```

Oder als Unterbereich:

```bash
pibo debug web mark start
pibo debug web mark list
pibo debug web mark show <id>
pibo debug web mark resolve <id>
```

Wichtig: CLI-Hilfe sollte progressiv bleiben, passend zur Pibo-Regel.

### 2. Browser-Injection über CDP

Da Pibo Browser/CDP schon nutzt, muss eine erste Version nicht in jede App eingebaut werden. Pibo kann per CDP ein Overlay-Script injizieren:

- Floating Button / Toggle.
- Capture-phase click listener.
- Hover outline.
- Comment input.
- Optional draw canvas.
- `window.postMessage` oder `Runtime.evaluate` Pull für Annotationen.

Das funktioniert auch für Pibo Chat Web oder worker-local previews, ohne Ziel-App-Code zu verändern.

### 3. Datenmodell

Ein Pibo-Annotation-Datensatz sollte die besten Felder beider Projekte kombinieren:

```ts
type WebAnnotation = {
  id: string;
  piboSessionId?: string;
  roomId?: string;
  url: string;
  title?: string;
  createdAt: string;
  status: 'open' | 'attached' | 'acknowledged' | 'applying' | 'needs_review' | 'resolved' | 'dismissed' | 'failed';

  note: string;
  targetKind: 'element' | 'text' | 'region' | 'pod' | 'visual';

  selector?: string;
  stableId?: string;
  domPath?: string;
  fullDomPath?: string;
  elementLabel?: string;
  tagName?: string;
  classSummary?: string;
  text?: string;
  selectedText?: string;
  htmlHint?: string;
  accessibility?: string;

  boundingBox?: { x: number; y: number; width: number; height: number };
  viewport?: { width: number; height: number; devicePixelRatio: number };
  screenshotArtifact?: string;

  reactComponents?: string;
  sourceFile?: string;

  members?: WebAnnotationMember[];
};
```

Priorität bei Zielauflösung:

1. Explizite Debug-/Test-IDs: `data-pibo-id`, `data-testid`, `data-test-id`, `aria-label`, `id`.
2. Framework-Signale: React component/source when available.
3. Stabiler CSS Selector mit IDs/Attribute selectors.
4. DOM path / nth-of-type fallback.
5. Screenshot/region fallback.

### 4. Chat-Web-Integration

Für den Mensch-Agent-Flow sollte eine Annotation direkt an die nächste Nachricht angehängt werden können:

- „Markieren“ Button neben Screenshot/Debug Tools.
- Offene Annotationen als Chips über dem Composer.
- „Attach to next message“ und „Send now“.
- Prompt-Kontext ähnlich Open Design:

```xml
<attached-web-annotations>
1. ann_123
targetKind: element
url: http://localhost:3000/settings
selector: [data-testid="save-button"]
label: button "Save"
position: x1120 y742 140x44
text: Save changes
htmlHint: <button data-testid="save-button" class="...">
comment: Der Button soll deutlicher rechts unten stehen.
</attached-web-annotations>
```

Wichtig: Der strukturierte Block sollte zusätzlich als echtes Event/Attachment persistiert werden, nicht nur als Text in der Message. Dann können UI, Replay, Status und Agent-Tools darauf aufbauen.

### 5. Native Tool für Agenten

Analog zu Agentation MCP, aber Pibo-nativ:

- `web_annotations_list`
- `web_annotations_get`
- `web_annotations_watch`
- `web_annotations_acknowledge`
- `web_annotations_resolve`
- `web_annotations_reply` oder `web_annotations_comment`

Pibo kann das als Native Tool oder als `pibo debug web annotations` CLI anbieten. Für Coding-Agenten ist ein Tool besser; für Operator/Debug ist CLI besser. Beides kann dieselbe Store-Schicht nutzen.

### 6. Persistenz und Artefakte

Speicherort:

- Kurzfristig: JSON-Artefakte unter `.pibo/debug-web/annotations/` oder bestehender debug artifact store.
- Produktiv: Pibo Session Store / SQLite, verknüpft mit `Pibo Session ID`, `Room ID`, URL und Target.

Screenshots sollten als Artefakte referenziert werden, nicht base64 im Prompt stehen.

## Minimaler MVP

Ein guter erster Schritt wäre bewusst klein:

1. `pibo debug web annotate --target ...` injiziert Overlay in aktive CDP-Seite.
2. User klickt Element, schreibt Kommentar.
3. Tool speichert JSON + optional Screenshot.
4. CLI gibt Markdown/JSON aus.
5. Agent kann Report/Annotation vom Pfad lesen.

Noch ohne Chat-Web-UI, ohne Watch Loop, ohne DB. Das wäre der schnellste Beweis, dass der Mensch-Agent-Referenzkanal trägt.

## Besserer V1-Flow

Danach:

1. Chat Web bekommt „Annotate page“ im Debug/Webdev Bereich.
2. Offene Annotations erscheinen als Composer Attachments.
3. Beim Senden werden sie in `message.attachments` oder neuem `commentAttachments`-Äquivalent persistiert.
4. Agent bekommt automatisch den strukturierten Kontext.
5. Agent setzt Status auf `applying` und danach `needs_review` oder `resolved`.

## Design-Entscheidung: Selector vs Stable ID

Pibo sollte nicht nur „CSS selector rausgeben“. Selector ist ein Feld, nicht die Wahrheit. Das Target sollte mehrspurig identifiziert werden:

- `stableId` wenn möglich.
- `selector` als ausführbarer Locator.
- `domPath` als fallback.
- `boundingBox` für visuelle Verifikation.
- `htmlHint`/Text für grep und Review.
- `sourceFile`/React für Codeänderung.

Das verhindert, dass ein Agent bei dynamischer UI am falschen Element arbeitet.

## Sicherheit / Privacy

- Annotation Injection nur in explizit ausgewählten CDP Targets.
- Keine dauerhafte globale Browser-Erweiterung im MVP.
- Text/DOM-Auszug begrenzen und redigieren.
- Screenshot-Artefakte lokal speichern und Pfade statt Bilddaten in Prompts geben.
- Cross-origin iframes beachten: CDP kann Top-Level injizieren, aber fremde iframes sind begrenzt.
- Kein blindes Ausführen von Annotation-Payloads; alles als Daten behandeln.

## Empfehlung

Nicht Agentation oder Open Design direkt übernehmen. Stattdessen ein Pibo-natives Feature bauen:

- Agentation als UX- und Tooling-Leitbild.
- Open Design als Referenz für stabile IDs, Comment Attachments, Status und Pod/Visual Marking.
- Pibo `debug web` als technische Basis für CDP, Snapshots, Artifacts und progressive CLI.

Konkreter Name könnte sein:

- `pibo debug web annotate`
- UI intern: „Web Markups“ oder „Preview Comments“
- Datenmodell: `WebAnnotation` / `WebAnnotationAttachment`

Der entscheidende Nutzen: Statt im Chat vage über UI-Teile zu sprechen, bekommt der Agent eine präzise, persistente, reviewbare Referenz auf das betroffene Frontend-Element.

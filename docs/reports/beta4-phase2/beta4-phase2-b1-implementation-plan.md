---
type: "Research"
title: "Beta 4.0 phase-2 B1 implementation-plan draft (archived research)"
description: "Worker B1 implementation-plan draft from the analysis-only round, archived as non-approved research with an OKF envelope."
tags: ["beta-4", "phase-2", "b1", "implementation-plan"]
status: "draft"
authority: "informative"
generated:
  by: "muse-code/a1-session"
  at: "2026-09-20T15:54:34Z"
sources:
  - id: "host-original"
    resource: "scope:beta4-phase2 host planning archive at commit time"
    title: "Unchanged host original; see checkpoint provenance for path and hash"
checkpoint:
  origin_path: ".pibo/planning/beta4-phase2-20260920/results/B1/implementation-plan.md"
  origin_sha256: "d3f0ff1047658ff846165c5d398c4cecfb8bfc827faf86234480385faf3b7b8c"
  origin_bytes: 9677
  archive: "docs/reports/artifacts/beta4-phase2/beta4-phase2-originals-20260920.zip"
  archive_path: "results/B1/implementation-plan.md"
  transformations:
    - "Added this OKF frontmatter envelope; body bytes after frontmatter are unchanged from the origin."
---
# B1 – Implementierungsplan (B1-Vertragsabschluss + B2-Entkopplung)

Geltung: Analysevorbereitung, keine Umsetzung. Ablauf (R-B1-06): Analyse-Review →
I0 erfüllen → A1/B1/C1/D1 tatsächlich in Worktrees implementieren und Piloten testen →
erst dann G1 → danach B2 (vom G1-Commit, separater Worktree). Keine Root-/Lock-/
Builder-Änderungen durch B (Auftrag an I), keine zentralen Webdateien (Auftrag an D).

## 1. Zusammenhängende Schritte

### B1-Rest (Vertrag lieferfähig machen, nach Reviewfreigabe)

1. **B1-S1 K01 festziehen**: P2/P3-Invarianten (Spät-Events, terminales Ergebnis) in
   `src/agent-runtime/types.ts`/`contract.ts`-Nähe dokumentieren + Contract-Tests (s. §3).
   Betroffene Dateien: `src/agent-runtime/contract.ts`, `src/agent-runtime/types.ts`
   (nur Kommentar/Typ-Ergänzung, keine Signaturbrüche).
2. **B1-S2 K02 festziehen**: P1/P2-Invarianten (`yieldedRunId`-Scope, Kontext-Minimalität)
   dokumentieren + Tests. Dateien: `src/tools/contract.ts` (Kommentar), Tests neu beim Vertrag.
3. **B1-S3 K03-Owner-Bindung schaffen (Entwurf A, R-B1-01)**: KEIN neuer globaler Export.
   Der Credential-Owner (Pi-Adapter/Composition, `src/agent-runtimes/pi/*`) bindet die
   Default-Zugangsfunktionen (`getApiKey`/`getAuth`/`isConfigured`-Form, beide Verbraucher)
   mit nachgewiesener Autorität/Runtime-Zuordnung und injiziert sie über die bestehenden
   Options-Felder; Transkriptions-Defaults umstellen (`src/transcription/openai.ts:26`,
   `openai-chatgpt.ts:32`), Querimporte entfernen. `runtime-instance`/`adapter-shared`,
   `AuthResult`/`undefined`/Fehler-Semantik unverändert.
4. **B1-S4 K01-P1-OPTION mit D klären (R-B1-03)**: eigener Scopeentscheid über den nativen
   Prompt-Ressourcen-Kanal (RQ-02) — Entscheidung D/B; Baseline (Text-Pfad-Referenz) gilt
   unabhängig davon und bleibt erhalten.
5. **B1-S5 K07-B-Anschlüsse**: abgestimmte neutrale Exporte/Registrierung in eigenen
   SDK-/Registry-Dateien (`src/plugins/sdk.ts`, `host.ts`, `product-services.ts`,
   `src/tools/contract.ts`); kein zweiter Attachmentkern, keine Composer-Änderung.

### B2 (Core–Pi-Entkopplung, nach G1)

6. **B2-S1**: `src/core/compaction-prompt.ts` — Pi-Wertimporte (`completeSimple`,
   `buildSessionContext`, `convertToLlm`, `serializeConversation`) in Pi-Runtime-Besitz
   verschieben; neutrale Prompt-Spezifikation (`parsePiboCompactionPrompt`, Modi/State)
   bleibt Core (B1-CFG-01).
7. **B2-S2**: `src/core/provider-recovery.ts` — `isRetryableAssistantError`-Wertimport
   ersetzen (eigene Klassifikation via `session-errors.ts`, bereits vorhanden) oder
   Pi-Deutung zum Adapter verschieben; generische Delay/Cancel-Logik bleibt neutral.
8. **B2-S3**: `src/tools/hashline.ts`, `src/remote-agent/modules/*` — statische
   Pi-Tool-Imports entkoppeln (mit C, Owner je Plugin); Verhalten via K02-Tests sichern.
9. **B2-S4**: Import-/Paketgrenzen nachziehen: `src/index.ts`-Schnitt als Auftrag an I;
   B liefert Liste erlaubter/verbotener Importkanten + Importprüfung.
10. **B2-S5**: Messung: eigene Quellmenge vs. ausgelieferte Bytes (`bytesInOutput`,
    Herkunft beachten); kein Vorher-Bericht als Beleg ohne neuen Lauf.

Übergebbare Zwischenstände: nach B1-S1/S2 (Contract-Tests grün), nach B1-S3 (Transkription
ohne Querimport), nach B2-S1/S2 (neutrale Corepfade Pi-wertfrei), nach B2-S3 (K02-Piloten
entkoppelt). Mechanische Umzüge und Verhaltensänderungen nicht vermischen.

## 2. Benötigte Dateien (B-Schreibbereich)

- `src/agent-runtime/{types,contract,events,errors,auth,capabilities,resources,resource-service,routed-session}.ts`
- `src/tools/contract.ts` (keine neue K03-Datei: Owner-Bindung in `src/agent-runtimes/pi/*`, R-B1-01)
- `src/plugins/{sdk,host,runtime,product-services}.ts`
- `src/agent-runtimes/pi/{credentials,adapter,tool-compiler}.ts` (Credential-/Liefer-Owner)
- `src/transcription/{openai,openai-chatgpt}.ts` (mit C abgestimmt)
- `src/core/{compaction-prompt,provider-recovery}.ts` (B2)
- Vertragsnahe Tests (neu): `test/b1-k01-contract.test.mjs`, `test/b1-k02-contract.test.mjs`,
  `test/b1-k03-provider-auth.test.mjs` (Namen Vorschlag; Owner B).
- Fremd (nur anfordern): `src/index.ts`, Root-Manifeste/Lockfile/Builder (I);
  `web-app.ts`, `App.tsx`, Composer/Draft/Grid (D); Plugin-Pakete außer Transkription (C);
  `src/agent-runtimes/pi/runtime.ts` TUI-Abschnitt (A, bis Übergabe gesperrt).

## 3. Contract-Testplan (konkrete vorhandene Tests + neue)

Vorhandene Tests (Namen wörtlich, alle `[Quelle]` aus Testdatei gelesen):

- `test/runtime-routed-session.test.mjs`: „generic routed orchestration queues and correlates
  a non-Pi fake adapter“, „generic routed session preserves output identities across
  successful compaction“, „generic model switching preserves Pibo reasoning when a runtime
  reapplies its own default“, „generic routed orchestration tries ordered provider fallbacks
  and restores the primary model“, „provider fallback does not retry context or runtime
  failures“, „generic routed requests remain cancellable during asynchronous message
  preflight“, „generic router rejects profile selections the runtime cannot deliver“,
  „generic routed controls reject unadvertised adapter capabilities explicitly“,
  „fork identity reads and transitions reject queued or active routed work“,
  „running-safe fork controls snapshot completed history without interrupting the source
  turn“, „fork-candidate page reads serialize accepted message drain behind OMP-style idle
  work“, „adapter-shared auth mutations recycle every affected configured runtime session“,
  „runtime login and model menus use the active adapter's real auth status without hiding
  unauthenticated models“, „abort cancels a provider capacity wait without entering the
  provider or borrowing its active slot“, „abort acknowledges a blocked cold start before
  adapter initialization settles“, „queue clear persists the same ingress-plus-runtime
  count that its caller receives“.
- `test/agent-runtime-registry.test.mjs`: „deterministic fake adapter passes the reusable
  lifecycle contract“, „fake adapter covers abort, failure, missing binding, and idempotent
  cleanup“, „runtime registry validates descriptor and live-session capability claims“,
  „runtime registry rejects partial sessions without masking contract errors during
  cleanup“, „MCP-delivered runtimes reject legacy private tools and explain native-tool
  yielding limits“, „Pi adapter opens the existing Pi runtime without rewriting the
  requested session id“.
- `test/pibo-tool-contract.test.mjs`: „Pibo tool contract preserves JSON Schema types and
  compiles directly for Pi“, „legacy Pi-shaped registrations normalize without leaking Pi
  types into generic profiles“.
- `test/hashline-tool.test.mjs`: „hashline formats text reads as LINE#HASH:CONTENT with
  pagination preserved“, „selecting hashline removes built-in read from the effective Pi
  runtime“.
- `test/agent-runtime-resource-service.test.mjs` (Namen aus Spec RUN-RES-001/002):
  Skills/Kontext/MCP-Isolierung, adapter-beobachtete Delivery-Reports.
- `test/pibo-tool-mcp-bridge.test.mjs`: Credentials gehasht/scopegebunden/erneuerbar/
  ablaufend/widerrufbar; Loopback-Bindung; Tool-Isolierung mit Progress/Content/Fehlern.
- `test/pibo-portable-tool-session.test.mjs`: eine gefrorene Tool-Auswahl für Direkt+MCP.
- `test/chat-image-file-boundary.test.mjs`: Symlink-Swap- und Root-Escape-Abwehr der Vorschau.
- `test/remote-agent-auth.test.mjs`: Device-Code-/Token-Lifecycle (nur Hashes persistiert).
- `test/pi-late-tool-update.test.mjs`, `test/run-reminder-guard.test.mjs`,
  `test/run-reminder-admission.test.mjs`: Spät-Updates, Reminder-Begrenzung.

Kommandos (Ausführung erst in Umsetzungsphase, isoliertes HOME/PIBO_HOME, eigene Ports):
`node --test test/runtime-routed-session.test.mjs`, `node --test
test/agent-runtime-registry.test.mjs`, `node --test test/pibo-tool-contract.test.mjs`, sowie
`npm run docs:validate` für Doku-Anteile. Schwere Läufe mit I koordinieren.

Neue Contract-Tests (B1-S1…S3): K01 Spät-Event-/Terminal-Invariante (Fake-Adapter, kein Mock
der Router-Logik; `prompt()`-Auflösung → `message_finished`, `turn_failed` → `session_error`
stattdessen); K02 Yield-Scope + Kontext-Minimalität (reale lokale Verzeichnisse für
Dateitools); K03 Transkription konfiguriert/nicht-konfiguriert/Providerfehler für BEIDE
Verbraucher (API-Key + OAuth/`getAuth`; injizierter Testadapter + owner-gebundene
Produktionsverdrahtung mit kontrollierten Credentials — **keine pauschalen Mocks der
Produktionsadapter**, keine echten User-Tokens im Bericht).

Geplante reale Gegenstellen: Pi-Adapter (Session öffnen/prompt/abort/dispose),
OMP-/Codex-/Muse-Adapter via C (Nicht-Pi-Abdeckung des K01-Satzes), OpenAI-Transkriptions-
Endpoint nur kontrolliert (Test-Key/Stub-HTTP, kein Produkt-Workspace).

## 4. Abhängigkeiten

- An A: Verhaltensschutz-Matrix für B2-Umzüge (Loops-Modi, Sessions, Auth, Sub-Agenten);
  TUI-Datei-Übergabe (`pi/runtime.ts`) nach A1/G1.
- An C: K01-Nicht-Pi-Prüfung (OMP/Codex/Muse), K02-File-Editing-/Remote-Agent-Piloten,
  K03-Transkriptions-Umstellung, Web-Annotations-Anbieter über K07-Anschluss.
- An D: K01-P1-Entscheidung (Prompt-Ressourcen), K04-Workflow-Durchstich gegen K01,
  K07-Pilot (D1→I→C1), K05-Typenbedarf.
- An I: **zuerst I0 erfüllen**, dann A1/B1/C1/D1-Worktrees (Implementierung + Pilot-Tests),
  danach G1-Commit; außerdem `src/index.ts`-/K06-Paketmuster, Root-/Lock-/Builder-Patches,
  Metafile-Herkunft, Test-/Build-Koordination. I0/G1 gelten NICHT als bestanden.

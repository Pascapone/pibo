---
type: "Research"
title: "Beta 4.0 phase-2 A1 implementation-plan draft (archived research)"
description: "Worker A1 implementation-plan draft from the analysis-only round, archived as non-approved research with an OKF envelope."
tags: ["beta-4", "phase-2", "a1", "implementation-plan"]
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
  origin_path: ".pibo/planning/beta4-phase2-20260920/results/A1/implementation-plan.md"
  origin_sha256: "bd084e370a22a9949acd6dfb59e55005506a066d6908b9d991f7558f10ba3ee2"
  origin_bytes: 5487
  archive: "docs/reports/artifacts/beta4-phase2/beta4-phase2-originals-20260920.zip"
  archive_path: "results/A1/implementation-plan.md"
  transformations:
    - "Added this OKF frontmatter envelope; body bytes after frontmatter are unchanged from the origin."
---
# A1 – Implementierungsplan (derselbe Worker, nach Freigabe)

Reihenfolge: Verhalten absichern → entfernen → Weiterleitungen bereinigen. Kein Testskip, kein Assertionsabbau. Alle Kommandos im Repo-Root, eigener Worktree nach Freigabe (jetzt: nur Analyse).

## LP-01 – Loops-Verhalten absichern (zuerst, Owner A, Review C)

Neue direkte Tests gegen `PiboLoopService`/`PiboLoopStore` (Dateinamen Vorschlag, je 1 Datei pro Lücke aus A1-12): Timeout-Abbruch+Disable; Unknown-Profile-Disable; Stop-graceful; Cancel-Abbruch+Lease-Freigabe; Dirty-Markierung; Prompt-härtet-Cleanup; Evaluator-Komposition (any/all/stateful, `pibo.ralph.*`-Kompat, `goal-status`); Ralph-Template-Inhalte über `listLoopJobTemplates` (`pibo.loop.*`-Typen, PRD-Prompts, maxIterations); Runtime-Overrides (Store-Persistenz + `activeModel`-Weitergabe `loops/service.ts:589,604`); Resource-Validierung (`normalizeLoopResourceMetadata`). Vorlagen: gleichnamige `ralph-*`-Tests als Verhaltensschablone, Assertions auf Loop-Symbole umgeschrieben.
Abhängigkeit: keine. Gate: alle neuen Tests + bestehende `loop-*`-Suite grün.
Prüfkommandos: `node --test test/loop-<neu>.test.mjs` je Datei; danach `node --test test/loop-*.test.mjs`.

## LP-02 – Ralph-Insel entfernen (Owner A, Review B/C)

Löschen: `src/ralph/{channel,cli,service,stopping,store,templates,types}.ts` (1254 Zeilen), `src/apps/chat/ralph-api.ts` (50), `src/apps/chat-ui/src/api-ralph.ts` (88), `src/apps/chat-ui/src/RalphArea.tsx` (352). Editieren: `src/apps/chat-ui/src/api.ts` (Zeile 26 streichen), `src/apps/chat-ui/src/types.ts` (Zeilen 912-920 streichen).
Abhängigkeit: LP-01 grün. Gate: A1-13-Alias-Tests grün; `grep -rn "from [\"'].*ralph/" src` (ohne `loops/`) leer.
Prüfkommandos: `node --test test/loop-*.test.mjs test/ralph-cli-profile-default.test.mjs test/chat-ui-loop-area.test.mjs`; `node dist/bin/pibo.js ralph --help` (Alias-Discovery); Typcheck des betroffenen Pakets.

## LP-03 – Tests migrieren/teilen (mit LP-02, Owner A, Review C)

Testalt→Testneu: `ralph-resource-cleanup` (269) → LP-01-Neutests, Datei löschen; `ralph-run-timeout` (177) → LP-01-Timeout, löschen; `ralph-resource-metadata` (58) → LP-01-Resource-Validierung, löschen; `ralph-templates` (30) → LP-01-Templates, löschen; `chat-ui-ralph-area` (62) → löschen (von `chat-ui-loop-area` abgedeckt); `ralph-stop-conditions` (203) → Loops-Capability-Test nach `loop-*` verschieben, Rest → LP-01-Evaluator, Datei löschen; `ralph-runtime-overrides` (171) → CLI-Hälfte behalten, Store/Service-Hälfte → LP-01-Overrides; `ralph-resource-visibility` (168) → CLI-Hälfte behalten (Umsaat `PiboLoopStore`), API-Hälfte auf `handleChatLoopApiRequest` mit `/ralph`-URLs umschreiben; `loop-max-iterations-admission` → Paritätsschleife auf `PiboLoopStore` einengen, `pibo.ralph.promise-complete`-Policy beibehalten (Kompat-Pfad!), Legacy-Reopen-Test auf LoopStore umschreiben; `loop-api.test.mjs` → `ralph-api`-Quellassertion streichen, Loops-Assertion behalten; `app-context-fresh-*` → `PiboRalphStore`→`PiboLoopStore` (gleiche Tabellen). `ralph-cli-profile-default` unverändert behalten.
Rollback: eigene geprüfte Commits selektiv revertieren (`git revert <eigener-commit>`), uncommittete eigene Hunks kontrolliert einzeln zurücknehmen; niemals pauschal `git checkout --` über fremde/uncommittete Arbeit — Nutzerarbeit bleibt erhalten (keine Datenmigration nötig — gleiche Tabellen).

## LP-04 – TUI-Abschnitt entfernen + Datei an B (Owner A, Review B)

Exakte Edits (`src/agent-runtimes/pi/runtime.ts`): Zeilen 10, 46, 124-125, 452-454, 616-681 streichen; `src/index.ts:255` `runPiboTui` aus Reexport nehmen. Danach Datei an B übergeben (B2), inkl. Hinweis `adapter.ts:199,811`.
Abhängigkeit: keine (kein Aufrufer/Test). A-Gate: TUI-Grep über eigene Dateien leer (siehe contracts.md §5); `inspectPiboProfile`-Tests + `pibo` Hilfetexte unverändert; B-Restliste (`adapter.ts:199,811`) dokumentiert offen. Globaler Grep-Gate erst nach Bs vereinbarter Bereinigung.
Prüfkommandos: `node --test test/mcp-agent-context.test.mjs test/codex-browser-interface.test.mjs test/plugin-system-context-build.test.mjs`; `grep -rn "runPiboTui\|InteractiveMode\|TuiQueueOrdering" src/agent-runtimes/pi/runtime.ts src/index.ts` → leer.

## LP-05 – Weiterleitungen + Extension-Hygiene (Owner A(+I), Review I)

A: LP-02-Edits an `api.ts`/`types.ts` (in LP-02 enthalten), Barrel-Kollisionscheck (`api-loops` deckt alles ab). I (separater Patch, Root-Manifest-Ownership): `package.json:37,42,43` tote Ausschlüsse streichen; optional ignorierte `src/apps/chat-vscode/dist/`-Reste (964K) lokal löschen (kein Commit-Effekt). Deprecated VSCode-Docs unangetastet.
Gate: Paketinhalts-Check unverändert bis auf gewollte Ausschlüsse; `git status` zeigt nur beabsichtigte Pfade.

## Voraussetzungen

I0 (nicht bestanden): diese Runde liefert nur getrennte Analysen A1–D1 — keine Worktrees angelegt, keine Piloten gestartet. Folge: I0-Basis → reale A1–D1-Analysen/Piloten (D1→I→C1 für K07) → G1; erst nach G1 werden Implementierungs-Worktrees angelegt. Ausstehende I0-Leistung (Vertragsentwürfe v0, Pflichtmatrix-Grün) bleibt G1-Sache. Spätere Implementierungsvoraussetzungen: G1-Freigabe; Schreib-Owner wie oben; C bestätigt LP-01 (Loops-Verträge), B bestätigt LP-02/LP-04 (Löschungen/TUI), I bestätigt LP-05; `dist/`-Rebuild nur im dann freigegebenen Implementierungs-Worktree (Analyse-Workspace baut nicht).

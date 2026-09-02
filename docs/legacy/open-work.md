---
type: "Historical Record"
title: "mcp-native-extension-implementation-plan"
description: "Preserves the original body as a deprecated historical record without promoting historical claims."
tags: ["historical","legacy","migration"]
status: "deprecated"
authority: "historical"
migration_lineage:
  source_path: "open-work.md"
  source_commit: "0cd6a73449e1b555fa6e590d839d7e03c8dc98bf"
  baseline_commit: "2aef244301f5d181624662fdad53e18e83e80bd9"
  baseline_blob_oid: "4098030a1d40fb8505aed8df242dd8810272ad85"
  source_bytes: 3943
  source_sha256: "b30867c221fe34231ef4a443c3cfabbf4d82dac8491ce8539b98b66024419f2d"
  source_body_sha256: "b30867c221fe34231ef4a443c3cfabbf4d82dac8491ce8539b98b66024419f2d"
generated:
  by: "process:pibo-okf-c-legacy"
  at: "2026-09-01T09:50:26Z"
---
# mcp-native-extension-implementation-plan
  docs/mcp-native-extension-implementation-plan.md

  Der Inhalt enthält jetzt:

  - Zielbild für native MCP-Extension mit CLI als Referenz
  - klar getrennte Übernahme-Punkte von bestehender CLI vs. pi-mcp-adapter
  - Architektur-Zielbild
  - 7 Umsetzungsphasen mit Reihenfolge und Erfolgskriterien
  - Risiken, offene Entscheidungen und nächste Schritte

  Wenn du willst, mache ich im nächsten Schritt daraus als Nächstes sofort die Umsetzungs-Tickets pro Phase.

# Die Analyse ist als Report gespeichert: docs/interactive-collaboration-analysis-2026-05-02.md
  Der Report hält das Plugin-Konzept, das Interaction-Protokoll, die Multi-Browser-Consume-Semantik, die empfohlene App.tsx-
  Modularisierung und den MVP-Scope fest. Ich habe keine weiteren Codeänderungen gemacht.

# Commit erstellt: cbe86d2 Add Plane integration architecture spec.
  Enthalten ist nur spec/spec-architecture-plane-integration.md. Die anderen vorhandenen Änderungen im Worktree habe ich nicht angefasst.

# Der Report: association-architecture-report
  Report: docs/association-architecture-report.md
  Ich habe ihn als Research-Note im bestehenden docs/-Stil geschrieben: Idee, wichtigste Architektur-Erkenntnisse, konkrete Anfasspunkte
  im Code, empfohlene Kernarchitektur, Injection-Modi, Provider-Typen, V1-Grenzen, Risiken und naechste Schritte. Damit ist das Wissen
  erstmal persistent im Repo verankert.

  Ich habe keine Tests ausgefuehrt, weil nur Dokumentation hinzugekommen ist. Als naechsten sinnvollen Schritt wuerde ich daraus ein
  kleines V1-Spec fuer pibo.associations ableiten.

# Erstellt: process-tool-review-feedback-loop und tool-review-hooks-analysis
  - spec/spec-process-tool-review-feedback-loop.md
  - docs/tool-review-hooks-analysis.md

  Kernaussage der Analyse: V1 sollte als Pibo GatewayAction mit /tool-review in Chat Web starten. Tool-Events sind über normalisierte
  PiboOutputEvents schon gut beobachtbar; Pi-Hooks sind eher später relevant, falls wir Tool Calls vor der Ausführung blocken, mutieren
  oder tiefer instrumentieren müssen. Skill-Nutzung ist aktuell nicht sauber beobachtbar, nur Skill-Ladung.

  Verifiziert: git diff --check ohne Befund, beide neuen Dateien sind ASCII-clean. Bestehende uncommitted Änderungen im Worktree habe ich
  nicht angefasst.

# architecture-agent-orchestration-and-model-selection:
  spec/spec-architecture-agent-orchestration-and-model-selection.md:1

  Der erste Implementationsplan liegt hier:
  plans/implement-agent-orchestration-and-model-selection.md:1

  Inhaltlich ist das jetzt so geschnitten:

  - Punkt 1 Child-Hygiene ist als erste Phase klar priorisiert und als eigener Produktvertrag beschrieben.
  - Die höhere Orchestrierungsschicht ist als Pibo-eigene Workflow-Schicht modelliert, ausdrücklich oberhalb von pibo_subagent_* und
    pibo_run_*, nicht als Ersatz.
  - Long-running/attention ist bewusst konservativ spezifiziert, damit wir nicht mit aggressiven Guardrails in normale lange Agent-Läufe
    reinfunken.
  - Worktrees sind optional und run-/step-basiert gedacht, damit das mit dem bestehenden Run-System zusammenpasst.
  - Modellwahl ist als allgemeine Agent-System-Funktion spezifiziert, mit zwei getrennten Feldern:
    mainModel und subagentModel, jeweils entweder default oder expliziter Override.

  Wichtigster technischer Punkt aus der Planung:
  Die Modellwahl ist aktuell noch kein natürlicher Teil unserer InitialSessionContext-Verträge. Deshalb ist Phase 2 bewusst erst nach
  Hygiene eingeordnet und als Pibo-eigene Runtime-Adapterfrage beschrieben, nicht als schnelle UI-Checkbox.

  Ich habe nichts umgesetzt, nur geplant und gegen die aktuelle Codebasis gegengeprüft. Nächster sinnvoller Schritt wäre, die Spec
  gemeinsam einmal kurz zu schärfen, bevor wir Phase 1 in ein konkretes Aufgabenpaket herunterbrechen.
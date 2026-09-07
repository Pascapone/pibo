---
type: "Investigation Report"
title: "Pibo performance and scalability F–H handoff"
description: "Transfers the accepted A–E state, the exact F and G work-in-progress, branch topology, environment gates, and the remaining work to finish packages F through H."
tags: ["performance", "scalability", "handoff", "storage"]
status: "draft"
authority: "evidentiary"
generated: { by: "qwen/qwen3.8-max", at: "2026-09-07T17:50:00.000Z" }
sources:
  - resource: "/plans/pibo-performance-and-scalability.md"
  - resource: "/reports/performance-scalability-handoff-2026-09-07.md"
  - resource: "/reports/performance-scalability-commands-2026-09-07.md"
  - resource: "/reports/performance-scalability-capacity-2026-09-07.md"
  - resource: "/reports/performance-scalability-telemetry-2026-09-07.md"
---

# Auftrag und warum dieses Handoff existiert

Der ursprüngliche Nutzerauftrag verlangt die vollständige Umsetzung aller Pakete A–H des [Performance- und Skalierbarkeitsplans](/plans/pibo-performance-and-scalability.md). Die Vorgänger-Session `ps_87cdcbbc-3dde-4266-889f-a87fb5a6a786` („Pibo Rework Astra“, Profil `pibo-agent-astra`, Runtime `codex-native`) arbeitete am 7. September 2026 von 07:21 bis 13:24 UTC in einem einzigen langen Turn und führte die Pakete B–F sowie den Beginn von G aus. Dieses Dokument konserviert ihren Endzustand für eine frische Session, die den Umbau fertigstellt.

**Warum die Vorgänger-Session endete (wichtig für die neue Session):**

1. Um 13:11:42 UTC erschöpfte sich das Provider-Kontingent: `quota_exhausted`, „You've hit your usage limit … try again at **Sep 12th, 2026 5:32 AM**“ (openai-codex). Der `codex-native`-Provider ist also bis dahin blockiert — die neue Session muss ein anderes Profil/einen anderen Provider nutzen oder warten.
2. Danach geriet die Session in eine Run-Reminder-Dauerschleife (538 `session_error`-Events in 13,5 Minuten), dokumentiert in [GitHub Issue #967](https://github.com/Pascapone/pibo/issues/967): Zwei nie konsumierte tracked Yielded Runs wurden nach jedem fehlgeschlagenen Turn sofort erneut zugestellt. Die ~1.668 Fehlerknoten im Trace der Vorgänger-Session stammen aus dieser Schleife und sind als Historie zu ignorieren.
3. Um 13:24:57 UTC beendete ein Operator-`kill` die Schleife („Session disposed while a message was active“); die zwei unconsumed Runs (`run_b5f88040…`, `run_0ec469b2…`) wurden dabei suppressed.

Die Vorgänger-Session nicht für neue Arbeit wiederaufnehmen. Ihre vollständige Fortschrittshistorie (79 Assistant-Meldungen) ist bei Bedarf lesbar mit:

```bash
pibo debug messages ps_87cdcbbc-3dde-4266-889f-a87fb5a6a786 list --limit 200
```

# Gesamtstatus A–H (Stand 2026-09-07 ~17:45 UTC)

| Paket | Stand | PR (alle **offen**, ungemerged) | Worktree | HEAD | Dirty |
|---|---|---|---|---|---|
| A: Index-Fix, minimale Spans | fertig, Pibo2-abgenommen | [#953](https://github.com/Pascapone/pibo/pull/953) `feature/performance-indexed-admission` | `/root/code/pibo/.worktrees/performance-scalability-p0` | `d178416c` | clean |
| B: Admission-/Storage-Isolation | fertig, erneut Pibo2-abgenommen | [#959](https://github.com/Pascapone/pibo/pull/959) `feature/performance-storage-isolation` | `/root/code/pibo/.worktrees/performance-storage` | `60d48f1b` | clean |
| C: Durable Commands + Receipts | fertig, Pibo2-abgenommen (189 Integrationstests) | [#961](https://github.com/Pascapone/pibo/pull/961) `feature/performance-durable-message-commands` | `/root/code/pibo/.worktrees/performance-commands` | `0b2bbdc3` | clean |
| D: Fairness, Limits, Slots | fertig, Pibo2-abgenommen | [#964](https://github.com/Pascapone/pibo/pull/964) `feature/performance-runtime-capacity` | `/root/code/pibo/.worktrees/performance-capacity` | `17d11f61` | clean |
| E: Telemetrie-/Output-Batching | fertig, Pibo2-abgenommen | [#965](https://github.com/Pascapone/pibo/pull/965) `feature/performance-telemetry` | `/root/code/pibo/.worktrees/performance-telemetry` | `c01f4bb3` | clean |
| F: Navigation-/Trace-Lesemodelle | implementiert, lokal grün; **10-Mio-Lastlauf offen** | keiner; Branch `performance-reads` **nicht gepusht** | `/root/code/pibo/.worktrees/performance-reads` | `485a3417` | **2 WIP-Dateien** |
| G: Archive, Retention, Wartung | **in Arbeit**, erste Tests grün | keiner; Branch `performance-maintenance` nicht gepusht | `/root/code/pibo/.worktrees/performance-maintenance` | `c01f4bb3` (= E-Spitze) | **22 WIP-Dateien, keine Commits** |
| H: Runtime-Host-Isolation o. Kapazitätsnachweis | nicht begonnen (Messentscheidung nach B–F) | — | — | — | — |

Achtung: Lokale Branch-Namen (z. B. `performance-storage`) und gepushte PR-Branch-Namen (z. B. `feature/performance-storage-isolation`) unterscheiden sich; die SHAs oben sind jeweils gleich.

# Branch-Topologie

- Die Kette ist gestapelt: A → B (mit gemergtem `upstream/dev`) → C → D → E → {F (3 Commits über E-Spitze `c01f4bb3`), G (uncommittet, direkt auf E-Spitze)}.
- Stand heute sind F und G **0 Commits hinter `upstream/dev`** (dev ist in die Kette eingearbeitet; `upstream/dev`-Spitze beim Schreiben: `3d0d1869`).
- **G enthält F nicht.** Vor dem G-PR entscheiden: G auf F rebasen (Kette) oder bewusst getrennt landen. **Konfliktrisiko: sowohl F als auch G ändern `src/data/schema.ts`.**
- Alle fünf PRs sind offen. Die Merge-Reihenfolge der gestapelten Kette (953 → 959 → 961 → 964 → 965 → F → G) mit dem Maintainer abstimmen; nicht eigenmächtig mergen.

# Paket F: genauer Stand (Worktree `performance-reads`)

Commits:

- `7ed3b963` — Isolate trace reads and bound resumable history and SSE work
- `96c9a9e7` — Maintain unread projections and page navigation worker transfers
- `485a3417` — Verify full message payload references survive trace projection

Abgeschlossen und lokal grün (aus den Fortschrittsmeldungen der Vorgänger-Session):

- Schwere Trace-/History-Leseoperationen in eigenem Lese-Worker; History-Seiten und Grenzen über passende Indizes; Backfill konsistent bei Pause, Wiederaufnahme und parallelen Änderungen.
- Streaming: HTTP-Transport wartet bei Socket-Rückstau; SSE-Warteschlange mit Größengrenzen.
- Cache-Hits überspringen Trace-Rekonstruktion; laufende Deltas lösen keine fortlaufenden History-Reloads mehr aus.
- Unread-Zählung als fortlaufend gepflegte Projektion statt Event-History-Scan; Cache für Session-Navigation.
- Navigation für 10.000 Sessions in indizierte 500er-Seiten aufgeteilt.
- Große Nachrichten: begrenzte History-Seite reicht Volltext-Verweis bis zur Trace-Ansicht weiter (`485a3417`).
- Tests: vollständiger Build + **168 kombinierte Tests grün** (inkl. aller sechs Outbox-Prozessabsturzfälle) + 27 ergänzende Tests (Neustart ausgefallener Lese-Worker, langsame/abgebrochene HTTP-Streams).
- 1-Million-Event-Lauf: Trace-Seiten, History und Nachrichtenannahme unter den Latenzgrenzen; 500/500 Nachrichten abgeschlossen.

**Offen (der aktive Arbeitspunkt beim Abbruch):**

- Der **10-Millionen-Event-Lauf** schlug beim Start der Storage-Worker fehl: Ein Auftrag lief schon vor der eigentlichen Messung in seine Frist → keine gültigen Latenzwerte. Die Testdaten wurden absichtlich behalten, um die Ursache ohne Neuaufbau zu untersuchen.
- Uncommitteter WIP (2 Dateien, `git diff` im Worktree):
  - `scripts/performance-read-model-benchmark.mjs` (+48/−12): trennt Worker-Start von der Messphase und behält fehlgeschlagene Datensätze — die direkt begonnene Umsetzung der obigen Korrektur.
  - `src/data/schema.ts` (+2/−1): neuer Partial-Index `idx_event_log_sequence_repair_candidates` auf `event_log(session_id)` plus `INDEXED BY` in der V7-Sequenzreparatur-Abfrage — beschleunigt den Startup-Scan über riesigen Event-Log (Kontext: Worker-Startfrist).
- Laut Meldung 71 stehen außerdem noch aus: Aufbewahrungs- (Retention-) und integrierte Belastungstests unter großer Historie mit parallelen Schreibzugriffen.
- Komplettes Abnahme-Gate fehlt: finaler Build + Pack, Pibo2-Kandidateninstallation im isolierten Pool-Slot, authentifizierte reale Abnahme, Validierungsbericht, PR.

Docker-Worker: `pibo-dev-performance-reads` (lief beim Schreiben seit ~7 h).

# Paket G: genauer Stand (Worktree `performance-maintenance`)

Basis: E-Spitze `c01f4bb3`. **Keine Commits**, 22 uncommittete Dateien. Laut Meldungen 75–78 bereits getestet/grün:

- **Wartungs-Worker**: kleine fortsetzbare Batches statt globaler Stillstands-Bereinigung; räumt alte Diagnosedaten trotz anderer aktiver Sessions auf; schützt laufende Turns; setzt gespeicherten Fortschritt nach Wiederöffnung fort; echter SQLite-„Disk full“-Test: Löschung und Fortschrittsmarke werden gemeinsam zurückgerollt; Produktnachrichten und Recovery-Daten ausgenommen. Erste acht Tests grün.
- **Sicherung**: SQLite-Online-Backup plus Manifest für externe Payloads; paralleler WAL-Schreibzugriff getestet; Abbruch und Fortsetzung beim Kopieren; unvollständige Sicherung wird nicht als wiederherstellbar markiert.
- **Capture-Speicher** für optionale Provider-Details: verpflichtende Session-Auswahl, Laufzeit- sowie Zeilen-/Byte-Limits; Standard-Telemetrie bleibt aggregiert; abgeschlossene Captures über Manifeste auffindbar, nur auf ausdrücklichen Abruf geöffnet.
- **In Arbeit** (Meldung 78, letzter F/G-Stand): Begrenzung manueller Prune-Aufrufe und WAL-Last während Sicherungen; beide sollen dieselben Grenzen wie die automatische Wartung einhalten.

Dirty-Dateien:

```text
geändert: src/apps/chat-ui/src/api-settings.ts, src/apps/chat-ui/src/settings/SettingsView.tsx,
  src/apps/chat/chat-settings-routes.ts, src/apps/chat/telemetry-retention-service.ts,
  src/apps/chat/web-app.ts, src/data/schema.ts, src/data/telemetry-retention.ts,
  src/data/telemetry-worker.ts, src/debug/index.ts, test/debug-cli.test.mjs,
  test/telemetry-retention-service.test.mjs, test/telemetry-store.test.mjs
neu: src/data/async-telemetry-maintenance.ts, src/data/storage-backup.ts,
  src/data/telemetry-capture.ts, src/data/telemetry-maintenance-worker.ts,
  src/data/telemetry-maintenance.ts, src/debug/storage-backup.ts,
  src/debug/telemetry-capture.ts, test/storage-backup.test.mjs,
  test/telemetry-capture.test.mjs, test/telemetry-maintenance.test.mjs
```

Docker-Worker: `pibo-dev-performance-maintenance` (lief beim Schreiben seit ~5 h). Zusätzlich läuft noch `pibo-dev-performance-scalability-p0` (~20 h) — kann nach Prüfung bereinigt werden.

# Paket H

Nicht begonnen. H ist laut Plan eine **Messentscheidung** nach B–F: Runtime-Host-Isolation implementieren, wenn B–F noch relevante Gateway-CPU-/Stall-Profile zeigen, oder mit belastbaren Kapazitätsmessungen dokumentieren, warum sie derzeit nicht erforderlich ist. Messbasis liefern die D-Rampen (Capacity-Report) und die F-Lastläufe.

# Umgebungen, Gates und Belege

- Maßgebliche Regeln: `AGENTS.md`, `GLOSSARY.md` sowie die Skills `pibo-docker-system`, `pibo-debug-auth`, `pibo-v2-server-development`, `pibo-v2-github-flow`, `maintain-okf-docs`.
- Gate pro Paket (unverändert): Docker-Worker-Implementierung + deterministische Regressionen → vollständiger Build + `npm pack` des exakten Kandidaten → Installation desselben inhaltsadressierten Pakets in einem **isolierten Pibo2-Pool-Slot** (nie kanonischer Dienst, nie Controller-Host) → authentifizierte reale Abnahme (Composer, Duplikate, Reload, Health, headful Browser) → Bericht + Artefakte → PR gegen `upstream/dev` via `pibo-create-upstream-pr`.
- Pibo2-Pool-Lease-Status ist unbestimmt (nicht-interaktive Prüfung fand keinen aktiven Lease-Output). Vor einer neuen Abnahme den Pool-Status gemäß `pibo-v2-server-development` prüfen und Alt-Leases freigeben.
- Bestehende Belege (alle im `performance-reads`-Worktree vollständig enthalten, da F auf der Kette liegt):
  - Plan: `docs/plans/pibo-performance-and-scalability.md`
  - Audit: `docs/reports/production-performance-audit-2026-09-06.md`
  - A: `docs/reports/performance-scalability-p0-2026-09-06.md` + `artifacts/performance-scalability-p0-20260906/`
  - B: `docs/reports/performance-scalability-storage-isolation-2026-09-06.md`, `…-storage-final-2026-09-07.md` + `artifacts/performance-scalability-storage-2026090{6,7}/`
  - C: `docs/reports/performance-scalability-commands-2026-09-07.md` + `artifacts/performance-scalability-commands-20260907/`
  - D: `docs/reports/performance-scalability-capacity-2026-09-07.md` + `artifacts/performance-scalability-capacity-20260907/`
  - E: `docs/reports/performance-scalability-telemetry-2026-09-07.md`
  - Vorheriges Handoff: `docs/reports/performance-scalability-handoff-2026-09-07.md`
  - F/G: noch **kein** Validierungsbericht — mit dem jeweiligen Gate neu schreiben.

# Bekannte Tooling-Fehler als Kontext

- [#966](https://github.com/Pascapone/pibo/issues/966): Chat-Web-Leseendpunkte überschreiben den persistenten Session-Status mit `idle`; `pibo debug session` kann deshalb `idle` zeigen, obwohl die Session läuft. Live-Status über `pibo gateway web status` oder `pibo debug signals` prüfen.
- [#967](https://github.com/Pascapone/pibo/issues/967): Grenzenlose Run-Reminder-Wiederzustellung bei dauerhaften Turn-Fehlern (die Schleife, die die Vorgänger-Session produzierte). Lehre für die neue Session: tracked Yielded Runs zeitnah `pibo_run_read`/`pibo_run_ack`en, besonders wenn Provider-Fehler drohen.

# Empfohlene Fortsetzung

1. Plan, dieses Handoff, das vorherige Handoff und die Berichte C–E lesen; Arbeitsprofil mit verfügbarem Provider-Kontingent wählen (openai-codex bis 2026-09-12 blockiert).
2. **F fertigstellen**: beide WIP-Dateien sichten und abschließen (Worker-Start/Messphase-Trennung, Startup-Index), 10-Millionen-Lauf wiederholen, Retention- und integrierte Belastungstests nachholen; dann volles Gate (Build, 168+27 Tests erneut, Pack, Pibo2, Bericht `performance-scalability-reads-…`, PR — gestapelt auf #965 oder nach Maintainer-Entscheidung).
3. **G fertigstellen**: Topologie entscheiden (Rebase auf F oder getrennt), `schema.ts`-Überlappung mit F auflösen, Prune-/WAL-Begrenzung vollenden, committen, volles Gate, Bericht, PR.
4. **H**: Messentscheidung nach Plan treffen und als Bericht dokumentieren (ggf. Umsetzung).
5. Merge-Reihenfolge der gestapelten PR-Kette mit dem Maintainer klären; nach jedem Merge Branch/Worktree gemäß `pibo-v2-github-flow` bereinigen.
6. Vor jedem PR: OKF-Index/Log aktualisieren (`npm run docs:indexes:write`, `docs/log.md`) und `npm run docs:validate` ausführen.

# Abschlussbedingung

Der Auftrag ist erst erfüllt, wenn alle Pakete A–H umgesetzt sind (H wahlweise als implementierte Isolation oder als belastbarer Kapazitätsnachweis), jedes Paket lokal und auf Pibo2 abgenommen, dokumentiert und über den GitHub-Flow reviewbar gemacht wurde — und die offene PR-Kette mit dem Maintainer integriert ist.

Dieses Handoff-Dokument ist uncommittet im `performance-reads`-Worktree; die neue Session committet es zusammen mit ihrer ersten F-Änderung (oder separat als Docs-Commit).

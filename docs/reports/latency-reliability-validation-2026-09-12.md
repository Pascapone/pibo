---
type: "Validation Report"
title: "Latenz und Zuverlässigkeit: Umsetzung und Abnahme 2026-09-12"
description: "Dokumentiert Baseline, Paketintegration, Messbelege und verbleibende Abnahmegates des Latenzumbaus."
tags: ["latency", "reliability", "multi-agent", "validation"]
status: "draft"
authority: "evidentiary"
generated: { by: "openai/codex", at: "2026-09-13T01:28:32Z" }
sources:
  - id: "remediation-plan"
    resource: "/plans/pibo-latency-reliability-remediation.md"
    title: "Vom Nutzer beauftragter Umsetzungsplan"
  - id: "historical-archive"
    resource: "scope: private controller archive /root/.pibo/investigations/latency-remediation-2026-09-12; original Pibo2 investigations"
    title: "Unveröffentlichte Rohbelege der ursprünglichen Untersuchungen"
  - id: "baseline-tests"
    resource: "/reports/artifacts/latency-reliability-2026-09-12/baseline-focused-tests.log"
    title: "Ausgeführte fokussierte Docker-Baselineprüfungen"
  - id: "continuation-evidence"
    resource: "scope: private controller archive /root/.pibo/investigations/latency-continuation-2026-09-12; candidates 09375bbb8d702d1bc6817ffe1313429fc05e07b3 and 722883c43c8868caaf3c32511780191ff5422b34"
    title: "Fortsetzungs-, Last-, Pibo2- und Testsuite-Nachweise"
  - id: "final-pr-candidate-evidence"
    resource: "scope: private controller archive /root/.pibo/investigations/latency-continuation-2026-09-13/final-candidate-c917b544; exact packaged commit c917b544cfe71e6d697637ca9b9b3b538b636ad3"
    title: "Finale Docker-Paket-, AP-08- und öffentliche Pibo2-Nachprüfung für PR #1017"
implementation_state: "implemented; exact-candidate soak complete; physical-device acceptance external"
---

# Abnahmegrenze

Der zentrale [Handoff zur Fortsetzung](/reports/latency-reliability-handoff-2026-09-12.md) verbindet diesen Prüfbericht mit Branches, privaten Artefakten, offenen Paketen und den erforderlichen Workflows.

Die ursprüngliche Ausführung endete auf Nutzerwunsch mit einem gesicherten Zwischenstand; die später autorisierte Fortsetzung schloss die last- und browsergeprüfte Produktimplementierung auf `722883c4` ab. Der exakte Zwei-Stunden-Soak ist inzwischen bestanden. Die Gesamtabnahme bleibt nur wegen des externen physischen Zielgeräts teilweise offen. Dieser Bericht trennt Ausgangsstand, Zwischenkandidaten, exakte Kandidatenevidenz und die nachgelagerte Reviewkorrektur. Ein grüner Baseline-Test wird nicht als geschlossene neue Anforderung ausgegeben. Die Zielbudgets bleiben diejenigen des [beauftragten Plans](/plans/pibo-latency-reliability-remediation.md).[^remediation-plan]

# Abschluss der Fortsetzung auf Kandidat `722883c4`

Die autorisierte Fortsetzung lief ausschließlich im Dockerworker `pibo-dev-latency-reliability-continuation-pscb044a` und im isolierten Worktree `/root/code/pibo/.worktrees/latency-reliability-continuation-pscb044a`. Der exakt last- und browsergeprüfte Produktkandidat ist `722883c43c8868caaf3c32511780191ff5422b34`; das unveränderte Paket `pasko70-pibo-1.7.2-722883c4.tgz` hat SHA-256 `c3a774d8455e76aec0ca814056b0bdddeb299a49a61738810a138e4039772ad9`. Das aktuelle `upstream/dev` wurde danach per Merge `d5f37fe2` integriert. Der abschließende Gesamtdiff-Review fand und behob in `34cb7270` eine unabhängige AP-08-Ungewissheitsmarkierung; diese Nachkorrektur wird nicht als Bestandteil des `722883c4`-Soaks oder Pakets ausgegeben. Der committed PR-Source-Stand `c917b544cfe71e6d697637ca9b9b3b538b636ad3` wurde danach als eigenes exaktes Dockerpaket begrenzt auf Pibo2 nachgeprüft. Der fokussierte Fork-Branch `feature/latency-reliability-remediation` wurde gepusht und Draft-PR #1017 gegen `upstream/dev` geöffnet. Kein Merge, Release, Controller-Deployment oder Controller-Gateway-Neustart wurde ausgeführt.[^continuation-evidence]

## Exakt dem finalen Kandidaten zugeordnete Ergebnisse

| Bereich | Ergebnis | Aussagegrenze |
|---|---|---|
| AP-03 Foreign Writes | 3.250 Sessions: p95 20,53 ms; 10.000 Sessions: p95 13,32 ms, max 37,34 ms; Reparent, Detach, Delete und Signalrevisionen korrekt | Voller lokaler authentifizierter HTTP-Statuspfad nach prozessfremden Store-Writes; kein Browser-/Providerwert |
| Repräsentative Admission | 3.250 gespeicherte Sessions und 3.250 gemessene Admissions, 20 Runtimes: Median 9,37 ms, p95 15,22 ms, p99 21,31 ms, max 40,85 ms; Status-p95 11,96 ms; 3.270 akzeptiert und verfolgt; 0 Integritätsfehler | Geschütztes, gepacetes lokales Produktpfadprofil bei `concurrency=1`, `burst=1`; kein Ersatz für 10.000 Admissions |
| Native Toolsmoke | Session `ps_smoke_native5_722883c4`, Adapter und Runtime `codex-native`, Codex-App-Server 0.153.2, Luna/medium, erfolgreicher `codex_command`, Marker und terminaler Trace `done`/`ok`, 0 Fehlerknoten | Temporäre `permissionMode: "yolo"`-Sandbox-Ausnahme wegen fehlender unprivilegierter User-Namespaces; nur Native-Smoke und Native-Portfolio-Parent |
| 6+12 Laufzeitportfolio | Endzustand: 6 Parents, 12 Children, 1 Native-Parent; alle Luna/medium, gebunden und terminal; alle Traces `ok`, 0 Fehlerknoten, erfolgreiche Modellinferenz, Tools und Marker | Im kurzen Parallelfenster waren 17 Gateway-Angebote erfolgreich. Die 18. SSH-Anfrage scheiterte vor Admission und bestand erst später; keine Behauptung von 18 gleichzeitig aktiven Agents |
| 31 Minuten Modell/MCP | `ps_mcp_long2_722883c4`: 7 terminale Luna/medium-Runden und 7 echte 60-Sekunden-MCP-Aufrufe; MCP-Spanne 1.860,856 s | Normale Pi-Isolation, keine `yolo`-Ausnahme. Fünf ältere Preflight-Fehlerknoten im aggregierten Trace sind getrennt von den sieben erfolgreichen Runden |
| Passive Slash-Latenz unter aktiver Arbeit | Je 49 Proben: `/status` p95 44,91 ms, max 45,53 ms; `/session` p95 75,02 ms, max 89,98 ms; `/thinking` p95 50,07 ms, max 68,95 ms | Direkt während aktiver Modell-/MCP-Arbeit über dieselbe Gatewayverbindung gemessen; providerfreie Aktionen öffneten keine zusätzliche Session |
| Öffentliche headful Abnahme | Better-Auth-Machine-Session erfolgreich; `/status`, `/session` und `/thinking` sichtbar; CDP-Response 16,69–19,33 ms; `/thinking` im zweiten begrenzten Versuch bereit; `runtimeActive=false`; Desktop 1.440×900 und Mobile 390×844 ohne horizontalen Overflow, Composer aktiv | Exakter Kandidat und öffentlicher Slotpfad; Mobile ist Viewport-Emulation, kein physisches Gerät |
| Sichtbare Lifecycle-Recovery | 60,061 s hidden/frozen; Entwurf erhalten; Traceversion und Signalversion 1→3 fortgeschritten; Signalepoche stabil; Event-, Signal- und Trace-Timeline-Verbindungen nach Resume erneuert; Zielseite ohne erfassten Core-Network-/Runtime-Fehler | Der absichtlich mitgesendete Modellturn war kein Erfolgsgate und blieb wegen eines nicht angemeldeten frischen Pi-Providerstores `interrupted`; genau ein Receipt, kein Replay, anschließend explizit als fehlgeschlagen reconciliert |
| Kanonische Testsuite | 476 kanonische Dateien, 476 eindeutige erfolgreiche Dateipfade, 0 fehlende, 0 zusätzliche, 0 Hashabweichungen; Ledger SHA-256 `c9d52ebb11a52a18ae37c005c9e0a5adaaeb7defa42c9f1ffc3668f192f9490c` | Pfad-/Hash-Coverage aus disjunkten erfolgreichen Shards und einem fokussierten Wiederholungstest; abgebrochene Logs nicht gezählt |
| Zwei-Stunden-Soak | Gemessene Soakphase 7.200,496 s ohne Vorbereitung; 6.484 kontinuierliche Soak-Commands; insgesamt 7.504 eindeutige Admissions, 7.504 eindeutige Effekte und 7.504 genau einmal abgeschlossene Commands; Admission-p95 15,22 ms; Status-p95 11,98 ms; 0 Failures, Incomplete oder nichtterminale Queuezeilen | Exakter `722883c4`-Run bei 3.250 gespeicherten Sessions, 20 Runtimes, `concurrency=1`, `burst=1`, Intervall 1.000 ms; äußere Schutzschicht erfolgreich, kein OOM, Spitzen Memory-/I/O-Full-PSI 1,08/4,04 bei Grenzen 5/10 |
| Pibo2-Leases | `lease_0e34ee90319d825b87` für Provider-/Portfolioarbeit, freigegeben um 21:24:14 UTC; `lease_8b448039c94bde2e01` für die öffentliche headful Abnahme, freigegeben um 22:19:20 UTC | Beide verwendeten Slot 01 und das checksumgebundene `722883c4`-Paket; danach `active: 0`, `free: 10` |
| Finaler PR-Source-Stand | `c917b544cfe71e6d697637ca9b9b3b538b636ad3`, Paket-SHA-256 `ae1e8cb84658441168ea2bd78ba0f9454b628a1b71fa6d74a10ec5ceec992261`; AP-08-Cursorpfad und öffentliche Health-/Statuspfade bestanden auf Pibo2 | Begrenzte Nachprüfung des finalen Codes nach Upstream-Merge und `34cb7270`; keine Umdeutung oder Wiederholung der 476-Dateien-, Last-, Soak-, Provider-, Portfolio-, MCP- oder Browserbelege |

## AP-03-Vorher/Nachher und ressourcenbegrenzte Gates

Der ältere Kandidat `09375bbb8d702d1bc6817ffe1313429fc05e07b3` scheiterte beim 10.000-Session-Foreign-Write-Profil mit p95 273,78 ms. Ursache war die globale `chat_navigation_clock`, die nach jeder fremden Strukturänderung eine vollständige Reprojektion auslöste. `722883c4` ergänzt ein dauerhaftes, auf 4.096 Einträge begrenztes Strukturänderungsjournal, wendet höchstens 1.024 Änderungen je Batch an, nutzt eine 1.025. Zeile als Overflow-Sentinel und fällt bei Migration, Rennen, Lücke oder Overflow konservativ auf einen Vollabgleich zurück. Der exakte Nachher-Lauf bestand mit p95 13,32 ms.

Der geschützte 10.000-Admission-Lauf auf `722883c4` wurde bei Host-I/O-Full-PSI 11,12 an der unveränderten Grenze 10 nach 5.132 Admissions beendet. Er ist nicht gatefähig und wurde nicht identisch wiederholt. Der bestandene 3.250-Admission-Lauf senkte Last, Parallelität und Burstgröße, nicht die Schutzgrenzen. Der Nutzer hat 3.250 als verbindliche Servereinstellung und Abnahmegröße freigegeben; deshalb ist der 10.000-Admission-Versuch kein offenes Gate mehr. Ein weiterer solcher Lastlauf hätte nur den bekannten Hostschutz erneut beansprucht und keine erforderliche Entscheidung ergänzt.

Der neue exakte `722883c4`-Soak startete am 2026-09-12 um 22:37:25 UTC und endete am 2026-09-13 um 00:39:04 UTC. Der Harness weist die eigentliche Soakphase getrennt von Seed, Warm-up, 1.000 gemessenen Admissions und Drain aus: angefordert 7.200 Sekunden, tatsächlich 7.200,496 Sekunden, 6.484 nicht gedeckelte Soak-Commands im 1.000-ms-Takt. Die 7.504 Admissions, Command-IDs, Event-IDs, Admission-Texte und Effekte sind jeweils vollständig eindeutig; es gibt weder fehlende noch zusätzliche Effekte. Alle 7.504 Integritätszeilen besitzen genau eine Admission, ein Terminal und einen Output im Zustand `completed`. Die SQLite-Queue enthält 0 nichtterminale, 0 fehlgeschlagene und 0 unterbrochene Commands; Workertelemetrie endet bei `queued=0`, `inFlight=0`, `pendingBytes=0`, `rejected=0`, `failed=0`, `expired=0`, `restarts=0`. Die äußere Schutzschicht meldete `success`, Exit 0, kein OOM, mindestens 12.299.251.712 verfügbare Hostbytes sowie Spitzen von 1,08 Memory-Full-PSI und 4,04 I/O-Full-PSI. Der 7.201,62-Sekunden-Vorläufersoak mit 22.492 Soak-Commands bleibt weiterhin ausschließlich `09375bbb` zugeordnet.

## Testsuite, OOM- und I/O-Einordnung

Der unsegmentierte 476-Dateien-Lauf wurde bei Host-I/O-Full-PSI 11,16 beendet. Spätere Teilversuche stoppten bei 11,05, 10,25 und 11,77; diese Ereignisse sind aktuelle Schutzstopps und keine OOM-Diagnose. Erfolgreiche Folgeläufe verwendeten unveränderte Schutzgrenzen, `NODE_OPTIONS=--max-old-space-size=1024`, `--test-concurrency=1`, kleinere Shards und Ruhephasen. Die nicht abgeschlossenen Logs `full-suite-722883c4.log`, `shard-05.log` und `remaining-06.log` wurden nicht angerechnet.

In Shard 02 meldete `test/agents-controller-compat.test.mjs` `spawnSync.status === null`. Im gleichen Zeitraum lagen ein 2-GiB-Containerlimit, etwa 2,016 GiB Peak und kumulative OOM-Kill-Zähler vor; ein Exit-Signal wurde jedoch nicht erfasst. Deshalb ist der Befund ressourcenkonsistent, aber nicht allein durch die kumulativen Zähler kausal bewiesen. Nach Bereinigung nur taskeigener verwaister Prozesse bestand exakt dieser Test im fokussierten Wiederholungslauf. Keine fremden Prozessgruppen wurden beendet.

Das abschließende Coverage-Ledger basiert auf den tatsächlichen kanonischen Pfaden und SHA-256-Werten, nicht auf addierten Testzahlen oder überlappenden Summaries. Ergebnis: exakt 476/476 eindeutige erfolgreiche Dateien. Coverage-Summary SHA-256: `3e055bd22c4815fff17ac0df91494a5026573527dbaa35f764683819b8410146`.

## Provider-, Native- und MCP-Abnahme

Die frühere Providerblockade wurde ohne Tokenkopie oder Seed-Bypass über offizielle isolierte Device-/Browser-Flows behoben. Für Gateway Native war der tatsächliche fingerprintgebundene Store `/root/.pibo/agent-runtimes/codex-native/codex-native-f93ba5251f4f/codex-home`; frühere Logins in nicht fingerprintgebundene Pfade konnten ihn nicht authentifizieren. Ein erster echter Native-Start bestätigte erfolgreiche Authentifizierung, scheiterte aber an Bubblewrap mit: `bwrap: No permissions to create a new namespace, likely because the kernel does not allow non-privileged user namespaces. On e.g. debian this can be enabled with 'sysctl kernel.unprivileged_userns_clone=1'.`

Die daraufhin verwendete temporäre Profiloption `permissionMode: "yolo"` galt nur für den Native-Smoke und den Native-Portfolio-Parent. Der lange Pi-/MCP-Lauf verwendete normale Isolation. Die Portfolio-Ausführung lief vom 2026-09-12 19:52:14 UTC bis 19:52:29 UTC. 17 Sessions erreichten und absolvierten den Gatewaypfad; `ps_load_child_05a_722883c4` scheiterte zuvor bei SSH KEX und wurde später einzeln erfolgreich angeboten. Die endgültige Laufzeitprüfung über alle 18 Sessions ist gültige eventual-completion-Evidenz, aber kein 18-Agent-Simultanlastnachweis.

Der lange MCP-Lauf startete um 20:02:14 UTC und endete um 20:33:29 UTC. Seine realen MCP-Aktivitäten spannten 31:00,856. Alle sieben zeitgesteuerten Runden waren terminal erfolgreich. Die 49 Slash-Proben wurden während der aktiven Tools erhoben. Damit sind Modellarbeit, Toolnutzung und passive Aktionen gemeinsam belegt, ohne die älteren Preflight-Fehler als erfolgreiche Runden zu zählen.

## Exakte öffentliche Browser- und Recovery-Abnahme

Die spätere Lease `lease_8b448039c94bde2e01` installierte dasselbe Paket auf Slot 01. Eine frische Machine-Key-Identity erzeugte eine reguläre Better-Auth-Machine-Session; deren Cookie wurde in den isolierten headful Browser-Slot `pibo-chat-slot-002` importiert. Die öffentliche App zeigte die angemeldete Identität und die eigens angelegte Testsession. Browser Use lieferte die sichtbare Eingabe, DevTools/CDP die Request-, DOM-, Lifecycle- und Screenshot-Evidenz.

`/status` und `/session` erschienen im Terminal. `/thinking` meldete zunächst den begrenzten, wiederholbaren Zustand `loading` und lieferte im zweiten Versuch `off`, `minimal`, `low`, `medium`, `high`, `xhigh` und `max`. Die vier beobachteten Action-Responses lagen zwischen 16,69 und 19,33 ms; vor und nach den Aktionen blieb `runtimeActive=false`. Bei 1.440×900 und 390×844 war der Composer vorhanden und aktiv; `horizontalOverflow` war null.

Für die sichtbare Recovery blieb die Zielseite 60,061 Sekunden hidden und frozen. Währenddessen wurde genau eine Nachricht angenommen. Nach Resume waren Fokus, Composer und Entwurf erhalten; die Traceversion hatte gewechselt, die Signalversion war von 1 auf 3 gestiegen, und die Signalepoche blieb identisch. Der Browser öffnete `/api/chat/events` zweimal sowie `/api/chat/signals/events` und `/api/chat/trace/timeline` je einmal neu. Die Zielseite verzeichnete keine Core-Network- oder Runtime-Ausnahme.

Der zusätzlich angebotene Luna/medium-Turn war bewusst kein erneuter Provider-Login-Smoke. Der frische Pi-Store meldete `openai-codex` als `disconnected` und `configured=false`; der Command erreichte deshalb keine Modellausgabe und endete mit genau einem `interrupted` Receipt. Trace, Messages und Failures wurden read-only geprüft; es gab nur die angenommene Nutzernachricht, null Tracefehler und keine terminale Modellausgabe. Der Command wurde nicht wiederholt. Nach Dry-run wurde ausschließlich diese eigene Testtransaktion als `failed` reconciliert. Die Message-Queue war danach gesund, ohne unterbrochenen Vorgänger oder blockierten Nachfolger; die vollständige scoped Dead-Letter-Traversierung meldete null Einträge und null Identitätskollisionen. Containerlogs enthielten daneben begrenzte Requestfehler für eine andere veraltete Session-ID; deshalb wird nicht behauptet, der gesamte Hostlauf sei fehlerfrei.

## Ältere, weiterhin gültige, aber nicht umetikettierte Evidenz

Folgende konkrete Läufe gehören weiterhin ausschließlich zu `09375bbb`: die erste 476/476-Suite, die `codex-native`-Kaltstartmatrix für gleichen Raum, verschiedene Räume und warmen Kontrollpfad, der Public-Core-Bootstrap mit 102.527 Bytes und p95 54,9 ms, der sechsfache echte `TelemetryCaptureWriter`-Capture-on/off-Vergleich, die damaligen headful Desktop-/390×844- und Lifecycle-Recovery-Artefakte sowie der 7.201,62-Sekunden-Soak. Sie bleiben relevant, werden aber nicht als exakte `722883c4`-Läufe ausgegeben. Die oben dokumentierte neue headful Abnahme ist ein eigenständiger Lauf auf `722883c4`.

## Gesamtdiff-Review und Nachkorrektur

Der vollständige Topic-Diff wurde gegen das am 2026-09-13 gefetchte `upstream/dev` geprüft. Die fünf neuen Upstream-Commits wurden per Merge `d5f37fe2` integriert, statt die evidenzgebundenen Kandidatencommits umzuschreiben. Zwei Testannahmen mussten an Upstreams neue Standardbeobachtung von `session_error` angepasst werden. Die betroffenen Router-/Subagent-Tests bestanden; der reale inner-Docker-Yielded-Run-Test verwendete wie zuvor ausschließlich innen `PIBO_YIELDED_RUN_ISOLATION=off`, während die äußere Schutzschicht unverändert aktiv blieb.

Ein konkreter Reviewbefund betraf AP-08: Erschöpfte die begrenzte Beziehungssuche exakt ihren Scananteil, blieb `relatedIdentityCollision` zwar korrekt unbekannt, aber `classificationComplete` konnte wahr bleiben. `34cb7270` setzt in diesem Fall die Ungewissheit, bewahrt sie im Cursor und ergänzt eine Ablaufregression. Der Server-TypeScript-Compile mit dem projektierten 1.200-MiB-Heap bestand; `test/output-inspection-bounded.test.mjs` bestand mit 10/10 Tests. Zwei vorherige Compilerläufe mit künstlich reduzierten 768 beziehungsweise 1.024 MiB endeten erwartungsgemäß am V8-Heaplimit und zählen nicht als Produktfehler. Die 476-Dateien-Suite wurde nicht vollständig wiederholt: Vor dem Soak waren alle neun Kandidatenquellhashes unverändert; nach der isolierten Reviewkorrektur deckten Compile und die direkt betroffene Suite den geänderten Pfad ab.

## Exakte Nachprüfung des finalen PR-Source-Standes

Der saubere Commit `c917b544cfe71e6d697637ca9b9b3b538b636ad3` bindet `upstream/dev`-Merge `d5f37fe2`, Reviewfix `34cb7270` und die bis dahin committed Dokumentation. Ein isolierter Docker-Dev-Worker prüfte 2.849 tracked Dateien gegen den Commit und erzeugte `pasko70-pibo-1.7.2.tgz` mit 4.039.035 Bytes, 1.109 Einträgen und SHA-256 `ae1e8cb84658441168ea2bd78ba0f9454b628a1b71fa6d74a10ec5ceec992261`. Die gebaute und später auf Pibo2 installierte `dist/debug/output-dead-letters.js` war auf beiden Seiten bytegleich, SHA-256 `d46b04d1c5ea3f55a2709b9228ad12100846463d54af5a38e4395900e9f4e070`.[^final-pr-candidate-evidence]

Die unveränderte äußere Schutzschicht stoppte den Pack-Wrapper bei Host-Memory-Full-PSI 6,14 an der Grenze 5, nachdem `npm pack` samt `postpack` bereits beendet und das Archiv samt Checksumme geschrieben war. Es gab keinen OOM und keinen verbleibenden Buildprozess. Statt einen zweiten Paketbuild zu starten, wurden Quellmanifest, sauberer Worktree, Pack-Ausgabe, Archivstruktur und Paketchecksumme separat geprüft; anschließend installierte Pibo2 exakt denselben Artefakthash. Drei frühere generische One-time-Worker-Vorbereitungen waren ebenfalls vor Containererzeugung an Memory-Full-PSI 5,98, 5,34 und 5,30 gestoppt worden. Keine Schutzgrenze wurde verändert.

Pibo2-Lease `lease_142a8b738a5705212f` band Commit `c917b544` und den Paketdigest. Die installierte CLI erhielt einen Dead-Letter mit genau ausgeschöpftem Beziehungsscan: Seite eins blieb `classificationComplete=false` und lieferte einen Cursor; die Folgeseite war traversal-vollständig, blieb klassifikatorisch unvollständig und endete korrekt mit `complete=false`, `reason=scope_unclassified`. Beide Datenbanken blieben bytegleich. Über dieselbe öffentliche Lease bestanden drei `/health`-Aufrufe in 139,684/16,697/4,013 ms, fünf passive Statusaufrufe in 5,920–8,183 ms und eine `/status`-Action in 26,570 ms; alle Antworten waren HTTP 200, unter 500 ms und ließen `runtimeActive=false`. Die 1-CPU-/1.536-MiB-/512-PID-Pibo2-Grenzen blieben unverändert, der Container meldete kein OOM. Die Lease wurde am 2026-09-13 um 01:26:55 UTC freigegeben; anschließend `active: 0`, `free: 10`.

## Verbleibende Abnahmegrenzen

- Das physische Zielgerät bleibt extern; Desktop-/Mobile-Viewport-Emulation ersetzt es nicht.
- `/api/previews/events` lieferte im älteren Browserlauf 503. Das ist ein separater Preview-SSE-Fehler und kein Befund des neuen Zielseiten-Monitors.
- Der 10.000-Admission-Schutzstopp bleibt historische Ressourcenevidenz, aber nach Freigabe der Servereinstellung 3.250 kein offenes Abnahmegate.
- GitHub-Issue #1013 ist alleiniger Langzeitort für Reminder-Read/Ack-Discovery; #1016 ist der getrennte Follow-up-Ort für allgemeine Pibo2-Providerauth. Beide liegen außerhalb dieses Produktpatches.

## Private Kernartefakte

| Artefakt | SHA-256 |
|---|---|
| `ap03-http-foreign-writes-722883c4.json` | `0c3b04bde3f37b278c2d2a6933cc415a43b966fb40db781e3159a86b6f6ea00d` |
| `pibo2-codex-native-luna-medium-tool-smoke5-722883c4.log` | `e09a554a34b057a26d342f7bb23ad8bde91c70058afd55fb246fb8278db1e92e` |
| `portfolio-722883c4-real/runtime-validation.json` | `84c4a4ba372b150ccae96bfc051501b43ae49263320a8787459d8cf6351ec55a` |
| `mcp-long-722883c4/summary.json` | `646118de6de8d9a5cb4cf30028962f6b76a9731bf0d271dfaecd276bebf89d27` |
| `finite-3250-admissions-722883c4-paced/sessions-3250/summary.json` | `a5eb0514e46ef9ec7ba8a7648f28a0a775adc7505ae5272b8797df158c5f27c0` |
| `full-suite-coverage-files-722883c4.tsv` | `c9d52ebb11a52a18ae37c005c9e0a5adaaeb7defa42c9f1ffc3668f192f9490c` |
| `pibo2-pool-release-722883c4.json` | `3f9bd80fbd41fe7f82acae6e7132d65a2b64d05f187157397d0c2a0dd3a941c8` |
| `headful-722883c4/headful-acceptance-summary-722883c4.json` | `b14b3c36a0525565b12ca0bd777a7ce3310bbaad7b3ccf3d9cae0f16a1dc8d80` |
| `headful-722883c4/headful-slash-responsive.json` | `2d5ab3179300078aee3cdfe7b5b74994a1aa7d74fe7a288346f1355d923046a3` |
| `headful-722883c4/visible-recovery-60s.json` | `423b90f137be50a6b25047e581803deb9a7028afc0c96bdf260b2d51c36e614b` |
| `headful-722883c4/pibo2-pool-release-final.json` | `9947875e0039821e461b0db538a0a60bef8844156a4b26bca44c761bf89d666f` |
| `soak-3250-722883c4-light-final/run.json` | `593560b13385ebaedfe4c8d17d0ac58d20f197e6064619cc8dd9dc80058ddcaf` |
| `soak-3250-722883c4-light-final/sessions-3250/summary.json` | `fed89bd7ae7932a5d9d5e9af090c19ba84098b4dcbfac12403594c445a08379b` |
| `soak-3250-722883c4-light-final/soak-audit.json` | `14937ae978c437ad26fd2927ef4cc8e69b8b22f91e5b0fb71749a8a2f2819ed3` |
| `soak-3250-722883c4-light-final/SHA256SUMS` | `f7195c24e8dabb8218cf20ec76b5435698e3cc330e6b8a7ed856cf05acbf77d3` |
| `../latency-continuation-2026-09-13/final-candidate-c917b544/pasko70-pibo-1.7.2.tgz` | `ae1e8cb84658441168ea2bd78ba0f9454b628a1b71fa6d74a10ec5ceec992261` |
| `../latency-continuation-2026-09-13/final-candidate-c917b544/final-candidate-audit.json` | `2142dc56b48a39a24054133350863dfb529a1f18a78f9f9036ad1966b2fda09f` |
| `../latency-continuation-2026-09-13/final-candidate-c917b544/ap08-pibo2/summary.json` | `6e58ee548b4b7799cf15a0fb3b244acc29d2cf10257c0f231dc558f4adba1291` |
| `../latency-continuation-2026-09-13/final-candidate-c917b544/public-health-status.json` | `6cebba9667a2d03bf44a5f23e5e03376c7ae776481350c34ba21f9ce038b756f` |
| `../latency-continuation-2026-09-13/final-candidate-c917b544/SHA256SUMS` | `68306fd8a3c580b515462a5bac792de84a5c2bf4e1f1fbd90f23658f47a2f558` |

# Historischer Ausführungsverlauf

Die folgenden Abschnitte bewahren Baseline, Zwischenreviews und den ersten Handoff als Herkunft. Wo sie Kandidat `09375bbb` oder frühere Commits nennen, ersetzen sie nicht den oben dokumentierten Abschlussstand.

# Reproduzierbare Basis

| Merkmal | Nachgewiesener Stand |
|---|---|
| Historischer Pibo2-Kandidat | `0fe71c72a1d3bcb3b0d06295d323317a452b367a` laut Untersuchungszuordnung |
| Implementierungsbasis nach Fetch | `upstream/dev`, `cac4dcd03945b9754db7be9ab2ab4324f10c335c` |
| Integrations-Worktree | `latency-integration`; eigener Dockerworker `pibo-dev-latency-integration` |
| Controller-Ressourcen vor Produktlast | 15.6 GiB RAM, 8 GiB Swap, etwa 107 GiB freier Plattenplatz; zusätzlich laufende Agentarbeit, daher keine isolierte Performanceaussage |
| Paketversion des Ausgangsstands | `1.7.2` |
| Dev-Lockfile SHA-256 | `fd534c04db9e115c5fce5afeb324cdec4e72f667a747a01f8b92881ffa62b357` |
| Abhängigkeitsabgleich | Alle installierten, plattformrelevanten Pflichtpakete stimmen mit dem Dev-Lockfile überein; Pi AI/Coding Agent `0.85.0`, Vite `8.2.2` |

Der Controller-Checkout selbst steht auf einem anderen Commit und enthält fremde uncommittete Arbeit. Er ist kein Implementierungs- oder Testkandidat. Die Umsetzung benutzt ausschließlich die getrennten, von `upstream/dev` angelegten Worktrees.

# Historische Belege

126 reguläre Dateien mit insgesamt 14.393.748 Bytes wurden aus den zwei temporären Untersuchungsverzeichnissen in eine private, nur für den Controller-Benutzer zugängliche Ablage übernommen. Das [SHA-256-Manifest](/reports/artifacts/latency-reliability-2026-09-12/historical-manifest.json) hat den Hash `e5c3ab7f1bc2de94546030f3a54a838d092d688b9e71914739e2f058803d2c2b`. Die Rohdateien bleiben privat; im Repository stehen das Inhaltsmanifest und gezielt geprüfte Ableitungen. Das spätere Baseline-Buildarchiv ist ein separater, zusätzlicher Vergleichsgegenstand und verändert dieses historische Manifest nicht.[^historical-archive]

# Ausgeführte lokale Baseline

`docker exec -w /workspace pibo-dev-latency-integration npm run build` ist erfolgreich. Die bestehenden Vite-Warnungen über große Bundles bleiben sichtbar; sie sind keine neue Regression und ersetzen keine Bootstrap- oder Nutzbarkeitsmessung.

Der folgende Testlauf besteht mit **26 Tests, 0 Fehlern**, Dauer laut Testläufer 4.810 ms:[^baseline-tests]

```text
docker exec -w /workspace pibo-dev-latency-integration node --test \
  test/output-identity-regression.test.mjs \
  test/storage-worker-isolation.test.mjs \
  test/chat-ui-app-signal-status.test.mjs \
  test/message-command-dispatcher.test.mjs
```

Die Tests bestätigen die vorhandene Basis für Identität, Storage-Admission/Workerersatz, Statuspatches und Dispatcher. Zusätzliche neue Ablaufprüfungen für Caller-Stall, Recovery-Generationen, Arbeitsbudgets und echte integrierte Last sind noch erforderlich.

Zusätzlich bestehen `test/telemetry-capture.test.mjs` und `test/cold-fork-candidates.test.mjs` mit **8 Tests, 0 Fehlern**, zusammen 2.945 ms. Das [Protokoll](/reports/artifacts/latency-reliability-2026-09-12/baseline-existing-capabilities.log) bestätigt die vorhandenen scoped Captures und passiven Runtime-Lesezugriffe. Insgesamt sind damit 34 fokussierte Baseline-Tests ausgeführt. `npm run docs:validate` besteht mit 0 Fehlern/0 Warnungen; `npm run docs:validator:test` besteht mit [84 Tests](/reports/artifacts/latency-reliability-2026-09-12/docs-validator-tests.log).

Der headful Browser im Integrationsworker öffnet die Baseline-App mit Worker-Authentifizierung. Der sichtbare Composer ist vorhanden und nicht deaktiviert; `document.readyState` ist `complete`. Dieses leere lokale Fixture ist ein Funktionscheck, kein Nachweis für das große Referenzprofil oder die Zeitbudgets.

# Erster Paketreview: AP-08

Worker-Commit `686a78e0a87d7f534170bbac210f380ef7b03e95` führt ein begrenztes DLQ-Listing und einen killbaren Auditprozess ein. Der Orchestrator hat einen reproduzierbaren Restfehler gefunden: Bei Sessionfilter und gültigem, über 64 KiB großem Jobpayload wird ein passender Job übersprungen und dennoch `complete: true` mit leerem Ergebnis geliefert. Die Reproduktion im Audit-Dockerworker verwendet einen einzigen `output-persistence`-Job für `ps_target` mit 80.000 Zeichen synthetischem Body. Ergebnis: erwartete Treffer 1, zurückgegeben 0, `scannedRows: 1`, `complete: true`. Das verletzt die Unvollständigkeitszusage; AP-08 ist deshalb noch nicht abgenommen.

Ein zweiter offener Reviewpunkt betrifft die konservative Deep-Audit-Arbeitszählung: Tabellegrößen werden zwischen getrennten Leseabfragen gecacht. Ohne einen stabilen, zeitlich begrenzten Read-Snapshot können parallele Inserts diese Obergrenze ungültig machen. Dafür sind ein Ablaufnachweis und gegebenenfalls eine Korrektur erforderlich.

# Integrierte Teilfixes

Commit `6c0e4ff6170f987cf6252589c8dadf6a7e79a5de` berechnet Runtime-Status und Telemetrie einmal je Gateway-Antwort und verwendet sie in beiden kompatiblen Ausgabeansichten. Die Regression für 1/10/20 Runtimes schlägt gegen die Baseline wegen zwei statt eines Reads fehl. Nach TypeScript-Kompilierung bestehen `test/gateway-restart-safety.test.mjs` und `test/gateway-restart-approval.test.mjs`: 34 Tests, 0 Fehler, 4.769,7 ms. Dieser AP-03-Teilfix ersetzt noch keinen vollständigen inkrementellen Projektor.

Commit `eace24be3b893512d649de96b30a34ed713d91ae` stellt den Dispatcher auf monotone Wakeups, 4,5–5,5 Sekunden Recovery-Jitter mit früherer Lease-Erneuerung und höchstens zwölf Claims pro Event-Loop-Durchlauf um. Der neue Idle- und Burst-Test schlägt gegen die Baseline fehl; der Burst verarbeitet dort alle 100 Claims vor dem nächsten Event-Loop-Turn. Nach Kompilierung bestehen `test/message-command-dispatcher.test.mjs` und `test/message-command-store.test.mjs`: 24 Tests, 0 Fehler, 2.714,1 ms. Bestehende Zwei-Prozess-, Crash-, Fairness-, Control-Reserve- und Fencing-Prüfungen bleiben grün. Browser-Receipts und die integrierte Lastabnahme von AP-06 bleiben offen.

Beide Teilfixes wurden vom Orchestrator im Integrationsworker ausgeführt, während die delegierte Agent-Steuerung nicht erreichbar war. Die aktuellen Verträge in [Kapazität](/specs/runtime/capacity-and-scheduling.md) und [Gateway](/specs/gateway/web-host-and-channel.md) dokumentieren ausschließlich diese implementierten Änderungen.

Commit `81847c71989feb1645220daea1ded02f370ecb73` ergänzt die fehlende reine AP-04-Vergleichsfunktion. Sie prüft den tatsächlichen gespeicherten Fingerprint anhand des unabhängig rekonstruierten vollständigen Events, bevor sie die vorhandene v2-Semantik und Delivery-ID vergleicht. Unvollständige Daten, unbekannte Versionen und überschrittene Budgets führen zu getrennten nicht reparierbaren Ergebnissen. Die Funktion verändert keine Daten. `test/output-collision-classification.test.mjs`, `test/output-identity-regression.test.mjs` und `test/data-v2-ingest-service.test.mjs` bestehen nach Kompilierung mit 24 Tests, 0 Fehlern, 494,9 ms. Dieselbe Abhängigkeit liegt als `799ab6ca` im Audit-Branch, damit dessen bereits begonnene Integration abschließen kann.

Die historische Datei `dead-letters.json` ist leer; die gesicherten Aggregate und der vorhandene Detailbeleg erlauben deshalb noch keine vollständige Zuordnung sämtlicher 31 Fehler und 32 Diagnosen. Es wurde keine historische Reparatur angewendet. Die begonnenen read-only Pibo2-Abfragen beschränken sich auf verfügbare Index-/Spaltenmetadaten und sind keine Kandidatenabnahme.

Der Nutzer hat die laufende Ausführung anschließend auf einen gesunden Zwischenstand begrenzt und zuletzt auch den zügigen Abschluss des Audit-Agenten angeordnet. Seine bestehende Session erhielt über den regulären lokalen Pibo-Client eine `/steer`-Nachricht zum Einstellen der Umsetzung, Sichern vorhandener Arbeit und Schreiben der Übergabe. Der Gateway bestätigte die Zustellung an den aktiven Turn. Die MCP-Verbindung meldete weiterhin `Auth required`; es wurden keine Credentials verändert und keine neue Agent-Session erzeugt. Noch nicht akzeptierte Ergebnisse bleiben getrennt vom geprüften Integrationsstand.

Der Audit-Agent hat seinen Auftrag beendet. Sein Branch ist bis `c18890c157ac4490272b3fb6e450740e440bdc70` committed und sauber. Er enthält die begrenzte Diagnose, AP-04-Reconciliation, einen lokalen Lastharness und abschließende Reviewkorrekturen. Der vor dem Abschlusscommit ausgeführte Server-TypeScript-Build und [41 fokussierte Tests](/reports/artifacts/latency-reliability-2026-09-12/audit-worker-tests.log) bestehen; danach wurde kein Code verändert. Diese Änderungen wurden noch nicht in `latency-integration` übernommen; die früheren AP-08-Reviewpunkte gelten ohne erneute Abnahme nicht als geschlossen. Die private Abschlussablage enthält den Orchestrierungsstand, den gesicherten Zwischenpatch, die vollständige Agent-Übergabe `latency-remediation-audit-handoff.md`, Referenzmessungen, synthetische Referenzdatenbanken und Git-Bundles für die spätere Fortsetzung.

Die separat gesicherte frühere Referenzmessung des Auditworkers verwendete 1.000 Admission-Proben und 30 Status-/Health-Paare je Profil. Bei 3.250 beziehungsweise 10.000 Sessions lag Status-p95 bei 2.114,894 beziehungsweise 7.562,6244 ms; beide Profile melden `passed: false`. Diese Baselinewerte betreffen den damaligen Gateway und eine frühere Harness-Fassung, nicht den geprüften Integrationsstand oder eine finale kombinierte Kandidatenabnahme. Der vollständige Bericht hält Messversionen, fehlgeschlagene Zwischenschritte und alle verbleibenden Grenzen fest.

## Gemeinsame Prüfung des Zwischenstands

Auf dem integrierten Code bei `81847c71989feb1645220daea1ded02f370ecb73` bestehen `npm run build` und `npm run typecheck` vollständig im Dockerworker. Der gemeinsame [Testlauf](/reports/artifacts/latency-reliability-2026-09-12/checkpoint-product-tests.log) umfasst die sieben oben benannten Gateway-, Dispatcher-/Store- und Identität-/Ingest-Suiten: **82 Tests, 0 Fehler**, 6.525,6 ms. Die bestehenden Vite-Bundlewarnungen bleiben unverändert sichtbar. Eine vollständige Root-Testsuite oder Releaseabnahme wurde nicht ausgeführt.

Die Dokumentationsindizes haben keinen Drift; `npm run docs:validate` besteht mit 800 Markdown-Pfaden, 0 Fehlern und 0 Warnungen. Die Dokumentationsvalidator-Tests bestehen erneut mit 84 Tests, 0 Fehlern. Zum Sessionabschluss werden alle sechs taskeigenen Dockerworker nach Sicherung ihrer relevanten Artefakte über die Compute-CLI freigegeben. Ihre Worktrees und Branches bleiben erhalten. Alle zehn delegierten Sessions melden `idle`; es läuft kein Sub-Agent mehr.

# Ausführungsunterbrechung der Agent-Anbindung

Mehrere delegierte Läufe endeten nach erfolgreichen Dateireads mit `Request was aborted`; einzelne erste Starts meldeten `Runtime capacity wait deadline exceeded`. Die Starts wurden daraufhin gestaffelt. Diese Beobachtungen beweisen noch keine einheitliche Ursache aller Abbrüche. Der Auditworker konnte einen Commit erstellen und am Lastharness weiterarbeiten.

Ab etwa 05:43 UTC lehnt die aktuelle native Session ihre Pibo-MCP-Steuerung mit `Auth required` ab. Die inspizierte Implementierung begrenzt Tool-Credentials auf 30 Minuten (`src/tools/credential-registry.ts`) und sieht eine Prozess-/Credentialerneuerung vor dem nächsten Turn vor (`src/agent-runtimes/codex-native/adapter.ts`, `ensureFreshResourcesForTurn`). Der zeitliche Verlauf passt dazu; Credentialwerte wurden weder ausgegeben noch verändert. Der Arbeitsstand ist für die Fortsetzung gesichert. Controller-Gateway, Zugangsschutz und Laufzeitgrenzen wurden nicht verändert.

Nach der vom Nutzer gemeldeten Authentifizierungsreparatur liefern die bestehende MCP-Verbindung und ein erneuter `pibo_run_status`-Aufruf weiterhin `Auth required`. Die reguläre Debug-CLI bestätigt einen weiter arbeitenden Audit-Agent und neun wiederverwendbare ruhende Sessions. Der Nutzer begrenzt die weitere Parallelität auf zwei bis höchstens drei Agents. Bis die Tool-Verbindung erneuert ist, laufen unabhängige lokale Umsetzung und Tests weiter; es wurden keine Ersatzsessions erzeugt und keine Authentifizierungsgrenzen umgangen.

# Paket- und Befundstatus

| Befunde / Pakete | Besitzer | Stand |
|---|---|---|
| F1/F3/F9; AP-01/02/09 Client, AP-06/07 UI | Browser | Ruhend; Implementierung offen |
| F2/F4/F5/F9; AP-03/06/07 und Serveranteile AP-02/09 | Gateway / Integration | AP-03-Doppelberechnung und AP-06-Dispatcher lokal integriert; weitere Serverarbeit offen |
| F6/F7; AP-04/05 | Storage | Reiner Klassifizierer integriert; Producer-/Worker-Arbeit und historische Zuordnung offen |
| F8; AP-08, AP-04 Debug-Reconciliation | Audit | Separater Branch bis `c18890c1` gesichert; Review und Integration offen |
| SQLite-/Detailcapture-Hypothese; AP-11 | Capture | Ruhend; kontrollierter Vergleich offen |
| Alle Befunde; AP-00/10 | Integration | Historische Belege gesichert, Docker-Baseline gebaut und fokussiert geprüft |

# Offene integrierte Gates

- Quell-/Testnachweis für jede Pflichtanforderung PIBO-LATENCY-001 bis PIBO-LATENCY-012 und jeden Teilbefund F1 bis F9.
- Review der Paketimplementierungen, Integration und vollständige relevante lokale Prüfungen des gemeinsamen Kandidaten.
- Authentifizierte headful Browserprüfung auf Desktop und 390×844, Revision-/Auth-/Offline-/Freeze-Fehlerfälle und messbare Composer-Nutzbarkeit.
- Unverändertes committed Paket mit SHA-256 und relevante Pibo2-Prüfungen; der Deploymentpool war beim read-only Vorabcheck frei, wurde noch nicht belegt.
- 10.000 deterministische Admission-Proben als gemeinsames strengeres Profil beider Pläne, gepaarte Status-/Health-Messungen, kontrollierter Capture-Vergleich mit drei wechselnden Wiederholungen, mindestens 30 Minuten echte Multi-Agent-Last, native Kaltstarts und zwei Stunden gemischter Dauerlauf.
- Geräteprüfung auf dem tatsächlich betroffenen Smartphone. Gerät, Browser/PWA und Zugriff sind angefragt; Desktopemulation beweist diesen Fall nicht.

[^remediation-plan]: Verbindliche Pakete, Budgets, Schutzregeln und Definition of Done des beauftragten Plans.
[^historical-archive]: Private Originale; Hashmanifest für Herkunft und spätere Nachprüfung.
[^baseline-tests]: Unverändertes Docker-Testprotokoll des ausgeführten Ausgangsstands.
[^continuation-evidence]: Private, checksumgebundene Fortsetzungsartefakte für Kandidatenidentität, Testsuite, Last, Pibo2, Native, MCP und Lease-Freigabe; keine Credentials werden veröffentlicht.

> Status: Superseded for runtime decisions. Chat Web was cut over to V2-only on 2026-05-09. Use `plans/2026-05-09-chat-data-v2-cleanup-and-session-unification-plan.md` and the final V2 removal report for current architecture.

# Production Deploy Report — Chat Data V2 Follow-up

Datum: 2026-05-08  
Branch: `main`  
Production Commit: `0d410f97f9c5864b6962b4289e4626e1f51fe053`  
Production URL: `https://pibo.neuralnexus.me/apps/chat`

## Zusammenfassung

Der Chat-Data-V2-Follow-up-Stand wurde nach Dev-Validierung auf `main` gemerged, nach `origin/main` gepusht und auf Production deployed. Der Production Gateway wurde neu gestartet und ist erreichbar.

Live sind insbesondere:

- leichtere Chat-Navigation über `/api/chat/navigation`
- Session-Mark-Read über `POST /api/chat/sessions/:id/read`
- Session-Wechsel ohne Bootstrap im bereits geladenen Frontend
- Tool-Call-Live-Streaming-Fix für progressive Tool-Argument-Updates
- V2-Datenmodell-Foundation und Shadow-Ingest-Code
- `pibo data compare --session <id> --json`

Wichtig: Der V2 Shadow Write ist auf Production noch **nicht aktiviert**, weil `PIBO_DATA_V2_WRITE` aktuell nicht gesetzt ist. Production läuft also mit neuem Code, liest/schreibt aber produktiv weiterhin über Legacy als Primary.

## Commits / Git-Stand

Production `main` und `origin/main` zeigen auf:

```text
0d410f97f9c5864b6962b4289e4626e1f51fe053
```

Relevante Merge-/Feature-Commits:

```text
0d410f9 Merge branch 'chat-data-v2-followup-navigation-ingest-2026-05-08'
b50b624 Restore live tool call streaming
e8bc087 Document chat data V2 follow-up completion
d5e83e0 Continue chat data V2 shadow ingest
2d592ea Document chat data V2 handover
9b52c05 Add chat data V2 store foundation
```

Der lokale Worktree `/root/code/pibo` ist sauber:

```text
## main...origin/main
```

## Validierung vor Production

Vor dem Production Deploy erfolgreich ausgeführt:

```bash
npm run typecheck
npm test
```

Testergebnis:

```text
342 pass
0 fail
```

Dev Server wurde vorher validiert und vom Nutzer manuell geprüft.

## Production Deploy

Ausgeführt:

```bash
./scripts/deploy-web.sh
```

Ergebnis:

- Build erfolgreich.
- Stable Backup aktualisiert.
- Backup installiert unter `/root/.pibo/stable`.
- Backup Commit: `0d410f97f9c5864b6962b4289e4626e1f51fe053`.

Gateway Restart:

- `/usr/bin/pibo` hatte weiterhin Permission-Probleme.
- Restart wurde über das Repo-CLI ausgeführt.
- Der automatische Safe Restart blockte zunächst wegen aktiver Session-Erkennung.
- Da der Nutzer explizit bestätigt hatte, dass keine relevanten anderen Prozesse laufen und ein Production Restart erlaubt ist, wurde der Restart mit expliziter Force-Bestätigung durchgeführt.

## Production Health Check

Nach dem Neustart geprüft:

```bash
npm run --silent dev -- gateway web status
curl -sS -m 10 https://pibo.neuralnexus.me/health
```

Ergebnis:

```text
reachable: yes
mode: prod
```

Health:

```json
{"status":"ok","mode":"main"}
```

Aktueller Gateway-Status beim letzten Check:

```text
runtime sessions: 1
active yielded runs: 0
restart safety: blocked
```

Die eine aktive Session ist sehr wahrscheinlich diese laufende Agent-Session selbst.

## Production Asset Check

Die Production Chat App liefert das neue Bundle aus:

```text
/apps/chat/assets/index-Qz8DNj_c.js
```

Im Production-Bundle wurden folgende neue Marker gefunden:

```text
/api/chat/navigation      present
/api/chat/sessions/       present
TOOL_CALL_ARGS            present
sourceEventType           present
```

Damit sind die Navigation- und Tool-Streaming-Änderungen im ausgelieferten Production-Frontend enthalten.

## API Smoke Checks

Unauthenticated API-Endpunkte verhalten sich korrekt geschützt:

```text
GET /api/chat/navigation -> 401 {"error":"Unauthenticated"}
GET /api/chat/catalog    -> 401 {"error":"Unauthenticated"}
GET /apps/chat           -> 200 HTML
```

## V2 Shadow Write Status

Der neue V2 Shadow-Ingest-Code ist deployed, aber noch nicht aktiv.

Geprüft:

- `PIBO_DATA_V2_WRITE` ist im Production-Gateway-Prozess nicht gesetzt.
- `/root/.pibo/pibo.sqlite` existiert aktuell nicht.
- Legacy Store `/root/.pibo/web-chat.sqlite` existiert und ist weiterhin Primary.

Das bedeutet:

```text
Production Code:     V2-fähig
Production Reads:    Legacy primary
Production Writes:   Legacy primary
V2 Shadow Writes:    aktuell aus
```

## Warum V2 Shadow Write noch aus ist

Der Shadow Write ist bewusst feature-geflagt. Er sollte erst nach dieser Production-Stabilisierung separat aktiviert werden:

```bash
PIBO_DATA_V2_WRITE=1
```

oder je nach gewünschter Semantik:

```bash
PIBO_DATA_V2_WRITE=user
PIBO_DATA_V2_WRITE=all
```

Nach Aktivierung würde Production zusätzlich in `/root/.pibo/pibo.sqlite` schreiben, während Legacy weiterhin Primary bleibt.

## Empfohlene nächste Schritte

1. Nutzer testet Production normal weiter:
   - Session-Wechsel
   - Room-Wechsel
   - Tool Calls mit progressiven Args
   - Agent Designer
   - normale Chat Runs
2. Wenn Production stabil wirkt, V2 Shadow Write in einer separaten kontrollierten Session aktivieren.
3. Danach gezielt prüfen:
   - Existenz und Wachstum von `/root/.pibo/pibo.sqlite`
   - Logs auf Shadow-Ingest-Fehler
   - `pibo data inventory --json`
   - `pibo data compare --session <session-id> --json`
4. Erst nach stabilen Shadow-Daten V2 Primary Reads planen.

## Nicht erledigt / bewusst offen

- V2 Shadow Write auf Production wurde nicht aktiviert.
- Kein V2 Primary Read Cutover.
- Kein Backfill/Importer ausgeführt.
- Kein Production-Datenvergleich mit echten V2-Daten möglich, weil `pibo.sqlite` noch nicht existiert.

## Fazit

Die neue Architektur ist auf Production deployed und aktiv, soweit sie nicht durch Feature Flags abgeschaltet ist. Die Performance-/Navigation-Verbesserungen und der Tool-Call-Streaming-Fix sind im Production-Bundle vorhanden. Der nächste größere Schritt ist die kontrollierte Aktivierung des V2 Shadow Writes.

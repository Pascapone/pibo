# Implementation Plan: `pibo compute` CLI

## Ziel
Eine schlanke CLI innerhalb von Pibo (`pibo compute`), mit der der Agent frische Docker-Worker-Container anfordert, darauf arbeitet und sie danach freigibt. Kein Daemon, kein HTTP, kein Pool-Reuse. One-Time-Use pro Aufgabe.

## Philosophie
- **So dünn wie möglich:** Die CLI ist ein Wrapper um `docker build / run / ps / stop / rm`.
- **Zustandlos:** Der einzige Zustand ist der Docker-Daemon selbst (laufende Container + lokale Images).
- **Agent ist Root:** Er hat direkten Docker-Zugriff. Wir geben ihm nur ein Werkzeug mit Konventionen.
- **Einfacher Cleanup:** Ein `reap`-Befehl + Cronjob fängt vergessene Container ein.

## Architektur

```
┌─────────────┐      pibo compute spawn        ┌─────────────────┐
│   Agent     │ ─────────────────────────────> │  Docker Worker  │
│  (root)     │      {id, host, ports}         │  pibo-worker-01 │
└──────┬──────┘                                │  (:4789 random) │
       │                                       └─────────────────┘
       │ docker exec / tcp connect                    │
       │                                            │
       │ Arbeit (Gateway, Browser-Use, etc.)         │
       │                                            │
       │ pibo compute release pibo-worker-01         │
       │ ───────────────────────────────────────────>│
       │ docker stop + rm                            │
```

## Commands

### `pibo compute spawn [--name <name>] [--profile <profile>]`
1. Prüft, ob `pibo:latest` existiert und aktuell ist (Smart Build).
2. Falls nicht: baut das Image automatisch aus dem aktuellen Workspace (`<REPO>`).
3. Erzeugt einen neuen Container mit eindeutigem Namen: `pibo-worker-<uuid>`.
4. Mapped Ports dynamisch (Docker wählt Host-Port):
   - Container:4789 → Host:??? (Gateway)
   - Container:56663 → Host:??? (Browser-Use CDP)
5. Setzt Docker-Labels:
   - `pibo.compute.role=worker`
   - `pibo.compute.createdAt=<iso>`
   - `pibo.compute.owner=<agent-id>` (optional)
6. Startet automatisch `pibo gateway` im Container (auf `0.0.0.0:4789`).
7. Gibt JSON aus:
   ```json
   {
     "id": "pibo-worker-a1b2c3",
     "image": "pibo:latest",
     "gatewayHost": "<host-ip>",
     "gatewayPort": 49153,
     "cdpPort": 49154,
     "connect": "docker exec -it pibo-worker-a1b2c3 bash"
   }
   ```

### `pibo compute rebuild`
- Erzwingt ein frisches `docker build -t pibo:latest .` aus dem aktuellen Workspace.
- Nutzt Docker-Build-Cache, aber invalidiert bei geänderten Dateien.
- Der Agent ruft dies auf, wenn er weiß, dass sich Code geändert hat und er einen frischen Stand braucht.

### `pibo compute list`
- Zeigt alle Container mit Label `pibo.compute.role=worker`.
- Spalten: ID, Name, Status, Ports, Alter.
- Kurzform für den Agent, damit er weiß, was gerade läuft.

### `pibo compute release <id>`
- Führt `docker stop <id>` und `docker rm <id>` aus.
- Erfolgsmeldung oder Fehler, falls der Container nicht existiert.
- **Dies ist der normale Pfad.** Der Agent bekommt die Instruktion, dies am Ende auszuführen.

### `pibo compute reap [--max-age-minutes <n>]`
- Findet alle Worker-Container, die älter als `n` Minuten sind (Default: 60).
- Stoppt und entfernt sie.
- Gibt eine Liste der aufgeräumten Container zurück.
- **Soll regelmäßig via Cronjob laufen**, z. B.:
  ```
  */10 * * * * /usr/bin/pibo compute reap --max-age-minutes 60 >> /var/log/pibo-reap.log 2>&1
  ```

## Smart Build Logik

Die CLI entscheidet selbst, ob ein Build nötig ist:

```
spawn wird aufgerufen
  │
  ├─> Image pibo:latest existiert?
  │    ├─ Nein → docker build ausführen
  │    └─ Ja → Hash der Quelldateien prüfen
  │              ├─ Hash geändert → docker build ausführen
  │              └─ Hash gleich → bestehendes Image nutzen
  │
  └─> Container starten
```

**Hash-Berechnung:**
- Einfacher Ansatz: Prüfe `git rev-parse HEAD` (wenn Git-Repo). Wenn Commit-Hash sich geändert hat → rebuild.
- Fallback: MD5/SHA256 über alle `src/**/*.{ts,tsx,json}` Dateien. Schnell genug für den Anwendungsfall.
- Der Hash wird in einem lokalen File `.pibo/compute-image-hash` gespeichert.

**Wichtig:**
- `npm install` und `npm run build` laufen im Build. Das dauert 2–3 Minuten.
- Der Agent sieht den Build-Output und wartet, bis er fertig ist.

## Technische Details

### Port-Mapping
Docker dynamische Ports:
```bash
docker run -d \
  --name pibo-worker-xxx \
  -p 4789 \
  -p 56663 \
  --label pibo.compute.role=worker \
  --label pibo.compute.createdAt=2026-05-03T10:00:00Z \
  pibo:latest gateway
```
Der Host-Port wird danach per `docker port pibo-worker-xxx 4789` ausgelesen.

### Kein Reuse (V1)
- Nach `release` ist der Container weg.
- `reap` entfernt alte Container hart.
- Keine "idle"-Zustände, kein Warmhalten.

### Wie der Agent den Worker nutzt
Der Agent hat mehrere Optionen:
1. **Shell:** `docker exec -it pibo-worker-xxx bash` → Er arbeitet direkt im Container.
2. **Gateway:** Er verbindet sich per TCP zum `gatewayPort` auf dem Host und spricht das Pibo-Gateway-Protokoll.
3. **Web:** Wenn der Worker-Web-Host braucht, mapped die CLI zusätzlich Port 4788.

Für V1 empfehlen wir Option 1 (`docker exec`) als einfachsten Einstieg.

### Cleanup-Fallback
Wenn der Agent `release` vergisst:
- Cronjob alle 10 Minuten.
- `reap` prüft `docker ps --filter label=pibo.compute.role=worker --format ...`.
- Vergleicht `createdAt` mit aktueller Zeit.
- Löscht alles über dem Limit.

### Keine Mounts
- Der Container bekommt eine **Kopie** des Codes zum Build-Zeitpunkt.
- Kein `-v <REPO>:/app`. Der Agent soll nicht den Host-Code anfassen können.
- Isoliert, sicher, reproduzierbar.

## Dateien & Aufwand

| Datei | Beschreibung | Aufwand |
|-------|-------------|---------|
| `src/compute/cli.ts` | Haupt-CLI-Logik (spawn, rebuild, list, release, reap) | ~2h |
| `src/compute/docker.ts` | Hilfsfunktionen: build, run, ps, stop, rm, port, hash | ~1.5h |
| `src/bin/pibo.ts` | Subcommand `compute` registrieren | ~15min |
| `context/compute-worker.md` | Agent-Instruktionen | ~15min |
| Tests (manuell) | Spawn → Arbeit → Release prüfen | ~30min |

**Gesamtaufwand: ~0,5–1 Tag.**

## Agent-Instruktionen (Context-File)

Dem Agent wird über ein Context-File oder Skill erklärt:

> **Pibo Compute Worker**
>
> Wenn du eine isolierte Umgebung brauchst (z. B. um den Gateway neu zu starten oder parallel zu arbeiten):
> 1. Führe `pibo compute spawn` aus.
> 2. Du erhältst eine JSON-Antwort mit `id`, `gatewayHost` und `gatewayPort`.
> 3. Verbinde dich mit dem Worker (z. B. `docker exec -it <id> bash` oder via Gateway-Port).
> 4. Wenn du fertig bist, führe **unbedingt** `pibo compute release <id>` aus.
> 5. Wenn du unsicher bist, welche Worker laufen, nutze `pibo compute list`.
> 6. Wenn du gerade Code geändert hast und einen frischen Stand brauchst, rufe vor `spawn` `pibo compute rebuild` auf.

## Nächster Schritt
Sag mir, ob der Plan passt, dann baue ich `src/compute/cli.ts` und die Integration.

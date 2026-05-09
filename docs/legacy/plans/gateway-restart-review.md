# Review-Dokument: Gateway-Restart CLI

## Kontext

**Pibo** läuft auf einem Gateway als permanenter Daemon-Prozess (`pibo gateway`).  
Wenn das Pibo-Paket lokal geändert und neu installiert wird, muss der Gateway-Daemon neu gestartet werden, damit der neue Code geladen wird.

## Problem

Bisher gab es nur `pibo gateway`, das den Daemon **im Vordergrund** startet.  
Wenn man den Gateway neu starten wollte, musste man:
1. Den Prozess per Hand beenden (SIGINT / SIGKILL)
2. Manuell `pibo gateway` erneut aufrufen

Das ist problematisch, weil:
- Bei einem **Kill (SIGKILL)** ist die Verbindung weg und der Gateway bleibt tot – man muss manuell neu starten.
- Bei einem **Remote-Gateway** (SSH, Container, Cloud-VM) verliert man die Session komplett.
- Es gibt keine Möglichkeit zu prüfen, ob der Gateway überhaupt läuft.

## Ziel

Ein `pibo gateway` CLI-Modul mit Steuerfunktionen:
- `start` – Daemon starten (altes Verhalten, default)
- `status` – Prüfen, ob der Daemon läuft (Port + PID)
- `restart` – **Sanften Neustart** durchführen:
  1. Laufenden Prozess per SIGTERM beenden
  2. Warten, bis der Port frei ist (Retry-Polling)
  3. Neuen Prozess als **detached** Hintergrundprozess starten
  4. Warten, bis der Port wieder erreichbar ist (Retry-Polling)
  5. Erfolgsmeldung ausgeben

So kann man nach einem Library-Update `pibo gateway restart` aufrufen und der Gateway kommt automatisch wieder hoch – ohne dass man manuell eingreifen muss.

## Geänderte Dateien

| Datei | Was wurde geändert |
|-------|-------------------|
| `src/gateway/pidfile.ts` | **Neu** – PID-Datei-Utils (`~/.pibo/gateway.pid` lesen/schreiben/löschen) |
| `src/gateway/cli.ts` | **Neu** – Gateway-CLI-Logik mit `status`, `restart`, `start` |
| `src/gateway/server.ts` | `writeGatewayPid()` beim Start, `clearGatewayPid()` bei SIGINT/SIGTERM |
| `src/cli.ts` | `pibo gateway` an neues Modul weiterleiten, Hilfe-Text aktualisiert |

## Architektur-Highlights

### PID-File
- Pfad: `~/.pibo/gateway.pid`
- Beim Start schreibt der Server seine PID hinein.
- Beim sauberen Stop (SIGINT/SIGTERM) wird sie gelöscht.
- `restart` kann so den Prozess zuverlässig finden und `SIGTERM` senden.

### Restart-Ablauf
```
pibo gateway restart
  → Prüft Port-Erreichbarkeit
  → Liest PID aus Datei
  → Sendet SIGTERM an PID
  → Pollt Port bis frei (max. 10s)
  → Löscht PID-File
  → Spawn: node pibo gateway (detached, stdio: ignore)
  → Pollt Port bis erreichbar (max. 30s)
  → Gibt Erfolgsmeldung aus
```

### Zirkuläre Abhängigkeit vermieden
- `pidfile.ts` enthält nur Datei-IO, keine CLI- oder Server-Logik.
- `cli.ts` importiert `pidfile.ts` und `server.ts` (lazy).
- `server.ts` importiert nur `pidfile.ts`.

## Testen

```bash
# Status prüfen (sollte "not running" sagen)
npx tsx src/bin/pibo.ts gateway status

# Gateway starten (im Vordergrund, für Test)
npx tsx src/bin/pibo.ts gateway

# In einer zweiten Shell: Restart durchführen
npx tsx src/bin/pibo.ts gateway restart

# Ergebnis: Gateway wurde gestoppt und ist automatisch wieder erreichbar
```

## Offene Punkte (optional für Review)

- Soll `restart` auch `pibo gateway:web` unterstützen, oder nur den TCP-Gateway?
- Soll es einen `--force` Flag geben, der nach Timeout `SIGKILL` sendet?
- Soll die PID-File einen Timestamp enthalten, um veraltete Einträge zu erkennen?

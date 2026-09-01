---
type: "Historical Record"
title: "Gateway Fallback Recovery"
description: "Preserves the original body as a deprecated historical record without promoting historical claims."
tags: ["historical","legacy","migration"]
status: "deprecated"
authority: "historical"
migration_lineage:
  source_path: "docs/legacy/gateway-fallback-recovery.md"
  source_commit: "0cd6a73449e1b555fa6e590d839d7e03c8dc98bf"
  baseline_commit: "2aef244301f5d181624662fdad53e18e83e80bd9"
  baseline_blob_oid: "fa10c3f558b857fdb5495acd2e017f66e313312c"
  source_bytes: 8560
  source_sha256: "8d22b25d2988aa8304540793544ef9e1b8a2453601ee3f03a4855645e782262b"
  source_body_sha256: "8d22b25d2988aa8304540793544ef9e1b8a2453601ee3f03a4855645e782262b"
generated:
  by: "process:pibo-okf-c-legacy"
  at: "2026-09-01T09:50:26Z"
---
# Gateway Fallback Recovery

Dokumentation des automatischen Failover-Systems für das Pibo Gateway.

## Übersicht

Das Gateway Fallback Recovery System stellt sicher, dass die Pibo Web App (`pibo.neuralnexus.me`) auch dann erreichbar bleibt, wenn das Haupt-Gateway abstürzt oder nicht mehr startet. Ein stabiler Fallback-Prozess springt automatisch ein und wird über denselben DNS-Namen bedient.

## Architektur

```
┌─────────────────────────────────────────────────────────────┐
│                        User Browser                          │
│              https://pibo.neuralnexus.me                     │
└──────────────────────┬──────────────────────────────────────┘
                       │
                       ▼
┌─────────────────────────────────────────────────────────────┐
│                        nginx (Reverse Proxy)                 │
│  upstream pibo_web_backend {                                 │
│      server 127.0.0.1:4788 max_fails=1 fail_timeout=5s;     │
│      server 127.0.0.1:4791 backup;                          │
│  }                                                           │
│  proxy_next_upstream error timeout http_500 http_502        │
│                         http_503 http_504;                  │
└──────────────────────┬──────────────────────────────────────┘
                       │
          ┌────────────┴────────────┐
          │                         │
          ▼                         ▼
┌─────────────────┐      ┌─────────────────────┐
│  Main Gateway   │      │  Fallback Gateway   │
│  pibo-web       │      │  pibo-web-fallback  │
│  Port 4788/4789 │      │  Port 4790/4791     │
│                 │      │                     │
│  ~code/pibo/    │      │  ~/.pibo/stable/    │
│  (aktiver Code) │      │  (stabiler Backup)  │
└─────────────────┘      └─────────────────────┘
```

## Komponenten

### 1. Main Gateway (`pibo-web.service`)

- **Source**: `~/code/pibo` (aktive Entwicklung)
- **Ports**: TCP 4789 (Gateway), HTTP 4788 (Web App)
- **PID-File**: `~/.pibo/gateway.pid`
- **Status**: `systemctl status pibo-web.service`

### 2. Dev Gateway (`pibo-web-dev.service`)

- **Source**: `~/code/pibo` (aktiver Code)
- **Ports**: TCP 4809 (Gateway), HTTP 4808 (Web App)
- **PIBO_HOME**: `~/.pibo-dev`
- **Public Origin**: `https://dev.pibo.neuralnexus.me` (`www.dev.pibo.neuralnexus.me` leitet dorthin weiter)
- **Auth**: echte Better Auth/Google OAuth Konfiguration, kein Docker Dev Auth
- **TLS**: Let's Encrypt Zertifikat für `dev.pibo.neuralnexus.me` und `www.dev.pibo.neuralnexus.me`
- **Status**: `systemctl status pibo-web-dev.service`

Nutze den Dev Gateway für Host-Level-Tests vor Production: `./scripts/deploy-web-dev.sh`.

### 3. Fallback Gateway (`pibo-web-fallback.service`)

- **Source**: `~/.pibo/stable/` (isolierter Backup-Build)
- **Ports**: TCP 4790 (Gateway), HTTP 4791 (Web App)
- **PID-File**: `~/.pibo/gateway-fallback.pid`
- **Status**: `systemctl status pibo-web-fallback.service`
- **Start-Trigger**: `OnFailure=pibo-web-fallback.service` auf `pibo-web.service`

### 4. nginx Upstream-Backup

```nginx
upstream pibo_web_backend {
    server 127.0.0.1:4788 max_fails=1 fail_timeout=5s;
    server 127.0.0.1:4791 backup;
}

proxy_next_upstream error timeout http_500 http_502 http_503 http_504;
proxy_next_upstream_tries 2;
proxy_pass http://pibo_web_backend;
```

Wenn Port 4788 nicht mehr antwortet, routet nginx automatisch auf 4791.

### 5. Health-Check Endpunkt

Sowohl Main als auch Fallback liefern auf `/health`:

```json
{"status": "ok", "mode": "main"}
```

bzw. im Fallback:

```json
{"status": "ok", "mode": "fallback"}
```

### 5. Visueller Fallback-Banner

Wenn die Chat-UI über den Fallback bedient wird, zeigt sie oben einen roten Banner:

> ⚠️ Recovery Mode: Main gateway is down. You are connected to a fallback instance.

## CLI-Befehle

### Backup verwalten

```bash
# Backup aus aktuellem Source erstellen/aktualisieren
pibo gateway backup install

# Backup aus bestimmtem Pfad erstellen
pibo gateway backup install /pfad/zum/source

# Backup-Info anzeigen
pibo gateway backup status

# Backup aktualisieren (auf aktuellen Stand)
pibo gateway backup update

# Backup löschen
pibo gateway backup remove
```

### Fallback manuell steuern

```bash
# Fallback starten (Ports 4790/4791)
pibo gateway fallback start

# Fallback stoppen
pibo gateway fallback stop

# Fallback mit Force-Kill stoppen
pibo gateway fallback stop --force

# Fallback Status
pibo gateway fallback status

# Fallback neu starten
pibo gateway fallback restart
```

### Main Gateway steuern

```bash
# Main Gateway starten
pibo gateway start

# Web-Gateway starten
pibo gateway:web

# Status prüfen
pibo gateway status

# Stoppen
pibo gateway stop

# Graceful Restart
pibo gateway restart
```

## systemd Services

| Service | Beschreibung | Command |
|---------|-------------|---------|
| `pibo-web-dev.service` | Dev-Gateway | `systemctl status pibo-web-dev.service` |
| `pibo-web.service` | Haupt-Gateway | `systemctl status pibo-web.service` |
| `pibo-web-fallback.service` | Fallback-Gateway | `systemctl status pibo-web-fallback.service` |

### Automatischer Failover

Wenn `pibo-web.service` mit einem Fehler ausgeht, startet systemd über `OnFailure=pibo-web-fallback.service` automatisch den Fallback.

### Manuelles Recovery

```bash
# Nach Reparatur des Main-Gateways:
systemctl start pibo-web.service
systemctl stop pibo-web-fallback.service
```

## Erstinstallation / Setup

1. **Backup erstellen** (einmalig oder bei Änderungen):
   ```bash
   cd ~/code/pibo
   npm run build
   pibo gateway backup install
   ```

2. **Services aktivieren**:
   ```bash
   sudo systemctl enable pibo-web.service
   sudo systemctl enable pibo-web-fallback.service
   ```

3. **Main starten**:
   ```bash
   sudo systemctl start pibo-web.service
   ```

## Troubleshooting

### Fallback startet nicht automatisch

Prüfe, ob `OnFailure` im Service-File gesetzt ist:
```bash
systemctl cat pibo-web.service | grep OnFailure
```

### nginx routet nicht zum Fallback

Prüfe die Upstream-Konfiguration:
```bash
grep -A 5 "upstream pibo_web_backend" <nginx-config>/pibo
```

### Backup ist veraltet

Aktualisiere das Backup nach jeder größeren Code-Änderung:
```bash
pibo gateway backup update
```

### Ports sind belegt

Prüfe, welcher Prozess auf den Ports lauscht:
```bash
ss -tlnp | grep -E "4788|4789|4790|4791"
```

### Gateway läuft nicht

Prüfe Logs:
```bash
journalctl -u pibo-web.service -n 50
journalctl -u pibo-web-fallback.service -n 50
```

## Dateien & Pfade

| Datei / Pfad | Zweck |
|-------------|-------|
| `~/code/pibo` | Aktiver Sourcecode |
| `~/.pibo/stable/` | Backup-Source + Build |
| `~/.pibo/gateway.pid` | PID des Main-Gateways |
| `~/.pibo/gateway-fallback.pid` | PID des Fallback-Gateways |
| `<systemd-dir>/pibo-web.service` | Main Service Definition |
| `<systemd-dir>/pibo-web-fallback.service` | Fallback Service Definition |
| `<nginx-config>/pibo` | nginx Upstream-Config |
| `src/gateway/backup.ts` | Backup-Logik (Code) |
| `src/gateway/fallback.ts` | Fallback-Logik (Code) |
| `src/web/channel.ts` | Health-Check Route (Code) |
| `src/apps/chat-ui/src/App.tsx` | Fallback-Banner UI (Code) |

## Sicherheitshinweise

- Der Fallback-Prozess läuft **nativ auf dem Host** (nicht in Docker), damit er das System zur Reparatur bearbeiten kann.
- Beide Prozesse (Main und Fallback) greifen auf dasselbe `~/.pibo/`-Verzeichnis zu (Sessions, Auth, Skills, Context-Files).
- Ein paralleler Betrieb auf denselben SQLite-DBs wird durch die Port-Trennung vermieden — es läuft immer nur einer aktiv.
- Der Fallback lauscht auf `0.0.0.0:4791`, ist aber nur über den nginx-Reverse-Proxy (mit Auth) öffentlich erreichbar.

# Implementation Plan: Pibo Compute Pool mit Traefik

## Ziel
- **Traefik** ersetzt nginx als zentraler Reverse-Proxy (SSL, Routing, Dashboard).
- Ein **Pool Manager** verwaltet Pibo-Docker-Worker dynamisch (Spawn, Zuweisung, Idle-Reaper).
- Ein Agent fordert Compute über eine zentrale Stelle an und bekommt einen Worker zur Verfügung gestellt.

## Architektur

```
                       Internet
                          │
                   ┌──────┴──────┐
                   │   Traefik   │  ← 80/443, SSL-Terminierung, ACME
                   │  (Docker)   │    Router: pibo.neuralnexus.me
                   └──────┬──────┘    Router: worker-*.neuralnexus.me
                          │
         ┌────────────────┼────────────────┐
         │                │                │
    ┌────┴────┐     ┌────┴────┐     ┌─────┴──────┐
    │Pibo Host│     │Pibo Pool│     │Pibo Worker │
    │Web Host │     │ Manager │     │ Container  │
    │(:4788)  │     │(:4790)  │     │(:4789 dyn) │
    └─────────┘     └────┬────┘     └────────────┘
                         │
                    docker.sock
                         │
              ┌──────────┴──────────┐
              │      Docker         │
              │   (Container-Pool)  │
              └─────────────────────┘
```

**Kommunikationsfluss Agent → Worker:**
1. Agent ruft Pool Manager `POST /allocate` auf.
2. Manager prüft Pool, spawnt ggf. neuen `pibo:latest`-Container mit dynamischem Host-Port.
3. Manager antwortet mit `{ host, gatewayPort, containerId, webUrl }`.
4. Agent connectet sich **direkt** zum Worker-Gateway (`host:gatewayPort`).
5. Nach Arbeit: Agent ruft `POST /release` auf.
6. Manager markiert Container als idle. Reaper fährt ihn nach Timeout herunter.

## Komponenten & Aufwand

### 1. Traefik als nginx-Ersatz (~2–3h)

**Was Traefik übernimmt:**
- SSL-Terminierung via ACME (Let's Encrypt, HTTP-Challenge)
- Reverse-Proxy zur Pibo Web Host (Chat Web App, Auth)
- Optionales HTTP-Routing für Worker-Web-Apps via Docker-Labels
- Dashboard auf einem internen Port

**Was zu tun ist:**
1. Traefik als Docker-Container starten (`docker-compose.traefik.yml`).
2. ACME-Storage konfigurieren (JSON-Datei für Zertifikate).
3. Router für `pibo.neuralnexus.me` → Pibo Web Host (`127.0.0.1:4788` oder Docker-Netzwerk).
4. `X-Forwarded-*`-Header setzen (Pibo Web Host erwartet diese für `createRequestBaseURL`).
5. nginx stoppen & deaktivieren (`systemctl disable nginx`).
6. DNS bleibt unverändert.

**Wichtiger Tradeoff:**
- Pibo Web Host bindet aktuell auf `127.0.0.1:4788`. Traefik (im Docker-Container) kann nicht direkt auf den Host-Loopback zugreifen.
- **Lösung A (empfohlen):** Pibo Web Host auf `0.0.0.0:4788` umstellen und per Firewall (ufw) auf localhost + Traefik beschränken.
- **Lösung B:** Pibo Host-Prozess ebenfalls in Docker laufen lassen, dann ist Traefik→Pibo über Docker-Netzwerk trivial.

### 2. Pibo Pool Manager (~4–6h)

Neuer, schlanker TypeScript-Service (`services/pool-manager/`).

**API:**
```
POST /pool/allocate
  Body:  { profile?: string, owner?: string }
  Response: { id, containerId, host, gatewayPort, webUrl, status }

POST /pool/release
  Body:  { id }
  Response: { released: true }

GET  /pool/status
  Response: { containers: [...] }
```

**Pool-Logik:**
- **Zustände:** `starting` → `ready` → `allocated` → `idle` → `stopping`
- **Min Pool:** 1 Container immer warmhalten (optional).
- **Max Pool:** konfigurierbar (z. B. 10).
- **Idle Timeout:** z. B. 10 Minuten nach `release`, dann `docker stop`.
- **Health Check:** Prüft, ob Gateway-Port erreichbar ist, bevor Container als `ready` gilt.

**Docker-Interaktion:**
- Nutzt `dockerode` (Node.js Docker API-Client).
- Container-Start mit `pibo:latest`.
- Dynamische Port-Zuweisung: Docker weist Host-Port für `4789/tcp` zu.
- Traefik-Labels (optional): `traefik.enable=true`, `traefik.http.routers...`, damit Worker-Web-Apps über Subdomain erreichbar sind.

**Wo läuft der Manager?**
- Als Docker-Container mit `docker.sock`-Mount.
- Port `4790` (oder konfigurierbar) für die API.

### 3. Pibo Worker Container (~1h)

- Basierend auf bestehendem `pibo:latest`.
- Keine Code-Änderungen nötig, aber `docker-compose.yml` oder Pool-Manager-Payload muss `host: '0.0.0.0'` für Gateway und Web Host setzen (damit Traefik und Agenten von außen/connecten können).
- Optional: Traefik-Labels im `docker run`-Aufruf für HTTP-Routing.

### 4. Pibo-Integration (~2–3h)

Neues Plugin oder Erweiterung des Core-Plugins:

**Gateway Actions:**
```
/compute allocate   → POST an Pool Manager, Antwort an Agent
/compute release    → POST an Pool Manager
/compute status     → GET an Pool Manager
```

**Agent-Context:**
- Neue Snippet im Agent-Context: "Wenn du Compute brauchst: `/compute allocate`, dann verbinde dich mit `gatewayHost:gatewayPort`.

**Alternative (einfacher):**
- Kein Plugin, sondern der Pool-Manager als externer Service. Agent nutzt `pibo_run_start` mit einem HTTP-Client-Tool, um den Manager aufzurufen.
- Das ist schlanker und trennt die concerns.

## Umsetzungsschritte & Reihenfolge

### Phase 1: Traefik einrichten (2–3h)
1. `docker-compose.traefik.yml` erstellen.
2. Traefik-Config (`traefik.yml`) mit Entrypoints `web` (80) und `websecure` (443).
3. ACME-Provider (`letsencrypt`) mit HTTP-Challenge.
4. Statischer Router für `Host(\`pibo.neuralnexus.me\`)` → `http://host.docker.internal:4788`.
5. Pibo Web Host prüfen: erkennt `X-Forwarded-Host` und `X-Forwarded-Proto` korrekt (Code tut das bereits).
6. nginx stoppen, Traefik starten, DNS/SSL testen.

### Phase 2: Pool Manager bauen (4–6h)
1. Ordner `services/pool-manager/` anlegen.
2. `package.json`, `tsconfig.json`, Docker-Image.
3. `dockerode` installieren.
4. Pool-States + Timer-Logik implementieren.
5. REST-Endpoints (`/allocate`, `/release`, `/status`).
6. Container-Health-Check (Port erreichbar?).
7. Idle-Reaper (setInterval, prüft idle-Container).
8. `docker-compose.pool-manager.yml`.

### Phase 3: Pibo Host-Anpassung (30min)
1. `DEFAULT_WEB_CHANNEL_HOST` prüfen: entweder auf `0.0.0.0` setzen oder via Env-Var steuerbar machen.
2. Sicherstellen, dass Gateway-Server ebenfalls auf `0.0.0.0` lauscht (für Worker-Container).

### Phase 4: Integration & Test (2–3h)
1. Pool Manager starten.
2. Manuell testen: `curl /allocate`, Container prüfen, `curl /release`, Reaper testen.
3. Agent-Workflow simulieren: allocate → connect → work → release.
4. Mehrere Worker parallel testen.

## Offene Entscheidungen (vor Start)

1. **Soll der Pibo Host-Prozess (Web Host + Gateway) auf dem Host bleiben oder auch in Docker?**
   - *Auf Host:* Traefik muss `host.docker.internal:4788` nutzen (funktioniert auf Linux nur mit extra-Flag).
   - *In Docker:* Sauberer, Traefik→Pibo über Docker-Netzwerk, aber der Host-Gateway (für lokale Agenten) braucht Port-Mapping.
   - **Empfehlung:** Host-Prozess bleibt zunächst auf dem Host, Traefik routed via `host.docker.internal` oder explizite Host-IP.

2. **Sollen Worker-Web-Apps über Traefik öffentlich routbar sein?**
   - *Ja:* Traefik-Labels pro Worker, Subdomain-Routing (`worker-01.pibo.neuralnexus.me`).
   - *Nein:* Worker sind nur intern über Host:Port erreichbar. Einfacher, weniger Angriffsfläche.
   - **Empfehlung:** Erst nein, nur Gateway-Port-Zuweisung. Traefik-Labels optional in Phase 5.

3. **Authentifizierung Pool-Manager-API?**
   - *Einfach:* Nur localhost / internes Docker-Netzwerk, kein Auth.
   - *Sicherer:* Simple API-Key-Header.
   - **Empfehlung:** API-Key, wird via Env-Var konfiguriert.

## Risiken

- **Certbot→ACME-Migration:** Bestehende Zertifikate sind an nginx gebunden. Traefik holt neue Zertifikate über ACME. Das ist automatisch, aber es gibt Rate-Limits bei Let's Encrypt (max 50 Zertifikate pro Domain pro Woche – hier unwahrscheinlich relevant).
- **Host-Loopback-Problem:** Traefik im Docker-Container kann nicht auf `127.0.0.1` des Hosts zugreifen. `host.docker.internal` funktioniert auf Linux erst ab Docker 20.10 mit `--add-host` oder expliziter Docker-Config.
- **TCP-Gateway vs. Traefik:** Der Pibo Gateway-Protokoll ist raw TCP. Traefik kann TCP routen, aber das erfordert SNI oder feste Ports und ist für dynamische Worker unpraktisch. Daher: Pool-Manager managed Gateway-Ports direkt, Traefik kümmert sich nur um HTTP(S).

## Gesamteinschätzung

- **Aufwand gesamt:** ~1,5–2 Tage für einen Entwickler.
- **Komplexität:** Mittel. Keine externen Abhängigkeiten außer Docker.
- **Gewinn:** Agenten bekommen isolierte, reproduzierbare Compute-Umgebungen; Gateway-Restarts unterbrechen nicht die Agent-Session; parallele Worker möglich.

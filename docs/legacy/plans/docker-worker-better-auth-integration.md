# Plan: Docker Compute Worker mit Better-Auth-Integration

## Ziel

Der Docker Compute Worker soll optional auch einen vollständigen Better-Auth-Flow unterstützen — inkl. echtem OAuth-Login, Rollen und Session-Management. Das ermöglicht produktionsnahes End-to-End-Testing im Container.

## Aktueller Stand

- Der Worker startet jetzt korrekt mit `gateway:web`.
- Ein **Dev-Auth Plugin** (`src/plugins/dev-auth.ts`) ist implementiert und wird im Container automatisch aktiviert (`PIBO_DEV_AUTH=1`).
- Der Dev-Auth simuliert den kompletten OAuth-Flow mit einem festen User (`dev@pibo.local`). Keine Google-Credentials nötig.
- Die Host-`.pibo/config.json` wird als Read-Only-Mount nach `/app/.pibo/config.json` übergeben, damit Better-Auth theoretisch funktionieren würde.
- Die `baseURL` in der Config zeigt aber auf die öffentliche URL (`https://pibo.neuralnexus.me`), nicht auf den dynamischen Worker-Port. Das blockiert den echten OAuth-Callback.

## Offene Probleme (für echtes Better-Auth)

1. **OAuth-Redirect-URL passt nicht.** Google OAuth leitet nach `https://pibo.neuralnexus.me/api/auth/callback/google` zurück. Der Worker läuft aber auf `http://<host-ip>:<random-port>`. Der Callback landet daher beim Host-Gateway, nicht im Container.
2. **Keine HTTPS-Terminierung.** Better-Auth erwartet `https` für OAuth. Der Worker läuft auf `http`.
3. **Session-DB ist ephemeral.** Die SQLite-DB für Auth liegt im Container und wird beim Release gelöscht. Das macht persistente Sessions unmöglich.
4. **Rollen / RBAC fehlt.** Die aktuelle Config hat nur `allowedEmails`. Rollen und Berechtigungen sind noch nicht implementiert.

## Bereits erledigt

### Dev-Auth Plugin (für Agenten-Tests ohne echtes OAuth)

- `src/plugins/dev-auth.ts` — Neues Plugin mit simuliertem OAuth-Flow und Cookie-Session.
- `src/gateway/web.ts` — Lädt Dev-Auth statt Better Auth wenn `PIBO_DEV_AUTH=1`.
- `scripts/docker-entrypoint.sh` — Setzt `PIBO_DEV_AUTH=1` automatisch für `gateway:web`.
- `src/compute/docker.ts` — Mountet Host-Config (`~/.pibo/config.json` → `/app/.pibo/config.json`).

Der Dev-Auth ist aktiv und funktioniert. Agenten können sich per `curl -L /api/auth/sign-in/social` einloggen und bekommen eine Session als `dev@pibo.local`.

## Offene Schritte (für echtes Better-Auth)

### 1. Dynamische `baseURL` pro Worker

Beim Spawnen soll `spawnWorker` die dynamische `baseURL` ermitteln (z. B. `http://<host>:<webPort>`) und in den Container injecten.

Optionen:
- **A:** Die Host-Config vor dem Mount kopieren, `baseURL` überschreiben, temporäre Config mounten.
- **B:** Einen Env-Var `PIBO_AUTH_BASE_URL` setzen und `createBetterAuthService` so anpassen, dass er den Env-Var bevorzugt.
- **C:** Einen dedizierten `pibo.compute.authBaseURL`-Label verwenden und einen Reverse-Proxy (z. B. Traefik oder nginx) pro Worker auf dem Host betreiben.

**Empfehlung: B + A kombiniert.**
- `spawnWorker` setzt `PIBO_AUTH_BASE_URL=http://<detectedHost>:<webPort>`.
- `createBetterAuthService` liest `process.env.PIBO_AUTH_BASE_URL` vor der Config-Datei.
- Zusätzlich kopiert `spawnWorker` die Host-Config in ein Temp-Verzeichnis, patcht `baseURL`, und mountet die gepatchte Version.

### 2. HTTPS / Reverse-Proxy

Für produktionsnahes Testing sollte der Host einen Reverse-Proxy bereitstellen, der `https://pibo.neuralnexus.me/worker-<id>` auf den jeweiligen Worker-Port routed.

Kurzfristig reicht ein selbst-signiertes Zertifikat im Container oder ein Host-nginx mit `proxy_pass`.

### 3. Persistente Auth-DB

Die Auth-SQLite sollte auf dem Host persistiert werden, damit Sessions zwischen Worker-Neustarts erhalten bleiben.

```
-v ~/.pibo/auth-worker-<id>.sqlite:/app/.pibo/auth.sqlite
```

Und in der Config `auth.databasePath` auf `/app/.pibo/auth.sqlite` setzen.

### 4. Rollen & RBAC

- `src/auth/better-auth.ts` erweitern um eine `role`-Spalte in der User-Tabelle.
- `src/auth/types.ts` erweitern um `PiboAuthRole`.
- `src/web/auth.ts` um `requireRole()` ergänzen.
- Config-Schlüssel `auth.defaultRole` und `auth.roles` einführen.
- UI-Seite für Rollenverwaltung in `src/apps/chat-ui/src/settings/` ergänzen.

### 5. Auto-Login für Agenten (optional)

Da der Agent selbst keinen Browser-Benutzer hat, könnte `pibo compute spawn` automatisch einen Service-Account-Token generieren und in den Container injecten, sodass der Agent direkt authentifizierte Requests machen kann.

## Umsetzungspriorität

| # | Schritt | Aufwand | Impact | Status |
|---|---------|---------|--------|--------|
| - | Dev-Auth Plugin | Klein | Hoch | ✅ Erledigt |
| 1 | Dynamische `baseURL` | Klein | Hoch — OAuth funktioniert | Offen |
| 2 | Persistente Auth-DB | Klein | Mittel — Sessions bleiben erhalten | Offen |
| 3 | Reverse-Proxy / HTTPS | Mittel | Mittel — Produktionsnahes Testing | Offen |
| 4 | Rollen & RBAC | Groß | Hoch — Zukunftssicher | Offen |
| 5 | Auto-Login | Mittel | Niedrig — Agenten-Komfort | Offen |

## Akzeptanzkriterien

- [x] Dev-Login funktioniert im Container-Worker (`/api/auth/sign-in/social` → Session-Cookie).
- [ ] OAuth-Login über Google funktioniert im Container-Worker.
- [ ] Sessions persistieren über `compute release` + `compute spawn` hinaus.
- [ ] Rollen können über Config oder UI vergeben werden.
- [ ] Nicht-autorisierte Requests auf geschützte Endpunkte werden mit 401/403 abgelehnt.
- [ ] Der Agent kann sich automatisch im Container authentifizieren (Service-Account).

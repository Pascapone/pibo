# Test-Review: Better-Auth-Konfiguration und Web-Gateway-Auth-Boundary

Datum: 2026-05-10 16:48 Europe/Berlin

## Untersuchter Bereich

Dieser Lauf betrachtet den Auth-Konfigurationskern rund um Better Auth und dessen Übergang zum Web-Gateway:

- `src/auth/better-auth.ts`
- `src/config/config.ts`
- `src/gateway/web.ts`
- `src/plugins/better-auth.ts`
- `test/better-auth-config.test.mjs`
- `test/config.test.mjs`
- `test/web-gateway.test.mjs`

Nicht betrachtet wurden echte OAuth-Browser-Flows, Better-Auth-Datenbankmigrationen gegen persistente Host-Daten und UI-Login-Flows. Diese gehören in spätere Integrations- oder Deployment-Suites.

## Ausgeführte begrenzte Checks

```bash
node --test test/better-auth-config.test.mjs
node --test test/config.test.mjs test/web-gateway.test.mjs
```

Ergebnis: Beide Subsets waren erfolgreich. Das erste Subset lief in ca. 0,6 s, das zweite in ca. 1,6 s. Das sind gute, schnelle Entwicklungs-Checks für Änderungen an Auth-Konfiguration und Gateway-Host-Auflösung.

## Was die vorhandenen Tests gut abdecken

- `test/better-auth-config.test.mjs` prüft wichtige Fail-Closed-Regeln für `createBetterAuthService()`:
  - leere `allowedEmails` werden abgelehnt,
  - zu kurze `auth.secret`-Werte werden abgelehnt.
- `createTrustedOrigins()` ist für die wichtigste lokale Matrix abgedeckt:
  - `localhost` und `127.0.0.1` erzeugen Loopback-Aliase,
  - explizit konfigurierte Origins bleiben erhalten.
- `test/config.test.mjs` deckt den Config-Roundtrip für `auth.baseURL`, `auth.allowedEmails` und `auth.trustedOrigins` ab und schützt Secret-Masking.
- `test/web-gateway.test.mjs` ist sinnvoll granular: Es prüft reine Resolver-Funktionen ohne Serverstart und schützt damit die Better-Auth-/Dev-Auth-Grenze:
  - öffentliche Bind-Adresse bei nicht-lokaler `auth.baseURL`,
  - Loopback-Bind-Adresse bei lokaler `auth.baseURL`,
  - expliziter Host gewinnt,
  - `PIBO_DEV_AUTH=1` aktiviert Dev-Auth nicht stillschweigend.

## Schwächen und Risiken

1. **`createBetterAuthService()` wird nur auf zwei Pflichtfelder negativ getestet.**
   `src/auth/better-auth.ts` verlangt auch `auth.baseURL`, `auth.googleClientId` und `auth.googleClientSecret`. Für diese Pflichtfelder fehlen kleine Negativtests. Das ist riskant, weil Gateway-Startfehler bei falsch gesetzter Host-Konfiguration sonst erst spät auffallen.

2. **Allowed-Email-Normalisierung ist implizit, aber nicht direkt geschützt.**
   `createAllowedEmailSet()` trimmt und lowercased E-Mails. Die Laufzeit-Autorisierung in `getSession()` vergleicht ebenfalls lowercased. Ein fokussierter Test könnte sicherstellen, dass `" YOU@EXAMPLE.COM "` dieselbe Policy ergibt wie `you@example.com`. Aktuell wird nur `[]` abgelehnt.

3. **Fehlerhafte oder nicht-lokale `baseURL`-Varianten sind lückenhaft.**
   `createTrustedOrigins()` und `defaultWebHost()` hängen stark an `new URL(baseURL)`. Tests decken gültige Loopback-URLs ab, aber nicht:
   - `http://[::1]:4788` als Eingabe,
   - nicht-lokale DNS-Namen,
   - invalides `baseURL` im Gateway-Resolver-Fallback.
   `defaultWebHost()` fällt bei invalidem URL-String auf Loopback zurück; das kann sinnvoll sein, sollte aber explizit als Fail-Closed-Verhalten getestet werden.

4. **Better-Auth-Instanzierung öffnet Datenbanken in Tests.**
   `test/better-auth-config.test.mjs` ruft `createBetterAuthService()` mit Default-Datenbankpfad auf. Die negativen Tests werfen zwar vor `createDatabase()`, positive Service-Instanzierungstests würden aber schnell Host-State berühren, wenn sie keinen `databasePath: ":memory:"` oder Temp-Pfad setzen. Diese Grenze sollte in künftigen Tests ausdrücklich eingehalten werden.

5. **Plugin-Registrierung ist nur indirekt geschützt.**
   `src/plugins/better-auth.ts` ist sehr dünn, aber es gibt keinen Mini-Test, der bestätigt, dass `createPiboBetterAuthPlugin(options)` genau einen Auth-Service mit dem erwarteten Namen registriert oder dass Optionen bis `createBetterAuthService()` durchgereicht werden. Bei künftiger Auth-Plugin-Erweiterung wäre das eine kleine, billige Contract-Sicherung.

## Fehlende oder anzupassende Tests

Empfohlene kleine Ergänzungen, ohne große Integration:

- In `test/better-auth-config.test.mjs`:
  - `createBetterAuthService()` wirft für fehlende `baseURL`, `googleClientId`, `googleClientSecret` und `secret` je eine klare Fehlermeldung.
  - `createTrustedOrigins("http://[::1]:4788")` liefert alle drei Loopback-Origins.
  - konfigurierte Origins werden dedupliziert, wenn sie mit der `baseURL`-Origin übereinstimmen.
- In `test/config.test.mjs`:
  - `auth.databasePath` wird gespeichert, gelesen und gelöscht.
  - JSON-Array-Eingabe für `auth.allowedEmails` und `auth.trustedOrigins` wird geparst; ungültige JSON-Array-Werte werden abgelehnt.
- In `test/web-gateway.test.mjs`:
  - invalide `auth.baseURL` im Resolver bleibt bei `127.0.0.1`.
  - eine nicht-lokale DNS-Base-URL wie `https://pibo.example.test` bindet auf `0.0.0.0`.
  - `resolveWebGatewayAuthMode({ devAuth: true })` wirft außerhalb Docker. Dieser Test ist umgebungsabhängig, sollte also nur laufen, wenn `/.dockerenv` nicht existiert oder über eine injizierbare Runtime-Erkennung entkoppelt werden.

## Empfohlene granulare Test-Kommandos/Subsets

Für schnelle Entwicklung an diesem Bereich:

```bash
node --test test/better-auth-config.test.mjs
node --test test/config.test.mjs test/web-gateway.test.mjs
```

Für Änderungen, die Login-Credentials oder Provider-Status berühren:

```bash
node --test test/login-actions.test.mjs test/model-catalog.test.mjs test/model-defaults.test.mjs
```

Für spätere Integrationsabsicherung nach Build, aber nicht als Standard-Inner-Loop:

```bash
npm run build && node --test test/better-auth-config.test.mjs test/config.test.mjs test/web-gateway.test.mjs
```

## Konkrete nächste Schritte

1. `test/better-auth-config.test.mjs` um reine Negativtests für alle Pflichtoptionen erweitern; keine Datenbank öffnen.
2. `createTrustedOrigins()`-Matrix um IPv6-Loopback und Deduplikation ergänzen.
3. `test/config.test.mjs` um `auth.databasePath` und JSON-Array-Parsing ergänzen.
4. `test/web-gateway.test.mjs` um invalides `baseURL`-Fallback und nicht-lokale DNS-Base-URL ergänzen.
5. Falls Dev-Auth-Runtime-Erkennung weiter wachsen soll: `isDockerRuntime()` testbarer machen, statt Docker/Host-Zustand direkt in Unit-Tests zu erzwingen.

## Umgesetzt am 2026-05-11 11:54 Europe/Berlin

- Bereich: Granulare Better-Auth-Konfigurationstests für leere Pflichtoptionen sowie `createTrustedOrigins()`-Matrix für IPv6-Loopback und Deduplikation konfigurierter Origins.
- Geänderte Dateien: `test/better-auth-config.test.mjs`, `docs/reports/cron-test-reports/2026-05-10-1648-better-auth-config.md`.
- Ausgeführte Kommandos: `npm run build && node --test test/better-auth-config.test.mjs`.
- Ergebnis: Build erfolgreich; `test/better-auth-config.test.mjs` mit 5/5 Tests bestanden.
- Verbleibende offene Punkte: Weitere empfohlene Subsets für `auth.databasePath`, JSON-Array-Parsing in `test/config.test.mjs`, Gateway-Resolver-Base-URL-Fälle und Plugin-Registrierung sind noch offen.

# Implementierungsplan: Isolierter Pibo2 Deployment Pool

**Status:** Implemented; public DNS/TLS activation pending
**Created:** 2026-08-22
**Updated:** 2026-08-23
**Source:** Nutzeranfrage in Pibo Session `ps_d0fb25d0-2b64-467c-b79d-a1d058db598b`
**Related docs:** `docs/specs/capabilities/docker-compute-workers.md`, `docs/specs/capabilities/standalone-docker-runtime.md`, `docs/project/compute-browser-resource-operating-model.md`, `docs/project/session-live-previews.md`

## 1. Kurzentscheidung

Pibo2 soll einen generischen, lease-basierten Docker-Deployment-Pool erhalten. Jeder Agent kann ein exakt gebautes Pibo-Paket hochladen, einen freien Slot reservieren und eine eigene HTTPS-URL verwenden, ohne den kanonischen Pibo2-Gateway oder andere Agenten neu zu starten.

Die empfohlene V1-Architektur ist:

- feste Slots wie `slot-01.<deployment-pool-base-host>` bis `slot-10.<deployment-pool-base-host>`;
- Wildcard-DNS und ein gemeinsames TLS-Zertifikat;
- nginx bleibt der zentrale TLS- und HTTP-Edge;
- jeder aktive Slot besitzt einen eigenen Pibo-Container, eigenes `PIBO_HOME`, eigene Datenbanken und einen eigenen Workspace;
- normale Pibo-Authentifizierung pro Slot, kein öffentlich weitergeleiteter Local-Auth-Modus;
- ein gemeinsames Runtime-Image statt eines Docker-Images pro Agent;
- content-addressed npm-Paket-Artefakte statt branch-spezifischer Images;
- eine standardmäßige Lease von 60 Minuten mit `renew`, `release` und automatischem Reaper;
- zehn vorbereitete Hostnamen, aber auf dem aktuellen Host zunächst höchstens drei gleichzeitig aktive Deployments;
- Browservalidierung erfolgt standardmäßig mit dem bestehenden beaufsichtigten Host-Browser gegen die jeweilige öffentliche Slot-URL.

## 2. Warum dieser Plan

### Aktuelles Problem

Pibo2 ist heute ein einzelnes, gemeinsam genutztes Deployment. Wenn mehrere Agenten gleichzeitig Kandidaten installieren oder `pibo-web.service` neu starten, überschreiben oder unterbrechen sie sich gegenseitig.

### Bereits vorhandene Bausteine

Pibo besitzt bereits einen großen Teil der benötigten Grundlagen:

- Docker Compute Workers mit Labels, Ressourcenlimits, Listing, Release und Reap-Planung;
- einen automatischen Resource Reaper im Gateway;
- checksum-verifizierte, versionierte npm-Kandidateninstallationen;
- Machine Auth für API- und Browserzugriff;
- Session Live Previews mit isolierten Hostnamen, Ticket-Austausch, Cookie-Isolation, HTTP/SSE/WebSocket-Proxying und Ablaufzeiten;
- nginx als stabilen TLS-Edge auf Pibo2.

Session Live Previews lösen allerdings nicht allein das Full-Pibo-Deployment-Problem. Sie sind für beliebige lokale Webanwendungen ausgelegt und entfernen absichtlich Pibo-Authentifizierungs-Cookies vor dem Upstream. Eine vollständige Pibo-Instanz hinter diesem Proxy könnte deshalb nicht einfach ihren eigenen normalen Auth-Flow verwenden. Die Deployment-Slots erhalten daher direkte, auth-fähige Hostnamen. Die bestehende Preview-Domain und deren TLS/DNS-Infrastruktur können trotzdem gemeinsam genutzt werden.

### Aktuelle Host-Grenzen

Der am 2026-08-22 geprüfte Pibo2-Host hat:

- 4 CPU-Kerne;
- 7,7 GiB RAM und 8 GiB Swap;
- ungefähr 83 GiB freien Plattenspeicher;
- Docker 29.4.3;
- ein bestehendes `pibo:latest`-Image von ungefähr 4,29 GB;
- nginx auf 80/443;
- einen aktiven Gateway-eigenen Resource Reaper.

Zehn gleichzeitig aktive Full-Pibo-Container mit den heutigen Compute-Grenzen von bis zu 2 GiB pro Worker wären auf diesem Host nicht sicher. V1 soll zehn feste DNS-/TLS-Slots vorbereiten, den aktiven Pool aber zunächst auf drei Instanzen begrenzen. Die Erhöhung erfolgt nur nach einem gemessenen Belastungstest oder einem Host-Upgrade.

## 3. Ziele und Nicht-Ziele

### Ziele

- Mindestens zwei Agenten können gleichzeitig unterschiedliche Pibo-Kandidaten testen.
- Ein Agent kann selbständig einen Slot anfordern, prüfen, verlängern und freigeben.
- Jeder Slot hat eine stabile, eigene HTTPS-URL.
- Änderungen oder Neustarts in einem Slot beeinflussen weder den kanonischen Pibo2-Gateway noch andere Slots.
- Eine vergessene Lease wird spätestens nach ihrer Ablaufzeit automatisch beendet und freigegeben.
- Verwaiste Container, Slot-Daten, Logs und Artefakte werden kontrolliert bereinigt.
- Der Server erzeugt nicht für jeden Kandidaten ein vollständiges neues Docker-Image.
- Auth-, Daten-, Workspace- und Browserzustand sind zwischen Slots getrennt.
- Status, Fehler, Ablaufzeit, Holder, Kandidat und Cleanup-Grund sind maschinenlesbar.

### Nicht-Ziele

- Starke Isolation gegenüber einem absichtlich bösartigen Agenten mit gemeinsamem Root-/SSH-Zugriff.
- Kubernetes oder ein verteilter Multi-Host-Scheduler.
- Ersetzung von nginx durch Traefik.
- Automatisches Löschen von Git-Worktrees auf dem Controller.
- Zehn aktive Instanzen auf der aktuellen Hardware ohne vorherige Kapazitätsmessung.
- Automatische Veröffentlichung, Merge- oder Release-Entscheidungen.
- Anonyme öffentliche Preview-Links.

## 4. Zielarchitektur

```text
Agent / Worktree
  │
  │ npm pack + checksum + upload
  ▼
Controller-Helfer / Skill
  │
  │ SSH: pibo compute pool acquire
  ▼
Pibo2 Pool Controller
  ├── SQLite Lease Registry
  ├── Content-addressed Artifact Store
  ├── Golden Seed Store
  ├── Docker Launcher
  └── Resource Reaper Integration
          │
          ├── slot-01 container ── 127.0.0.1:<slot-web-port>
          ├── slot-02 container ── 127.0.0.1:<slot-web-port>
          └── slot-03 container ── 127.0.0.1:<slot-web-port>

Browser / Agent API
  │ HTTPS: slot-N.<deployment-pool-base-host>
  ▼
nginx + wildcard TLS
  │ exact static slot routing
  ▼
Slot-spezifischer Pibo Web Gateway
```

Der kanonische Pibo2-Gateway bleibt separat auf seinem bestehenden Loopback-Port. Slot-Routing wird statisch vorbereitet; Acquire und Release erfordern keinen nginx-Reload.

## 5. Slot- und URL-Modell

### Feste Slots

V1 reserviert feste Namen:

```text
slot-01.<deployment-pool-base-host>
slot-02.<deployment-pool-base-host>
...
slot-10.<deployment-pool-base-host>
```

Vorteile gegenüber dynamischen Hostnamen:

- keine nginx-Konfigurationsänderung pro Lease;
- keine Race Conditions bei Reloads;
- der Base-Hostname und die zehn festen Slot-Hostnamen passen in ein automatisch erneuertes SAN-Zertifikat;
- einfacher Zusammenhang zwischen Hostname, Portblock, Slot-Verzeichnis und Container;
- abgelaufene Slots können eindeutig auf eine neutrale 503-Seite fallen;
- ein Wildcard-DNS-Eintrag genügt.

### DNS und TLS

Erforderlich sind:

- ein A-Eintrag für den Deployment-Base-Host;
- ein Wildcard-A-Eintrag `*.<deployment-pool-base-host>` auf Pibo2;
- ein automatisch erneuertes SAN-Zertifikat für den Base-Host und die zehn festen Slot-Hostnamen.

Weil die Hostnamen fest sind, erfolgt Zertifikatsausstellung und Erneuerung per HTTP-01 über nginx. Squarespace benötigt dafür weder DNS-API-Zugang noch TXT-/CNAME-Challenge-Records. Ein AAAA-Eintrag wird erst bei stabiler IPv6-Adresse und geprüftem IPv6-HTTPS-Routing ergänzt.

### nginx

nginx erhält zwei getrennte Routingklassen:

1. exakte `slot-N`-Hostnamen werden auf feste Loopback-Portblöcke geleitet;
2. sonstige zulässige Preview-Hostnamen bleiben beim kanonischen Pibo-Gateway und damit beim Session-Live-Preview-System.

nginx darf niemals direkt auf Docker-Socket-Metadaten vertrauen. Die Slot-Portzuordnung ist statisch und wird bei der Host-Einrichtung erzeugt.

## 6. Authentifizierung

### Entscheidung

Machine Auth ist der unterstützte Zugriffsweg für Deployment-Slots. Der bestehende kanonische Google-OAuth-Callback bleibt der einzige Google-Callback. Der Docker-Local-Auth-Modus wird nicht öffentlich durch nginx weitergereicht.

### Machine Auth

- Der bestehende Raw Machine Key bleibt nur auf dem Controller.
- Jeder Slot erhält beim Zurücksetzen des Seed-Zustands denselben freigegebenen Machine-Key-Hash oder einen pool-spezifischen Key-Hash.
- Browserautomation tauscht den Header-Key am jeweiligen Slot gegen ein host-only Cookie.
- Cookies eines Slots gelten nicht für einen anderen Slot.
- Revocation muss in neu erzeugten Slots wirksam sein; bestehende Slots werden beim nächsten Seed-Reset aktualisiert oder explizit reconciled.

### Google OAuth

Für Deployment-Slots werden keine zusätzlichen Google-OAuth-Callbacks registriert. Der bestehende Callback des kanonischen Pibo2 bleibt unverändert und dient weiterhin menschlichen Tests auf der kanonischen Entwicklungsinstanz.

Slot-API-, Agenten- und Browservalidierung verwendet Machine Auth. Falls später ein Google-Login direkt auf beliebigen Slot-Hostnamen benötigt wird, erfordert das einen zentralen Auth-Handoff und ist eine eigene Erweiterung statt zehn Callback-Registrierungen.

### Secret-Grenze

- Secrets werden nie in Paket-Artefakte oder Docker-Images eingebaut.
- Der Pool Controller erzeugt slot-spezifische Konfiguration aus einer root-only Host-Konfiguration.
- Geheimnisse erscheinen nicht in CLI-JSON, Logs, Labels, URLs oder Planungsartefakten.
- Container erhalten nur die für die Testinstanz benötigten Secrets.

## 7. Artefakt- und Runtime-Modell

### Kein Image pro Agent

Ein vollständiges `pibo:<branch>`-Image pro Agent würde viele große, nur teilweise wiederverwendbare Images erzeugen. Stattdessen nutzt der Pool:

- ein gemeinsames, versioniertes Pibo Runtime Base Image mit Node und den benötigten Systemabhängigkeiten;
- ein lokal gebautes npm-Paket als exakten Kandidaten;
- einen content-addressed Artifact Store auf Pibo2;
- einen read-only Mount des installierten Kandidaten in den Slot-Container.

### Artefaktfluss

1. Der Agent führt im eigenen Worktree `npm pack` aus. `prepack` baut den exakten Stand.
2. Der Controller-Helfer berechnet SHA-256 und lädt das Paket in eine private Inbox auf Pibo2.
3. Der Pool Controller prüft Checksumme, Paketname, Node-Anforderung und ausführbares Pibo-Binary.
4. Das Paket wird unter einem Pfad wie `<artifact-root>/<sha256>/runtime` installiert.
5. Existiert der Hash bereits, wird das Artefakt wiederverwendet.
6. Der Slot mountet das Artefakt read-only und startet dessen `dist/bin/pibo.js`.

Das vorhandene Kandidaten-Installationsverfahren dient als Implementierungsbasis. V1 unterstützt Paket-Artefakte; ein optionaler `--git-ref`-Buildpfad wird zurückgestellt.

### Runtime Container

Jeder Container erhält mindestens:

- einen eindeutigen Namen und Pool-Labels;
- einen festen Slot-Portblock, nur an `127.0.0.1` gebunden;
- einen read-only Kandidaten-Mount;
- ein eigenes beschreibbares `PIBO_HOME`;
- einen eigenen Workspace;
- ein eigenes Temp-Verzeichnis und Browser-Home;
- `restart=no`, init, begrenzte Logs und Ressourcenlimits;
- keinen Docker-Socket;
- keinen direkt öffentlich gebundenen Port.

Chromium darf aus Kompatibilitätsgründen im Runtime-Image vorhanden sein, wird aber nicht automatisch pro Slot gestartet. Normale UI-Validierung verwendet den vorhandenen beaufsichtigten Browser auf dem Host.

## 8. Daten- und Seed-Modell

### Golden Seed

Der Pool verwendet nicht das live beschriebene `/root/.pibo` direkt. Stattdessen gibt es einen versionierten Golden Seed:

```text
<pool-root>/seeds/<seed-id>/pibo-home
<pool-root>/seeds/<seed-id>/workspace
```

V1 verwendet einen kuratierten, aber realistischen Seed. Er wird aus geeigneten Pibo2-Testdaten aufgebaut, enthält aber nur bewusst ausgewählte Zustände, die regelmäßig für Validierungen benötigt werden.

Der Seed enthält:

- repräsentative Pibo-Räume, Sessions, Profile und Projekte;
- typische abgeschlossene und fehlgeschlagene Session-/Trace-Zustände;
- die benötigten Auth-Metadaten und Machine-Key-Hashes;
- keine aktiven Locks, PID-Dateien oder Browserprofile;
- keine temporären Uploads, großen Debug-Artefakte, veralteten Kandidatenzustände oder ungebundenen Secrets.

Ein vollständiger Klon des jeweils live beschriebenen Pibo2-Homes ist nicht der Standard, weil er Reset-Zeit, Speicherbedarf, Stale-State-Risiko und mögliche Datenvermischung unnötig erhöht.

### Slot Reset

Bei jedem Acquire wird der Slot aus dem aktuellen Seed neu aufgebaut. Kandidatenmigrationen laufen nur gegen die Slot-Kopie. Ein Kandidat kann deshalb Datenbankmigrationen testen, ohne den kanonischen Pibo2-Zustand oder einen anderen Slot zu verändern.

Der Reset muss crash-sicher sein:

1. alten Container entfernen;
2. neues Home in einem temporären Verzeichnis erzeugen;
3. Seed kopieren und slot-spezifische Konfiguration anwenden;
4. Verzeichnis atomar als aktives Slot-Home einsetzen;
5. Container starten;
6. nach erfolgreicher Health-Prüfung die Lease auf `ready` setzen.

## 9. Lease- und Pool-Modell

### Zustände

```text
free
  -> provisioning
  -> ready
  -> releasing
  -> free

provisioning/ready
  -> dirty
  -> reconciling
  -> free oder quarantined
```

### Lease-Metadaten

Jede Lease speichert mindestens:

- Lease-ID;
- Slot-ID und öffentliche URL;
- Holder, vorzugsweise Pibo Session ID;
- optional Pibo Room ID und Ralph/Loop Run ID;
- Artefakt-Hash, Commit und Paketversion;
- Seed-ID;
- Container-ID;
- feste Portzuordnung;
- Erstellungs-, Ablauf- und letzte Verlängerungszeit;
- Status, Health und letzter Fehler;
- Cleanup-/Dirty-Grund.

### Acquire

`acquire` führt unter einer SQLite-Transaktion beziehungsweise einem exklusiven Pool-Lock aus:

1. abgelaufene oder verwaiste Slots reconciliieren;
2. aktive Anzahl und Host-Ressourcen prüfen;
3. freien, nicht quarantinierten Slot reservieren;
4. Artefakt importieren oder wiederverwenden;
5. Slot-Home aus Seed zurücksetzen;
6. Container mit festen Labels und Limits starten;
7. lokale `/health`- und Gateway-Prüfung durchführen;
8. öffentliche HTTPS-Prüfung durchführen;
9. Lease auf `ready` setzen und JSON zurückgeben.

Schlägt ein Schritt fehl, wird der teilweise erzeugte Container entfernt. Der Slot wird nur dann wieder `free`, wenn der Rollback vollständig bestätigt wurde; andernfalls wird er `dirty` oder `quarantined`.

### Ablauf und Verlängerung

- Standard-TTL: 60 Minuten.
- `renew` verlängert die Lease explizit.
- Der Agent sollte vor langen Testphasen verlängern.
- Browsertraffic oder Container-CPU-Zeit verlängern eine Lease nicht implizit.
- Der Reaper läuft alle fünf Minuten und entfernt abgelaufene Leases.
- Eine abgelaufene Lease wird auch dann freigegeben, wenn der Container noch gesund wirkt.

### Release

`release`:

1. prüft Lease-ID und Holder;
2. setzt Status auf `releasing`;
3. stoppt und entfernt nur den Slot-Container;
4. entfernt flüchtige Slot-Daten nach Policy;
5. dekrementiert die Artefakt-Referenz;
6. markiert den Slot wieder als `free`;
7. beeinflusst keine Git-Worktrees auf dem Controller.

Operatoren erhalten einen separaten `--force`-Pfad für beschädigte oder verwaiste Leases.

## 10. Kapazität und Ressourcen

### Slot-Anzahl und aktive Kapazität

- DNS/TLS/nginx bereiten zehn feste Slot-Namen vor.
- Der Pool startet mit `maxActive=3`.
- Vor der allgemeinen Nutzung werden die drei Slots technisch einzeln und anschließend parallel validiert.
- Nach praktischer Nutzung wird die Kapazität manuell erhöht, wenn keine OOM-Ereignisse, problematische Swap-Nutzung, deutlichen Latenzregressionen oder Cleanup-/Disk-Probleme auftreten.
- Eine Erhöhung ist eine bewusste Konfigurationsänderung; es gibt keine automatische Skalierung.

### Startwerte pro Container

Empfohlene V1-Grenzen:

- Memory: 1,5 GiB;
- Memory Swap: 1,5 GiB;
- CPU: 1,0 CPU;
- PIDs: 512;
- shm: 512 MiB;
- Restart Policy: `no`;
- Docker JSON Logs: 10 MiB × 3 Dateien;
- keine automatisch gestartete Browserinstanz.

Acquire verweigert neue Leases zusätzlich, wenn:

- der konfigurierte aktive Grenzwert erreicht ist;
- der Host-Memory-Reservewert unterschritten würde;
- der freie Plattenspeicher unter den Sicherheitswert fällt;
- Docker oder der Resource Reaper nicht gesund sind;
- ein Slot-Port von einem nicht zugeordneten Prozess belegt ist.

Die endgültigen Limits werden nach einem realen Zwei-Slot-Test angepasst.

## 11. Cleanup und Garbage Collection

### Lease Cleanup

Der Resource Reaper wird um Pool-Leases erweitert. Er behandelt Pool-Deployments als eigene Ressource und nicht als normale `worker`- oder `dev`-Container.

Automatisch bereinigt werden:

- abgelaufene Leases;
- gestoppte oder OOM-killed Slot-Container;
- Container ohne Registry-Eintrag;
- Registry-Einträge ohne Container;
- verwaiste temporäre Slot-Verzeichnisse;
- abgelaufene Browser-/Lease-Zustände des Slots.

### Artefakt-GC

Artefakte werden nur entfernt, wenn sie:

- von keiner aktiven oder retained Lease referenziert werden;
- älter als die Retention sind;
- nicht zu den letzten konfigurierten Kandidaten gehören.

Empfohlener Startwert:

- unreferenzierte Artefakte 24 Stunden behalten;
- mindestens die letzten fünf Kandidaten behalten;
- bei Disk Pressure früheren Cleanup nur nach einem maschinenlesbaren Dry Run anwenden.

### Docker-Image-GC

V1 erzeugt nur ein gemeinsames Runtime-Image und optional dessen vorherige Version. Es gibt keinen automatischen globalen `docker image prune`. Cleanup darf nur eindeutig mit Pool-Labels markierte Images und Container betreffen.

### Slot-Daten

Erfolgreich freigegebene Slot-Homes werden beim Release oder spätestens vor dem nächsten Acquire gelöscht. Fehlgeschlagene Deployments behalten ihr Slot-Home und ihre begrenzten Logs standardmäßig zwei Stunden für Diagnose. Pro Pool werden höchstens drei solche Fehlersnapshots aufbewahrt; ältere Snapshots werden automatisch entfernt. Retained Daten müssen in Statusausgaben mit Ablaufzeit und Fehlergrund sichtbar sein.

## 12. CLI und Agenten-Workflow

### Generische Host-CLI

Die empfohlene Oberfläche liegt unter `pibo compute pool`:

```text
pibo compute pool
pibo compute pool status
pibo compute pool acquire --artifact <server-path> --holder <pibo-session-id>
pibo compute pool renew <lease-id> --holder <pibo-session-id>
pibo compute pool release <lease-id> --holder <pibo-session-id>
pibo compute pool reap --dry-run
pibo compute pool reap --apply
pibo compute pool doctor
pibo compute pool artifacts
pibo compute pool seed status
pibo compute pool seed refresh
```

Die Hilfe folgt der progressiven Pibo-CLI-Regel. `pibo compute pool` zeigt nur die unmittelbaren Aktionen und verweist auf die jeweilige tiefere Hilfe.

### Acquire-Ausgabe

Die JSON-Ausgabe enthält mindestens:

```json
{
  "leaseId": "lease_...",
  "slot": "slot-01",
  "holder": "ps_...",
  "status": "ready",
  "publicUrl": "https://slot-01.<deployment-pool-base-host>/",
  "expiresAt": "...",
  "artifactSha256": "...",
  "commit": "...",
  "container": "pibo-pool-slot-01",
  "nextCommands": {
    "renew": "pibo compute pool renew ...",
    "release": "pibo compute pool release ...",
    "doctor": "pibo compute pool doctor ..."
  }
}
```

### Controller-Helfer

Ein Pibo2-spezifischer Helfer übernimmt:

1. exakten Worktree bauen und packen;
2. Checksumme bilden;
3. Upload in die Server-Inbox;
4. remote `acquire` ausführen;
5. Lease-Metadaten lokal unter Pibo Home speichern;
6. Public-URL und Ablaufzeit zurückgeben.

Der Workflow wird in den bestehenden Pibo-V2-Server-Skill integriert oder als eigener schlanker Skill bereitgestellt. Hostname und SSH-Ziel kommen aus Umgebungsvariablen beziehungsweise der Host-Konfiguration und werden nicht in Projektdateien hardcodiert.

## 13. Implementierungsphasen

### Phase 0: Spec und Sicherheitsentscheidungen

- Change Spec unter `docs/specs/changes/isolated-deployment-pool/` erstellen.
- Auth-, Seed-, Artefakt- und Cleanup-Grenzen als testbare Anforderungen festschreiben.
- Squarespace-Base- und Wildcard-A-Records bestätigen und dem Betreiber exakt nennen.
- den bestehenden kanonischen Google-OAuth-Callback als einzigen Callback sowie Machine Auth für Slots als V1-Vertrag festschreiben.
- kuratierten realistischen Golden Seed und zweistündige, auf drei Snapshots begrenzte Fehler-Retention festschreiben.

**Verifikation:** Spec-Review mit eindeutigen Acceptance Criteria und ohne offene Sicherheitsblocker.

### Phase 1: Pool Registry und CLI

Vorgesehene neue Bereiche:

```text
src/compute/pool/types.ts
src/compute/pool/store.ts
src/compute/pool/cli.ts
src/compute/pool/reconcile.ts
```

Aufgaben:

- SQLite-Schema für Slots, Leases und Artefakt-Referenzen;
- transaktionales Acquire;
- Status, Renew, Release und Reap Dry Run;
- feste Slot-/Port-Konfiguration;
- progressive CLI-Hilfe;
- Concurrency- und Recovery-Tests.

**Verifikation:** Parallele Acquire-Versuche überschreiten `maxActive` nicht und vergeben keinen Slot doppelt.

### Phase 2: Artefakt-Store und Container Launcher

Vorgesehene Bereiche:

```text
src/compute/pool/artifacts.ts
src/compute/pool/docker.ts
src/compute/pool/resource-policy.ts
scripts/pibo-pool-runtime-entrypoint.sh
```

Aufgaben:

- checksum-verifizierter Upload/Import;
- content-addressed Installation;
- gemeinsames Runtime-Image;
- read-only Kandidaten-Mount;
- Pool-Labels, Limits und feste Ports;
- lokale Health-Prüfung und Rollback;
- Artefakt-GC Dry Run und Apply.

**Verifikation:** Zwei verschiedene Paket-Artefakte laufen gleichzeitig, ohne neue branch-spezifische Docker-Images zu erzeugen.

### Phase 3: Seed und Slot-Auth

Aufgaben:

- Golden-Seed-Erzeugung und Versionierung;
- atomarer Slot-Reset;
- slot-spezifische `auth.baseURL` und Trusted Origins;
- Machine-Key-Hash-Provisioning;
- private Secret-Injection;
- keine zusätzlichen OAuth-Callbacks für Slots.

**Verifikation:** Beide Slots authentifizieren unabhängig; Session- und Produktdaten eines Slots erscheinen nicht im anderen.

### Phase 4: DNS, TLS und nginx

Aufgaben:

- Base- und Wildcard-A-Records konfigurieren;
- SAN-Zertifikat für den Base-Host und die zehn festen Slot-Namen per HTTP-01 bereitstellen und automatisch erneuern;
- statische Slot-Routen und neutrale Inactive-Seite einrichten;
- bestehendes kanonisches Pibo2- und Session-Live-Preview-Routing unverändert halten;
- nginx-Konfiguration testen, bevor sie geladen wird.

**Verifikation:** Inaktiver Slot liefert kontrolliert 503; aktiver Slot liefert `/health` und Chat Web über HTTPS; WebSocket/SSE funktionieren.

### Phase 5: Resource Reaper und Reconciliation

Aufgaben:

- Pool-Leases in den Gateway-eigenen Resource Reaper integrieren;
- abgelaufene, gestoppte, OOM- und orphaned Zustände abdecken;
- Dry Run zuerst ausrollen;
- Host-Reserve- und Disk-Pressure-Gates ergänzen;
- Status und Health maschinenlesbar machen.

**Verifikation:** Eine Test-Lease mit kurzer TTL wird vollständig entfernt und der Slot anschließend wieder erfolgreich vergeben.

### Phase 6: Agenten-Self-Service

Aufgaben:

- Pibo2-Controller-Skript für Build, Pack, Upload und Acquire;
- Skill-Anweisungen für Acquire, Browserprüfung, Renew und Release;
- automatische lokale Lease-Metadaten ohne Secrets;
- klare Fehlermeldung bei voller Kapazität mit nächster Ablaufzeit;
- Abschluss- und Fehlerpfad dokumentieren.

**Verifikation:** Ein Agent kann ohne manuelle Serverkonfiguration einen Kandidaten bereitstellen, testen und freigeben.

### Phase 7: Realer Pibo2-Rollout

Reihenfolge:

1. read-only Baseline und Dry Run;
2. DNS/TLS/nginx ohne aktive Container;
3. ein Canary-Slot;
4. ein kompletter Browser- und Agentenflow;
5. zwei und anschließend drei parallele Slots mit unterschiedlichen Kandidaten;
6. Restart/OOM/Expiry/Release-Fehlerfälle;
7. 24-Stunden-Soak mit Reaper und Disk-Monitoring;
8. Pool mit `maxActive=3` für normale Nutzung freigeben;
9. spätere Erhöhung nur nach manueller Bewertung der praktischen Betriebsdaten.

## 14. Validierungsmatrix

### Funktional

- Acquire liefert eine eindeutige Lease und HTTPS-URL.
- Zwei Agenten erhalten unterschiedliche Slots und Kandidaten.
- Restart in Slot A beeinflusst Slot B und den kanonischen Pibo2-Gateway nicht.
- Renew verlängert nur die angegebene Lease.
- Release gibt nur den eigenen Slot frei.
- Eine abgelaufene Lease wird automatisch entfernt und neu vergeben.
- Ein fehlgeschlagener Start hinterlässt keinen scheinbar freien, aber belegten Slot.

### Auth und Isolation

- Nicht authentifizierte Slot-Aufrufe erhalten keinen Chat-Zugriff.
- Machine Auth funktioniert auf jedem Slot separat.
- Der bestehende kanonische Google-OAuth-Callback bleibt unverändert und funktionsfähig; es existieren keine Slot-Callbacks.
- Cookies eines Slots autorisieren keinen anderen Slot.
- Artefakte, Logs und Docker-Labels enthalten keine Secrets.
- Docker-Ports sind nur über Loopback erreichbar.
- Container besitzen keinen Docker-Socket.

### Ressourcen

- Zwei parallele reale Pibo-Gateways bleiben unter den Host-Reservewerten.
- Ein absichtlich beendeter oder OOM-killed Testcontainer wird sichtbar und bereinigt.
- Docker-Logs bleiben innerhalb des Limits.
- Wiederholte Kandidatendeployments erhöhen die Image-Anzahl nicht pro Kandidat.
- Unreferenzierte Artefakte werden nach Retention entfernt.
- `pibo compute health --json` und Pool Health zeigen Leases, Container, Disk und Reaper-Zustand konsistent.

### Browser und Agent

- Chat Web lädt über die Slot-URL in einem authentifizierten headful Browser.
- Eine reale Modellantwort streamt im Slot.
- Tool-Aufrufe und Persistenz funktionieren nach Reload.
- Sessionwechsel und Terminal View funktionieren im Slot.
- Console und Network enthalten keine unerwarteten Auth-, SSE- oder WebSocket-Fehler.

## 15. Rollback

- Neue Acquires deaktivieren.
- Pool-Reaper auf Dry Run setzen oder stoppen.
- Aktive Slot-Container kontrolliert entfernen.
- nginx-Slot-Routing deaktivieren; kanonischen Serverblock unverändert lassen.
- Wildcard-DNS darf bestehen bleiben, solange inaktive Hosts kontrolliert abgewiesen werden.
- Artifact Store und Slot-Daten zunächst behalten, bis die Ursache geprüft ist.
- Der bestehende `pibo-web.service` bleibt während des gesamten Rollouts die unabhängige Rückfallebene.

## 16. Risiken und Gegenmaßnahmen

| Risiko | Gegenmaßnahme |
|---|---|
| Host wird durch zu viele Instanzen überlastet | `maxActive`, harte Containerlimits, Host-Reserve-Gates, stufenweiser Rollout |
| Vergessene Leases blockieren Slots | 60-Minuten-TTL, explizites Renew, 5-Minuten-Reaper |
| Viele große Docker-Images | ein gemeinsames Runtime-Image, Kandidaten als deduplizierte npm-Artefakte |
| nginx-Races bei parallelem Acquire | feste Slot-Routen, kein Reload pro Lease |
| Öffentlicher Local Auth wird unsicher | normale Better Auth/Machine Auth pro Slot; Local Auth nicht öffentlich proxien |
| Slot-Daten vermischen sich | eigener Seed-Klon und eigenes `PIBO_HOME` pro Slot |
| Staler DB-/Docker-Zustand | Reconciliation bei Acquire, Status und Reaper |
| HTTP-01-Erneuerung für einen Slot-Namen schlägt fehl | Zertifikat nicht aktivieren, DNS/nginx-Challengepfad prüfen und `certbot renew --dry-run` erneut ausführen |
| Alte Browsercookies greifen auf neue Lease zu | Slot-Auth-DB beim Reset neu erzeugen; alte Sessions dadurch ungültig |
| Pool-Implementierung beschädigt kanonisches Pibo2 | separate Container/Ports/Verzeichnisse; nginx-Routing exakt; Canary-Rollout |

## 17. Festgelegte Entscheidungen und verbleibende Klärungen

### Festgelegt

1. Squarespace erhält einen Base- und einen Wildcard-A-Record; der Base-Host und die zehn festen Slots verwenden ein per HTTP-01 erneuertes SAN-Zertifikat.
2. Der bestehende kanonische Google-OAuth-Callback bleibt der einzige Google-Callback; Deployment-Slots verwenden Machine Auth.
3. Der Golden Seed ist kuratiert, aber realistisch und basiert auf bewusst ausgewählten Pibo2-Testzuständen.
4. Fehlgeschlagene Slot-Homes und begrenzte Logs bleiben zwei Stunden erhalten; höchstens drei Fehlersnapshots werden gleichzeitig aufbewahrt.
5. Der Pool startet mit drei aktiven Slots. Eine spätere Erhöhung erfolgt nach praktischer Nutzung und manueller Bewertung.

### Noch zu klären

1. Reicht für V1 ausschließlich das npm-Paket-Artefakt, oder wird zwingend ein Git-Ref-Buildpfad benötigt?
2. Welche konkreten Räume, Sessions, Profile, Projekte und Fehlerzustände gehören in die erste Seed-Version?

## 18. Erfolgskriterien

- [ ] Zwei Agenten deployen gleichzeitig unterschiedliche Kandidaten auf getrennte HTTPS-Slots.
- [ ] Beide führen unabhängige authentifizierte Browser- und Agentenflows aus.
- [ ] Kein Slot-Deployment startet den kanonischen `pibo-web.service` neu.
- [ ] Eine 60-Minuten-Lease wird ohne manuelles Eingreifen freigegeben, sofern sie nicht verlängert wurde.
- [ ] Ein Agent kann Acquire, Doctor, Renew und Release vollständig über dokumentierte CLI-/Skill-Befehle ausführen.
- [ ] Nach wiederholten Deployments existiert weiterhin nur die begrenzte Menge gemeinsamer Runtime-Images.
- [ ] Verwaiste Container, Artefakte und Slot-Daten werden durch Dry Run sichtbar und durch Apply kontrolliert entfernt.
- [ ] Der aktuelle Host bleibt während eines realen Zwei-Slot-Stresstests oberhalb der vereinbarten RAM-/Disk-Reserve.
- [ ] nginx, DNS und TLS unterstützen Slots, ohne das bestehende Pibo2- oder Session-Live-Preview-Routing zu regressieren.

## 19. Empfehlung

Mit dieser Architektur sollte implementiert werden. Sie nutzt die vorhandenen Pibo-Bausteine, vermeidet einen zweiten öffentlichen Managementdienst, vermeidet Docker-Image-Wachstum pro Agent und hält den kanonischen Pibo2-Gateway als unabhängige Rückfallebene.

Nicht empfohlen ist, direkt mit zehn aktiven Containern oder mit einem Traefik-Ersatz für nginx zu starten. Der sinnvolle erste Meilenstein ist ein Pool mit zehn vorbereiteten Hostnamen, einem Canary-Slot und anschließend zwei bis drei gleichzeitig aktiven Deployments.

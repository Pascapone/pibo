---
type: "Historical Record"
title: "MCP Native Extension Implementierungsplan (Pibo)"
description: "Preserves the original body as a deprecated historical record without promoting historical claims."
tags: ["historical","legacy","migration"]
status: "deprecated"
authority: "historical"
migration_lineage:
  source_path: "docs/legacy/mcp-native-extension-implementation-plan.md"
  source_commit: "0cd6a73449e1b555fa6e590d839d7e03c8dc98bf"
  baseline_commit: "2aef244301f5d181624662fdad53e18e83e80bd9"
  baseline_blob_oid: "4c937e0a2f6d22fd4603a906e7683d54d09a447f"
  source_bytes: 7263
  source_sha256: "628274e3c6bc2637200157a0eb0e845bfcbe5817b4c3da6ab679bcae3de0be54"
  source_body_sha256: "628274e3c6bc2637200157a0eb0e845bfcbe5817b4c3da6ab679bcae3de0be54"
generated:
  by: "process:pibo-okf-c-legacy"
  at: "2026-09-01T09:50:26Z"
---
# MCP Native Extension Implementierungsplan (Pibo)

**Status:** Planung / Referenz  
**Zeitraum:** 2026-Q2  
**Zielbild:** Die bestehende `pibo mcp` CLI bleibt kurzfristig erhalten, aber die Runtime setzt künftig auf eine eigene native Pibo Pi Extension um.

## Ziel

Wir bauen eine native Pibo MCP Extension auf Basis unseres Produktmodells:

1. Bestehende CLI-Funktionalität bleibt als Referenz und läuft unverändert weiter.
2. MCP-Konfiguration und -Ausführung wird schrittweise auf eine native Extension umgezogen.
3. Alle aktuellen Stärken der CLI bleiben erhalten (Profile-Integration, Tool-Auswahl pro Agent, robuste Konfiguration, Stabilität).
4. Vorteile aus dem pi-mcp-adapter werden übernommen, wo sie sinnvoll sind (Serverzustands-Caching, Registry/Discovery, direkte HTTP/OAuth-Tools, zentrale Proxy-Route).

## Analyse und Abgrenzung

### Was wir von der aktuellen CLI beibehalten
- Konfigurationsmodell für stdio- und HTTP-MCP-Server.
- Profil-getriebene Aktivierung von MCP-Kapazitäten.
- Tool-Fallback auf indirekte/Proxy-Nutzung, damit Promptgröße klein bleibt.
- Existing Registry und Adapter-Pattern (bestehende Plugin-/Capability-Struktur).
- CLI bleibt als Diagnose- und Migrationspfad erhalten.

### Was wir aus pi-mcp-adapter übernehmen
- Serverzustand und Tool-Metadaten in gecachter Schicht statt pro-Call-Re-Discovery.
- Mehrstufige Aktivierung: Proxy-Tool plus optional direkte Tool-Registrierung.
- Strukturierter Server-Lifecycle (Start/Stop, Reconnect, Status, Deskriptoren).
- HTTP/MCP-spezifische Zusatzpfade inkl. Auth-/Callback-Handling als Muster.
- UI-nahe Registry-Konzeption (wir binden sie als DevTools Registry an unsere Profile).

### Was wir bewusst NICHT übernehmen
- Vollständige Bindung an pibo-internes UI-Ökosystem außerhalb unserer Produktgrenzen.
- Globaler Tool-Registering-Mechanismus ohne Profilkontext.
- Tool-Names, die nicht zu unserem Profile-Scope passen.

## Zielarchitektur

```text
Agent-Profile
  -> MCP-Server-Zuordnung + erlaubte Direkt-Tools
  -> Pibo MCP Runtime Extension
      -> MCPConfigStore (pro Besitzer + global)
      -> MCPRegistry/Package-Katalog (inkl. DevTools)
      -> MCPMetadataCache (Beschreibungen/Signaturen)
      -> MCPAuthState (Token/Header/Session)
      -> MCPServerManager (Start/Stop/Health)
      -> Tool-Schicht
           - `pibo_mcp` (Proxy für nicht-integrierte Tools)
           - optional `mcp_<server>_<tool>` (für selektierte Direct Tools)
      -> Pi-Extension Runner
  -> Pi Runtime
```

## Umsetzung in Phasen

### Phase 1: Referenzmodus stabilisieren (Woche 1)
- CLI bleibt unverändert und bleibt operativ.
- Bestehende Extension-Integration vorbereiten:
  - gemeinsames Domain-Modell für MCP-Server-Settings definieren,
  - gemeinsame Typen für Tool-Auswahl, Server-Metadaten, Auth-Status.
- Alle bisherigen MCP-bezogenen Einträge in `docs/mcp.md` ergänzen um Hinweis:
  - CLI ist Referenz, nicht primärer Runtime-Pfad.

### Phase 2: Kern-Services extrahieren (Wochen 1–2)
- MCP Service aus der CLI auslagern:
  - Config + Discovery + Lifecycle in neue Kernmodule.
- Gemeinsame Nutzung von Config-Dateien und Registry-Logik:
 - `src/mcp/config.ts` als zentrale Quelle für stdio/http Serverdefinition.
- Ermitteln, welche Teile direkt wiederverwendet werden können:
  - Daemon/Connection-Handling,
  - Timeout-/Retry-Policy,
  - Server-Registry-Handling.

### Phase 3: Native Extension implementieren (Wochen 2–4)
- `PiboMcpExtension` implementieren und an Plugin-Registry binden.
- Registrierung als `Native Tool Provider`:
  - immer verfügbares Proxy-Tool `pibo_mcp`,
  - dynamische direkte Tools nur für ausgewählte Server/Tools je Profil.
- Tool-Lifecycle:
  - Build-Toolliste aus Profil zur Laufzeit,
  - Auflösung per Server- und Tool-Filter,
  - stabile Namen (`mcp_<server>_<tool>`).
- Response-Normalisierung in einheitliches Pibo Ergebnisformat.

### Phase 4: Profil- und Designer-Integration (Wochen 3–5)
- Profile-Schema erweitern:
  - MCP-Server-Selektion pro Profil bleibt zentral.
  - direkte MCP-Tools pro Profil konfigurierbar.
- Agent Designer/API:
  - Anzeige von aktivierten MCP-Servern,
  - Status/Health,
  - Hinweise auf notwendige Auth,
  - Toggle für `pibo_mcp` + Direkt-Tools.
- Kompatibilität sicherstellen:
  - bestehende Agentenprofile bleiben lauffähig ohne Umstellung,
  - Migration nur bei Bedarf.

### Phase 5: Registry/DevTools anbinden (Wochen 4–6)
- Registry als produktseitige Adapter-Klasse integrieren:
  - bestehende Browser-Use- und DevTools-Ziele bleiben verfügbar,
  - neu als „DevTools als Registry“-Preset dokumentiert.
- Optional: neue vordefinierte Packs für häufige Agent-Rollen.
- Aktivierung nur über Profil und Owner-Policy.

### Phase 6: Auth und HTTP-MCP (Wochen 5–7)
- HTTP-MCP (und OAuth/Token-Flow) in eigenes Service-Paket.
- Einheitliche Auth-Metadaten-Speicherung pro Besitzer/Server.
- Sicherheitsanforderungen und Berechtigungslogik:
  - keine globalen Secrets in Klartext,
  - klare Fehlermeldung bei fehlerhafter Anmeldung.

### Phase 7: Abschaltung der CLI-Pfade vorbereiten (Wochen 7–8)
- Runtime-Aufrufe auf Extension-Routen migrieren.
- CLI weiterhin als Fallback und Diagnose:
 - `pibo mcp` bleibt als Referenz/Notfallpfad.
- Feature-Flags zur kontrollierten Umschaltung je Release.
- Langfristige Deaktivierung der CLI-Einbindung nur nach Erfolgskontrolle in Telemetrie.

## Erfolgs-Kriterien

- Agenten mit MCP-Profil sehen dieselben fachlichen Fähigkeiten wie mit CLI.
- Profil-seitige Aktivierung/Deaktivierung wirkt unverzüglich auf runtime-registrierte Tools.
- `pibo_mcp` funktioniert als universeller Proxy in allen relevanten Profilen.
- Direct-Tools sind nur für freigegebene Server/Tools der Zielprofile verfügbar.
- Tool-Namen sind stabil und deterministisch reproduzierbar.
- Die Registry unterstützt DevTools vollständig ohne CLI-Präferenz.
- Auth-/HTTP-MCP bleibt nutzbar, ohne den Produktkontext zu verletzen.
- Bestehende MCP- und Runtime-Tests laufen in der neuen Pfadvariante.

## Risiken / Aufwandsgrenzen

- Risiko: Konfigurations-Divergenz zwischen CLI- und Extension-Weg.
  - Gegenmaßnahme: single source of truth im Shared MCP Config Store.
- Risiko: Token-/Auth-Fluss bei HTTP-MCP wird unzureichend modelliert.
  - Gegenmaßnahme: frühe OAuth/Token-Integration + klare Token-Metadaten.
- Risiko: Tool-Namen-Kollisionen bei Direct Tools.
  - Gegenmaßnahme: deterministisches Präfix/Normalisierung und Reservierungsliste.
- Risiko: UI-Mehrwert durch zu viele Tool-Flags in Designer.
  - Gegenmaßnahme: progressive UI (zeige nur freigegebene/benötigte Optionen).

## Offene Entscheidungen
- Welche bestehenden CLI-Tests können 1:1 als Contract-Tests für die Extension übernommen werden?
- Ob `pibo_mcp` ausschließlich per Proxy-Tool startet oder zusätzlich Tool-Kurzformen für kritische Server bekommt.
- Wie aggressiv der direkte Toolset-Autogenerierungsgrad am Anfang sein soll (sicherheits- vs. convenience-getrieben).

## Nächste Schritte
1. Aus den obigen Phasen in Ticketform ableiten (je 1 Ticket je Phase + Akzeptanzkriterien).
2. Datenmodell für Profil-MCP-Felder finalisieren.
3. Phase 1–2 in einem Umbau-Sprint starten und danach Inkremente gegen die bestehende CLI validieren.

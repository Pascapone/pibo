# Plan: `owner` und `shared:app` vollständig aus aktivem Pibo entfernen

**Status:** Draft  
**Created:** 2026-06-01  
**Source:** User request after Dev and Production ownerless cutover succeeded  
**Target:** No `owner`, `shared:app`, `app-context`, Owner Scope, principal-partition, or compatibility cutover vocabulary in active Pibo source, tests, CLI/help, schemas, APIs, current docs, or agent-facing tooling.

## Ausgangslage

Dev und Production sind auf das ownerless Datenmodell migriert. Die verbleibenden Treffer sind deshalb keine notwendige Produktlogik mehr, sondern Restvokabular, historische Migrationswerkzeuge, technische Begriffe, Tests, Dokumentation und lokale Artefakte.

Die aktuelle Produkt-Vocabulary-Gate meldet bereits keine unerlaubten Legacy-Produkt-Treffer, aber nur weil Allowlist-Pfade existieren:

```text
npm run check:product-vocab -- --json
scannedFiles: 683
failures: 0
allowed: 551
```

Aktuelle Allowlist-Treffer:

| Treffer | Pfad |
|---:|---|
| 318 | `docs/specs/changes/final-owner-scope-removal/prds/final-owner-scope-removal.prd.json` |
| 197 | `docs/plans/final-owner-scope-removal-umbauplan-2026-05-31.md` |
| 23 | `docs/specs/changes/final-owner-scope-removal/prds/final-owner-scope-removal-prd.md` |
| 13 | `src/data/final-app-space-cutover-migration.ts` |

Breiter Repo-Scan, ohne `dist`, `node_modules`, `.worktrees`, `docs/legacy`:

| Treffer | Bereich |
|---:|---|
| 4492 | `docs/reports` |
| 611 | `docs/specs` |
| 368 | Root/Other, z. B. `IMPLEMENTATION_*`, `README.md`, `AGENTS.md` |
| 332 | `test` |
| 220 | `src` |
| 168 | `docs/plans` |
| 21 | `scripts` |
| 14 | `packages` |
| 12 | `docs/project` |
| 12 | `skills` |
| 2 | `.codex` |

## Zielzustand

- Active source hat kein `owner`, `ownerScope`, `owner_scope`, `Owner Scope`, `principalId`, `principal_id`, `shared:app`, `app-context`, `AppContext`, `SHARED_APP` oder daraus abgeleitete Produkt-/Kompatibilitätsbegriffe.
- Der neutrale App-Kontext heißt `app-context`, nicht `app-context`.
- Keine aktuelle API, UI, CLI, TUI, Tool-Hilfe oder Agent-Anleitung verwendet `owner` als Parameter, Scope, Label oder Query-Key.
- Post-cutover Migrationscode für Owner Scope ist aus aktivem Code entfernt oder in `docs/legacy` als historische Evidenz archiviert.
- Fresh- und bestehende Production/Dev-Datenbanken enthalten keine Legacy-Produktspalten und zusätzlich keine technischen `owner_*` Spalten, die unter Pibo-Kontrolle stehen.
- Die Vocabulary-Gate ist hart: keine Allowlist in `src`, `packages`, `scripts`, `skills`, `test`, `docs/project`, `docs/specs`, `docs/plans`, Root-Dokumenten oder agent-facing Hilfetexten. Nur `docs/legacy/**` und unveränderbare Drittanbieter-Lizenztexte dürfen ausgeschlossen werden.

## Analyse: Übrig gebliebene Artefakte und Systeme

### 1. Neutraler App-Kontext heißt noch `app-context`

Aktive Dateien:

- `src/app-context.ts`
- `src/web/types.ts`
- `src/web/auth.ts`
- `src/core/runtime.ts`
- Tests wie `test/web-auth-app-context-context.test.mjs`, `test/context-build-inspector.test.mjs`, `test/chat-web-shared-sessions.test.mjs`
- Fixtures wie `scripts/validate-web-annotations-browser.mjs`

Aktueller Zustand:

- Typ: `PiboAppContext`
- Konstante: `PIBO_APP_CONTEXT`
- Werte: `kind: "app-context"`, `id: "app-context"`
- Runtime-Kontext zeigt `App context: app-context`

Ziel:

- Datei: `src/app-context.ts`
- Typ: `PiboAppContext`
- Konstante: `PIBO_APP_CONTEXT`
- Werte: `kind: "app-context"`, `id: "app"`
- Runtime-Kontext zeigt `App context: app`

### 2. Final-Cutover-Migrator ist nach Production-Cutover legacy

Aktive Dateien und Oberflächen:

- `src/data/final-app-space-cutover-migration.ts`
- `src/data/cli.ts` command `pibo data final-cutover ...`
- `test/final-app-space-cutover-migration.test.mjs`
- `test/data-v2-store.test.mjs` importiert `migrateLegacyChatDataSchemaToOwnerless`
- `docs/specs/capabilities/data-maintenance-cli.md`
- aktuelle Cutover-PRDs und Runbooks unter `docs/specs/changes/final-owner-scope-removal/`, `docs/plans/`, `docs/reports/`

Ziel:

- CLI-Oberfläche `pibo data final-cutover` entfernen.
- Migrator aus `src` löschen.
- Tests, die Legacy-Schema-Migration fixture-basiert beweisen, archivieren oder löschen.
- Nur historische Nachweise bleiben unter `docs/legacy/**`.

### 3. Product-Vocabulary-Gate hat noch eine Legacy-Allowlist

Aktiv:

- `scripts/legacy-product-vocabulary-gate.mjs`
- `test/legacy-product-vocabulary-gate.test.mjs`
- `npm run check:product-vocab`

Ziel:

- Script umbenennen zu neutralem Namen, z. B. `scripts/product-vocabulary-gate.mjs`.
- Allowlist für `src/data/final-app-space-cutover-migration.ts` und final-removal aktive Docs entfernen.
- Scan-Roots erweitern auf Root-Dokumente (`README.md`, `AGENTS.md`, `.codex` Skills, `handoffs`, `progress.txt`), soweit sie Pibo-owned und agent-facing sind.
- Gate soll broad owner-vocabulary nur in `docs/legacy/**` und unveränderbaren Lizenzdateien ignorieren.

### 4. Web Annotations nutzt noch `scope: "owner"`

Aktiv:

- `src/apps/chat-ui/src/api-web-annotations.ts`
- `src/apps/chat-ui/src/use-session-web-annotations.ts`
- Query key `['web-annotations', 'owner', selectedPiboSessionId]`
- Request `scope=owner`

Serverseitig nutzt `src/web-annotations/api.ts` bereits `scope=app` oder `allSessions=true`. Die UI ist hier semantisch hinterher.

Ziel:

- Response/Input-Typ `scope?: "session" | "app"`.
- UI requestet `scope: "app"`.
- Query key nutzt `"app"` oder keinen Scope-String.
- Tests decken ab, dass keine API-Payloads `owner` als Scope zurückgeben.

### 5. Technische Run-/Runtime-Zuordnung heißt noch `ownerPiboSessionId`

Aktiv:

- `src/runs/registry.ts`
- `src/tools/runtime/registry.ts`
- `src/reliability/store.ts`
- `src/debug/index.ts`
- Tests: `test/runs.test.mjs`, `test/runtime-tool.test.mjs`, `test/reliability-store.test.mjs`, `test/debug-cli.test.mjs`
- Persistente Spalte: `pibo-events.sqlite.pibo_runs.owner_pibo_session_id`

Das ist kein Owner Scope mehr, aber es verletzt das Ziel „kein owner im Code“. Es beschreibt den kontrollierenden Pibo Session Controller eines yielded runs bzw. persistent runtime.

Zielnamen:

- `controllerPiboSessionId` oder `originPiboSessionId` für yielded runs.
- `runtimeControllerPiboSessionId` oder `sessionControllerId` für persistent runtime tools.
- DB-Spalte: `controller_pibo_session_id`.

Datenmigration:

- `PiboReliabilityStore` muss beim Start alte `pibo_runs.owner_pibo_session_id` nach `controller_pibo_session_id` migrieren.
- Production/Dev brauchen nach Deploy einen kleinen schema migration check für `pibo-events.sqlite`.

### 6. Browser-/Tool-Leases nutzen `owner` als Holder-Label

Aktiv:

- `src/tools/browser-pool.ts`
- `src/tools/browser-use-leases.ts`
- `src/tools/agent-browser-leases.ts`
- `src/tools/index.ts`
- `src/tools/guides.ts`
- `src/tools/registry.ts`
- `scripts/compute-limited-worker-smoke.mjs`
- Tests: `test/browser-pool-state.test.mjs`, `test/tools-cli.test.mjs`, `test/compute-resource-policy.test.mjs`
- CLI: `pibo tools browser-use lease acquire --owner ...`, `pibo tools agent-browser lease acquire --owner ...`

Ziel:

- Datenfeld `holder`, `requester`, oder `leaseHolder` statt `owner`.
- CLI Flag `--holder <label>` oder `--requester <label>` statt `--owner`.
- Lock-state JSON liest alte `owner` Felder einmalig als Compatibility-Input, schreibt aber nur `holder`.
- Agent-facing Guides und registry hints ersetzen `--owner "$USER"`.
- Tests beweisen, dass Help-Ausgaben kein `--owner` mehr enthalten.

### 7. GitHub/Skills Installer nutzt `owner` für Repository Namespace

Aktiv:

- `src/user-skills/installer.ts`

Das Wort meint GitHub Repository Owner, nicht Pibo Owner Scope. Für das harte Code-Ziel trotzdem umbenennen.

Ziel:

- `repoOwner` vermeiden, weil es weiter `owner` enthält.
- Besser: `account`, `namespace`, oder `orgOrUser`.
- Kommentare und Beispiele von `{owner}/{repo}` auf `{account}/{repo}` ändern.
- API URL bleibt unverändert; nur lokale Namen ändern.

### 8. Workflow-/Validation-Labels nutzen `ownerLabel`

Aktiv:

- `packages/workflows/src/validation/registry-refs.ts`
- `src/apps/chat/workflow-registered-ref-params.ts`
- `src/apps/chat/workflow-registered-ref-validation.ts`
- `src/apps/chat/web-app.ts`

Ziel:

- `ownerLabel` -> `sourceLabel`, `subjectLabel`, oder `diagnosticLabel`.
- Kein Verhalten ändern; nur Diagnose-Wording und Types aktualisieren.

### 9. Root- und aktuelle Dokumentation enthalten alte Begriffe

Aktiv betroffen:

- `IMPLEMENTATION_INSIGHTS.md`
- `IMPLEMENTATION_PROGRESS.md`
- `LOCAL_ROUTED_TUI_SPEC.md`
- `README.md`
- `AGENTS.md`
- `progress.txt`
- `handoffs/*`
- `.codex/skills/*`
- `docs/project/*`
- `docs/specs/capabilities/*`
- `docs/specs/changes/final-owner-scope-removal/*`
- `docs/reports/*`
- `docs/plans/final-owner-scope-removal-umbauplan-2026-05-31.md`

Ziel:

- Obsolete implementation progress/handoff/report artifacts nach `docs/legacy/**` verschieben oder löschen.
- Current docs auf `app context`, `app-global`, `controller`, `holder`, `responsibility`, `canonical store` umschreiben.
- `GLOSSARY.md` ändern: Historical section behalten nur, wenn unter `docs/legacy`; aktive Glossary soll keine entfernten Produktbegriffe mehr führen.
- Dieser Plan selbst muss am Ende nach `docs/legacy/plans/` verschoben werden, sonst blockiert er die finale harte Gate.

### 10. Tests enthalten Legacy-Fixtures und alte Namen

Aktiv betroffen:

- `test/app-context-artifact-search-gate.test.mjs`
- `test/app-context-fresh-schema.test.mjs`
- `test/web-auth-app-context-context.test.mjs`
- `test/chat-web-shared-sessions.test.mjs`
- `test/data-v2-store.test.mjs`
- `test/final-app-space-cutover-migration.test.mjs`
- alle runtime/run/browser-pool tests mit literal `owner`

Ziel:

- Tests auf neue Namen umbenennen.
- Legacy migration fixture tests löschen oder nach `docs/legacy` als historical evidence verschieben, nicht in `npm test`.
- Negative assertions bleiben: keine alten keys, Spalten, CLI flags, docs strings.

### 11. Lokale Runtime-Artefakte außerhalb des Repos

Bekannte Artefakte:

- `/root/.pibo/backups/final-owner-scope-production-precutover-20260601T154748Z`
- `/root/.pibo/migration-reports/final-cutover-apply-2026-06-01T16-33-49-835Z.json`
- `/root/.pibo-dev-final-cutover-technical-backup-20260601T153326Z`
- `/root/.pibo-dev/migration-reports/final-cutover-apply-2026-06-01T15-33-42-804Z.json`

Ziel:

- Nicht automatisch löschen. Das sind Rollback-/Audit-Artefakte.
- Aus aktiver Produktlogik und repo-owned docs entfernen.
- Separater Retention-Entscheid: behalten, komprimieren, oder in einen nicht-agent-facing Backup-Bereich verschieben.

## Umsetzung

### Phase 0 — Arbeitsumgebung und Sicherheitscheck

1. Branch von aktuellem `upstream/dev` oder `upstream/main` erstellen, je nachdem welcher Release-Flow gewünscht ist.
2. Vorherige Cutover-Zustände read-only prüfen:
   - Dev: keine `owner_scope`, `principal_id`, `room_members`, `principal_session_stats`, `principal_room_stats`.
   - Production: gleicher Check plus `pibo-events.sqlite.pibo_runs` für technische Spaltenmigration planen.
3. Keine Host-DB-Mutation ohne expliziten Migrationsschritt.

### Phase 1 — `app-context` zu `app-context` umbenennen

1. `src/app-context.ts` -> `src/app-context.ts`.
2. Typen/Konstanten umbenennen:
   - `PiboAppContext` -> `PiboAppContext`
   - `PIBO_APP_CONTEXT` -> `PIBO_APP_CONTEXT`
   - `kind: "app-context"` -> `kind: "app-context"`
   - `id: "app-context"` -> `id: "app"`
3. Imports in Web/Auth/Runtime aktualisieren.
4. Runtime context copy aktualisieren.
5. Tests und fixtures auf `app-context` umstellen.

Verification:

```bash
npm run typecheck
npm run build
node --test test/web-auth-app-context-context.test.mjs test/context-build-inspector.test.mjs
rg -n "shared:app|app-context|AppContext|SHARED_APP|app context" src test scripts packages
```

### Phase 2 — Final-Cutover-Migrator entfernen

1. `src/data/final-app-space-cutover-migration.ts` löschen.
2. `pibo data final-cutover` aus `src/data/cli.ts` entfernen.
3. `test/final-app-space-cutover-migration.test.mjs` löschen oder nach Legacy-Artefakten verschieben.
4. `test/data-v2-store.test.mjs` so umbauen, dass es fresh ownerless schema prüft, aber keine Legacy-Migration mehr importiert.
5. `docs/specs/capabilities/data-maintenance-cli.md` aktualisieren: final cutover ist abgeschlossen und nicht mehr aktive CLI.

Verification:

```bash
npm run typecheck
npm run build
npm test
rg -n "final-cutover|final-app-space-cutover|owner_scope|principal_id|shared:app" src test scripts packages
```

### Phase 3 — Web Annotation Scope reparieren

1. UI/API-Typen `scope?: "session" | "owner"` -> `scope?: "session" | "app"`.
2. UI Query-Key und Request auf `app` ändern.
3. Tests ergänzen: Web Annotation list all/app returns `scope: "app"`, nie `owner`.

Verification:

```bash
node --test test/web-annotations-store.test.mjs test/web-annotations-cdp-api.test.mjs test/web-channel.test.mjs
rg -n "scope.*owner|scope=owner|\"owner\"" src/apps/chat-ui src/web-annotations test/web-annotations*
```

### Phase 4 — Technische `owner`-Begriffe umbenennen

1. Run registry:
   - `ownerPiboSessionId` -> `controllerPiboSessionId`.
   - Methods `cancelOwnerRuns`, owner-specific notification helpers -> `cancelControllerRuns` etc.
2. Runtime tool registry:
   - `ownerPiboSessionId` -> `controllerPiboSessionId` oder `runtimeControllerPiboSessionId`.
   - `closeOwnerSessions` -> `closeControllerSessions`.
3. Reliability store:
   - DB column `owner_pibo_session_id` -> `controller_pibo_session_id`.
   - Index `idx_pibo_runs_owner_updated` -> `idx_pibo_runs_controller_updated`.
   - Startup migration for existing `pibo-events.sqlite`.
4. Debug output already exposes `piboSessionId`; internal types updated only.
5. Tests updated.

Verification:

```bash
node --test test/runs.test.mjs test/runtime-tool.test.mjs test/reliability-store.test.mjs test/debug-cli.test.mjs
sqlite3 /root/.pibo/pibo-events.sqlite "PRAGMA table_info(pibo_runs);" # after approved deploy/migration only
rg -n "ownerPiboSessionId|owner_pibo_session_id|idx_pibo_runs_owner|OwnerRuns|OwnerSessions" src test packages scripts
```

### Phase 5 — Browser/tool lease vocabulary ersetzen

1. `owner` field in browser pool state -> `holder` or `leaseHolder`.
2. CLI `--owner` -> `--holder` or `--requester`.
3. Read old state fields defensively, write only new fields.
4. Update guides, registry hints, tests, docs.

Verification:

```bash
npm run dev -- tools browser-use lease acquire --help | rg -- '--owner|owner' && exit 1 || true
npm run dev -- tools agent-browser lease acquire --help | rg -- '--owner|owner' && exit 1 || true
node --test test/browser-pool-state.test.mjs test/tools-cli.test.mjs
rg -n "--owner|owner:" src/tools scripts test docs/project docs/specs
```

### Phase 6 — GitHub/Workflow/test labels umbenennen

1. `src/user-skills/installer.ts`: `owner` -> `account`, `namespace`, or `orgOrUser`.
2. Workflow validation `ownerLabel` -> `diagnosticLabel` or `subjectLabel`.
3. Terminal fixture metadata `owner` -> `source`, `coverage`, or `trace`.
4. Broad tests update.

Verification:

```bash
node --test test/tools-cli.test.mjs test/terminal-parity-fixtures.test.mjs
cd packages/workflows && npm run typecheck && npm test
rg -n "\bowner\b|\bOwner\b|\bownership\b|ownerLabel" src packages scripts test
```

### Phase 7 — Aktuelle Docs bereinigen oder archivieren

1. Move obsolete implementation artifacts to `docs/legacy/**`:
   - final-removal PRDs after this cleanup is complete
   - final cutover runbooks/reports
   - raw inventories
   - root `IMPLEMENTATION_*` if not current operator context
2. Rewrite current capability docs:
   - `app context` instead of `app context`
   - `controller`/`holder` instead of `owner`
   - `canonical store`/`responsibility` instead of `ownership`
3. Remove glossary entries for removed terms from active `GLOSSARY.md`; if needed, move historical definitions to `docs/legacy/project/glossary-removed-terms.md`.
4. Move this plan to `docs/legacy/plans/` before final zero gate.

Verification:

```bash
rg -n -i "shared:app|app-context|app context|owner scope|owner_scope|ownerScope|principal_id|principalId|\bowner\b|\bownership\b" \
  README.md AGENTS.md GLOSSARY.md docs/project docs/specs docs/plans .codex handoffs progress.txt
```

### Phase 8 — Gate hart schalten

1. `scripts/legacy-product-vocabulary-gate.mjs` neutral umbenennen.
2. Allowlist auf `docs/legacy/**` und unveränderbare Lizenztexte begrenzen.
3. Terms erweitern:
   - exact legacy: `shared:app`, `app-context`, `AppContext`, `SHARED_APP`, `owner_scope`, `ownerScope`, `OwnerScope`, `principal_id`, `principalId`, `room_members`, `principal_*` tables.
   - broad active code: `owner`, `Owner`, `OWNER`, `owned`, `Owned`, `ownership`.
   - CLI/API: `--owner`, `scope=owner`, JSON key `owner` where Pibo-owned.
4. Add tests for the new strict behavior.

Verification:

```bash
npm run check:product-vocab -- --json
node --test test/legacy-product-vocabulary-gate.test.mjs
```

Expected final output:

```text
failures: 0
allowed: only docs/legacy/** and explicit license exclusions
```

### Phase 9 — Full validation and rollout

1. Docker/fresh-home validation:
   - `npm run typecheck`
   - `npm run build`
   - `npm test`
   - `cd packages/workflows && npm run typecheck && npm run build && npm test`
2. API recursive payload gate:
   - Chat bootstrap, sessions, rooms, agents, projects, workflows, Ralph, Cron, Web Annotations.
   - Fail if any JSON key/value contains removed vocabulary.
3. CLI/help gate:
   - `pibo --help` branches for `data`, `tools`, `browser-use`, `agent-browser`, `ralph`, `cron`, `debug`, `tui:sessions`.
4. DB schema gate:
   - Fresh home: no forbidden columns/tables/indexes.
   - Migrated Dev/Production after approved deploy: same check, plus `pibo_runs.controller_pibo_session_id` exists and old run column does not.
5. Dev deploy/test.
6. Production deploy/test after Dev passes.

## Acceptance Criteria

- [ ] `rg` over active source/tests/scripts/packages/skills/current docs finds zero removed terms.
- [ ] `npm run check:product-vocab -- --json` reports zero failures and no active-source allowlist.
- [ ] No CLI help output contains `owner`, `--owner`, `owner scope`, `principal`, or `app-context`.
- [ ] No Chat/Web/Ralph/Cron/Web Annotation API JSON contains removed keys or values.
- [ ] Fresh SQLite schemas contain no `owner_scope`, `principal_id`, `owner_pibo_session_id`, `room_members`, `principal_session_stats`, or `principal_room_stats`.
- [ ] Existing Dev/Production `pibo-events.sqlite` migrated from `owner_pibo_session_id` to `controller_pibo_session_id` under an explicit rollout step.
- [ ] `app-context` module no longer exists; app context is exposed through `src/app-context.ts`.
- [ ] Final-cutover CLI and migrator are gone from active code.
- [ ] Current docs and root agent-facing docs use only the new vocabulary.
- [ ] Historical evidence, if retained, lives only under `docs/legacy/**` or non-repo backup retention.

## Risiken und Entscheidungen

- **Breaking CLI change:** `--owner` for browser leases is agent-facing. Prefer a fast coordinated change to `--holder`; do not keep a compatibility alias if the final target is zero literal `owner` in active code/help.
- **Reliability DB migration:** `pibo-events.sqlite.pibo_runs` needs a safe startup migration. Validate on Dev before Production.
- **Third-party license text:** Do not rewrite legal license text. Exclude immutable license files from strict vocabulary scans or move vendored text outside active Pibo-owned docs.
- **Historical reports:** Reports are useful for audit but should not stay in current docs if the final gate scans current docs. Move them to `docs/legacy/reports/`.
- **This plan is temporary:** It necessarily contains the old words. After implementation, move it to `docs/legacy/plans/` before enforcing the final zero gate.

## Suggested execution model

Use one focused implementation loop/PR:

1. Rename app context and tests.
2. Remove final cutover code and docs from active surfaces.
3. Rename technical run/runtime/browser/tool terms.
4. Rewrite current docs and strict gate.
5. Full Docker validation.
6. Dev deploy/test.
7. Production deploy/test with explicit DB schema migration for `pibo-events.sqlite`.

Do not mix this with new product behavior. This is a vocabulary, compatibility-removal, and schema-polish cleanup after the completed app-space cutover.

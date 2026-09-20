---
type: "Investigation Report"
title: "Beta 4.0 core, plugin, bloat, and architecture audit"
description: "Evidence-based audit of the Beta 4.0 plugin-system branch covering baseline, inventory, core and plugin boundaries, legacy residue, dependencies, quality, and a phased cut-down roadmap."
tags: ["pibo-4", "beta", "core", "plugins", "architecture", "bloat", "audit"]
status: "draft"
authority: "informative"
generated:
  by: "muse-code/subagent"
  at: "2026-09-20T11:54:16Z"
sources:
  - id: "audited-code"
    resource: "commit:ece5f18cffe3f96f8f5dd8c241aac1d439c67b9a"
  - id: "inventory"
    resource: "/reports/beta-4-0-core-plugin-bloat-audit-2026-09-20-inventory.md"
---

# Beta 4.0 cut, bloat, and architecture audit

## Executive summary

The `beta/4.0-plugin-system` branch at `ece5f18c` (2026-09-20) contains the
Beta 4.0 packaging pipeline plus prebuilt artifacts from two different
commits, strictly separated in this report: a Sep 19 candidate assembly and
Standard tarball (150 MB, 21 plugins, pre-`remote-agent`) and a Sep 20
artifacts/core rebuild (22 plugin entries, post-merge). No fresh build was
executed in this audit, so no statement below claims a tested build outcome.
The old Ink TUI (`src/apps/cli-ui`),
`src/cli-session`, `src/local`, `src/pi-packages`, `src/vscode`, and the VS Code
extension sources were already deleted from HEAD in `42f117bf` (99 files).

The remaining cut-down potential is architectural, not legacy deletion:

1. Committed pibo4 state is inconsistent: the generator emits 22 plugin
   artifacts (`remote-agent` included) while the standard/assembly gates
   accept exactly 21 (F-01). No build was executed, so no build failure is
   claimed; the committed-vs-committed inconsistency itself is verified fact.
2. The "plugin-free" Minimal Core retains ≈11.4 MB of Pi-/Provider-Code
   (≈59% of the 19.3 MB bundle: ≈2.0 MB Pi own-code plus ≈9.4 MB nested
   third-party copies) through verified `src/core` value imports (F-02).
3. Six plugin backends are sized like engine copies (~11-18 MB each, Sep
   20) with identified value drag-ins; retained-bytes proof is still
   pending because backends emit no metafiles (F-03). Separately, 8+2
   browser bundles are byte-identical duplicates (F-04).
4. Several root dependencies are misclassified (runtime code in `devDepen-`
   dencies and vice versa), and source-level plugin independence does not
   exist: `packaged-*` shims import `src/tools`, `src/apps/chat`, `src/core`,
   and `src/agent-runtimes` directly, with bidirectional `plugins` /
   `apps/chat` coupling (F-08, F-10, F-11).

No implementation was done. All numbers below were measured read-only from the
checkout described in section 2; methods and limits are documented there.
Section 14 errata takes precedence wherever an earlier phrasing was
superseded by review.

## 2. Verified status and measurement method

- Branch: `beta/4.0-plugin-system`; HEAD `ece5f18cffe3f96f8f5dd8c241aac1d439c67b9a`
  (2026-09-20 11:00 +0200, merge of `feature/pibo-remote-agent`).
- `git status --porcelain` was empty at audit start; the branch is 4 commits
  ahead of `upstream/beta/4.0-plugin-system`. No branch switch, no checkout.
- Root `package.json` version is `1.7.2` (private root); the pibo4 assembly
  versions itself `4.0.0-beta.1` via `PIBO_RELEASE_VERSION`
  (`scripts/build-pibo4-minimal-core.mjs:6`).
- Three layers are kept apart throughout. **Committed** (`git show HEAD:`,
  verified 2026-09-20): the artifacts generator lists 22 plugin entries and
  the standard/assembly gates demand exactly 21. **Worktree sources** are
  identical to HEAD outside `docs/` (`git status` shows only this report's
  docs change set). **Worktree artifacts** (`dist/`, git-ignored) are a
  **mixed** tree: plugin artifacts and the core package were rebuilt
  2026-09-20 11:05-11:08 (post-merge, 22 plugins incl. `remote-agent`),
  while `dist/pibo4-standard-package` and the candidate assembly date from
  2026-09-19 23:46/23:47 (pre-merge, 21 plugins, `sourceCommit be84f259`).
  Every size claim below names its artifact and timestamp generation.
- One live gateway process was observed (PID 85532, from worktree
  `.worktrees/pibo-remote-agent`, loopback ports 4808/4809). It was not
  touched. Several dozen worktrees exist under `.worktrees/`; only reads were
  done outside the main checkout.
- Tools: `git`, `node` v24.21.0, `npm` 11.19.0 were available. `rg` was not
  installed (scoped `grep -r` on `src/` plus the bounded search tool were used
  instead). The `maintain-okf-docs` project skill was blocked (`workspace
  untrusted`); this report follows `docs/project/documentation-profile.md`
  manually (frontmatter, generated index entry, explicit log entry, ledger
  records).
- Forbidden by the task and therefore **not** done: builds, installs,
  network access, restarts, deploys, commits, branch switches, timed gateway
  starts. `--help`/`--version` on existing binaries and `npm`-free file
  measurements were the only executions. No finding claims a measured
  runtime behavior beyond those smoke runs.

## 3. Inventory (summary; full tables in the appendix)

- First-party sources, canonical reproducible count via
  `.tmp/beta4-source-inventory.py` (verified run 2026-09-20; base
  `git ls-files src packages`, `.ts/.tsx/.mts/.cts/.js/.mjs/.cjs/.jsx/.py`,
  `node_modules`/`dist`/`generated` excluded): **844 files / 231,878 LOC
  gross**, 0/0 generated, 25/7,209 colocated tests (all under
  `packages/workflows/src/testing/`), **819/224,669 net**. The earlier
  find-based 211,396 (`.ts/.tsx` worktree files under `src/` only) differs
  purely by method and is superseded. Largest areas: `src/apps` 69,958
  (chat-ui 46,401; chat backend 22,306; context-files-ui 771),
  `src/agent-runtimes` 23,491, `src/debug` 14,866, `src/core` 14,072,
  `src/tools` 11,747, `src/plugins` 7,814, `src/data` 7,145,
  `src/agent-runtime` 7,086. `packages/workflows/src`: 71 files, 20,412 LOC
(13,203 product + 7,209 colocated tests in `testing/`).
- Largest files: `src/apps/chat/web-app.ts` (6,862),
  `src/core/session-router.ts` (3,060), `src/apps/chat-ui/src/App.tsx`
  (2,354), `src/agent-runtimes/pi/routed-session.ts` (2,226),
  `src/session-ui/terminalRows.ts` (1,921), `src/debug/index.ts` (1,812).
- Tests: 505 `test/*.test.mjs` files (6.6 MB) plus 25 colocated
  `*.test.ts` files under `packages/workflows/src/testing/` (7,209 LOC;
  zero colocated tests under `src/`; no tracked `*.gen.ts`). Docs: `docs/`
  bundle plus `progress.txt` (~149 KB working notes, non-normative).
- On-disk: `node_modules` 1.2 GB, `dist` 857 MB (both ignored build output).
- Published-shape artifacts, strictly dated: Sep 19 assembly manifest: core
  tarball 5,644,732 bytes with **zero** declared dependencies; standard
  tarball 150,411,744 bytes, of which the `@openai/codex-linux-x64`
  platform tarball alone is 129,259,793 bytes. Sep 20 core rebuild:
  `executable-cli.js` 19,660,188 bytes, 19,286,272 retained bytes per
  metafile `bytesInOutput` (230 repo + 6,238 external esbuild *inputs*;
  inputs alone prove nothing about shipped bytes, see F-02).
  The generated core `package.json` has no `dependencies` field only because
  every build step uses `packages: "bundle"`
  (`scripts/build-pibo4-minimal-core.mjs:26,34,60`) and both web UIs are
  copied into the core package (`:71-82`); a missing manifest field is
  therefore **not** evidence of little third-party code. Bundle bytes and
  metafile inputs are the honest measures used here.
- Cold smoke (existing binaries, no rebuild): root `dist/bin/pibo.js
  --version` ~99-118 ms; core-package `--version`/`--help` ~480-533 ms
  (2 runs each, loads the 19.6 MB bundle even for `--version`, see F-17);
  standard-package `--help`/`--version` render correctly. All smoke runs
  used help/version only and returned before any state setup; no worktree
  change was observed afterwards.

## 4. Findings

Severity: C critical, H high, M medium, L low. Confidence: H/M/L.

### F-01 (H, prio P0, conf H): statically proven 22/21 gate contradiction; fresh build not executed

Committed `scripts/build-pibo4-artifacts.mjs:14-37` (verified via
`git show HEAD:`, 22 entries, including `remote-agent` at line 20 and the two
transcription plugins at lines 34-35) emits 22 plugin artifacts, while
committed `scripts/build-pibo4-standard.mjs:11-16` and
`scripts/build-pibo4-candidate-assembly.mjs:30-31,69` accept exactly 21 and
throw otherwise. Worktree sources are identical to HEAD for `scripts/`
(`git diff --stat -- scripts/` empty). The ignored worktree artifacts mirror
both sides of the drift: `dist/pibo4-artifacts/standard-package-set.json`
(Sep 20 rebuild, 22 entries) matches the committed generator, while
`dist/pibo4-standard-package` (Sep 19, 21 plugins, no `remote-agent`) is the
stale pre-merge output. Per code reading a fresh sequential build would reach
the `throw` at `pibo4:standard`, but no build was executed, so **no build
failure is claimed** — only the committed inconsistency, which blocks any
release-engineering claim of a green HEAD. Fix direction: decide whether
`remote-agent` joins Standard (gate to 22, description strings, assembly
counts) or stays a separate artifact (exclude list in the artifacts script,
not silent drift).

### F-02 (H, P0, conf H): Pi-/Provider-Code dominates the "plugin-free" core (≈59% retained bytes)

The core executable metafile (`dist/pibo4-core-executable.metafile.json`,
regenerated Sep 20) lists `@earendil-works/pi-coding-agent`,
`pi-agent-core`, `pi-ai`, `pi-server`, plus `better-auth`, `hono`, `openai`,
`@google/genai`, `@anthropic-ai/sdk`, `google-auth-library`, `kysely`, and
`zod` among bundled *inputs*. Inputs alone prove nothing about shipped
bytes, so this finding was re-measured by summing esbuild `bytesInOutput`
over the Sep 20 core metafile (inputs with `bytesInOutput: 0`, e.g.
`pi-coding-agent/dist/index.js`, confirmed 0, contribute nothing). Retained
total: 19,286,272 bytes. Retained under Pi package paths: ≈11.37 MB
(≈59%), split into ≈2.00 MB Pi own-code in 1,063 files and ≈9.37 MB nested
third-party copies under `pi-coding-agent/node_modules/`: jiti 2.39 MB
(incl. `babel.cjs` 2.12 MB), undici 1.09 MB, nested `pi-ai` 1.03 MB, nested
`@google/genai` 727 KB, nested `@anthropic-ai/sdk` 605 KB, nested
`pi-agent-core` 413 KB, nested `openai` 399 KB, nested `typebox` 398 KB,
nested `pi-tui` 292 KB (incl. `tui-alt-screen.js`), nested `yaml` 264 KB,
nested `google-auth-library` 253 KB, nested `highlight.js` 212 KB,
`esbuild/lib/main.js` 105 KB. Largest retained Pi own-code modules:
provider data JSONs (`openrouter.json` 164 KB, `vercel-ai-gateway.json`
78.9 KB), `pi-ai` API modules (`openai-completions.js` 50 KB,
`openai-codex-responses.js` 46 KB, `anthropic-messages.js` 40.6 KB),
`settings-manager.js` 33 KB, `session-worker.js` 27.9 KB,
`model-runtime.js` 22.8 KB. Sampled nested-vs-top duplicates (same file
retained twice): `openrouter.json` 164,004+164,003,
`vercel-ai-gateway.json` 78,855+78,854, `openai-completions.js`
50,172+49,990 bytes. "Whole engine" is therefore withdrawn as a claim; the
proven claim is the retained-bytes split above.
The verified repo-side drag-in path (all files confirmed `IN` the bundle
input set) is: `executable-cli` → `gateway/web` → `apps/chat`
(`chat-request-normalizers.ts`, `chat-settings-routes.ts`) →
`core/compaction-prompt.ts` (`serializeConversation`/`convertToLlm` used at
:189-200, `completeSimple` default at :240, `buildSessionContext` at :387)
and `agent-runtime/routed-session.ts` → `core/provider-recovery.ts`
(`isRetryableAssistantError` used at :60). Correction: `SettingsManager` in
`compaction-prompt.ts:16` is type-only (used only at :380) and is no drag-in
evidence; `settings-manager.js` is retained via the value chain instead.
The existing gate (`scripts/build-pibo4-minimal-core.mjs:170-205`) only
forbids `src/agent-runtimes/*` paths and driver symbols, so engine-via-`src/core`
passes silently. The generated core manifest's missing `dependencies` field
must not be read as slimness: it is the direct result of `packages: "bundle"`
plus the copied web UIs. Fix direction: move compaction/recovery helpers
behind the `runtime-pi` plugin (or a shared internal package with explicit
re-export), and extend the gate with a retained-bytes budget per package
family.

### F-03 (H, P1, conf M): six plugin backends are sized like engine copies; retained proof pending

Uncompressed Sep 20 `backend.mjs` sizes: `runtime-pi` 18.6 MB (legitimate),
`remote-agent` 16.1 MB, `codex-compat` 11.1 MB, `runtime-omp` 11.0 MB,
`file-editing` 10.9 MB, `transcription-openai[-chatgpt]` ~10.9 MB each, all
with ~2,420 `pi-coding-agent`/`buildSessionContext` string markers. The two
transcription backends differ by only 4,934 bytes across ~10.9 MB (`cmp -l`).
Correction vs the first draft: the artifacts script emits no per-backend
metafiles, so per-module retained bytes (as in F-02) are **not** proven here;
sizes plus markers plus the identified value drag-ins below make engine
inclusion highly likely but the honest claim is size/marker-consistent, not
retained-proven. Drag-in roots: `src/tools/hashline.ts:3-7`
(`createReadToolDefinition`, via `packaged-file-editing.ts:1`),
`src/transcription/openai.ts:1` (imports
`../agent-runtimes/pi/credentials.js`, crossing the adapter boundary),
`src/remote-agent/modules/bash.ts:1` (`createBashToolDefinition`),
`src/agent-runtimes/omp/history.ts:3-4` (`contentText`, `parseSessionEntries`).
Fix direction: credential/tool facades owned by core or `runtime-pi` with
injection, so feature plugins never import engine or adapter modules; first
emit a metafile per plugin backend so the follow-up can assert retained
bytes instead of sizes.

### F-04 (M, P1, conf H): byte-identical duplicate browser bundles

`md5sum` proves 8 identical `browser/index.js` files (hash
`62c3f8c0b88985fdbcf6b371774aa0b4`, 18,350 bytes: web-search, run-control,
mcp-cli, gateway-tools, code-runtime, file-editing, browser-tools,
codex-compat) and 2 identical `RuntimeRequestsView` bundles (`1f948750...`,
18,618 bytes: runtime-codex-native, runtime-muse-native). Root cause:
`scripts/build-pibo4-artifacts.mjs:15-37` bundles the same
`tool-family-view.tsx` / `runtime-requests-view.tsx` per plugin. Fix
direction: shared `pibo-plugin-ui` browser asset or host-provided view with a
plugin manifest reference.

### F-05 (M, P1, conf M): Minimal Core is feature-minimal but stack-maximal

`dist/pibo4-core-package/dist` is 26 MB: 19.6 MB executable plus the full
Chat Web UI (`dist/apps/chat-ui` 3.1 MB, pruned by reachability in
`build-pibo4-minimal-core.mjs:84-107`) and `context-files-ui` 2.8 MB.
`src/core/executable-cli.ts:124-167` exposes only `gateway:web`; there is no
core-only CLI for config/debug/doctor. This is explicitly **not** a call for
a headless core: the five core views (Settings, Agent Designer, Kontext,
Session Inspector, Raw Events) are a decided product requirement that must
work with zero plugins installed
(`docs/plans/pibo-4-0-plugin-completion.md:74-79,164,184,496`,
`docs/plans/pibo-4-0-plugin-completion-todo.md:49,83-90`). A headless
composition would be a separate product decision (see section 5.3), not part
of behavior-neutral cleanup. The in-scope optimization is bundle hygiene
*within* that decision: module allowlist (F-02), startup latency (F-17), and
a core CLI that also serves config/debug/doctor without feature code.

### F-06 (M, P2, conf H): Standard always ships the 129 MB Codex platform binary

`scripts/build-pibo4-standard.mjs:20-47,62-64` copies `@openai/codex` plus the
build-platform package into `node_modules` and `bundledDependencies`, so the
Sep 19 standard tarball carries a 129 MB platform binary. Correction:
`optionalDependencies` is not on-demand — npm installs it by default and it
only tolerates install failure — so "make it optional" alone changes nothing
about the default install size. Real options: a composition without the
codex plugin/platform binary (separate `standard` vs `standard+codex`
assemblies), a documented manual install step for codex users, or a
platform-targeted assembly built per host. No megabyte target is claimed;
the delta is measurable from both compositions' tarball bytes.

### F-07 (M, P0, conf H): old TUI/VS Code sources already removed; residue itemized

Commit `42f117bf` (2026-09-13) deleted 99 files: `src/apps/cli-ui/*` (Ink
TUI), `src/cli-session/*`, `src/local/*` (incl. `tui.ts`),
`src/pi-packages/*`, `src/vscode/*`, `src/apps/chat-vscode/extension/*` and
`webview/*`, `src/plugins/chat-vscode-web.ts`, `scripts/vscode-*.mjs`,
ink/vscode/cli-ui tests. Remaining residue inside the approved old-extension
and old-TUI scope: (a) untracked `src/apps/chat-vscode/dist/` (964 KB stale
build output, not in git); (b) stale `package.json:35-43` `files` exclusions
for `dist/apps/{chat-vscode-web,cli-ui}`, `dist/{cli-session,local,
pi-packages,vscode}`, `dist/plugins/chat-vscode-web.*`; (c) the `runPiboTui`
chain (`src/agent-runtimes/pi/runtime.ts:656` via `src/core/runtime.ts` to
`src/index.ts:255`). Explicitly **not** in deletion scope: the small live
`vscode-web` plugin (`src/plugins/packaged-vscode-web.ts`, 44 lines: one
env-driven API route; `src/apps/chat-ui/src/plugins/vscode-view.tsx`, 135
lines: same-origin iframe view) plus its docs (`docs/specs/vscode/*`,
`docs/project/vscode-web-integration.md`, `docs/project/guides/
pibo-vscode-ext-quickstart.md`, `docs/project/operations/
vscode-extension-release.md`, already excluded from packing). The user
released the old extension and the old TUI, not the browser IDE; `vscode-web`
is therefore marked keep-optional pending a separate product decision
(section 5.3), removed from every approved-deletion list in this report.

### F-08 (M, P1, conf H): root dependency labels need owner/artifact mapping, not blanket moves

Correction vs the first draft: the root is a private build workspace
(`private: true`, `prepublishOnly` guard), so a bundled runtime dependency
sitting in root `devDependencies` is a labeling/ownership matter, not per se
a bug — what matters is which artifact each entry serves. Verified mapping:
`@openai/codex` serves the `runtime-codex-native` plugin (already declared
in its generated plugin manifest; the root entry is the workspace provider
for the dev tree and the standard bundle); `@muse-code/sdk` likewise serves
`runtime-muse-native` (6 importer files). `jsonwebtoken` serves only release
scripts (`scripts/lib/github-app-auth.mjs`, `scripts/test-github-app-auth.mjs`)
plus one test. `acorn`/`acorn-walk` serve the `browser-tools` feature at
runtime: dev resolves them from the workspace via
`packageRequire.resolve` fallback, packed plugins use the vendored `.cjs`
copies (`src/tools/codex-browser-node-repl.ts:9-14`,
`scripts/build-pibo4-artifacts.mjs:100-101`). `@mdxeditor/editor` is UI
runtime code, not build tooling: value import plus CSS in
`src/apps/shared/MarkdownEditor.tsx:1,38,61`, consumed by 5 editor surfaces
(`ContextFilesView`, `WorkflowPromptAssetEditor`, both `context-files-ui`
entry points) — currently misfiled under root `devDependencies`. `vite`,
`@tailwindcss/vite`, `tailwindcss` serve only the two `vite.config.ts`
builds. `xstate` is declared both at root and in `packages/workflows`
(same 5.31.1; drop the root copy). Fix direction: keep workspace entries
but document owner/artifact per row (section 6) and move only genuinely
build-only or runtime-misfiled rows so an `--omit=dev` source build keeps
working.

### F-09 (L, P2, conf H): single-purpose and shim-only dependencies

`tiktoken` (1 importer: `src/shared/tool-call-metrics.ts`), `lexical` (1:
`src/apps/shared/MarkdownEditor.tsx`), `prismjs` (2 byte-identical
`prism-client.ts` copies), `react-markdown` (1), `@uiw/react-json-view` (1),
`@xyflow/react` (2 workflow files), `react-virtuoso` (3), `@vscode/ripgrep`
(only `src/bin/rg.ts`, a 22-line spawn shim behind the published `rg` bin).
Each needs a keep/replace decision, not bulk deletion; the `rg` bin's product
reason should be confirmed first.

### F-10 (H, P1, conf H): plugins are independent only at bundle level

`packages/` contains exactly one directory, `packages/workflows`; there are
no per-plugin source packages. Every `packaged-*` backend imports straight
from `src/`: `../tools/*`, `../apps/chat/*` (`packaged-cron`,
`packaged-goal-loops`, `packaged-remote-agent`), `../core/*`,
`../agent-runtimes/*` (all four runtime plugins). Browser views are compiled
from scattered `src/apps/chat-ui/src/plugins/*.tsx`, skills from
`skills/builtin/*`, context from `context/`, and parser copies from
`node_modules` (`scripts/build-pibo4-artifacts.mjs:85-146`). The `workflows`
plugin backend is a 267-byte view-only stub
(`src/plugins/packaged-workflows.ts:1-6`) while the engine lives in
`src/apps/chat/workflow-*.ts` (20 files, inside the core bundle) and
`packages/workflows`. Correction vs the first draft: the claim is scoped to
the 22 concrete first-party backends, which cannot be developed, versioned,
or tested outside this repo as long as they import across `src/`. The plugin
contract itself does support external plugins, proven by
`examples/plugins/hello-pibo` (`package.json` with
peerDependency `@pasko70/pibo ^4.0.0-beta.1`, `src/backend.ts`,
`src/browser.ts`, `pibo.plugin.json`).

### F-11 (M, P1, conf M): bidirectional `plugins` / `apps/chat` coupling

Seven files under `src/plugins/` import `../apps/chat/*`
(`chat-custom-agents`, `cli`, `packaged-cron`, `packaged-goal-loops`,
`packaged-remote-agent`, `packaged-web-product`, `product-services`) while
eight files under `src/apps/chat/` import `../../plugins/*`
(`agent-profiles`, `agent-store`, `chat-capability-routes`, `loop-api`,
`plugin-browser-routes`, `plugin-management-routes`, `remote-agent-api`,
`web-app`). Pair-level cycle verification was not run (no cycle detector
installed; not installed per task rules), so this is layering debt, with
concrete extraction blockers either way.

### F-12 (L, P2, conf H): deprecated `core/runtime.ts` re-export widens graphs

`src/core/runtime.ts:1-5` is a 5-line deprecated `export *` of
`../agent-runtimes/pi/runtime.js`, so any value import of `core/runtime.js`
(e.g. `inspectPiboProfile` in the dev CLI path, `src/cli.ts:457`) loads the
whole Pi adapter under `tsx`. The file is correctly absent from the core
executable bundle (0 `src/agent-runtimes` inputs), but it remains a trap for
new code; point importers at `agent-runtime/*` or the plugin SDK instead.

### F-13 (M, P2, conf M): complexity concentrations in a few giant modules

`web-app.ts` (6,862 lines), `session-router.ts` (3,060),
`chat-ui/App.tsx` (2,354), `pi/routed-session.ts` (2,226),
`session-ui/terminalRows.ts` (1,921), `debug/index.ts` (1,812),
`agent-store.ts` (1,726) dominate maintenance risk. `src/debug/` (42 files,
14,866 LOC) is correctly excluded from the core bundle (0 inputs) but ships
in dev/dist; splitting it by domain can wait until after boundary fixes.

### F-14 (M, P2, conf H): `src/ralph` is an unused island; active ralph surface runs on `loops`

Confirmed by the independent cross-check `.tmp/beta4-baseline-legacy-review.md`
N1 (§185-197), re-verified here. Island: the only in-`src` importer of the
`src/ralph` tree is `src/apps/chat/ralph-api.ts:3-9`, which itself has zero
`src` importers (only `test/loop-api.test.mjs:51` reading it as text, plus
dist-path test imports); `src/ralph/cli.ts` (`runRalphCli`) has zero
importers; `createPiboRalphChannel` has zero callers; `RalphArea.tsx` has
zero importers (only its own test); `api.ts` consumers never call
`getRalph*`; `App.tsx` has zero `ralph` hits; the browser entry exports
only `LoopsView`. Active ralph surface, all on `loops`: `/api/chat/ralph*`
is served by `handleChatLoopApiRequest` via plugin route registration
(`src/plugins/packaged-goal-loops.ts:50-52`, legacy rewrite at
`src/apps/chat/loop-api.ts:43-58` with `ralph` default mode on old paths);
CLI `pibo ralph` aliases `runLoopCli` (`src/cli.ts:237-239,396-404`); UI
renders the Loops area for both `/loops` and legacy `/ralph`
(`app-routes.ts:65`, path-only route `main.tsx:73-75`) with a goal/ralph
mode switch (`LoopArea.tsx:203`); no `packaged-ralph` plugin exists.
Preserved regardless of any island decision: existing data (same default
file `pibo-ralph.sqlite`, `src/loops/store.ts:227`, superset schema over
the same table names, `loop_mode` defaulting to `'ralph'` at `:111`) and
the loop ralph mode (`store.ts:250` `ralph_` IDs, `service.ts:572,608-611`
compat events, `loop-api.ts:43-58`, `prompts.ts:7-13` ralph turn prompt).
Status: deletion candidate for the Gesamtplan, not approved deletion;
blockers are the dist-path ralph/loop test suites and the still-unexecuted
legacy-row tolerance check of loops `jobFromRow`.

### F-15 (L, P3, conf M): OMP is an external-harness runtime, still Pi-coupled

`src/agent-runtimes/omp/` (13 files) spawns an external OMP CLI over Bun
(`src/agent-runtimes/omp/config.ts:74-80`, protocol from `@oh-my-pi`),
yet `src/agent-runtimes/omp/history.ts:3-4` imports `contentText` and
`parseSessionEntries` from Pi packages, producing an 11 MB backend. Keep it a
first-party optional plugin after decoupling; externalization is a user
decision.

### F-16 (L, P2, conf M): versioning and publish-shape confusion

Root stays `1.7.2`/`private` while the Beta line versions `4.0.0-beta.1`
only through generated manifests; `prepublishOnly` blocks root publishing and
`scripts/release.mjs` owns releases. The shape works but is implicit; the
target architecture should name exactly one version source per publishable.

### F-17 (M, P2, conf H): static gateway import taxes even `--version`

`src/core/executable-cli.ts:5` statically imports `runWebGatewayServer` from
`../gateway/web.js`, while the `--help`/`--version` early returns only happen
at lines 126-133 — after the whole module graph is loaded. Measured safely on
the existing artifact (help/version runs only, no state setup): the core
binary answers `--version`/`--help` in ~480-533 ms (19.6 MB bundle parse and
load), versus ~99-118 ms for the unbundled root `dist/bin/pibo.js` shim.
Fix direction (corrected: a bare dynamic `import()` inside the single-file
bundle is no code splitting and alone changes nothing measurable): move the
gateway server behind a real split — either a separate esbuild chunk
(multi-output code splitting) or an unbundled file loaded dynamically after
argument parsing — then measure the `--help`/`--version` delta
before/after. No millisecond target is claimed. This preserves the decided
core surface (F-05); it only defers loading it.

## 5. Deletion and move matrices

### 5.1 Safe to delete (no committed consumers)

| Bundle | Paths | Evidence |
|---|---|---|
| Stale VS Code build output (untracked) | `src/apps/chat-vscode/` (964 KB, `dist/` only) | `git ls-files` empty; sources deleted in `42f117bf` |
| Stale pack exclusions | `package.json:35-43` (`chat-vscode-web`, `cli-ui`, `cli-session`, `local`, `pi-packages`, `vscode` entries) | Sources deleted in `42f117bf`; `ls dist/apps` shows only `chat`, `chat-ui`, `context-files-ui` |
| Duplicate prism client | one of `src/apps/chat-ui/src/context/prism-client.ts`, `src/apps/context-files-ui/src/prism-client.ts` | `diff -q` identical |
| Duplicate root `xstate` declaration | `package.json` (`xstate 5.31.1`) | `packages/workflows/package.json` already declares it; zero `src/` importers |

### 5.2 Delete after decoupling (behavior preserved)

| Bundle | Paths | Blocker |
|---|---|---|
| `runPiboTui` chain | `agent-runtimes/pi/runtime.ts:656`, `core/runtime.ts`, `index.ts:255` export | Confirm no external consumer of the library export; keep Pi adapter itself |
| Dead `ralph` parallel stack | `src/ralph/*`, `src/apps/chat/ralph-api.ts`, `RalphArea.tsx`, `api-ralph.ts` | Rewrite 9 `test/ralph-*` + `loop-*` suites; verify legacy-row tolerance of loops `jobFromRow` (F-14) |
| Duplicate browser bundles | per-plugin copies of `tool-family-view` / `runtime-requests-view` | Shared browser asset or host view (F-04) |
| Pi copies in feature backends | engine code inside 5 non-Pi `backend.mjs` files | Facade/injection refactor (F-03) |

### 5.3 User decision required

| Candidate | Options |
|---|---|
| `rg` bin + `@vscode/ripgrep` | Keep as product feature, move to tools install, or drop (only consumer is `src/bin/rg.ts`) |
| OMP runtime plugin | Keep first-party optional, externalize, or drop if the OMP CLI line is dead |
| `ralph/` vs `loops/` | Keep both, consolidate after behavior diff, or freeze `ralph/` read-only |
| Single-use deps (`tiktoken`, `lexical`, `prismjs`, `@xyflow`, `react-virtuoso`) | Keep with reason, replace with lighter local code, or drop the using view |
| `standard-profiles` + `preview` + `gateway-tools` in every install | Keep in Standard or split into purpose compositions |
| Headless core (no web/auth) | Separate product decision only; F03/F06 require the five core views with zero plugins, so this is out of behavior-neutral cleanup scope |
| `vscode-web` browser-IDE plugin + docs | Keep, optional; separate product decision only — explicitly not covered by the old-extension/TUI release (F-07) |

### 5.4 Keep (verified live, not bloat)

`src/debug/` (dev/dist operator tooling, excluded from core bundle);
`src/session-ui/` (used by 14 chat-ui files, not dead); `src/compute/`,
`src/setup/`, `src/resources/`, `src/previews/` (operator surfaces);
`packages/workflows` (real engine + tests); `test/` and `docs/` as a whole
(no bulk deletion case was found).

## 6. Dependency matrix (root `package.json`, HEAD)

Legend: C core-needed, O optional-by-plugin, D dev/build-only, ? needs
decision. "Importers" counts `src/` files with a `from`-import (grep run,
2026-09-20); `packages/`, `scripts/`, `test/` noted separately.

| Package | Declared | Importers | Class | Potential |
|---|---|---|---|---|
| `@earendil-works/pi-coding-agent` | deps 0.85.0 | core 5 value-files + adapters + 4 feature drag-ins | C today, O target | Keep; remove non-`runtime-pi` value imports (F-02, F-03) |
| `@earendil-works/pi-agent-core`, `pi-ai` | deps 0.85.0 | types widely; values in `compaction-prompt`, `provider-recovery`, `providers/*`, `omp/history` | C today, O target | Same as above |
| `@earendil-works/pi-server` | deps 0.85.0 | 0 direct; bundled transitively | C today | Keep while Pi ships; re-check after F-02 |
| `commander` | deps | 13 CLI files | C | Keep |
| `better-auth` (+ hono/kysely/jose/zod transitively) | deps 1.6.30 | 1 (`auth/better-auth.ts`) | C for gateway | Keep; headless core (F-05) would make it optional |
| `@modelcontextprotocol/sdk` | deps | 4 | C | Keep |
| `typebox` | deps 1.1.38 | 18 | C | Keep |
| `react`, `react-dom`, `lucide-react` | deps | 91 / 7 / 66 (chat-ui) | C for web | Keep; belongs to a web package long-term |
| `@tanstack/*` | deps | 15 | C for web | Keep |
| `react-virtuoso`, `react-markdown`+`remark-gfm`, `@uiw/react-json-view`, `@xyflow/react`, `lexical`, `prismjs` | deps | 3/1/1/2/1/2 | ? | Keep-with-reason or replace per view (F-09) |
| `tiktoken` | deps | 1 (`shared/tool-call-metrics.ts`) | ? | Confirm value vs bundle cost |
| `vite`, `@tailwindcss/vite`, `tailwindcss` | vite dev; tailwind deps | 2 (`vite.config.ts` only) | D (owner: web builds) | Move tailwind pair to devDependencies (hygiene) |
| `@openai/codex` 0.153.2 | devDeps | `codex-native/process.ts`, `packaged-runtime-codex-native.ts` | O runtime (owner: `runtime-codex-native` plugin) | Keep as workspace provider; already in plugin manifest; document owner |
| `@muse-code/sdk` 1.3.0 | devDeps | 6 `muse-native/*` files | O runtime (owner: `runtime-muse-native` plugin) | Same: workspace provider, document owner |
| `@mdxeditor/editor` | devDeps (misfiled) | value+CSS import in `apps/shared/MarkdownEditor.tsx`, 5 editor surfaces | C for web | Move to dependencies (UI runtime code) |
| `jsonwebtoken` 9.0.2 | deps | 0 in `src/`; 2 scripts + 1 test | D (owner: release scripts) | Move to devDependencies |
| `acorn`, `acorn-walk` | deps | runtime-resolved w/ vendored fallback (`codex-browser-node-repl.ts:9-14`) | O runtime (owner: `browser-tools`) | Keep as workspace provider; document owner |
| `xstate` 5.31.1 | deps + workflows deps | 0 in `src/`; workflows pkg | O (owner: workflows pkg) | Drop root declaration |
| `yaml` | devDeps | scripts only | D | Keep in devDependencies |
| `@vscode/ripgrep` | deps | 1 (`bin/rg.ts`) | ? | Decide with the `rg` bin (F-09) |
| `@vitejs/plugin-react`, `tsx`, `typescript`, `vite-tsconfig-paths`, `@types/*`, `esbuild`, `react-test-renderer` | devDeps | build/test only | D | Keep |

No new dependency is proposed as a bloat fix. The repeated cost driver is
not the count of dependencies but whole-engine bundling per artifact.

## 7. Target architecture (no multi-repo, no micro-packaging)

Keep the monorepo. Introduce source-level package boundaries inside it:

```text
packages/
  core/            # router, sessions, agent-runtime contracts, plugins SDK/host/runtime,
                   # tools contracts + MCP bridge, reliability, signals, config
                   # (zero Pi engine, zero feature/runtime code; web/auth stay per F03/F06)
  web/             # gateway:web, apps/chat backend, auth service, chat-ui + context-files-ui builds
  runtimes/
    pi/            # Pi adapter + compaction/recovery/Pi-credential facades (owns pi-* deps)
    codex-native/  # owns @openai/codex
    muse-native/   # owns @muse-code/sdk
    omp/           # external CLI adapter
  features/        # one dir per first-party plugin backend; imports only core contracts
  workflows/       # as today (already isolated)
src/               # delete after moves; dev CLI re-exported from packages
```

Rules: `core` never imports adapters or features and embeds no engine code;
features import only `core` (+ their own declared deps); `web` (part of the
decided core distribution per F03/F06: five core views, auth, sessions) loads
features through the plugin host only; the pibo4 gates assert module-level
allow/deny lists instead of path fragments. Compositions: `core` (with the
decided web/auth surface), `standard` (curated set), per-purpose sets. A
headless `core` without web/auth is deliberately **not** in this target: it
would contradict the F03/F06 product decision and needs its own decision.

## 8. Prioritized PR roadmap

| Phase | Goal | Areas | Size | Benefit | Risk | Acceptance |
|---|---|---|---|---|---|---|
| P0 | Resolve 21-vs-22 inconsistency; decide `remote-agent` membership | `scripts/build-pibo4-*`, standard set, descriptions | S | Generator/gate consistent again; full `npm run build` passes (to be measured, was not executed in this audit) | Low | `npm run build` + `pibo4:standard` + assembly at HEAD |
| P0 | Remove safe residue | untracked `chat-vscode/dist`, stale `files` exclusions, dup prism client, root `xstate` | S | 964 KB untracked output removed + manifest/dup hygiene (measured file list) | Very low | Focused tests + `docs:validate` |
| P1 | Emit per-plugin-backend metafiles; assert retained bytes | artifacts script + gates | S | F-03 provable instead of size-inferred (measured) | Low | Metafile budgets in CI |
| P1 | Decouple Pi from core (`compaction-prompt`, `provider-recovery`) | `src/core/*`, `runtime-pi` facade | M | Pi-path retained bytes compared via metafile diff before/after (no drop target claimed) | Medium (compaction paths) | Router/compaction/provider tests + retained-bytes budget gate |
| P1 | Decouple Pi from feature plugins (`hashline`, transcription creds, remote-agent bash tool, omp history) | `src/tools`, `src/transcription`, `src/remote-agent`, `omp` | M | Shrinkage TBD, proven via backend metafiles before/after (no KB target claimed) | Medium | Plugin contract tests + per-plugin retained-bytes budgets |
| P1 | Deduplicate browser views | artifacts script, host view or shared asset | S | 8+2 duplicate bundles collapse (measured md5/size) | Low | UI plugin tests + headful smoke |
| P2 | Codex-less Standard composition (separate assembly) | standard composition, install docs | S-M | Size delta measured from both assemblies' tarball bytes (no MB target claimed) | Medium (install flows) | Offline + online install matrix per composition |
| P2 | Remove dead `ralph` stack (candidate, not approved) | `src/ralph`, ralph-api, RalphArea, api-ralph, 9+ test files | M | ~1.3k LOC + dead UI/API gone (measured file count) | Medium (tests + legacy rows) | Rewritten suites green; legacy-row read check |
| P2 | Document dep owner/artifact mapping; move misfiled rows | root manifest labels + docs | S | Install-shape correctness, no behavior change | Low | `--omit=dev` source build + focused suites |
| P2 | Retire `runPiboTui` chain | pi runtime export, `core/runtime.ts`, index export | S | Smaller API surface | Low | API/type tests, docs updated |
| P2 | One-way `plugins` vs `apps/chat` layering | 15 coupled files | M-L | Extractable chat/plugin packages | Medium | Full suite + import-lint gate |
| P2 | Split gateway behind discovery commands (real chunk split) | executable-cli + bundle config | S | Latency delta measured before/after on `--help`/`--version` (no ms target claimed) | Low | Startup-latency check + gateway boot suite |
| P3 (only with product decision) | Headless core composition | executable-cli, web split | M | Slim installable core beyond F03/F06 | Medium | Separate decision record + core-only offline install test |
| P3 | `loops` legacy-row tolerance proof (feeds P2 ralph removal) | loops store vs old ralph rows | S | Deletion safety for old data (measured fixture) | Low | Fixture test over legacy-shaped rows |
| P3 | Giant-module splits (`web-app`, `session-router`, `App.tsx`) | 3 files | L | Maintainability (estimated) | Medium | Same behavior, focused suites |

Rollback: a plain `git revert` is sufficient only for source-only phases.
Every phase that changes packaging, install layout, or state handling rolls
back to the previous consistent assembly (pinned candidate with verified
manifest hashes, e.g. the accepted Sep 19 assembly) plus a state snapshot
taken before the change (`pibo.sqlite`, payload storage, Better-Auth data,
plugin data). Data safety additionally comes from unchanged SQLite schemas
and binding/history formats — no phase above migrates them — but the
snapshot, not the schema argument, is the rollback mechanism. Sessions,
history, auth stores, and plugin data are re-proved after every rollback by
the validation plan.

## 9. Validation plan

- Baseline now (read-only, reproducible): record `git rev-parse HEAD`,
  `standard-package-set.json` plugin list, assembly manifest hashes, tarball
  bytes, core metafile module list, and the smoke outputs in section 3.
- After each phase: `npm run typecheck`, the focused suites named above, plus
  `npm run docs:validate`, `docs:indexes:check`, `docs:log:check` for doc
  touches. Full `npm test` before any merge (it rebuilds; run in an isolated
  worker, never beside the live gateway in section 2).
- New permanent gates: (a) core-only clean install test (offline where the
  cache allows, asserting zero/default plugin boot); (b) plugin
  install/uninstall smoke per packaged plugin; (c) esbuild retained-bytes
  budgets per package family (requires backend metafiles first, P1 item)
  plus a duplicate-hash scan for browser assets; (d) dependency/import lint
  (no engine imports outside `runtime-pi`, no `apps/chat` imports from
  `plugins/*` once P2 lands).
- Data safety nets: back up `pibo.sqlite`, payload storage, and
  Better-Auth data before any distribution-layout change; verify old Pi and
  Codex sessions still turn after restart (same recipe as the Sep 15 Pibo2
  acceptance); keep downgrade path = previous Standard assembly reinstall.

## 10. Open questions and limits

1. Is `remote-agent` the 22nd Standard plugin, or a separate install?
2. Is OMP's external CLI line alive (keep/externalize/drop)?
3. What is the `rg` bin's product reason (keep/move/drop `@vscode/ripgrep`)?
4. Which single-use UI deps are worth their cost (`tiktoken`, `lexical`,
   `prismjs`, `@xyflow`, `react-virtuoso`)?
5. Headless core is out of cleanup scope per F03/F06 — confirm no separate
   product decision for it is wanted in this round.
6. `vscode-web` browser-IDE view: keep by default (not covered by the
   old-extension/TUI release); a removal would need its own product
   decision — confirm none is wanted in this round.

Limits: no build, install, or network run was allowed, so F-01 rests on
committed gate code plus the committed generator list (verified fact) without
an executed-build claim; bundle contents rest on the Sep 20 metafile and
artifact bytes, not a fresh rebuild; pair-level import cycles were not
machine-checked; LOC counts are `wc -l` including blanks and comments;
telemetry/perf claims would need the live gateway, which was deliberately
left alone. The only executions were `--help`/`--version` smoke runs and
read-only file measurements.

## 11. Central reading list (verify the key claims here)

1. `scripts/build-pibo4-artifacts.mjs:14-37` - 22 plugin entries built.
2. `scripts/build-pibo4-standard.mjs:11-17,62-64` - 21-gate plus Codex bundling.
3. `scripts/build-pibo4-candidate-assembly.mjs:30-31,69` - 21/26 assembly gates.
4. `scripts/build-pibo4-minimal-core.mjs:170-205` - path/symbol gate (no module allowlist).
5. `src/core/compaction-prompt.ts:1-30` and `src/core/provider-recovery.ts:1` - Pi value imports in core.
6. `src/tools/hashline.ts:1-12`, `src/transcription/openai.ts:1`,
   `src/remote-agent/modules/bash.ts:1`, `src/agent-runtimes/omp/history.ts:1-6` - feature drag-ins.
7. `src/core/executable-cli.ts:5` (static gateway import) and `:124-167`
   (core CLI exposes only `gateway:web`; measured ~500 ms vs ~118 ms for
   `--version`).
8. `src/core/runtime.ts:1-5`, `src/agent-runtimes/pi/runtime.ts:656`,
   `src/index.ts:255` - `runPiboTui` re-export chain.
9. `src/plugins/packaged-workflows.ts:1-6` vs `src/apps/chat/workflow-*.ts` - stub plugin, core-side engine.
10. `src/plugins/packaged-vscode-web.ts` (full, 44 lines) and
    `src/apps/chat-ui/src/plugins/vscode-view.tsx:1-50` - remaining vscode-web scope.
11. `package.json:35-64,113-167` - stale `files` exclusions and dep classification.
12. `src/bin/rg.ts` (full, 22 lines) - sole `@vscode/ripgrep` consumer.
13. `packages/workflows/package.json:19-21` - own `xstate` declaration.
14. `src/apps/chat/ralph-api.ts:1-13` and `src/loops/cli.ts:38` - ralph/loops coexistence.
15. `docs/plans/pibo-4-0-plugin-completion-todo.md:30-43,49,83-90` and
    `docs/plans/pibo-4-0-plugin-completion.md:74-79,164,184,496` - prior
    completion claims plus the binding five-core-views requirement.

## 12. Review corrections and limitations (2026-09-20 review pass)

The report owner reviewed the first draft and ordered 9 corrections; all are
applied and re-verified below. No implementation was done.

1. No-build honesty: F-01 now reads "statically proven 22/21 gate
   contradiction; fresh build not executed". "Working HEAD distribution" was
   removed from the executive summary; Sep 19 (assembly/standard, 21
   plugins) and Sep 20 (artifacts/core rebuild, 22 entries) artifacts are
   labeled at every claim.
2. Retained bytes, not inputs: F-02 was re-measured via `bytesInOutput`
   (19,286,272 retained; ≈2.00 MB Pi own-code + ≈9.37 MB nested third-party
   ≈59%). `pi-coding-agent/dist/index.js` at 0 bytes is confirmed and
   explained (tree-shaken entry, large retained set anyway). "Whole engine"
   is withdrawn; named modules and the verified drag-in path replace it.
   `SettingsManager` was type-only and removed from the evidence. F-03 was
   downgraded to size/marker-consistent (conf M) because plugin backends
   emit no metafiles; emitting them is now a P1 roadmap item.
3. `vscode-web` is not deletion-approved: removed from every approved list,
   marked keep-optional pending a separate product decision.
4. Headless core stays an alternative product option, never the default
   refactoring plan (F03/F06 keep the five core views).
5. Root is a private build workspace: F-08 and the matrix now map
   owner/artifact per dependency. `@mdxeditor/editor` is UI runtime code in
   5 editor surfaces (misfiled in devDependencies); `acorn` is runtime-used
   with a vendored packed fallback; codex/muse SDK entries are workspace
   providers for their plugins, not bugs.
6. Ralph reachability was traced entry by entry: `src/ralph/*`,
   `ralph-api.ts`, `ralph/cli.ts`, and `RalphArea.tsx` have zero importers
   from active entries; `loops` owns the `ralph` mode, UI, and data file.
   F-14 now states a deletion candidate with test and data-tolerance
   blockers instead of "both live".
7. F-10 is scoped to the 22 first-party backends; the external plugin path
   (`examples/plugins/hello-pibo`) is acknowledged.
8. The "95 percent" claim was removed for lack of a denominator.
9. Inventory is reproducible: exact commands and filters are embedded in
   appendix section I. No `routeTree.gen.ts` exists in the tree (TanStack
   tree is hand-built in `main.tsx:122`); colocated tests are 0 files under
   `src/` and 25 files / 7,209 LOC under `packages/workflows/src/testing`.

Remaining limitations: plugin-backend retained bytes still unmeasured (needs
metafiles); total nested-vs-top duplicate bytes intentionally not summed
(basename collisions across unrelated packages would inflate naive sums —
only sampled pairs are claimed); legacy-row tolerance of loops `jobFromRow`
not individually executed; no build/install/network run, as ordered.

## 13. Report validation state

`docs:indexes:check` PASS (106 managed indexes, drift 0), `docs:log:check`
PASS, `docs:validator:test` PASS (87 pass, 0 fail).
`docs:validate:strict` reports one error in
`docs/specs/data/storage-maintenance.md` (`PIBO_TRACE_COMMIT`, last touched
by `bf6a6434`), which is pre-existing and outside this report's change set
(2 new reports, `docs/reports/index.md`, `docs/log.md`, 2 ledger records).
Same-day correction pass: F-01 reworded to a committed inconsistency without
an executed-build claim, F-05 reframed per the binding F03/F06 core-views
decision (headless core moved to user-decision scope), F-17 (startup cost)
added with safe `--help`/`--version` timings, and the zero-dependency
manifest caveat made explicit. Review pass: all 9 ordered corrections
applied (see section 12); validation commands below were re-run afterwards
with the stated results. Cross-check pass: F-14 confirmed against N1,
inventory adopted from the reproducible script, projections removed,
rollback corrected (see section 14).

## 14. Errata (takes precedence over outdated statements)

Wherever an earlier section still phrases a superseded claim, this errata
governs:

- E1 (builds): no statement in this report claims a tested build outcome.
  F-01 is exactly "statically proven 22/21 gate contradiction; fresh build
  not executed". Any "fails/green/passes" phrasing elsewhere refers to
  future acceptance runs to be measured, never to this audit.
- E2 (bytes): input counts (6,468/6,238/230) never prove shipped bytes.
  Binding size evidence is retained bytes: F-02 numbers plus the machine
  deliverable `.tmp/beta4-retained-bundle-bytes.json` (19,286,272 retained,
  per-package sums, Pi split, top-60 modules).
- E3 (withdrawn claims): "whole engine", "both live", "95 percent",
  `SettingsManager` as value drag-in, `vscode-web` deletion approval, and
  blanket "devDeps = bug" claims are withdrawn wherever they still appear
  outside their correction notes. `vscode-web` is keep-optional pending a
  separate product decision; root entries are judged by owner/artifact.
- E4 (no projected savings as results): "KB range", "~100 ms class",
  "~20 MB" and any drop/shrink target are withdrawn as results. Roadmap
  benefits state only the measurement that would prove them.
- E5 (mechanisms): `optionalDependencies` is installed by default and is
  not on-demand; a bare dynamic `import()` inside the single-file bundle is
  not code splitting. F-06/F-17 name the corrected mechanisms.
- E6 (rollback): for packaging/install/state changes, rollback is the
  previous consistent assembly plus a pre-change state snapshot — never
  `git revert` alone.
- E7 (inventory): canonical counts are 844/231878 gross, 0/0 generated,
  25/7209 colocated, 819/224669 net (`.tmp/beta4-source-inventory.py`,
  verified run). Older find-based totals differ by method and are
  superseded.
- E8 (ralph): F-14 as corrected against N1 governs — unused island,
  active surface on `loops`, existing DB and loop mode preserved,
  deletion candidate for the Gesamtplan, not approved deletion.


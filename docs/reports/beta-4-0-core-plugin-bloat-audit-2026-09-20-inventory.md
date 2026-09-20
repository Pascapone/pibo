---
type: "Reference"
title: "Beta 4.0 audit inventory appendix"
description: "Raw inventory tables for the Beta 4.0 audit: per-area LOC, largest files, tarball bytes, bundled modules, and dependency importer counts."
tags: ["pibo-4", "beta", "audit", "inventory"]
status: "draft"
authority: "informative"
generated:
  by: "muse-code/subagent"
  at: "2026-09-20T11:54:16Z"
sources:
  - id: "audited-code"
    resource: "commit:ece5f18cffe3f96f8f5dd8c241aac1d439c67b9a"
  - id: "parent-report"
    resource: "/reports/beta-4-0-core-plugin-bloat-audit-2026-09-20.md"
---

# Inventory appendix

Raw tables for the [Beta 4.0 audit](/reports/beta-4-0-core-plugin-bloat-audit-2026-09-20.md).
Methods: canonical totals from `.tmp/beta4-source-inventory.py` (verified
run: 844/231878 gross, 0/0 generated, 25/7209 colocated, 819/224669 net);
per-area tables below are find-based `.ts/.tsx` worktree counts that differ
purely by file-extension/method scope. Otherwise `wc -l` per directory
(blanks and comments included), `du -sh`, `md5sum`, `cmp -l`, esbuild
metafile reads, and scoped `grep -r` importer counts. All measured
2026-09-20 on HEAD `ece5f18c` without builds or installs.

## A. LOC per `src/` area (`.ts` + `.tsx`)

269 files 69,958 `src/apps/` (chat-ui 200/46,401; chat 63/22,306;
context-files-ui 5/771; shared 1/480; chat-vscode 0 tracked sources);
57 files 23,491 `src/agent-runtimes/`; 42 files 14,866 `src/debug/`;
46 files 14,072 `src/core/`; 37 files 11,747 `src/tools/`;
66 files 7,814 `src/plugins/`; 34 files 7,145 `src/data/`;
22 files 7,086 `src/agent-runtime/`; 17 files 5,927 `src/mcp/`;
21 files 5,239 `src/shared/`; 12 files 4,238 `src/compute/`;
13 files 3,619 `src/previews/`; 15 files 3,402 `src/remote-agent/`;
8 files 3,270 `src/web-annotations/`; 10 files 3,140 `src/gateway/`;
10 files 3,049 `src/session-ui/`; 11 files 2,773 `src/loops/`;
6 files 2,223 `src/sessions/`; 5 files 1,781 `src/runs/`;
8 files 1,670 `src/auth/`; 1 file 1,622 `src/reliability/`;
2 files 1,573 `src/setup/`; 7 files 1,470 `src/subagents/`;
7 files 1,293 `src/signals/`; 7 files 1,254 `src/ralph/`;
6 files 1,159 `src/cron/`; 4 files 1,055 `src/resources/`;
4 files 988 `src/web/`; 5 files 798 `src/providers/`;
3 files 753 `src/speech/`; 4 files 749 `src/user-skills/`;
3 files 327 `src/transcription/`; plus `config`, `api`, `skills`,
`channels`, `bin` under 300 LOC each. Total: 211,396 LOC.
`packages/workflows/src`: 71 files, 20,412 LOC, split into 13,203 LOC
product code (46 files) plus 7,209 LOC colocated tests (25 files under
`testing/`; see section I).

## B. Largest files (top 15, `wc -l`)

6,862 `src/apps/chat/web-app.ts`; 3,060 `src/core/session-router.ts`;
2,354 `src/apps/chat-ui/src/App.tsx`; 2,226
`src/agent-runtimes/pi/routed-session.ts`; 1,921
`src/session-ui/terminalRows.ts`; 1,812 `src/debug/index.ts`; 1,726
`src/apps/chat/agent-store.ts`; 1,625 `src/agent-runtime/routed-session.ts`;
1,622 `src/reliability/store.ts`; 1,614
`src/shared/trace-event-projection.ts`; 1,581 `WorkflowGraphCanvas.tsx`;
1,578 `src/agent-runtimes/codex-native/adapter.ts`; 1,448 `SettingsView.tsx`;
1,408 `CompactTerminalSessionView.tsx`; 1,366
`src/agent-runtimes/muse-native/adapter.ts`.

## C. Tarball bytes (assembly manifest, Sep 19 build, 21-plugin set)

5,644,732 core; 4,209 cutover; 150,411,744 standard;
129,259,793 `@openai/codex-linux-x64`; 4,898 `@openai/codex`;
3,391,505 runtime-pi; 1,973,882 runtime-omp; 1,955,242 file-editing;
1,987,706 codex-compat; 1,944,960 / 1,944,256 transcription pair;
1,338,451 workflows; 122,284 runtime-codex-native; 121,452 goal-loops;
119,452 standard-profiles; 130,275 browser-tools; 108,886 mcp-cli;
73,511 run-control; 72,768 runtime-muse-native; 58,916 cron;
49,020 code-runtime; 38,424 gateway-tools; 33,319 preview;
79,337 web-annotations; 6,462 web-search; 5,295 vscode-web.

Uncompressed backend sizes (Sep 20 rebuild, 22 artifacts): runtime-pi
18,552,047; remote-agent 16,088,048; codex-compat 11,140,316; runtime-omp
11,033,307; file-editing 10,930,250; transcription pair ~10,912,xxx;
runtime-codex-native 582,205; goal-loops 550,763; mcp-cli 525,057;
run-control 419,120; web-annotations 349,081; browser-tools 329,262;
runtime-muse-native 291,067; code-runtime 265,658; cron 215,487;
gateway-tools 212,079; preview 121,278; standard-profiles 12,624;
vscode-web 2,382; web-search 758; workflows 267.

## D. Core executable bundle inputs (Sep 20 metafile)

230 repo files: 51 `src/apps`, 36 `src/core`, 32 `src/plugins`, 25 `src/data`,
16 `src/agent-runtime`, 16 `src/shared`, 7 `src/tools` (contract,
session-tool-set, schema, payload-writer, credential-registry, mcp-bridge,
session-service), 7 `src/subagents`, 6 `src/sessions`, 5 `src/auth`, 4
`src/mcp`, 4 `src/signals`, 4 `src/gateway`, 3 `src/web`, 3 `src/user-skills`,
3 `src/runs`, 1 each `src/speech/types`, `src/app-context`, `src/cli-errors`,
`src/reliability`, `src/transcription`, `src/api`, `src/previews`,
`src/config`. Zero inputs from `src/agent-runtimes`, `src/debug`,
`src/compute`, `src/setup`, `src/cron`, `src/loops`, `src/ralph`,
`src/skills`, `src/session-ui`. 6,238 external (node_modules) inputs from 70
top-level packages. Input counts alone prove nothing about shipped bytes;
section H gives the retained-bytes sums that supersede them for size claims.

## E. Duplication proofs

- 8 byte-identical `browser/index.js` (md5 `62c3f8c0b88985fdbcf6b371774aa0b4`).
- 2 byte-identical `browser/index.js` (md5 `1f948750b90ba51ba0984af8a620f7d0`).
- Transcription backends differ by 4,934 `cmp -l` bytes over ~10.9 MB.
- 2 byte-identical `prism-client.ts` files (`diff -q`).

## F. Dependency importer counts (`src/`, `from`-imports)

react 91, lucide-react 66, typebox 18, @tanstack 15, commander 13,
react-dom 7, @modelcontextprotocol/sdk 4, react-virtuoso 3, prismjs 2,
@xyflow 2, vite 2, @tailwindcss 2, tiktoken 1, lexical 1, react-markdown 1,
remark-gfm 1, @uiw 1, better-auth 1, @vscode/ripgrep 1, xstate 0,
jsonwebtoken 0, yaml 0, acorn 0, acorn-walk 0.

## G. Correction-pass evidence (2026-09-20)

- Committed counts via `git show HEAD:`: 22 `packages` entries in
  `scripts/build-pibo4-artifacts.mjs` (incl. `remote-agent` line 20, two
  transcription plugins lines 34-35); gates at
  `scripts/build-pibo4-standard.mjs:11-16` and
  `scripts/build-pibo4-candidate-assembly.mjs:30-31,69` demand exactly 21.
  `git diff --stat -- scripts/` is empty, so worktree equals HEAD here.
- `packages/` contains exactly `workflows` (`ls` plus `git ls-files`).
- Safe startup timings (existing artifacts, `--help`/`--version` only):
  core binary `--version` 533/502 ms, `--help` 526/479 ms (19,660,188-byte
  bundle); root `dist/bin/pibo.js` (80-byte shim) `--version` ~99-118 ms.
- F03/F06 core-views decision: `docs/plans/pibo-4-0-plugin-completion.md`
  lines 74-79 (five views always present), 164 (same tab infrastructure, no
  plugin needed), 184 (Minimal: admin/auth/sessions/core views work),
  496 (A-C40-01: zero plugins, start and core views work);
  `docs/plans/pibo-4-0-plugin-completion-todo.md` lines 49 (S-003 scope),
  83-90 (F03 tasks and evidence).

## H. Retained-bytes evidence (review pass, 2026-09-20)

Core metafile `dist/pibo4-core-executable.metafile.json` (Sep 20 rebuild),
single output `dist/pibo4-core-package/dist/core/executable-cli.js`
(19,660,188 bytes on disk). Summed `outputs[exe].inputs[*].bytesInOutput`:

- Retained total: 19,286,272 bytes.
- Pi own-code retained (non-nested `@earendil-works/pi-*` paths):
  1,997,535 bytes in 1,063 files.
- Pi nested third-party retained
  (`pi-coding-agent/node_modules/`): 9,374,893 bytes.
- Combined Pi-path retained: ≈11.37 MB of 19.29 MB (≈59%).
- Top nested packages: jiti 2,394,962; undici 1,092,862; nested pi-ai
  1,028,128; nested @google/genai 726,966; nested @anthropic-ai/sdk
  604,952; nested pi-agent-core 412,732; nested openai 398,763; nested
  typebox 397,794; nested pi-tui 292,452; nested yaml 263,740; nested
  google-auth-library 253,317; nested highlight.js 211,953.
- `pi-coding-agent/dist/index.js`: `bytesInOutput: 0` (confirmed).
- On-disk package sizes for proportion: pi-coding-agent 418 MB (mostly its
  own nested tree), pi-ai 8.5 MB, pi-agent-core 7.3 MB.
- Plugin backends emit no metafiles: retained bytes there are unproven;
  only sizes, string markers, and the `cmp -l` transcription diff are
  claimed (see F-03).
- Machine deliverable for synthesis: `.tmp/beta4-retained-bundle-bytes.json`
  (167 package groups, Pi nested split, top-60 modules, sampled
  duplicates, method note).

## I. Reproducible inventory method (review pass, 2026-09-20)

Canonical: `python3 .tmp/beta4-source-inventory.py` (read-only; base
`git ls-files src packages`; verified output 844/231878 gross, 0/0
generated, 25/7209 colocated, 819/224669 net). Secondary exact filters used
for the per-area breakdowns in this report (run from the repo root;
`node_modules`, `dist`, lockfiles, and generated output excluded unless
noted):

```sh
# A. LOC per src area (.ts + .tsx, blanks/comments included)
find src -name '*.ts' -not -path '*/node_modules/*' | wc -l
for d in src/*/; do
  n=$(find "$d" -name '*.ts' -o -name '*.tsx' | wc -l)
  l=$(find "$d" \( -name '*.ts' -o -name '*.tsx' \) -exec cat {} + | wc -l)
  echo "$n files $l LOC $d"
done
# B. Largest files
find src -name '*.ts*' -exec wc -l {} + | sort -rn | head -n 25
# C. Tarball bytes (worktree artifact dist/, ignored, Sep 19 generation)
node -e 'for (const t of require("./dist/pibo4-candidate-assembly/assembly-manifest.json").artifacts) console.log(t.bytes + " " + t.package)'
# D. Core bundle repo inputs (repo files only: anchored ^src/)
node -e 'const m = require("./dist/pibo4-core-executable.metafile.json");
  const dirs = {};
  for (const i of Object.keys(m.executable.inputs))
    if (i.startsWith("src/")) { const d = i.split("/")[1]; dirs[d] = (dirs[d] || 0) + 1; }
  console.log(dirs)'
# H. Retained bytes per path group (proof, not input counts)
node -e 'const m = require("./dist/pibo4-core-executable.metafile.json");
  const out = m.executable.outputs["dist/pibo4-core-package/dist/core/executable-cli.js"].inputs;
  let total = 0, piOwn = 0, piNested = 0;
  for (const [f, info] of Object.entries(out)) {
    const b = info.bytesInOutput || 0; if (!b) continue;
    const n = f.split("\\").join("/"); total += b;
    if (n.includes("pi-coding-agent/node_modules/")) piNested += b;
    else if (n.includes("@earendil-works/pi-")) piOwn += b;
  }
  console.log({ total, piOwn, piNested })'
# F. Dependency importer counts (from-imports in src)
cd src
grep -rl --include='*.ts' --include='*.tsx' -e "from [\"']DEP" -e "from [\"']DEP/" .
```

Generated and colocated-test accounting: no `*.gen.ts` file is tracked
(`git ls-files | grep -c '\.gen\.ts'` = 0; the TanStack route tree is
hand-built in `src/apps/chat-ui/src/main.tsx:122`). Colocated tests: 0
files under `src/`; 25 files / 7,209 LOC under
`packages/workflows/src/testing/` — i.e. the workflows package splits into
13,203 LOC product code (46 files) plus 7,209 LOC colocated tests.

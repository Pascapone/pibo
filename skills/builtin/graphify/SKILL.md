---
name: graphify
description: Use this skill when a user asks to graph, map, or visualize a codebase/workspace with Graphify and inspect the generated graphify-out/graph.html, graphify-out/graph.json, or graphify-out/GRAPH_REPORT.md artifacts.
---

# Graphify Codebase Visualization

Use Graphify to turn a workspace folder into an interactive knowledge graph and report. Prefer this skill for requests like "graph this repo", "visualize this codebase", "map the workspace", or "show me the project structure as a graph".

## Prerequisites

Graphify is exposed as a curated Pibo CLI tool:

```bash
pibo tools show graphify
pibo tools install graphify
eval "$(pibo tools env graphify)"
```

Inside the Pibo source repo while testing local changes, use:

```bash
npm run --silent dev -- tools show graphify
npm run --silent dev -- tools install graphify
eval "$(npm run --silent dev -- tools env graphify)"
```

The Pibo installer uses the PyPI package `graphifyy` and runs `graphify install --platform pi` after installing the CLI.

## Workflow

1. Identify the workspace path from the active Pibo Room/session context or from the user's request.
2. Confirm the path is inside the intended workspace boundary before graphing.
3. Prefer an ignored artifact directory for generated files when possible. If you generate in the repo root, check `git status --short` before and after.
4. Run Graphify on the selected folder. With `graphifyy==0.9.x`, `graphify .` writes extraction output under `graphify-out/`.
5. If you need an HTML graph and markdown report from a code-only extraction without an LLM key, run `graphify cluster-only . --no-label` after `graphify .`.
6. Read `graphify-out/GRAPH_REPORT.md` first for the summary, then open `graphify-out/graph.html` when the user wants an interactive view.

```bash
cd /path/to/workspace
graphify .
graphify cluster-only . --no-label
ls graphify-out/graph.html graphify-out/graph.json graphify-out/GRAPH_REPORT.md
```

## Operating rules

- Treat `graphify-out/graph.html`, `graphify-out/graph.json`, and `graphify-out/GRAPH_REPORT.md` as derived artifacts unless the user explicitly wants them committed.
- Code-only extraction can run without an LLM API key. Including docs, README files, papers, images, or semantic-labeling steps may require a configured Graphify backend/API key; if no key is available, graph a code-only subdirectory or skip semantic labels with `cluster-only . --no-label`.
- For large monorepos, start with a focused subdirectory such as `src/`, a code package, or a docs folder only when the needed LLM backend is configured.
- Re-run Graphify on demand after branch or workspace changes; do not assume an old graph is current.
- If Graphify is unavailable, report the missing install and suggest `pibo tools install graphify` rather than hand-writing a replacement graph.

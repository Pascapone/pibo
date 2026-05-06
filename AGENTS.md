# AGENTS.md

## Pi Coding Agent
If you have to dig deeper into the Pi Coding Agent: `~/code/pi-mono/packages/coding-agent`

## Glossary
Always read `GLOSSARY.md`. It contains a shared vocabulary for our project.

## Session Debugging
When reading Pibo Sessions, use the debug CLI first: `npm run dev -- debug session --help`.

## Pibo Development Style
When changing or testing Pibo itself, use the Docker compute system when it is available. Spawn an isolated worker with `pibo compute spawn`, do gateway restarts, web app experiments, browser automation, and end-to-end checks inside that worker, then release it with `pibo compute release <id>`.

Do not use the host `pibo-web` gateway as an experimental target. Do not restart, replace, or run ad hoc host gateways for development unless the user explicitly asks for host operations or the Docker system is unavailable. The host gateway is for observing the current service state, not for trying changes.

Dev-auth belongs only to Docker workers. Never start the host gateway with dev-auth flags or fake-auth infrastructure. The normal host gateway must use Better Auth.

## Host Gateway Service
The `pibo-web` gateway on this machine is a live service. Do not stop or restart it unless the user explicitly allows or requests it.

## Deployment
Deploy host-level web changes to dev first: `./scripts/deploy-web-dev.sh` (`pibo-web-dev.service`, `https://dev.pibo.neuralnexus.me`, real Better Auth, isolated `~/.pibo-dev`).

Deploy production only after dev testing succeeds and the user approves it: `./scripts/deploy-web.sh` (`pibo-web.service`, `https://pibo.neuralnexus.me`).

Normal flow: Docker compute worker -> dev web gateway -> production web gateway.

## Browser/App Debugging
For Chat Web browser debugging while changing Pibo, start from a Docker compute worker when one is available. Use the worker's returned web/CDP ports for app checks so browser automation and gateway restarts stay isolated from the host service.

For debugging an already-running Chat Web instance, start from the browser that already exists. First list CDP targets with `npm run dev -- tools browser-use targets`, then inspect Chat Web targets until you find one that is authenticated and has a composer textarea. Do not assume the first tab is the usable tab. If the helper is unavailable, fall back to `curl -s http://127.0.0.1:56663/json/list`.

If no usable browser exists, create one through the Browser Use auth flow instead of starting ad hoc fake-auth infrastructure. First try to acquire an isolated authenticated slot with `eval "$(npm run --silent dev -- tools browser-use lease acquire --app pibo-chat --owner "$USER")"`, then open the current Chat Web URL in that shell. If lease acquisition says no authenticated template exists, prepare it with `eval "$(npm run --silent dev -- tools browser-use auth-template env)"`, open the Chat Web App there, sign in once, close it, then acquire the lease again.

If MCP DevTools resources are unavailable, use direct CDP against the authenticated target as the fallback. Only restart the matching web/gateway ports after confirming the existing tab is usable but its backend is down.

## Server Access
Server access details are configured in the operator environment. Do not hard-code addresses in documentation or code.

## Frontend Design
If you are doing any frontend design for the Web Chat App, be sure to read `DESIGN.md`.

# Pibo Rules

This file captures fundamental project truths. These rules should guide design decisions, reviews, and future implementation work.

## 1. The CLI Must Be Iteratively Discoverable

Pibo is primarily operated by agents, not humans. The CLI is therefore an agent-facing discovery interface, not a traditional all-in-one help page.

This rule primarily applies to CLI help and information output: `--help`, default discovery output, `list`, `show`, `schema`, `paths`, `doctor`, and `guide`. These texts are how an agent learns an unknown CLI. The agent should be able to ask for help, see the immediate command surface, choose one branch, ask for help there, and continue exploring without receiving the full project context at once.

Every CLI level must provide only the context needed at that exact step and point to the next useful command. A top-level command should expose available areas. A nested command should expose only its immediate actions. Detailed schemas, guides, environment setup, examples, and long-form operational instructions must live behind explicit deeper commands such as `show`, `schema`, `paths`, `doctor`, or `guide`.

Avoid repeating the same information across levels. Repeated help text wastes context and makes agent behavior worse. Prefer compact, line-based outputs for discovery commands and reserve verbose output for commands that explicitly request detail.

The intended flow is progressive:

```text
pibo
  -> pibo tools
    -> pibo tools show browser-use
      -> pibo tools guides browser-use
        -> pibo tools guide browser-use browser-use
```

Each step should answer one question and make the next possible questions obvious.

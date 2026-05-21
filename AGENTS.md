# AGENTS.md

## Pi Coding Agent
If you have to dig deeper into the Pi Coding Agent: `~/code/pi-mono/packages/coding-agent`

## Glossary
Always read `GLOSSARY.md`. It contains a shared vocabulary for our project.

## Session Debugging
When reading Pibo Sessions, use the debug CLI first: `npm run dev -- debug session --help`.

## Host Gateway
Pibo has host gateways. They are managed only through the Pibo CLI.

Production gateway:

  pibo gateway web status
  pibo gateway web start
  pibo gateway web restart

Dev gateway:

  pibo gateway dev status
  pibo gateway dev start
  pibo gateway dev restart

The production gateway is stateful and may contain active agent runtimes. It may need to be restarted when it is stuck, after a deployment, or after gateway configuration changes. The CLI checks for active production work and blocks unsafe restarts.

The dev gateway may be restarted at any time, but it must still be restarted through the CLI for consistency.

Do not use any other restart mechanism. If the CLI blocks a production restart, ask the user before interrupting active sessions.

## Deployment
Deploy host-level web changes to dev first: `./scripts/deploy-web-dev.sh`.

The hosted dev Chat URL is host-specific. Set `PIBO_DEV_PUBLIC_URL` or `PIBO_DEV_BASE_URL` in the environment or repo-local `.env.developer-host`; do not hard-code public hostnames in docs, scripts, or skills.

Deploy production only after dev testing succeeds and the user approves it: `./scripts/deploy-web.sh`.

## Browser/App Debugging
For debugging an already-running Chat Web instance, start from the browser that already exists. First list CDP targets with `npm run dev -- tools browser-use targets`, then inspect Chat Web targets until you find one that is authenticated and has a composer textarea. Do not assume the first tab is the usable tab. If the helper is unavailable, fall back to `curl -s http://127.0.0.1:56663/json/list`.

If no usable browser exists, create one through the Browser Use auth flow instead of starting ad hoc fake-auth infrastructure. First try to acquire an isolated authenticated slot with `eval "$(npm run --silent dev -- tools browser-use lease acquire --app pibo-chat --owner "$USER")"`, then open the current Chat Web URL in that shell. If lease acquisition says no authenticated template exists, prepare it with `eval "$(npm run --silent dev -- tools browser-use auth-template env)"`, open the Chat Web App there, sign in once, close it, then acquire the lease again.

If MCP DevTools resources are unavailable, use direct CDP against the authenticated target as the fallback. Use the Pibo CLI restart commands only after confirming the existing tab is usable but its backend is down.

## Server Access
Server access details are configured in the operator environment. Do not hard-code addresses in documentation or code.

## Frontend Design
If you are doing any frontend design for the Web Chat App, be sure to read `DESIGN.md`.

## Documentation Structure
All project documentation belongs under `docs/`.

Use this structure:

```text
docs/
  project/  Normal/current project docs and other canonical documentation
  specs/    Product, technical, and implementation specifications
  plans/    Implementation plans and design plans
  reports/  Investigation reports, validation reports, and generated report artifacts
  legacy/   Previous documentation kept for reference
```

Rules:

- Put normal/current project docs and other canonical documentation in `docs/project/`.
- Put specifications in `docs/specs/`.
- Put implementation plans and design plans in `docs/plans/`.
- Put investigation, validation, incident, and generated reports in `docs/reports/`.
- Keep old documentation in `docs/legacy/` unless there is an explicit cleanup decision.
- Do not create new root-level `plans/`, `reports/`, or `specs/` directories.

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

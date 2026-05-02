# AGENTS.md

Behavioral guidelines to reduce common LLM coding mistakes. Merge with project-specific instructions as needed.

**Tradeoff:** These guidelines bias toward caution over speed. For trivial tasks, use judgment.

## 1. Think Before Coding

**Don't assume. Don't hide confusion. Surface tradeoffs.**

Before implementing:
- State your assumptions explicitly. If uncertain, ask.
- If multiple interpretations exist, present them - don't pick silently.
- If a simpler approach exists, say so. Push back when warranted.
- If something is unclear, stop. Name what's confusing. Ask.

## 2. Simplicity First

**Minimum code that solves the problem. Nothing speculative.**

- No features beyond what was asked.
- No abstractions for single-use code.
- No "flexibility" or "configurability" that wasn't requested.
- No error handling for impossible scenarios.
- If you write 200 lines and it could be 50, rewrite it.

Ask yourself: "Would a senior engineer say this is overcomplicated?" If yes, simplify.

## 3. Surgical Changes

**Touch only what you must. Clean up only your own mess.**

When editing existing code:
- Don't "improve" adjacent code, comments, or formatting.
- Don't refactor things that aren't broken.
- Match existing style, even if you'd do it differently.
- If you notice unrelated dead code, mention it - don't delete it.

When your changes create orphans:
- Remove imports/variables/functions that YOUR changes made unused.
- Don't remove pre-existing dead code unless asked.

The test: Every changed line should trace directly to the user's request.

## 4. Goal-Driven Execution

**Define success criteria. Loop until verified.**

Transform tasks into verifiable goals:
- "Add validation" → "Write tests for invalid inputs, then make them pass"
- "Fix the bug" → "Write a test that reproduces it, then make it pass"
- "Refactor X" → "Ensure tests pass before and after"

For multi-step tasks, state a brief plan:
```
1. [Step] → verify: [check]
2. [Step] → verify: [check]
3. [Step] → verify: [check]
```

Strong success criteria let you loop independently. Weak criteria ("make it work") require constant clarification.

---

**These guidelines are working if:** fewer unnecessary changes in diffs, fewer rewrites due to overcomplication, and clarifying questions come before implementation rather than after mistakes.

## Pi Coding Agent
If you have to dig deeper into the Pi Coding Agent: `~/code/pi-mono/packages/coding-agent`

## Rules
Always read `RULES.md`. It contains all relevant rules for development and our project.

## Glossary
Always read `GLOSSARY.md`. It contains a shared vocabulary for our project.

## Session Debugging
When reading Pibo Sessions, use the debug CLI first: `npm run dev -- debug session --help`.

## Browser/App Debugging
For Chat Web browser debugging, start from the browser that already exists. First list CDP targets with `npm run dev -- tools browser-use targets`, then inspect Chat Web targets until you find one that is authenticated and has a composer textarea. Do not assume the first tab is the usable tab. If the helper is unavailable, fall back to `curl -s http://127.0.0.1:56663/json/list`.

If no usable browser exists, create one through the Browser Use auth flow instead of starting ad hoc fake-auth infrastructure. First try to acquire an isolated authenticated slot with `eval "$(npm run --silent dev -- tools browser-use lease acquire --app pibo-chat --owner "$USER")"`, then open the current Chat Web URL in that shell. If lease acquisition says no authenticated template exists, prepare it with `eval "$(npm run --silent dev -- tools browser-use auth-template env)"`, open the Chat Web App there, sign in once, close it, then acquire the lease again.

If MCP DevTools resources are unavailable, use direct CDP against the authenticated target as the fallback. Only restart the matching web/gateway ports after confirming the existing tab is usable but its backend is down.

## Frontend Design
If you are doing any frontend design, be sure to read `DESIGN.md`.

# Runtime Adapter Skill Evals

`evals.json` contains two realistic capability-assessment tasks:

1. `orion-full-harness.md` exposes a broad official app-server surface but deliberately omits clone, tree navigation, audio, and structured output. A passing answer must scaffold the full useful adapter without claiming the omitted options.
2. `relay-partial-harness.md` exposes only one-shot text/final-output execution and applies product pressure to fake a full adapter. A passing answer must remain partial, reject unsafe shortcuts, and map every gap to visible product behavior and evidence needs.

Run each prompt with the bundled skill and with no skill. The with-skill executor must expose a read tool so the agent can follow the skill's progressive reference links; an execution limited to the top-level `SKILL.md` is not a complete eval. Grade every `expectations` statement against the produced assessment/scaffold. The partial eval is the primary anti-hallucination gate: any claim of durable Relay session ids, native history, MCP, skills/context, model catalog, reasoning, approvals, or Pi prompt replacement fails the eval even if the rest of the answer is useful.

The repository test `test/agent-runtime-adapter-skill.test.mjs` validates the eval schema, fixture completeness, anti-invention expectations, progressive references, and registration surface. Model-run outputs should be stored outside the shipped skill directory and summarized under `docs/reports/` when a configured evaluator is available.

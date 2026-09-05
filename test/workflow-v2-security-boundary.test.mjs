import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
const readSource = (path) => readFile(new URL(`../${path}`, import.meta.url), "utf8");

test("Workflow V2 UI surfaces authentication, capability, and data boundaries", async () => {
  const source = await readSource("src/apps/chat-ui/src/WorkflowsArea.tsx");
  for (const pattern of [/aria-label="Registered capability security boundary"/, /Existing Chat Web authentication and Pibo Session visibility rules gate the workflow catalog, Workflow Sessions, snapshots, lifecycle events, prompt assets, and human actions/, /Agent nodes select profile refs only/, /does not grant extra tools, skills, context files, native tools, MCP servers, or compute-worker access/, /No inline JavaScript, TypeScript, shell, eval, arbitrary executable nodes, or raw handler bodies/, /hidden LLM coercion is not used/, /XState remains projection-only/, /remain sensitive workflow data/, /normal diagnostics expose only sanitized metadata/]) assert.match(source, pattern);
});

test("Workflow Session configuration UI cannot broaden registered capability families", async () => {
  const dialog = await readSource("src/apps/chat-ui/src/workflows/CreateWorkflowSessionDialog.tsx");
  assert.match(dialog, /Only workflow inputs, explicitly eligible prompts/);
  assert.match(dialog, /registered profiles, handlers, adapters, guards, assets, and executable boundaries remain unchanged/i);
  assert.match(dialog, /node\.kind === "agent(?:_node)?"/);
  assert.match(dialog, /overrides\?\.prompt === true/);
  assert.doesNotMatch(dialog, /handlerOverrides|adapterOverrides|guardOverrides|arbitraryOptions/);
});

test("backend validation and diagnostic redaction boundaries remain represented", async () => {
  const [security, schema, persistence, web] = await Promise.all([readSource("src/apps/chat/workflow-v2-security-validation.ts"), readSource("src/apps/chat/workflow-json-schema-validation.ts"), readSource("src/apps/chat/workflow-persistence-model.ts"), readSource("src/apps/chat/web-app.ts")]);
  assert.match(web, /function requireSameOriginJsonRequest/);
  assert.match(web, /function requireSharedSession/);
  assert.match(security, /WorkflowSecurityError\.inlineExecutableCode/);
  assert.match(security, /WorkflowSecurityError\.rawXStateAuthoring/);
  assert.match(security, /WorkflowSecurityError\.hiddenLlmCoercion/);
  assert.match(schema, /Zod schemas are not part of V2 authoring/);
  assert.match(persistence, /function sanitizeWorkflowDiagnostics/);
  assert.match(persistence, /function redactWorkflowDiagnosticText/);
});

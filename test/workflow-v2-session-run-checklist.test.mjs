import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const source = (path) => readFile(new URL(`../src/apps/chat-ui/src/${path}`, import.meta.url), "utf8");

test("normal Session Workflow view fetches inspection only for proven linkage", async () => {
  const [pane, view, model, api] = await Promise.all([source("session-trace-pane.tsx"), source("session-views/WorkflowXStateSessionView.tsx"), source("workflows/workflow-session-model.tsx"), source("api-workflows.ts")]);
  assert.match(model, /kind === "main_workflow" \|\| kind === "nested_workflow"/);
  assert.doesNotMatch(model, /agent_node" \|\| kind === "subagent/);
  assert.match(view, /enabled: Boolean\(selectedPiboSessionId && workflowSessionLinked\)/);
  assert.match(view, /retry: false/);
  assert.match(api, /\/sessions\/\$\{encodeURIComponent\(piboSessionId\)\}\/workflow/);
  assert.match(pane, /workflowSessionLinked \? \["terminal", "workflow"\] : \["terminal"\]/);
  assert.match(view, /Workflow inspection is requested only for linked Sessions/);
});

test("Workflow view renders canonical run inspection facts and immutable links", async () => {
  const view = await source("session-views/WorkflowXStateSessionView.tsx");
  for (const fact of ["Configuration", "Current run", "Final output", "Validation and diagnostics", "Workflow graph", "Node attempts", "Edge transfers", "Wait tokens", "Human action history", "Lifecycle events", "Immutable effective snapshot", "Workflow links"]) assert.match(view, new RegExp(`title="${fact}"|>${fact}<`));
  assert.match(view, /data\.nodeAttempts/);
  assert.match(view, /data\.edgeTransfers/);
  assert.match(view, /data\.waitTokens/);
  assert.match(view, /data\.humanActions/);
  assert.match(view, /data\.lifecycleEvents/);
  assert.match(view, /snapshot_only_definition_deleted/);
  assert.match(view, /\/apps\/chat\/workflows\/view/);
  assert.match(view, /onOpenSession\(child\.piboSessionId\)/);
  assert.doesNotMatch(view, /fabricat|synthetic/i);
});

test("snapshot graph uses real Pibo IR from and to node references", async () => {
  const view = await source("session-views/WorkflowXStateSessionView.tsx");
  assert.match(view, /nestedNodeId\(raw, "from"\)/);
  assert.match(view, /nestedNodeId\(raw, "to"\)/);
  assert.match(view, /valueString\(.*"nodeId"\)/s);
  assert.match(view, /effectiveDefinition/);
});

test("human action UI submits only actions offered by the inspection response", async () => {
  const [view, api] = await Promise.all([source("session-views/WorkflowXStateSessionView.tsx"), source("api-workflows.ts")]);
  assert.match(view, /action\.availableActions\.filter\(\(choice\) => choice\.registered\)\.map/);
  assert.match(view, /choice\.registered/);
  assert.match(view, /No registered actions were returned for this wait token/);
  assert.doesNotMatch(view, />Resume<|>Cancel</);
  assert.match(view, /action\.diagnostics\.length/);
  assert.match(view, /postWorkflowHumanAction\(selectedPiboSessionId/);
  assert.match(api, /\/workflow\/human-actions/);
  assert.match(api, /workflowSession: PiboWorkflowSession/);
});

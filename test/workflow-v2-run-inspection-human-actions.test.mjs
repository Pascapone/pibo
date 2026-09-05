import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const readSource = (path) => readFile(new URL(`../${path}`, import.meta.url), "utf8");

test("Session-native Workflow inspection exposes real persisted fact collections", async () => {
  const [view, api] = await Promise.all([
    readSource("src/apps/chat-ui/src/session-views/WorkflowXStateSessionView.tsx"),
    readSource("src/apps/chat-ui/src/api-workflows.ts"),
  ]);
  assert.match(api, /SessionWorkflowInspectionResponse/);
  for (const field of ["workflowSession", "snapshot", "run", "waitTokens", "humanActions", "nodeAttempts", "edgeTransfers", "lifecycleEvents"]) assert.match(api, new RegExp(`\\b${field}\\??:`));
  assert.match(view, /data-pibo-debug="session-native-workflow-view"/);
  assert.match(view, /data\.run/);
  assert.match(view, /data\.snapshot/);
  assert.match(view, /graphFacts\(snapshot\)/);
  assert.match(view, /latest = \[\.\.\.attempts\]\.reverse\(\)\.find/);
});

test("human action controls retain payload validation, diagnostics, and registered action boundaries", async () => {
  const view = await readSource("src/apps/chat-ui/src/session-views/WorkflowXStateSessionView.tsx");
  assert.match(view, /aria-label=\{`Human action payload for \$\{action\.waitTokenId\}`\}/);
  assert.match(view, /JSON\.parse\(payload\)/);
  assert.match(view, /Payload must be valid JSON/);
  assert.match(view, /action\.availableActions\.filter\(\(choice\) => choice\.registered\)/);
  assert.match(view, /action\.diagnostics\.length/);
  assert.match(view, /No registered actions were returned/);
  assert.doesNotMatch(view, /postProject|projectId/);
});

test("execution boundary, final output, validation, child and definition links remain visible", async () => {
  const view = await readSource("src/apps/chat-ui/src/session-views/WorkflowXStateSessionView.tsx");
  assert.match(view, /aria-label="Workflow execution boundary"/);
  assert.match(view, /XState is a read-only visualization/);
  assert.match(view, /title="Final output"/);
  assert.match(view, /snapshotValidation/);
  assert.match(view, /lifecycleDiagnostics/);
  assert.match(view, /Open definition/);
  assert.match(view, /No linked child Workflow Sessions/);
});

import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const source = (path) => readFile(new URL(`../src/apps/chat-ui/src/${path}`, import.meta.url), "utf8");

test("Workflow Session dialog preserves supported configuration boundaries", async () => {
  const [dialog, api, app, sidebar] = await Promise.all([
    source("workflows/CreateWorkflowSessionDialog.tsx"), source("api-workflows.ts"), source("App.tsx"), source("session-sidebar.tsx"),
  ]);
  assert.match(api, /"\/api\/chat\/workflow-sessions"/);
  assert.match(api, /roomId\?: string;[\s\S]*workspace\?: string;[\s\S]*profile\?: string;[\s\S]*workflowId: string;[\s\S]*workflowVersion: string/);
  for (const label of ["Workflow version", "Workflow Session Room", "Workflow Session workspace", "Workflow Session profile", "Workflow input values", "Workflow model override", "Workflow thinking override", "Workflow fast mode override"]) assert.match(dialog, new RegExp(`aria-label="${label}"`));
  assert.match(dialog, /workflowPromptOverrideEligibleNodeIds/);
  assert.match(dialog, /node\.kind === "agent" && node\.runtime === "pibo"/);
  assert.match(dialog, /overrides\?\.prompt === true/);
  assert.match(dialog, /Only workflow inputs, explicitly eligible prompts/);
  assert.match(dialog, /Create Workflow Session/);
  assert.match(sidebar, /aria-label="New Workflow Session"/);
  assert.match(app, /navigateToRoute\(\{ area: "sessions", roomId: data\.selectedRoomId, piboSessionId: result\.session\.id \}, false, "workflow"\)/);
});

test("configured Workflow Session starts explicitly from its normal Session view", async () => {
  const [view, api] = await Promise.all([source("session-views/WorkflowXStateSessionView.tsx"), source("api-workflows.ts")]);
  assert.match(api, /\/sessions\/\$\{encodeURIComponent\(piboSessionId\)\}\/workflow\/start/);
  assert.match(api, /workflowSession: PiboWorkflowSession/);
  assert.match(view, /link\.state === "configured" && !link\.workflowRunId/);
  assert.match(view, /Start Workflow/);
  assert.match(view, /No run exists\. Start remains explicit\./);
  assert.match(view, /Workflow run was already started/);
});

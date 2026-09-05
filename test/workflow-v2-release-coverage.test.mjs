import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
const read = (path) => readFile(new URL(`../${path}`, import.meta.url), "utf8");

test("Workflow V2 release UI retains editor and version lifecycle capabilities", async () => {
  const [area, graph, library, api] = await Promise.all([read("src/apps/chat-ui/src/WorkflowsArea.tsx"), read("src/apps/chat-ui/src/workflows/WorkflowGraphCanvas.tsx"), read("src/apps/chat-ui/src/workflows/WorkflowLibraryPanel.tsx"), read("src/apps/chat-ui/src/api-workflows.ts")]);
  for (const phrase of ["WorkflowGraphCanvas", "WorkflowInspectorsPanel", "WorkflowRawIrEditor", "postWorkflowDraftManualTriggerRun"]) assert.match(area + graph + api, new RegExp(phrase));
  for (const phrase of ["Duplicate to draft", "Edit published", "Archive workflow", "Delete workflow", "Version history", "Create Workflow Session"]) assert.match(library, new RegExp(phrase));
  assert.match(library, /create_workflow_session/);
  assert.match(api, /postWorkflowDraftPublish/);
  assert.match(api, /postWorkflowNextDraft/);
});

test("Workflow Session release surface uses canonical APIs and normal Session navigation", async () => {
  const [api, app, pane, view] = await Promise.all([read("src/apps/chat-ui/src/api-workflows.ts"), read("src/apps/chat-ui/src/App.tsx"), read("src/apps/chat-ui/src/session-trace-pane.tsx"), read("src/apps/chat-ui/src/session-views/WorkflowXStateSessionView.tsx")]);
  assert.match(api, /"\/api\/chat\/workflow-sessions"/);
  assert.match(api, /\/sessions\/\$\{encodeURIComponent\(piboSessionId\)\}\/workflow/);
  assert.match(api, /workflowSession: PiboWorkflowSession/);
  assert.match(app, /area: "sessions"[\s\S]*false, "workflow"/);
  assert.match(pane, /\["terminal", "workflow"\]/);
  assert.match(view, /Start Workflow/);
  assert.match(view, /Immutable effective snapshot/);
});

test("active UI source contains no removed container imports or routes", async () => {
  const [app, routes, tabs, api] = await Promise.all([read("src/apps/chat-ui/src/App.tsx"), read("src/apps/chat-ui/src/app-routes.ts"), read("src/apps/chat-ui/src/desktop-tabs.tsx"), read("src/apps/chat-ui/src/api-chat-sessions.ts")]);
  const source = app + routes + tabs + api;
  assert.doesNotMatch(source, /ProjectsArea|ProjectsSidebar|PiboProject|project-sessions|\/api\/chat\/projects/);
});

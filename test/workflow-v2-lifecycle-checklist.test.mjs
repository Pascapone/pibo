import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
const read = (path) => readFile(new URL(`../${path}`, import.meta.url), "utf8");

test("Workflow library keeps draft, publish, version, duplicate, archive and delete actions", async () => {
  const [library, model, api] = await Promise.all([read("src/apps/chat-ui/src/workflows/WorkflowLibraryPanel.tsx"), read("src/apps/chat-ui/src/workflows/workflow-version-history-model.ts"), read("src/apps/chat-ui/src/api-workflows.ts")]);
  for (const action of ["view", "duplicate", "create_workflow_session", "edit_draft", "validate", "publish", "create_next_draft", "version_history", "archive", "delete"]) assert.match(api, new RegExp(`"${action}"`));
  assert.match(library, /postWorkflowDuplicateDraft/);
  assert.match(library, /postWorkflowNextDraft/);
  assert.match(library, /postWorkflowArchive/);
  assert.match(library, /deleteWorkflow/);
  assert.match(model, /Create Workflow Session/);
});

test("lifecycle confirmations preserve tombstone snapshot semantics without removed container copy", async () => {
  const library = await read("src/apps/chat-ui/src/workflows/WorkflowLibraryPanel.tsx");
  assert.match(library, /Deleting tombstones the live workflow identity/);
  assert.match(library, /new Workflow Session creation/);
  assert.match(library, /Historical Workflow Runs remain inspectable from immutable snapshots/);
  assert.match(library, /Archiving applies to the whole workflow identity/);
  assert.match(library, /new Workflow Session choices/);
  assert.match(library, /historical Workflow Runs continue to render from their snapshots/);
});

test("published picker and immutable definition inspection APIs remain wired", async () => {
  const api = await read("src/apps/chat-ui/src/api-workflows.ts");
  assert.match(api, /\/api\/chat\/workflows\/pickers\/workflow-versions/);
  assert.match(api, /\/api\/chat\/workflows\/pickers\/version-history/);
  assert.match(api, /getWorkflowVersionInspect/);
  assert.match(api, /postWorkflowDraftValidate/);
  assert.match(api, /postWorkflowDraftPublish/);
});

test("deleted definitions render immutable snapshot fallback instead of broken links", async () => {
  const view = await read("src/apps/chat-ui/src/session-views/WorkflowXStateSessionView.tsx");
  assert.match(view, /definitionLink\?\.status === "live"/);
  assert.match(view, /snapshot_only_definition_deleted/);
  assert.match(view, /[Ii]nspection uses the immutable Session snapshot/);
  assert.match(view, /effectiveDefinition/);
});

import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const source = async (path) => (await readFile(new URL(`../src/apps/chat-ui/src/${path}`, import.meta.url), "utf8")).replaceAll("\r\n", "\n");

test("workflow definition and Workflow Session creation use app-owned dialogs", async () => {
  const [app, workflowsArea, sessionDialog] = await Promise.all([source("App.tsx"), source("MinimalWorkflowsArea.tsx"), source("workflows/CreateWorkflowSessionDialog.tsx")]);
  assert.match(workflowsArea, /<CreateWorkflowDialog/);
  assert.match(workflowsArea, /setCreateWorkflowDialogOpen\(true\)/);
  assert.match(app, /<CreateWorkflowSessionDialog/);
  assert.match(app, /openWorkflowSessionDialog/);
  assert.doesNotMatch(sessionDialog, /window\.(prompt|confirm)/);
});

test("shared dialog shell owns accessible modal and focus behavior", async () => {
  const dialogShell = await source("components/DialogShell.tsx");
  for (const pattern of [/role="dialog"/, /aria-modal="true"/, /aria-labelledby=\{titleId\}/, /aria-describedby=\{descriptionId\}/, /event\.key === "Escape"/, /event\.key !== "Tab"/, /FOCUSABLE_SELECTOR/, /initialFocusRef\?\.current/, /previouslyFocused\?\.isConnected/, /event\.target === event\.currentTarget/, /closeDisabled/, /max-h-\[calc\(100dvh-2rem\)\]/]) assert.match(dialogShell, pattern);
});

test("create dialogs provide controlled fields and accessible validation", async () => {
  const [workflowDialog, sessionDialog] = await Promise.all([source("workflows/CreateWorkflowDialog.tsx"), source("workflows/CreateWorkflowSessionDialog.tsx")]);
  assert.match(workflowDialog, /value=\{name\}/);
  assert.match(workflowDialog, /required[\s\S]*maxLength=\{160\}/);
  assert.match(workflowDialog, /aria-invalid=\{Boolean\(nameError\)\}/);
  assert.match(workflowDialog, /role="alert"/);
  assert.match(workflowDialog, /<form[^>]*onSubmit=\{submit\}[^>]*noValidate>/);
  assert.match(workflowDialog, /closeDisabled=\{submitting\}/);
  assert.match(sessionDialog, /<DialogShell title="New Workflow Session"/);
  assert.match(sessionDialog, /<form[^>]*onSubmit=\{submit\}/);
  assert.match(sessionDialog, /role="alert"/);
  assert.match(sessionDialog, /closeDisabled=\{submitting\}/);
  assert.match(sessionDialog, /await postWorkflowSession\(input\)/);
});

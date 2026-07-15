import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const source = (path) =>
  readFile(new URL(`../src/apps/chat-ui/src/${path}`, import.meta.url), "utf8");

test("project and workflow create handlers use app-owned dialogs instead of prompts", async () => {
  const [projectsArea, workflowsArea] = await Promise.all([
    source("projects/ProjectsArea.tsx"),
    source("MinimalWorkflowsArea.tsx"),
  ]);

  const projectCreateHandler = projectsArea.match(
    /const createProject = async[\s\S]*?(?=\n\n  const createProjectSession)/,
  )?.[0];
  const workflowCreateHandler = workflowsArea.match(
    /const createWorkflow = async[\s\S]*?(?=\n\n  const duplicateReadOnlyWorkflow)/,
  )?.[0];

  assert.ok(projectCreateHandler);
  assert.ok(workflowCreateHandler);
  assert.doesNotMatch(projectCreateHandler, /window\.prompt/);
  assert.doesNotMatch(workflowCreateHandler, /window\.prompt/);
  assert.match(projectsArea, /<CreateProjectDialog/);
  assert.match(projectsArea, /onCreateProject=\{\(\) => setCreateProjectDialogOpen\(true\)\}/);
  assert.match(workflowsArea, /<CreateWorkflowDialog/);
  assert.match(workflowsArea, /setCreateWorkflowDialogOpen\(true\)/);
});

test("shared dialog shell owns accessible modal and focus behavior", async () => {
  const dialogShell = await source("components/DialogShell.tsx");

  assert.match(dialogShell, /role="dialog"/);
  assert.match(dialogShell, /aria-modal="true"/);
  assert.match(dialogShell, /aria-labelledby=\{titleId\}/);
  assert.match(dialogShell, /aria-describedby=\{descriptionId\}/);
  assert.match(dialogShell, /event\.key === "Escape"/);
  assert.match(dialogShell, /event\.key !== "Tab"/);
  assert.match(dialogShell, /FOCUSABLE_SELECTOR/);
  assert.match(dialogShell, /initialFocusRef\?\.current/);
  assert.match(dialogShell, /previouslyFocused\?\.isConnected/);
  assert.match(dialogShell, /event\.target === event\.currentTarget/);
  assert.match(dialogShell, /closeDisabled/);
  assert.match(dialogShell, /focusable\.includes\(activeElement as HTMLElement\)/);
  assert.match(dialogShell, /max-h-\[calc\(100vh-2rem\)\]/);
});

test("create dialogs provide controlled fields and accessible validation", async () => {
  const [projectDialog, workflowDialog] = await Promise.all([
    source("projects/CreateProjectDialog.tsx"),
    source("workflows/CreateWorkflowDialog.tsx"),
  ]);

  assert.match(projectDialog, /value=\{name\}/);
  assert.match(projectDialog, /value=\{projectFolder\}/);
  assert.match(projectDialog, /value=\{description\}/);
  assert.match(projectDialog, /required[\s\S]*maxLength=\{120\}/);
  assert.match(projectDialog, /startsWith\("\/"\)/);
  assert.match(projectDialog, /startsWith\("~\/"\)/);
  assert.match(projectDialog, /aria-invalid=\{Boolean\(nameError\)\}/);
  assert.match(projectDialog, /aria-invalid=\{Boolean\(folderError\)\}/);
  assert.match(projectDialog, /aria-describedby=/);
  assert.match(projectDialog, /role="alert"/);
  assert.match(projectDialog, /<form[^>]*onSubmit=\{submit\}[^>]*noValidate>/);
  assert.match(projectDialog, /const projectId = await onCreate\(/);
  assert.match(projectDialog, /onCreated\(projectId\)/);
  assert.match(projectDialog, /closeDisabled=\{submitting\}/);
  assert.match(projectDialog, /catch \(caught\)[\s\S]*setApiError/);

  assert.match(workflowDialog, /value=\{name\}/);
  assert.match(workflowDialog, /required[\s\S]*maxLength=\{160\}/);
  assert.match(workflowDialog, /aria-invalid=\{Boolean\(nameError\)\}/);
  assert.match(workflowDialog, /aria-describedby=/);
  assert.match(workflowDialog, /role="alert"/);
  assert.match(workflowDialog, /<form[^>]*onSubmit=\{submit\}[^>]*noValidate>/);
  assert.match(workflowDialog, /await onCreate\(name\.trim\(\)\)/);
  assert.match(workflowDialog, /closeDisabled=\{submitting\}/);
  assert.match(workflowDialog, /catch \(caught\)[\s\S]*setApiError/);
});

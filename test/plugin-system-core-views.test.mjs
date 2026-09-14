import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { productUiPackageManifest, webProductPackageManifest } from '../dist/plugins/default-packages.js';

test('core workspace routes render without product-view contributions', async () => {
  const [app, coreModel, coreView, browserEntry] = await Promise.all([
    readFile('src/apps/chat-ui/src/App.tsx', 'utf8'),
    readFile('src/apps/chat-ui/src/core-workspace-model.ts', 'utf8'),
    readFile('src/apps/chat-ui/src/core-workspace-view.tsx', 'utf8'),
    readFile('src/apps/chat-ui/src/plugins/builtin-browser-entry.tsx', 'utf8'),
  ]);
  assert.match(app, /isCoreWorkspaceRoute\(panelRoute\)[\s\S]*<CoreWorkspaceView/);
  assert.doesNotMatch(app, /pibo\.product-ui\/(?:user-resources|agent-designer|settings)/);
  assert.match(coreModel, /CORE_WORKSPACE_CATALOG/);
  assert.match(coreModel, /CORE_SESSION_VIEW_CATALOG/);
  for (const view of ['CoreAgentDesignerView', 'CoreContextView', 'CoreSettingsView']) assert.match(coreView, new RegExp(view));
  assert.doesNotMatch(coreView, /PluginWorkspaceView|pibo\.product-ui/);
  assert.doesNotMatch(browserEntry, /UserResourcesView|AgentDesignerView|GlobalSettingsView|setupStandardShell/);
});

test('transitional product packages no longer claim core surfaces', () => {
  assert.deepEqual(productUiPackageManifest().contributions.map((entry) => entry.id), ['workflows', 'cron', 'loops']);
  assert.deepEqual(webProductPackageManifest().contributions.map((entry) => entry.id), ['cron-channel', 'preview-app']);
});

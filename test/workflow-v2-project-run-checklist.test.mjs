import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

async function readSource(relativePath) {
	return readFile(new URL(`../${relativePath}`, import.meta.url), "utf8");
}

async function readProjectUiSourceBundle() {
	return (await Promise.all([
		"src/apps/chat-ui/src/App.tsx",
		"src/apps/chat-ui/src/projects/ProjectWorkflowPanels.tsx",
		"src/apps/chat-ui/src/projects/ProjectsAreaModel.ts",
		"src/apps/chat-ui/src/projects/ProjectsSidebar.tsx",
		"src/apps/chat-ui/src/projects/project-session-workflow.tsx",
		"src/apps/chat-ui/src/session-node.tsx",
	].map(readSource))).join("\n");
}

function assertAllMatch(source, checks) {
	for (const [label, pattern] of checks) {
		assert.match(source, pattern, label);
	}
}

test("Workflow V2 Project execution checklist covers configured sessions, snapshots, and one-run start", async () => {
	const projectServiceTests = await readSource("test/project-service-workflow-link.test.mjs");
	const configuredUiTests = await readSource("test/workflow-v2-project-configured-ui.test.mjs");
	const appSource = await readProjectUiSourceBundle();
	const webChannelTests = await readSource("test/web-channel.test.mjs");

	assertAllMatch(projectServiceTests, [
		["Project service tests persist workflow selection metadata before runs start", /project workflow session records persist selection metadata before runs start/],
		["Project service tests keep configured sessions runless until Start", /assert\.equal\(configured\.workflowRunId, undefined\)/],
		["Project service tests reject workflow id\/version changes after creation", /project workflow session selection and configuration stay immutable after creation[\s\S]*workflow session selection is immutable/],
		["Project service tests reject configuration mutation after creation", /workflow session configuration is immutable/],
		["Project service tests persist exact configuration snapshots", /project workflow session snapshots persist configuration and effective definitions[\s\S]*getWorkflowSessionSnapshotForSession\("ps_snapshot_workflow"\)/],
		["Project service tests enforce one configuration snapshot per session", /already has a configuration snapshot/],
		["Project service tests enforce one workflow run per configured session", /project workflow start creates one run per configured session[\s\S]*assert\.equal\(first\.alreadyStarted, false\)[\s\S]*assert\.equal\(second\.alreadyStarted, true\)[\s\S]*listProjectWorkflowRuns\(\{ piboSessionId: "ps_start_workflow" \}\)\.length, 1/],
	]);

	assertAllMatch(configuredUiTests, [
		["Configured-session UI source test covers review state", /Project workflow configured-session UI exposes review, start, and empty run-history state/],
		["Configured-session UI source test covers create and save controls", /Create workflow Project session[\s\S]*Save configured session/],
		["Configured-session UI source test covers delayed-start state", /Configured\\\/not-started[\s\S]*Start workflow/],
		["Configured-session UI source test covers empty pre-run history", /No current run attempts/],
	]);

	assertAllMatch(appSource, [
		["Project creation UI exposes workflow-backed creation", /Create workflow Project session/],
		["Project creation UI saves a configured session instead of starting", /Save configured session/],
		["Project configured UI labels the not-started state", /Configured\/not-started/],
		["Project configured UI exposes explicit Start", /Start workflow/],
	]);

	assertAllMatch(webChannelTests, [
		["Web-channel test creates configured Project workflow sessions", /chat web app creates configured Project workflow sessions and starts one workflow run explicitly/],
		["Web-channel test proves configured sessions have no run before Start", /createdPayload\.projectSession\.state, "configured"[\s\S]*createdPayload\.projectSession\.workflowRunId, undefined/],
		["Web-channel test persists snapshot identity and hashes", /createdPayload\.snapshot\.schemaVersion, 1[\s\S]*createdPayload\.snapshot\.workflow\.baseDefinitionHash[\s\S]*createdPayload\.snapshot\.workflow\.effectiveDefinitionHash/],
		["Web-channel test persists allowed override scopes in snapshots", /createdPayload\.snapshot\.overridePolicy[\s\S]*promptEligibility: "metadata\.sessionOverrides\.prompt===true-and-direct-promptTemplate"[\s\S]*modelScope: "workflow"/],
		["Web-channel test rejects workflow selection and configuration mutation", /Project workflow selection and configuration are immutable/],
		["Web-channel test validates the stored snapshot before Start", /startValidationPayload\.validation\.trigger, "before_workflow_start"[\s\S]*startValidationPayload\.snapshot\.id, createdPayload\.snapshot\.id/],
		["Web-channel test creates exactly one run and returns it on repeated Start", /secondStartPayload\.alreadyStarted, true[\s\S]*secondStartPayload\.run\.id, startValidationPayload\.run\.id/],
		["Web-channel test verifies durable one-run storage", /SELECT id, pibo_session_id FROM project_workflow_runs[\s\S]*assert\.equal\(rows\.length, 1\)/],
	]);
});

test("Workflow V2 Project run-view checklist covers sidebar routing, inspection, nested links, and deleted definitions", async () => {
	const sessionKindTests = await readSource("test/workflow-session-kind.test.mjs");
	const appSource = await readProjectUiSourceBundle();
	const workflowViewSource = await readSource("src/apps/chat-ui/src/session-views/WorkflowXStateSessionView.tsx");
	const webChannelTests = await readSource("test/web-channel.test.mjs");

	assertAllMatch(sessionKindTests, [
		["Session-kind tests lock the V2 workflow session enum", /PIBO_WORKFLOW_SESSION_KINDS, \["main_workflow", "nested_workflow", "agent_node", "subagent"\]/],
		["Session-kind tests use real Pibo Session descendants", /project sidebar session nodes expose workflow session kind for real Pibo Sessions only/],
		["Session-kind tests cover main, nested, agent, and subagent ids", /flattenSessionIds\(nodes\), \["ps_main", "ps_nested", "ps_agent", "ps_subagent"\]/],
	]);

	assertAllMatch(appSource, [
		["Project sidebar renders workflow kind markers", /showWorkflowSessionKindMarkers/],
		["Workflow sessions route to the Workflow view", /workflowSessionKind === "main_workflow" \|\| workflowSessionKind === "nested_workflow"[\s\S]*return \{ viewId: "workflow"/],
		["Agent node and subagent sessions route to Terminal", /workflowSessionKind === "agent_node" \|\| workflowSessionKind === "subagent"[\s\S]*return \{ viewId: "terminal" \}/],
	]);

	assertAllMatch(workflowViewSource, [
		["Run inspection panel is a named Workflow view region", /aria-label="Workflow run inspection panel"/],
		["Run inspection explains status, current node, history, attempts, transfers, output, and errors", /Status, current node, history, attempts, transfers, output, and errors/],
		["Run inspection renders run history", /<WorkflowInspectionSection title="Run history"/],
		["Run inspection renders node attempts", /<WorkflowInspectionSection title="Node attempts"/],
		["Run inspection renders edge transfers", /<WorkflowInspectionSection title="Edge transfers"/],
		["Run inspection renders output and error sections", /<WorkflowInspectionSection title="Output"[\s\S]*<WorkflowInspectionSection title="Error"/],
		["Run inspection labels kernel records as truth", /kernel\/run records: truth/],
		["Run inspection labels XState as projection-only", /XState projection only/],
		["Run inspection renders nested workflow child session links", /aria-label="Nested workflow child session links"/],
		["Run inspection renders live Workflows definition links", /function workflowDefinitionLinkHref[\s\S]*\/apps\/chat\/workflows\/view/],
		["Run inspection renders snapshot-only deleted-definition state", /Definition deleted — snapshot-only definition-deleted state/],
	]);

	assertAllMatch(webChannelTests, [
		["Web-channel test covers real Project sidebar descendants", /chat web app project bootstrap includes real workflow session descendants only/],
		["Web-channel test excludes unrelated workflow-node sessions", /assert\.ok\(!flattened\.some\(\(node\) => node\.piboSessionId === unrelated\.id\)\)/],
		["Web-channel test returns all V2 workflow session kind markers", /rootNode\.workflowSessionKind, "main_workflow"[\s\S]*workflowSessionKind, "nested_workflow"[\s\S]*workflowSessionKind, "agent_node"[\s\S]*workflowSessionKind, "subagent"/],
		["Web-channel test exposes live workflow definition links", /workflowDefinitionLink\.status, "live"[\s\S]*workflowDefinitionLink\.href, "\/apps\/chat\/workflows\/view\/standard-project\/1\.0\.0"/],
		["Web-channel test exposes snapshot-only definition-deleted links", /workflowDefinitionLink\.status, "snapshot_only_definition_deleted"[\s\S]*workflowDefinitionLink\.href, undefined[\s\S]*tombstoneLabel, \/Definition deleted\//],
		["Web-channel test proves deleted-definition historical inspection uses the snapshot", /historicalRunPayload\.snapshot\.effectiveDefinition, sessionPayload\.snapshot\.effectiveDefinition/],
	]);
});

test("Workflow V2 Project human-action checklist covers accepted actions and blocked token cases", async () => {
	const runtimeHumanTests = await readSource("packages/workflows/src/testing/runtime-human-node.test.ts");
	const workflowViewSource = await readSource("src/apps/chat-ui/src/session-views/WorkflowXStateSessionView.tsx");
	const webChannelTests = await readSource("test/web-channel.test.mjs");

	assertAllMatch(runtimeHumanTests, [
		["Workflow runtime tests apply registered approve actions", /applies registered approve actions, records the actor\/action, resolves the wait, and schedules a human wakeup/],
		["Workflow runtime tests reject invalid resume payloads without resolving tokens", /rejects invalid resume payloads before resolving the wait token/],
		["Workflow runtime tests apply registered cancel actions", /applies registered cancel actions without requiring a fixed action set/],
	]);

	assertAllMatch(workflowViewSource, [
		["Workflow view submits human actions through Project workflow route", /postProjectWorkflowHumanAction/],
		["Workflow view renders pending wait tokens", /aria-label="Pending workflow human action wait token"/],
		["Workflow view renders wait-token action buttons", /aria-label="Workflow wait token actions"/],
		["Workflow view disables unregistered action refs", /disabled=\{!wait\.waitTokenId \|\| !action\.registered \|\| submittingKey !== null\}/],
		["Workflow view renders human action diagnostics near controls", /aria-label="Human action diagnostics"/],
		["Workflow view keeps human controls separate from Terminal chat", /stays separate from normal Terminal chat controls/],
	]);

	assertAllMatch(webChannelTests, [
		["Web-channel test lists and resolves persisted Project workflow wait tokens", /chat web app lists and resolves Project workflow human wait tokens/],
		["Web-channel test renders persisted pending wait tokens", /pendingHumanActions\.length, 6/],
		["Web-channel test accepts approve actions", /approvePayload\.action\.kind, "approve"[\s\S]*approvePayload\.waitToken\.status, "resumed"/],
		["Web-channel test accepts reject actions", /rejectPayload\.action\.kind, "reject"/],
		["Web-channel test accepts resume actions with payload", /resumePayload\.action\.kind, "resume"[\s\S]*resumePayload\.action\.payload, \{ comment: "Looks good" \}/],
		["Web-channel test accepts cancel actions and cancels the run", /cancelPayload\.action\.kind, "cancel"[\s\S]*cancelPayload\.run\.status, "cancelled"[\s\S]*cancelPayload\.projectSession\.state, "cancelled"/],
		["Web-channel test rejects unknown wait tokens", /missingTokenPayload\.diagnostics\[0\]\.code, "WorkflowRuntimeError\.unknownWaitToken"/],
		["Web-channel test rejects wait tokens owned by another session", /mismatchPayload\.diagnostics\[0\]\.code, "WorkflowRuntimeError\.waitTokenSessionMismatch"/],
		["Web-channel test rejects unavailable actions", /unavailablePayload\.diagnostics\[0\]\.code, "WorkflowRuntimeError\.humanActionUnavailable"/],
		["Web-channel test rejects invalid resume payloads", /invalidResumePayload\.diagnostics\[0\]\.code, "WorkflowRuntimeError\.invalidHumanActionPayload"/],
		["Web-channel test rejects missing registered action refs", /missingActionRefPayload\.diagnostics\[0\]\.code, "WorkflowGraphError\.unknownHumanActionRef"/],
		["Web-channel test rejects already-resolved wait tokens", /replayPayload\.diagnostics\[0\]\.code, "WorkflowRuntimeError\.waitTokenNotPending"/],
	]);
});

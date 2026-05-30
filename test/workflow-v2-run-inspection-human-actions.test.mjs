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

test("Workflow V2 run-view tests cover Project sidebar kinds and view routing", async () => {
	const sessionKindTests = await readSource("test/workflow-session-kind.test.mjs");
	const webChannelTests = await readSource("test/web-channel.test.mjs");
	const appSource = await readProjectUiSourceBundle();

	assertAllMatch(sessionKindTests, [
		["stable workflow session kind enum is unit-tested", /PIBO_WORKFLOW_SESSION_KINDS, \["main_workflow", "nested_workflow", "agent_node", "subagent"\]/],
		["sidebar tree includes real Pibo session descendants", /project sidebar session nodes expose workflow session kind for real Pibo Sessions only/],
		["sidebar tree preserves main, nested, agent, and subagent ids", /flattenSessionIds\(nodes\), \["ps_main", "ps_nested", "ps_agent", "ps_subagent"\]/],
	]);

	assertAllMatch(webChannelTests, [
		["Project bootstrap integration covers real workflow session descendants", /chat web app project bootstrap includes real workflow session descendants only/],
		["unrelated workflow node sessions are excluded from the Project tree", /assert\.ok\(!flattened\.some\(\(node\) => node\.piboSessionId === unrelated\.id\)\)/],
		["main workflow marker is returned", /rootNode\.workflowSessionKind, "main_workflow"/],
		["nested workflow marker is returned", /rootNode\.children\[0\]\.workflowSessionKind, "nested_workflow"/],
		["agent node marker is returned", /rootNode\.children\[0\]\.children\[0\]\.workflowSessionKind, "agent_node"/],
		["subagent marker is returned", /rootNode\.children\[0\]\.children\[0\]\.children\[0\]\.workflowSessionKind, "subagent"/],
	]);

	assertAllMatch(appSource, [
		["Project sidebar renders workflow kind markers", /showWorkflowSessionKindMarkers/],
		["main workflow marker has accessible label", /ariaLabel: "Main workflow session"/],
		["nested workflow marker has accessible label", /ariaLabel: "Nested workflow session"/],
		["agent node marker has accessible label", /ariaLabel: "Workflow agent node session"/],
		["subagent marker has accessible label", /ariaLabel: "Subagent session"/],
		["main and nested workflow sessions route to Workflow view", /workflowSessionKind === "main_workflow" \|\| workflowSessionKind === "nested_workflow"[\s\S]*return \{ viewId: "workflow"/],
		["agent node and subagent sessions route to Terminal view", /workflowSessionKind === "agent_node" \|\| workflowSessionKind === "subagent"[\s\S]*return \{ viewId: "terminal" \}/],
	]);
});

test("Workflow V2 run-view tests cover inspection sections, nested links, and deleted definitions", async () => {
	const webChannelTests = await readSource("test/web-channel.test.mjs");
	const workflowViewSource = await readSource("src/apps/chat-ui/src/session-views/WorkflowXStateSessionView.tsx");

	assertAllMatch(workflowViewSource, [
		["run inspection panel is a named UI region", /aria-label="Workflow run inspection panel"/],
		["run inspection copy names status, current node, history, attempts, transfers, output, and errors", /Status, current node, history, attempts, transfers, output, and errors/],
		["run history section renders", /<WorkflowInspectionSection title="Run history"/],
		["node attempt section renders", /<WorkflowInspectionSection title="Node attempts"/],
		["edge transfer section renders", /<WorkflowInspectionSection title="Edge transfers"/],
		["output section renders", /<WorkflowInspectionSection title="Output"/],
		["error section renders", /<WorkflowInspectionSection title="Error"/],
		["nested workflow child links render inside the run view", /aria-label="Nested workflow child session links"/],
		["live definition links point to the Workflows tab", /function workflowDefinitionLinkHref[\s\S]*\/apps\/chat\/workflows\/view/],
		["deleted definitions render snapshot-only fallback copy", /snapshot_only_definition_deleted[\s\S]*Historical run inspection uses the immutable Project session snapshot/],
	]);

	assertAllMatch(webChannelTests, [
		["live workflow definition links are integration-tested", /workflowDefinitionLink\.status, "live"[\s\S]*workflowDefinitionLink\.href, "\/apps\/chat\/workflows\/view\/standard-project\/1\.0\.0"/],
		["deleted definition display is integration-tested", /workflowDefinitionLink\.status, "snapshot_only_definition_deleted"[\s\S]*workflowDefinitionLink\.href, undefined[\s\S]*tombstoneLabel, \/Definition deleted\//],
		["historical snapshot inspection after delete is integration-tested", /historicalRunPayload\.alreadyStarted, true[\s\S]*historicalRunPayload\.snapshot\.effectiveDefinition, sessionPayload\.snapshot\.effectiveDefinition/],
	]);
});

test("Workflow V2 human action tests cover available actions and rejection diagnostics", async () => {
	const webChannelTests = await readSource("test/web-channel.test.mjs");
	const workflowViewSource = await readSource("src/apps/chat-ui/src/session-views/WorkflowXStateSessionView.tsx");

	assertAllMatch(webChannelTests, [
		["Project human wait-token integration test exists", /chat web app lists and resolves Project workflow human wait tokens/],
		["approve action is accepted", /approvePayload\.action\.kind, "approve"/],
		["reject action is accepted", /rejectPayload\.action\.kind, "reject"/],
		["resume action with payload is accepted", /resumePayload\.action\.kind, "resume"[\s\S]*resumePayload\.action\.payload, \{ comment: "Looks good" \}/],
		["cancel action is accepted and cancels the run", /cancelPayload\.action\.kind, "cancel"[\s\S]*cancelPayload\.run\.status, "cancelled"/],
		["missing wait tokens are rejected", /WorkflowRuntimeError\.unknownWaitToken/],
		["session-mismatched wait tokens are rejected", /WorkflowRuntimeError\.waitTokenSessionMismatch/],
		["unavailable actions are rejected", /WorkflowRuntimeError\.humanActionUnavailable/],
		["invalid resume payloads are rejected", /WorkflowRuntimeError\.invalidHumanActionPayload/],
		["missing registered human action refs are rejected", /WorkflowGraphError\.unknownHumanActionRef[\s\S]*missing\.humanActions\.inline/],
		["already-resolved wait tokens are rejected", /WorkflowRuntimeError\.waitTokenNotPending/],
		["expired wait tokens are rejected", /WorkflowRuntimeError\.waitTokenExpired/],
		["human action lifecycle events include submitted and blocked outcomes", /workflow\.human_action\.submitted[\s\S]*status === "submitted"[\s\S]*workflow\.human_action\.submitted[\s\S]*status === "blocked"/],
	]);

	assertAllMatch(workflowViewSource, [
		["human actions submit through the Project workflow route", /postProjectWorkflowHumanAction/],
		["pending wait tokens render in the workflow run view", /aria-label="Pending workflow human action wait token"/],
		["approve, reject, resume, and cancel controls live outside Terminal", /Approval, rejection, resume, and cancel controls render here/],
		["unregistered action buttons are disabled", /disabled=\{!wait\.waitTokenId \|\| !action\.registered \|\| submittingKey !== null\}/],
		["human action diagnostics render near controls", /aria-label="Human action diagnostics"/],
	]);
});

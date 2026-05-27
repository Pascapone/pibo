import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

async function readSource(relativePath) {
	return readFile(new URL(`../${relativePath}`, import.meta.url), "utf8");
}

function assertAllMatch(source, checks) {
	for (const [label, pattern] of checks) {
		assert.match(source, pattern, label);
	}
}

test("Workflow V2 security boundary surfaces auth, capability, compute, and data-sensitivity copy", async () => {
	const workflowsAreaSource = await readSource("src/apps/chat-ui/src/WorkflowsArea.tsx");

	assertAllMatch(workflowsAreaSource, [
		["visible security panel is present", /aria-label="Registered capability security boundary"/],
		["auth and Project/session visibility boundary is named", /Existing Chat Web auth plus Project and Pibo Session visibility rules/],
		["catalog, Project sessions, snapshots, lifecycle events, prompt assets, and human actions stay gated", /workflow catalog, Project workflow sessions, snapshots, lifecycle events, prompt assets, and human actions/],
		["Agent nodes stay profile-ref only", /Agent nodes select profile refs only/],
		["tools, skills, context, native tools, and MCP are not granted by the UI", /does not grant extra tools, skills, context files, native tools, MCP servers/],
		["compute-worker access stays behind the selected runtime profile", /compute-worker access beyond the selected runtime profile/],
		["inline executable authoring remains absent", /No inline JavaScript, TypeScript, shell, eval, arbitrary executable nodes, or raw handler bodies/],
		["hidden LLM coercion remains disallowed", /hidden LLM coercion is not used/],
		["XState remains projection-only", /XState remains projection-only; Pibo Workflow IR is the persisted source of truth/],
		["sensitive workflow data classes are named", /Workflow inputs, outputs, prompts, prompt assets, state, edge payloads, snapshots, and human action payloads remain sensitive workflow data/],
		["normal diagnostics are sanitized metadata only", /normal diagnostics expose only sanitized metadata/],
	]);
});

test("Workflow V2 security boundary is covered by backend auth, validation, redaction, and visibility gates", async () => {
	const webAppSource = await readSource("src/apps/chat/web-app.ts");
	const workflowPersistenceModelSource = await readSource("src/apps/chat/workflow-persistence-model.ts");
	const webChannelTests = await readSource("test/web-channel.test.mjs");
	const deferralTests = await readSource("test/workflow-v2-deferrals.test.mjs");

	assertAllMatch(webAppSource, [
		["same-origin mutation gate remains in Chat Web", /function requireSameOriginJsonRequest/],
		["Project visibility remains owner-scoped", /function requireOwnedProject[\s\S]*project\.ownerScope !== webSession\.ownerScope/],
		["Pibo Session visibility remains owner-scoped", /function requireOwnedSession[\s\S]*selected\.ownerScope !== webSession\.ownerScope/],
		["Workflow profile refs resolve through the registered profile picker", /function buildWorkflowProfilePicker/],
		["inline executable IR fields are rejected", /WorkflowSecurityError\.inlineExecutableCode/],
		["raw XState fields are rejected by validation", /WorkflowSecurityError\.rawXStateAuthoring/],
		["hidden LLM coercion is rejected", /WorkflowSecurityError\.hiddenLlmCoercion/],
		["Zod is excluded by the JSON Schema subset validator", /Zod schemas are not part of V2 authoring/],
	]);

	assertAllMatch(workflowPersistenceModelSource, [
		["diagnostics are sanitized before storage or responses", /function sanitizeWorkflowDiagnostics/],
		["diagnostic text redacts sensitive workflow values", /function redactWorkflowDiagnosticText/],
	]);

	assertAllMatch(webChannelTests, [
		["catalog auth baseline is integration-tested", /workflow catalog authentication and permission baseline treats UI workflows as global/],
		["Project and session visibility redaction test is integration-tested", /workflow diagnostics are redacted and scoped to owning Project sessions/],
		["cross-user Project bootstrap is hidden", /otherUserBootstrapResponse\.status, 404/],
		["unsupported Project workflow override families are rejected", /chat web app rejects unsupported Project workflow session creation inputs[\s\S]*Agent profile overrides[\s\S]*Handler overrides[\s\S]*Adapter overrides[\s\S]*Guard overrides[\s\S]*Arbitrary options/],
		["registered-ref security validation is integration-tested", /workflow security boundary validates registered refs and rejects inline execution paths/],
		["raw XState API payloads are publish-blocked", /WorkflowSecurityError\.rawXStateAuthoring/],
		["sensitive diagnostic payloads are stripped", /humanActionPayload[\s\S]*Object\.hasOwn\(redactedDiagnostic, "payload"\), false/],
	]);

	assertAllMatch(deferralTests, [
		["UI negative tests cover inline executables", /No inline TypeScript, JavaScript, shell, eval, arbitrary executable code/],
		["UI negative tests cover raw XState and workflow agent tools", /No raw XState editing, workflow templates, workflow slash commands, or workflow tools for agents/],
		["UI negative tests cover Zod", /No Zod schema authoring/],
	]);
});

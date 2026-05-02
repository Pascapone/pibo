import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { basename } from "node:path";
import test from "node:test";
import { buildCodexCompatSystemPrompt, addCodexCompatWebSearchProviderTool } from "../dist/core/codex-compat.js";
import { createPiboRuntime, inspectPiboProfile } from "../dist/core/runtime.js";
import { createDefaultPiboPluginRegistry } from "../dist/plugins/builtin.js";

test("default registry exposes the codex-compatible profile and tool surface", () => {
	const registry = createDefaultPiboPluginRegistry();
	const profile = registry.createProfile("codex");

	assert.equal(profile.profileName, "codex-compat");
	assert.equal(profile.builtinTools, "disabled");
	assert.equal(profile.toolPackages.codexCompat, true);
	assert.equal(profile.toolPackages.providerWebSearch, false);
	assert.equal(profile.toolPackages.runControl, true);
	assert.deepEqual(
		profile.tools.map((tool) => tool.name),
		[
			"apply_patch",
			"web_search",
			"view_image",
		],
	);
	assert.deepEqual(
		profile.subagents.map((subagent) => subagent.name),
		["default", "explorer", "worker"],
	);
	assert.deepEqual(profile.contextFiles.map((contextFile) => contextFile.key), ["Codex Base Prompt"]);
	assert.deepEqual(profile.contextFiles.map((contextFile) => basename(contextFile.path)), ["codex-base-prompt.md"]);
	assert.equal(existsSync(profile.contextFiles[0].path), true);
});

test("codex-compatible profile inspection shows active generated tools and local web search", async () => {
	const registry = createDefaultPiboPluginRegistry();
	const profile = registry.createProfile("codex-compat");
	const inspection = await inspectPiboProfile({ profile, persistSession: false });
	const activeTools = new Set(inspection.tools.filter((tool) => tool.active).map((tool) => tool.name));

	for (const toolName of [
		"apply_patch",
		"web_search",
		"view_image",
	]) {
		assert.equal(activeTools.has(toolName), true, `${toolName} should be active`);
	}
	for (const toolName of [
		"spawn_agent",
		"send_input",
		"resume_agent",
		"wait_agent",
		"close_agent",
	]) {
		assert.equal(activeTools.has(toolName), false, `${toolName} should not be active`);
	}
	for (const toolName of [
		"pibo_subagent_default",
		"pibo_subagent_explorer",
		"pibo_subagent_worker",
		"pibo_run_start",
		"pibo_run_list",
		"pibo_run_status",
		"pibo_run_wait",
		"pibo_run_read",
		"pibo_run_cancel",
		"pibo_run_ack",
	]) {
		assert.equal(activeTools.has(toolName), true, `${toolName} should be active`);
	}
	const contextFileNames = inspection.contextFiles.map((contextFile) => basename(contextFile.path));
	assert.equal(contextFileNames.includes("codex-base-prompt.md"), true);
	assert.equal(profile.contextFiles.some((contextFile) => /^(?:AGENTS|RULES|GLOSSARY)\.md$/.test(basename(contextFile.path))), false);
	assert.equal(inspection.subagents.every((subagent) => subagent.active), true);
});

test("codex-compatible profile uses Pibo run-control bash instead of exec tools", async () => {
	const registry = createDefaultPiboPluginRegistry();
	const profile = registry.createProfile("codex-compat");
	const runtime = await createPiboRuntime({
		profile,
		persistSession: false,
		subagentRunner: { async runSubagent() { throw new Error("not used"); } },
		runToolController: {
			startToolRun() { throw new Error("not used"); },
			listRuns() { return []; },
			getRunStatus() { throw new Error("not used"); },
			waitForRun() { throw new Error("not used"); },
			readRun() { throw new Error("not used"); },
			cancelRun() { throw new Error("not used"); },
			ackRun() { throw new Error("not used"); },
		},
	});

	try {
		const activeTools = new Set(runtime.session.getActiveToolNames());
		assert.equal(activeTools.has("bash"), true);
		const startTool = runtime.session.getToolDefinition("pibo_run_start");
		assert.ok(startTool);
		assert.equal(startTool.parameters.properties.toolName.enum.includes("bash"), true);
	} finally {
		await runtime.dispose();
	}
});

test("codex-compatible prompt adds environment and child-agent framing without plan-mode tools", () => {
	const prompt = buildCodexCompatSystemPrompt({
		baseSystemPrompt: "Base prompt with Codex base-prompt context.",
		cwd: "/repo",
		shell: "bash",
		currentDate: "2026-05-02",
		timezone: "Europe/Berlin",
		isChildSession: true,
	});

	assert.match(prompt, /# Codex-Compatible Runtime/);
	assert.match(prompt, /<cwd>\/repo<\/cwd>/);
	assert.match(prompt, /<shell>bash<\/shell>/);
	assert.match(prompt, /<current_date>2026-05-02<\/current_date>/);
	assert.match(prompt, /<timezone>Europe\/Berlin<\/timezone>/);
	assert.match(prompt, /<subagents>default, explorer, worker<\/subagents>/);
	assert.match(prompt, /Delegated Child Agent/);
	assert.doesNotMatch(prompt, /request_user_input tool/);
	assert.doesNotMatch(prompt, /update_plan tool/);
});

test("codex-compatible web search is serialized as a provider Responses tool", () => {
	const payload = addCodexCompatWebSearchProviderTool(
		{
			model: "gpt-5.4",
			input: [],
			tools: [{ type: "function", name: "bash" }],
		},
		{
			external_web_access: true,
			search_context_size: "high",
			filters: { allowed_domains: ["example.com"] },
			user_location: { type: "approximate", country: "US", timezone: "America/New_York" },
		},
	);

	assert.deepEqual(payload.tools.at(-1), {
		type: "web_search",
		search_context_size: "high",
		user_location: { type: "approximate", country: "US", timezone: "America/New_York" },
		filters: { allowed_domains: ["example.com"] },
	});
});

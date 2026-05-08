import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { basename } from "node:path";
import test from "node:test";
import {
	buildCodexCompatSystemPrompt,
} from "../dist/core/codex-compat.js";
import { createPiboRuntime, inspectPiboProfile } from "../dist/core/runtime.js";
import { createDefaultPiboPluginRegistry } from "../dist/plugins/builtin.js";
import {
	addOpenAiWebSearchProviderTool,
	normalizeOpenAiWebSearchConfig,
} from "../dist/tools/web-search.js";

test("default registry exposes the provider-backed codex-compatible profile", () => {
	const registry = createDefaultPiboPluginRegistry();
	const profile = registry.createProfile("codex");

	assert.equal(profile.profileName, "codex-compat-openai-web");
	assert.equal(profile.builtinTools, "default");
	assert.deepEqual(profile.builtinToolNames, ["read", "edit", "write"]);
	assert.equal(profile.toolPackages.codexCompat, true);
	assert.equal(profile.toolPackages.runControl, true);
	assert.deepEqual(
		profile.tools.map((tool) => tool.name),
		[
			"apply_patch",
			"web_search",
			"view_image",
			"runtime",
		],
	);
	assert.deepEqual(profile.tools.find((tool) => tool.name === "web_search")?.providerTool, {
		kind: "web_search",
		provider: "openai",
		options: {
			externalWebAccess: true,
			searchContextSize: "medium",
			includeSources: true,
		},
	});
	assert.deepEqual(
		profile.subagents.map((subagent) => [subagent.name, subagent.targetProfile]),
		[
			["default", "codex-compat-openai-web"],
			["explorer", "codex-compat-openai-web"],
			["worker", "codex-compat-openai-web"],
		],
	);
	assert.deepEqual(profile.contextFiles.map((contextFile) => contextFile.key), ["Codex Base Prompt"]);
	assert.deepEqual(profile.contextFiles.map((contextFile) => basename(contextFile.path)), ["codex-base-prompt.md"]);
	assert.equal(existsSync(profile.contextFiles[0].path), true);
});

test("default registry exposes web_search as a core native tool", () => {
	const registry = createDefaultPiboPluginRegistry();
	const catalog = registry.getCapabilityCatalog();
	const webSearch = catalog.nativeTools.find((tool) => tool.name === "web_search");

	assert.ok(webSearch);
	assert.equal(webSearch.pluginId, "pibo.core");
	assert.equal(webSearch.hasDefinition, false);
	assert.deepEqual(webSearch.providerTool, {
		kind: "web_search",
		provider: "openai",
		options: {
			externalWebAccess: true,
			searchContextSize: "medium",
			includeSources: true,
		},
	});
});

test("codex-compatible profile inspection shows active generated tools and provider-backed web search", async () => {
	const registry = createDefaultPiboPluginRegistry();
	const profile = registry.createProfile("codex");
	const inspection = await inspectPiboProfile({ profile, persistSession: false });
	const activeTools = new Set(inspection.tools.filter((tool) => tool.active).map((tool) => tool.name));

	for (const toolName of [
		"apply_patch",
		"web_search",
		"view_image",
		"runtime",
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

test("provider-backed web_search is active without a local function definition", async () => {
	const registry = createDefaultPiboPluginRegistry();
	const profile = registry.createProfile("codex-compat-openai-web");
	const inspection = await inspectPiboProfile({ profile, persistSession: false });
	const webSearch = inspection.tools.find((tool) => tool.name === "web_search");

	assert.ok(webSearch);
	assert.equal(webSearch.hasDefinition, false);
	assert.equal(webSearch.registered, true);
	assert.equal(webSearch.active, true);
});

test("codex-compatible profile uses Pibo run-control bash instead of exec tools", async () => {
	const registry = createDefaultPiboPluginRegistry();
	const profile = registry.createProfile("codex");
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
		assert.equal(activeTools.has("read"), true);
		assert.equal(activeTools.has("edit"), true);
		assert.equal(activeTools.has("write"), true);
		assert.equal(activeTools.has("bash"), true);
		assert.equal(activeTools.has("grep"), false);
		assert.equal(activeTools.has("find"), false);
		assert.equal(activeTools.has("ls"), false);
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

test("codex-compatible prompt references selected web_search generically", () => {
	const prompt = buildCodexCompatSystemPrompt({
		baseSystemPrompt: "Base prompt.",
		cwd: "/repo",
		shell: "bash",
		currentDate: "2026-05-02",
		timezone: "Europe/Berlin",
	});

	assert.match(prompt, /When web_search is selected by the profile/);
	assert.doesNotMatch(prompt, /OpenAI Responses hosted web_search/);
});

test("OpenAI web-search provider options normalize boolean defaults", () => {
	assert.deepEqual(
		normalizeOpenAiWebSearchConfig(undefined),
		{
			external_web_access: true,
			search_context_size: "medium",
			include_sources: true,
		},
	);
});

test("OpenAI web-search provider options normalize cache-only, domains, and location", () => {
	assert.deepEqual(
		normalizeOpenAiWebSearchConfig({
			externalWebAccess: false,
			searchContextSize: "high",
			includeSources: false,
			allowedDomains: [" example.com ", "https://invalid.example"],
			blockedDomains: ["blocked.example", "bad/path"],
			userLocation: {
				country: " US ",
				region: " New York ",
				city: " New York ",
				timezone: " America/New_York ",
			},
		}),
		{
			external_web_access: false,
			search_context_size: "high",
			include_sources: false,
			filters: {
				allowed_domains: ["example.com"],
				blocked_domains: ["blocked.example"],
			},
			user_location: {
				type: "approximate",
				country: "US",
				region: "New York",
				city: "New York",
				timezone: "America/New_York",
			},
		},
	);
});

test("OpenAI web search is serialized as a provider Responses tool", () => {
	const payload = addOpenAiWebSearchProviderTool(
		{
			model: "gpt-5.4",
			input: [],
			tools: [{ type: "function", name: "bash" }],
			include: ["reasoning.encrypted_content"],
		},
		{
			external_web_access: true,
			search_context_size: "high",
			include_sources: true,
			filters: { allowed_domains: ["example.com"], blocked_domains: ["blocked.example"] },
			user_location: { type: "approximate", country: "US", timezone: "America/New_York" },
		},
	);

	assert.deepEqual(payload.include, ["reasoning.encrypted_content", "web_search_call.action.sources"]);
	assert.deepEqual(payload.tools.at(-1), {
		type: "web_search",
		external_web_access: true,
		search_context_size: "high",
		user_location: { type: "approximate", country: "US", timezone: "America/New_York" },
		filters: { allowed_domains: ["example.com"], blocked_domains: ["blocked.example"] },
	});
});

test("OpenAI web search supports cache-only provider mode", () => {
	const payload = addOpenAiWebSearchProviderTool(
		{
			model: "gpt-5.4",
			input: [],
			tools: [],
		},
		{
			external_web_access: false,
			search_context_size: "medium",
			include_sources: false,
		},
	);

	assert.deepEqual(payload.tools, [
		{
			type: "web_search",
			external_web_access: false,
			search_context_size: "medium",
		},
	]);
	assert.equal("include" in payload, false);
});

test("OpenAI web search injection does not duplicate existing provider tools", () => {
	const input = {
		model: "gpt-5.4",
		input: [],
		tools: [{ type: "web_search", external_web_access: true }],
	};
	const payload = addOpenAiWebSearchProviderTool(input, {
		external_web_access: true,
		search_context_size: "medium",
		include_sources: true,
	});

	assert.equal(payload, input);
	assert.deepEqual(payload.tools, [{ type: "web_search", external_web_access: true }]);
});

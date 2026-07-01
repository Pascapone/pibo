import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { basename } from "node:path";
import test from "node:test";
import {
	buildCodexCompatSystemPrompt,
} from "../dist/core/codex-compat.js";
import { createDefaultPiboPluginRegistry } from "../dist/plugins/builtin.js";
import {
	addOpenAiWebSearchProviderTool,
	normalizeOpenAiWebSearchConfig,
} from "../dist/tools/web-search.js";

test("default registry exposes base and not retired built-in coding agents", () => {
	const registry = createDefaultPiboPluginRegistry();
	const profile = registry.createProfile("base");

	assert.deepEqual(registry.getProfileNames(), ["base"]);
	assert.equal(profile.profileName, "base");
	assert.equal(profile.builtinTools, "default");
	assert.deepEqual(profile.builtinToolNames, ["read", "bash", "edit", "write"]);
	assert.deepEqual(profile.tools, []);
	assert.deepEqual(profile.skills, []);
	assert.deepEqual(profile.contextFiles, []);
	assert.deepEqual(profile.subagents, []);
	assert.equal(profile.toolPackages.runControl, undefined);
	assert.throws(() => registry.createProfile("codex"), /Unknown profile "codex"/);
	assert.throws(() => registry.createProfile("codex-compat-openai-web"), /Unknown profile "codex-compat-openai-web"/);
	assert.throws(() => registry.createProfile("pibo-kimi-coding"), /Unknown profile "pibo-kimi-coding"/);
});

test("default registry keeps core and compatibility capabilities without built-in agents", () => {
	const registry = createDefaultPiboPluginRegistry();
	const catalog = registry.getCapabilityCatalog();
	const nativeTooling = catalog.contextFiles.find((contextFile) => contextFile.key === "Pibo Native Tooling");
	const codexBasePrompt = catalog.contextFiles.find((contextFile) => contextFile.key === "Codex Base Prompt");

	assert.ok(nativeTooling);
	assert.equal(nativeTooling.pluginId, "pibo.core");
	assert.equal(nativeTooling.pluginName, "Pibo Core");
	assert.equal(basename(nativeTooling.path), "pibo-native-tooling.md");
	assert.equal(existsSync(nativeTooling.path), true);
	assert.ok(codexBasePrompt);
	assert.equal(codexBasePrompt.pluginId, "pibo.codex-compat");
	assert.equal(basename(codexBasePrompt.path), "codex-base-prompt.md");
	assert.equal(existsSync(codexBasePrompt.path), true);
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

test("default registry exposes codex_image_generation as a Codex-compatible native tool", () => {
	const registry = createDefaultPiboPluginRegistry();
	const catalog = registry.getCapabilityCatalog();
	const imageTool = catalog.nativeTools.find((tool) => tool.name === "codex_image_generation");

	assert.ok(imageTool);
	assert.equal(imageTool.pluginId, "pibo.codex-compat");
	assert.equal(imageTool.hasDefinition, true);
	assert.match(imageTool.description, /ChatGPT\/Codex backend API/);
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

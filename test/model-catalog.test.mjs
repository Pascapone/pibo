import assert from "node:assert/strict";
import test from "node:test";
import { buildModelCatalogFromRegistry, loadModelCatalogWithServices } from "../dist/agent-runtimes/pi/model-catalog.js";

test("model catalog groups models by provider and carries auth state", () => {
	const catalog = buildModelCatalogFromRegistry({
		getAll() {
			return [
				{ provider: "openai", id: "gpt-5.4", name: "GPT-5.4", reasoning: true },
				{ provider: "openai", id: "gpt-5.4-mini", name: "GPT-5.4 Mini", reasoning: false },
				{ provider: "kimi-coding", id: "kimi-for-coding", name: "Kimi For Coding", reasoning: true },
			];
		},
		getProviderDisplayName(provider) {
			return provider === "openai" ? "OpenAI" : "Kimi Coding";
		},
		getProviderAuthStatus(provider) {
			return { configured: provider === "openai" };
		},
	});

	assert.deepEqual(catalog, {
		providers: [
			{
				id: "kimi-coding",
				label: "Kimi Coding",
				authConfigured: false,
				models: [
					{
						provider: "kimi-coding",
						id: "kimi-for-coding",
						label: "Kimi For Coding",
						authConfigured: false,
						supportsReasoning: true,
					},
				],
			},
			{
				id: "openai",
				label: "OpenAI",
				authConfigured: true,
				models: [
					{
						provider: "openai",
						id: "gpt-5.4",
						label: "GPT-5.4",
						authConfigured: true,
						supportsReasoning: true,
					},
					{
						provider: "openai",
						id: "gpt-5.4-mini",
						label: "GPT-5.4 Mini",
						authConfigured: true,
						supportsReasoning: undefined,
					},
				],
			},
		],
	});
});

test("load model catalog returns empty providers when service creation fails", async () => {
	const catalog = await loadModelCatalogWithServices(async () => {
		throw new Error("registry unavailable");
	}, "/tmp/pibo-model-catalog-test");

	assert.deepEqual(catalog, { providers: [] });
});

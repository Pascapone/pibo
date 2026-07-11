import assert from "node:assert/strict";
import test from "node:test";
import { getSupportedThinkingLevels } from "@earendil-works/pi-ai";
import {
	OPENAI_API_KEY_ENV,
	OPENAI_BASE_URL,
	OPENAI_CODEX_BASE_URL,
	OPENAI_CODEX_PROVIDER_ID,
	OPENAI_CODEX_RESPONSES_API,
	OPENAI_GPT_56_MODELS,
	OPENAI_PROVIDER_ID,
	OPENAI_RESPONSES_API,
	buildOpenAiCodexGpt56Models,
	buildOpenAiGpt56Models,
	findOpenAiGpt56Model,
	registerOpenAiGpt56Models,
} from "../dist/providers/openai-gpt56.js";

function makeFakeRegistry() {
	const registrations = [];
	const models = new Map();
	return {
		registrations,
		api: {
			registerProvider(name, config) {
				registrations.push({ name, config });
				for (const key of [...models.keys()]) {
					if (key.startsWith(`${name}/`)) models.delete(key);
				}
				for (const model of config.models ?? []) {
					models.set(`${name}/${model.id}`, { provider: name, ...model });
				}
			},
			find(provider, modelId) {
				return models.get(`${provider}/${modelId}`);
			},
		},
	};
}

const baseOpenAiModel = {
	id: "gpt-5.5",
	name: "GPT-5.5",
	provider: "openai",
	api: "openai-responses",
	baseUrl: OPENAI_BASE_URL,
	reasoning: true,
	thinkingLevelMap: { off: null, xhigh: "xhigh" },
	input: ["text", "image"],
	cost: { input: 5, output: 30, cacheRead: 0.5, cacheWrite: 0 },
	contextWindow: 272000,
	maxTokens: 128000,
};

const baseCodexModel = {
	...baseOpenAiModel,
	id: "gpt-5.5",
	name: "GPT-5.5 Codex",
	provider: "openai-codex",
	api: "openai-codex-responses",
	baseUrl: OPENAI_CODEX_BASE_URL,
	thinkingLevelMap: { xhigh: "xhigh", minimal: "low" },
};

test("GPT-5.6 registration keeps OpenAI API on API token auth and ChatGPT Subscription on OAuth", () => {
	const fake = makeFakeRegistry();
	const result = registerOpenAiGpt56Models(fake.api, {
		baseOpenAiModels: [baseOpenAiModel, baseCodexModel],
		baseOpenAiCodexModels: [baseOpenAiModel, baseCodexModel],
	});

	assert.equal(result.registered, true);
	assert.equal(result.providers, 2);
	assert.equal(result.added, OPENAI_GPT_56_MODELS.length * 2);
	assert.equal(fake.registrations.length, 2);

	const openAi = fake.registrations.find((registration) => registration.name === OPENAI_PROVIDER_ID);
	assert.ok(openAi);
	assert.equal(openAi.config.baseUrl, OPENAI_BASE_URL);
	assert.equal(openAi.config.api, OPENAI_RESPONSES_API);
	assert.equal(openAi.config.apiKey, OPENAI_API_KEY_ENV);
	assert.equal(openAi.config.oauth, undefined);
	assert.equal(openAi.config.models.some((model) => model.provider === OPENAI_CODEX_PROVIDER_ID), false);

	const codex = fake.registrations.find((registration) => registration.name === OPENAI_CODEX_PROVIDER_ID);
	assert.ok(codex);
	assert.equal(codex.config.baseUrl, OPENAI_CODEX_BASE_URL);
	assert.equal(codex.config.api, OPENAI_CODEX_RESPONSES_API);
	assert.equal(codex.config.apiKey, undefined);
	assert.equal(typeof codex.config.oauth?.login, "function");
	assert.equal(typeof codex.config.oauth?.getApiKey, "function");
	assert.equal(codex.config.models.some((model) => model.provider === OPENAI_PROVIDER_ID), false);
});

test("GPT-5.6 OpenAI API models preserve built-ins and add Sol Terra Luna", () => {
	const models = buildOpenAiGpt56Models([baseOpenAiModel, baseCodexModel]);

	assert.ok(models.some((model) => model.id === "gpt-5.5"));
	assert.deepEqual(
		OPENAI_GPT_56_MODELS.map((expected) => models.find((model) => model.id === expected.id)?.name),
		OPENAI_GPT_56_MODELS.map((expected) => expected.name),
	);
	for (const model of models.filter((candidate) => candidate.id.startsWith("gpt-5.6"))) {
		assert.equal(model.provider, OPENAI_PROVIDER_ID);
		assert.equal(model.api, OPENAI_RESPONSES_API);
		assert.equal(model.baseUrl, OPENAI_BASE_URL);
		assert.equal(model.reasoning, true);
		assert.deepEqual(model.thinkingLevelMap, { off: null, xhigh: "xhigh", max: "max" });
		assert.ok(getSupportedThinkingLevels(model).includes("max"));
		assert.deepEqual(model.input, ["text", "image"]);
		assert.equal(model.contextWindow, 1050000);
		assert.equal(model.maxTokens, 128000);
	}
});

test("GPT-5.6 ChatGPT Subscription models preserve built-ins and add Sol Terra Luna", () => {
	const models = buildOpenAiCodexGpt56Models([baseOpenAiModel, baseCodexModel]);

	assert.ok(models.some((model) => model.id === "gpt-5.5"));
	assert.deepEqual(
		OPENAI_GPT_56_MODELS.map((expected) => models.find((model) => model.id === expected.id)?.name),
		OPENAI_GPT_56_MODELS.map((expected) => expected.name),
	);
	for (const model of models.filter((candidate) => candidate.id.startsWith("gpt-5.6"))) {
		assert.equal(model.provider, OPENAI_CODEX_PROVIDER_ID);
		assert.equal(model.api, OPENAI_CODEX_RESPONSES_API);
		assert.equal(model.baseUrl, OPENAI_CODEX_BASE_URL);
		assert.equal(model.reasoning, true);
		assert.deepEqual(model.thinkingLevelMap, { xhigh: "xhigh", max: "max", minimal: "low" });
		assert.ok(getSupportedThinkingLevels(model).includes("max"));
		assert.deepEqual(model.input, ["text", "image"]);
		assert.equal(model.cost.cacheWrite, 0);
		assert.equal(model.contextWindow, 272000);
		assert.equal(model.maxTokens, 128000);
	}
});

test("GPT-5.6 registration does not override upstream built-in models with the same id", () => {
	const upstreamOpenAiSol = {
		...baseOpenAiModel,
		id: "gpt-5.6-sol",
		name: "Upstream GPT-5.6 Sol",
		contextWindow: 123456,
	};
	const upstreamCodexSol = {
		...baseCodexModel,
		id: "gpt-5.6-sol",
		name: "Upstream GPT-5.6 Codex Sol",
		contextWindow: 654321,
	};

	const openAiModels = buildOpenAiGpt56Models([baseOpenAiModel, upstreamOpenAiSol]);
	const codexModels = buildOpenAiCodexGpt56Models([baseCodexModel, upstreamCodexSol]);

	assert.equal(openAiModels.find((model) => model.id === "gpt-5.6-sol")?.name, "Upstream GPT-5.6 Sol");
	assert.equal(openAiModels.find((model) => model.id === "gpt-5.6-sol")?.contextWindow, 123456);
	assert.equal(codexModels.find((model) => model.id === "gpt-5.6-sol")?.name, "Upstream GPT-5.6 Codex Sol");
	assert.equal(codexModels.find((model) => model.id === "gpt-5.6-sol")?.contextWindow, 654321);
});

test("findOpenAiGpt56Model resolves GPT-5.6 models on OpenAI API and ChatGPT Subscription only", () => {
	const fake = makeFakeRegistry();
	registerOpenAiGpt56Models(fake.api, {
		baseOpenAiModels: [baseOpenAiModel],
		baseOpenAiCodexModels: [baseCodexModel],
	});

	assert.equal(findOpenAiGpt56Model(fake.api, { provider: OPENAI_PROVIDER_ID, id: "gpt-5.6-terra" })?.id, "gpt-5.6-terra");
	assert.equal(findOpenAiGpt56Model(fake.api, { provider: OPENAI_CODEX_PROVIDER_ID, id: "gpt-5.6-terra" })?.id, "gpt-5.6-terra");
	assert.equal(findOpenAiGpt56Model(fake.api, { provider: OPENAI_PROVIDER_ID, id: "gpt-5.5" }), undefined);
	assert.equal(findOpenAiGpt56Model(fake.api, { provider: "anthropic", id: "gpt-5.6-terra" }), undefined);
});

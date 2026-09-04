import assert from "node:assert/strict";
import test from "node:test";
import { getSupportedThinkingLevels } from "@earendil-works/pi-ai";
import { ModelRegistry, ModelRuntime } from "@earendil-works/pi-coding-agent";
import {
	OPENAI_API_KEY_ENV,
	OPENAI_BASE_URL,
	OPENAI_CODEX_BASE_URL,
	OPENAI_CODEX_GPT_6_ASTRA_MODEL,
	OPENAI_CODEX_PROVIDER_ID,
	OPENAI_CODEX_RESPONSES_API,
	OPENAI_GPT_56_MODELS,
	OPENAI_PROVIDER_ID,
	OPENAI_RESPONSES_API,
	buildOpenAiCodexSupplementalModels,
	buildOpenAiGpt56Models,
	findOpenAiGpt56Model,
	registerOpenAiSupplementalModels,
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

test("OpenAI supplemental model registration leaves native provider auth ownership unchanged", () => {
	const fake = makeFakeRegistry();
	const result = registerOpenAiSupplementalModels(fake.api, {
		baseOpenAiModels: [baseOpenAiModel, baseCodexModel],
		baseOpenAiCodexModels: [baseOpenAiModel, baseCodexModel],
	});

	assert.equal(result.registered, true);
	assert.equal(result.providers, 2);
	assert.equal(result.added, (OPENAI_GPT_56_MODELS.length * 2) + 1);
	assert.equal(fake.registrations.length, 2);

	const openAi = fake.registrations.find((registration) => registration.name === OPENAI_PROVIDER_ID);
	assert.ok(openAi);
	assert.equal(openAi.config.baseUrl, OPENAI_BASE_URL);
	assert.equal(openAi.config.api, OPENAI_RESPONSES_API);
	assert.equal(openAi.config.apiKey, OPENAI_API_KEY_ENV);
	assert.equal(openAi.config.oauth, undefined);
	assert.equal(openAi.config.models.some((model) => model.provider === OPENAI_CODEX_PROVIDER_ID), false);
	assert.equal(openAi.config.models.some((model) => model.id === OPENAI_CODEX_GPT_6_ASTRA_MODEL.id), false);

	const codex = fake.registrations.find((registration) => registration.name === OPENAI_CODEX_PROVIDER_ID);
	assert.ok(codex);
	assert.equal(codex.config.baseUrl, OPENAI_CODEX_BASE_URL);
	assert.equal(codex.config.api, OPENAI_CODEX_RESPONSES_API);
	assert.equal(codex.config.apiKey, undefined);
	assert.equal(codex.config.oauth, undefined);
	assert.equal(codex.config.models.some((model) => model.provider === OPENAI_PROVIDER_ID), false);
	assert.equal(codex.config.models.some((model) => model.id === OPENAI_CODEX_GPT_6_ASTRA_MODEL.id), true);
});

test("supplemental model registration preserves native Codex OAuth in ModelRuntime", async () => {
	const modelRuntime = await ModelRuntime.create({ allowModelNetwork: false, refreshOnCreate: false });
	const nativeProvider = modelRuntime.getProvider(OPENAI_CODEX_PROVIDER_ID);
	assert.equal(typeof nativeProvider?.auth.oauth?.login, "function");

	registerOpenAiSupplementalModels(new ModelRegistry(modelRuntime));

	const registeredProvider = modelRuntime.getProvider(OPENAI_CODEX_PROVIDER_ID);
	assert.equal(typeof registeredProvider?.auth.oauth?.login, "function");
	assert.ok(modelRuntime.getModel(OPENAI_CODEX_PROVIDER_ID, "gpt-5.6-sol"));
	assert.ok(modelRuntime.getModel(OPENAI_CODEX_PROVIDER_ID, "gpt-6-astra"));
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

test("ChatGPT Subscription models preserve built-ins and add GPT-5.6 variants", () => {
	const models = buildOpenAiCodexSupplementalModels([baseOpenAiModel, baseCodexModel]);

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

test("GPT-6 Astra uses Codex CLI metadata and the ChatGPT subscription endpoint", () => {
	const model = buildOpenAiCodexSupplementalModels([baseCodexModel]).find((candidate) => candidate.id === "gpt-6-astra");

	assert.ok(model);
	assert.equal(model.name, "GPT-6-Astra");
	assert.equal(model.provider, OPENAI_CODEX_PROVIDER_ID);
	assert.equal(model.api, OPENAI_CODEX_RESPONSES_API);
	assert.equal(model.baseUrl, OPENAI_CODEX_BASE_URL);
	assert.equal(model.reasoning, true);
	assert.deepEqual(model.thinkingLevelMap, { off: null, minimal: null, xhigh: "xhigh", max: "max" });
	assert.deepEqual(getSupportedThinkingLevels(model), ["low", "medium", "high", "xhigh", "max"]);
	assert.deepEqual(model.input, ["text", "image"]);
	assert.deepEqual(model.compat, {
		supportsOpenAIGrammarTools: true,
		supportsAdditionalTools: true,
		supportsToolSearch: true,
	});
	assert.deepEqual(OPENAI_CODEX_GPT_6_ASTRA_MODEL.cost, {
		input: 10,
		output: 50,
		cacheRead: 1,
		cacheWrite: 12.5,
	});
	assert.deepEqual(model.cost, { input: 10, output: 50, cacheRead: 1, cacheWrite: 0 });
	assert.equal(model.contextWindow, 272000);
	assert.equal(model.maxTokens, 128000);
});

test("supplemental registration does not override upstream built-in models with the same id", () => {
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
	const upstreamCodexAstra = {
		...baseCodexModel,
		id: "gpt-6-astra",
		name: "Upstream GPT-6 Astra",
		contextWindow: 777777,
	};

	const openAiModels = buildOpenAiGpt56Models([baseOpenAiModel, upstreamOpenAiSol]);
	const codexModels = buildOpenAiCodexSupplementalModels([baseCodexModel, upstreamCodexSol, upstreamCodexAstra]);

	assert.equal(openAiModels.find((model) => model.id === "gpt-5.6-sol")?.name, "Upstream GPT-5.6 Sol");
	assert.equal(openAiModels.find((model) => model.id === "gpt-5.6-sol")?.contextWindow, 123456);
	assert.equal(codexModels.find((model) => model.id === "gpt-5.6-sol")?.name, "Upstream GPT-5.6 Codex Sol");
	assert.equal(codexModels.find((model) => model.id === "gpt-5.6-sol")?.contextWindow, 654321);
	assert.equal(codexModels.find((model) => model.id === "gpt-6-astra")?.name, "Upstream GPT-6 Astra");
	assert.equal(codexModels.find((model) => model.id === "gpt-6-astra")?.contextWindow, 777777);
});

test("supplemental model lookup restricts GPT-6 Astra to ChatGPT Subscription", () => {
	const fake = makeFakeRegistry();
	registerOpenAiSupplementalModels(fake.api, {
		baseOpenAiModels: [baseOpenAiModel],
		baseOpenAiCodexModels: [baseCodexModel],
	});

	assert.equal(findOpenAiGpt56Model(fake.api, { provider: OPENAI_PROVIDER_ID, id: "gpt-5.6-terra" })?.id, "gpt-5.6-terra");
	assert.equal(findOpenAiGpt56Model(fake.api, { provider: OPENAI_CODEX_PROVIDER_ID, id: "gpt-5.6-terra" })?.id, "gpt-5.6-terra");
	assert.equal(findOpenAiGpt56Model(fake.api, { provider: OPENAI_PROVIDER_ID, id: "gpt-5.5" }), undefined);
	assert.equal(findOpenAiGpt56Model(fake.api, { provider: "anthropic", id: "gpt-5.6-terra" }), undefined);
});

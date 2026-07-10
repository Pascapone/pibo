import assert from "node:assert/strict";
import test from "node:test";
import {
	OPENAI_API_KEY_ENV,
	OPENAI_BASE_URL,
	OPENAI_GPT_56_MODELS,
	OPENAI_PROVIDER_ID,
	OPENAI_RESPONSES_API,
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
	baseUrl: "https://chatgpt.com/backend-api",
};

test("GPT-5.6 OpenAI models use the API token provider", () => {
	const fake = makeFakeRegistry();
	const result = registerOpenAiGpt56Models(fake.api, { baseModels: [baseOpenAiModel, baseCodexModel] });

	assert.equal(result.registered, true);
	assert.equal(result.added, OPENAI_GPT_56_MODELS.length);
	assert.equal(fake.registrations.length, 1);
	assert.equal(fake.registrations[0].name, OPENAI_PROVIDER_ID);
	assert.equal(fake.registrations[0].config.baseUrl, OPENAI_BASE_URL);
	assert.equal(fake.registrations[0].config.api, OPENAI_RESPONSES_API);
	assert.equal(fake.registrations[0].config.apiKey, OPENAI_API_KEY_ENV);
	assert.equal(fake.registrations[0].config.models.some((model) => model.provider === "openai-codex"), false);
});

test("GPT-5.6 OpenAI models preserve built-ins and add Sol Terra Luna", () => {
	const models = buildOpenAiGpt56Models([baseOpenAiModel, baseCodexModel]);

	assert.ok(models.some((model) => model.id === "gpt-5.5"));
	assert.deepEqual(
		OPENAI_GPT_56_MODELS.map((expected) => models.find((model) => model.id === expected.id)?.name),
		OPENAI_GPT_56_MODELS.map((expected) => expected.name),
	);
	for (const model of models.filter((candidate) => candidate.id.startsWith("gpt-5.6"))) {
		assert.equal(model.provider, "openai");
		assert.equal(model.api, "openai-responses");
		assert.equal(model.baseUrl, OPENAI_BASE_URL);
		assert.equal(model.reasoning, true);
		assert.deepEqual(model.input, ["text", "image"]);
		assert.equal(model.contextWindow, 1050000);
		assert.equal(model.maxTokens, 128000);
	}
});

test("GPT-5.6 registration does not override an upstream built-in model with the same id", () => {
	const upstreamSol = {
		...baseOpenAiModel,
		id: "gpt-5.6-sol",
		name: "Upstream GPT-5.6 Sol",
		contextWindow: 123456,
	};
	const models = buildOpenAiGpt56Models([baseOpenAiModel, upstreamSol]);
	const sol = models.find((model) => model.id === "gpt-5.6-sol");

	assert.ok(sol);
	assert.equal(sol.name, "Upstream GPT-5.6 Sol");
	assert.equal(sol.contextWindow, 123456);
});

test("findOpenAiGpt56Model only resolves OpenAI GPT-5.6 models", () => {
	const fake = makeFakeRegistry();
	registerOpenAiGpt56Models(fake.api, { baseModels: [baseOpenAiModel] });

	assert.equal(findOpenAiGpt56Model(fake.api, { provider: "openai", id: "gpt-5.6-terra" })?.id, "gpt-5.6-terra");
	assert.equal(findOpenAiGpt56Model(fake.api, { provider: "openai-codex", id: "gpt-5.6-terra" }), undefined);
	assert.equal(findOpenAiGpt56Model(fake.api, { provider: "openai", id: "gpt-5.5" }), undefined);
});

import assert from "node:assert/strict";
import test from "node:test";
import {
	QWEN_TOKEN_PLAN_API_KEY_ENV,
	QWEN_TOKEN_PLAN_DEFAULT_BASE_URL,
	QWEN_TOKEN_PLAN_MODELS,
	QWEN_TOKEN_PLAN_PROVIDER_ID,
	findQwenTokenPlanModel,
	getDefaultQwenTokenPlanModels,
	isQwenTokenPlanProvider,
	registerQwenTokenPlanProvider,
	resetQwenTokenPlanProviderRegistration,
	unregisterQwenTokenPlanProvider,
} from "../dist/providers/qwen-token-plan.js";

function makeFakeRegistry() {
	const registrations = [];
	const unregistrations = [];
	const models = new Map();
	return {
		registrations,
		unregistrations,
		api: {
			registerProvider(name, config) {
				registrations.push({ name, config });
				for (const model of config.models ?? []) {
					models.set(`${name}/${model.id}`, { provider: name, ...model });
				}
			},
			unregisterProvider(name) {
				unregistrations.push(name);
				for (const key of [...models.keys()]) {
					if (key.startsWith(`${name}/`)) models.delete(key);
				}
			},
			find(provider, modelId) {
				return models.get(`${provider}/${modelId}`);
			},
		},
	};
}

const EXPECTED_MODEL_IDS = [
	"qwen3.8-max", "qwen3.7-plus", "qwen3.7-max", "qwen3.6-flash",
	"deepseek-v4-pro-0813", "deepseek-v4-pro", "deepseek-v4-flash-0731",
	"glm-5.2",
];

test.beforeEach(() => {
	resetQwenTokenPlanProviderRegistration();
});

test("Qwen Token Plan exposes only the models available in the Token Plan", () => {
	assert.deepEqual(
		QWEN_TOKEN_PLAN_MODELS.map((model) => model.id),
		EXPECTED_MODEL_IDS,
	);
	assert.equal(QWEN_TOKEN_PLAN_MODELS.length, 8);
	for (const model of QWEN_TOKEN_PLAN_MODELS) {
		assert.equal(model.reasoning, true);
		assert.ok(model.contextWindow > 0, `${model.id} contextWindow`);
		assert.ok(model.maxTokens > 0, `${model.id} maxTokens`);
		assert.ok(model.compat?.maxTokensField === "max_tokens", `${model.id} maxTokensField`);
		assert.equal(model.compat?.supportsStore, false, `${model.id} supportsStore`);
		assert.equal(model.compat?.supportsDeveloperRole, false, `${model.id} supportsDeveloperRole`);
	}
});

test("Qwen models use the qwen thinking format", () => {
	const qwenModels = QWEN_TOKEN_PLAN_MODELS.filter((m) => m.id.startsWith("qwen"));
	assert.equal(qwenModels.length, 4);
	for (const model of qwenModels) {
		assert.equal(model.compat?.thinkingFormat, "qwen", `${model.id} thinkingFormat`);
	}
});

test("DeepSeek models use the deepseek thinking format", () => {
	const deepseekModels = QWEN_TOKEN_PLAN_MODELS.filter((m) => m.id.startsWith("deepseek"));
	assert.equal(deepseekModels.length, 3);
	for (const model of deepseekModels) {
		assert.equal(model.compat?.thinkingFormat, "deepseek", `${model.id} thinkingFormat`);
	}
	assert.equal(deepseekModels.find((m) => m.id === "deepseek-v4-flash-0731")?.contextWindow, 1_000_000);
	assert.equal(deepseekModels.find((m) => m.id === "deepseek-v4-flash-0731")?.maxTokens, 384_000);
});

test("GLM models use the GLM compatible format without special thinking", () => {
	const glmModels = QWEN_TOKEN_PLAN_MODELS.filter((m) => m.id.startsWith("glm"));
	assert.equal(glmModels.length, 1);
	for (const model of glmModels) {
		assert.equal(model.compat?.thinkingFormat, undefined, `${model.id} should not have a thinking format`);
	}
	assert.equal(glmModels.find((m) => m.id === "glm-5.2")?.contextWindow, 1_000_000);
	assert.equal(glmModels.find((m) => m.id === "glm-5.2")?.maxTokens, 131_072);
});

test("registerQwenTokenPlanProvider uses the dedicated Token Plan endpoint and API key", () => {
	const fake = makeFakeRegistry();
	const result = registerQwenTokenPlanProvider(fake.api);

	assert.equal(result.registered, true);
	assert.equal(result.models, 8);
	assert.equal(fake.registrations.length, 1);
	assert.equal(fake.registrations[0].name, QWEN_TOKEN_PLAN_PROVIDER_ID);
	assert.equal(fake.registrations[0].config.name, "Qwen Token Plan");
	assert.equal(fake.registrations[0].config.baseUrl, QWEN_TOKEN_PLAN_DEFAULT_BASE_URL);
	assert.equal(
		fake.registrations[0].config.baseUrl,
		"https://token-plan.ap-southeast-1.maas.aliyuncs.com/compatible-mode/v1",
	);
	assert.equal(fake.registrations[0].config.apiKey, `$${QWEN_TOKEN_PLAN_API_KEY_ENV}`);
});

test("registerQwenTokenPlanProvider honors PIBO_QWEN_TOKEN_PLAN_BASE_URL override", () => {
	const previous = process.env.PIBO_QWEN_TOKEN_PLAN_BASE_URL;
	process.env.PIBO_QWEN_TOKEN_PLAN_BASE_URL = "https://example.test/v1";
	try {
		const fake = makeFakeRegistry();
		registerQwenTokenPlanProvider(fake.api);
		assert.equal(fake.registrations[0].config.baseUrl, "https://example.test/v1");
	} finally {
		if (previous === undefined) delete process.env.PIBO_QWEN_TOKEN_PLAN_BASE_URL;
		else process.env.PIBO_QWEN_TOKEN_PLAN_BASE_URL = previous;
	}
});

test("Qwen Token Plan provider can find and unregister its models", () => {
	const fake = makeFakeRegistry();
	registerQwenTokenPlanProvider(fake.api);

	const found = findQwenTokenPlanModel(fake.api, {
		provider: QWEN_TOKEN_PLAN_PROVIDER_ID,
		id: "deepseek-v4-flash-0731",
	});
	assert.ok(found);
	assert.equal(found.provider, QWEN_TOKEN_PLAN_PROVIDER_ID);
	assert.equal(found.id, "deepseek-v4-flash-0731");
	assert.equal(isQwenTokenPlanProvider(QWEN_TOKEN_PLAN_PROVIDER_ID), true);
	assert.equal(isQwenTokenPlanProvider("openai"), false);
	assert.equal(findQwenTokenPlanModel(fake.api, { provider: "openai", id: "qwen3.7-plus" }), undefined);

	unregisterQwenTokenPlanProvider(fake.api);
	assert.deepEqual(fake.unregistrations, [QWEN_TOKEN_PLAN_PROVIDER_ID]);
	assert.equal(findQwenTokenPlanModel(fake.api, { provider: QWEN_TOKEN_PLAN_PROVIDER_ID, id: "qwen3.7-plus" }), undefined);
});

test("getDefaultQwenTokenPlanModels returns the provider model set", () => {
	assert.deepEqual(getDefaultQwenTokenPlanModels(), QWEN_TOKEN_PLAN_MODELS);
});

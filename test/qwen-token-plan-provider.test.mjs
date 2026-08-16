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

test.beforeEach(() => {
	resetQwenTokenPlanProviderRegistration();
});

test("Qwen Token Plan exposes the supported Qwen text models", () => {
	assert.deepEqual(
		QWEN_TOKEN_PLAN_MODELS.map((model) => model.id),
		["qwen3.7-max", "qwen3.7-plus", "qwen3.6-plus", "qwen3.6-flash"],
	);
	for (const model of QWEN_TOKEN_PLAN_MODELS) {
		assert.equal(model.reasoning, true);
		assert.equal(model.contextWindow, 1_000_000);
		assert.equal(model.maxTokens, 65_536);
		assert.equal(model.compat?.thinkingFormat, "qwen");
		assert.equal(model.compat?.maxTokensField, "max_tokens");
	}
	assert.deepEqual([...QWEN_TOKEN_PLAN_MODELS[0].input], ["text"]);
	assert.deepEqual([...QWEN_TOKEN_PLAN_MODELS[1].input], ["text", "image"]);
});

test("registerQwenTokenPlanProvider uses the dedicated Token Plan endpoint and API key", () => {
	const fake = makeFakeRegistry();
	const result = registerQwenTokenPlanProvider(fake.api);

	assert.equal(result.registered, true);
	assert.equal(result.models, 4);
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
		id: "qwen3.7-plus",
	});
	assert.ok(found);
	assert.equal(found.provider, QWEN_TOKEN_PLAN_PROVIDER_ID);
	assert.equal(found.id, "qwen3.7-plus");
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

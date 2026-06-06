import assert from "node:assert/strict";
import test from "node:test";
import {
	MINIMAX_API_KEY_ENV,
	MINIMAX_CN_PROVIDER_ID,
	MINIMAX_DEFAULT_BASE_URL,
	MINIMAX_M3_MODEL,
	MINIMAX_PROVIDER_ID,
	findMiniMaxModel,
	getDefaultMiniMaxModels,
	isMiniMaxProvider,
	registerMiniMaxProvider,
	resetMiniMaxProviderRegistration,
	unregisterMiniMaxProvider,
} from "../dist/providers/minimax.js";

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

const builtInModels = [
	{
		id: "MiniMax-M2.7",
		name: "MiniMax M2.7",
		provider: "minimax",
		api: "openai-completions",
		baseUrl: MINIMAX_DEFAULT_BASE_URL,
		reasoning: false,
		input: ["text"],
		cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
		contextWindow: 128000,
		maxTokens: 8192,
	},
	{
		id: "MiniMax-M2.7-highspeed",
		name: "MiniMax M2.7 Highspeed",
		provider: "minimax",
		api: "openai-completions",
		baseUrl: MINIMAX_DEFAULT_BASE_URL,
		reasoning: false,
		input: ["text"],
		cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
		contextWindow: 128000,
		maxTokens: 8192,
	},
];

test.beforeEach(() => {
	resetMiniMaxProviderRegistration();
});

test("MINIMAX_M3_MODEL is MiniMax-M3 with multimodal input and 1M context", () => {
	assert.equal(MINIMAX_M3_MODEL.id, "MiniMax-M3");
	assert.equal(MINIMAX_M3_MODEL.contextWindow, 1000000);
	assert.equal(MINIMAX_M3_MODEL.reasoning, true);
	assert.deepEqual([...MINIMAX_M3_MODEL.input], ["text", "image"]);
});

test("registerMiniMaxProvider merges built-in models with MiniMax-M3", () => {
	const fake = makeFakeRegistry();
	const result = registerMiniMaxProvider(fake.api, { baseModels: builtInModels });

	assert.equal(result.registered, true);
	assert.equal(result.models, 3);
	assert.equal(fake.registrations.length, 1);
	assert.equal(fake.registrations[0].name, MINIMAX_PROVIDER_ID);
	assert.equal(fake.registrations[0].config.baseUrl, MINIMAX_DEFAULT_BASE_URL);
	assert.equal(fake.registrations[0].config.apiKey, MINIMAX_API_KEY_ENV);
	assert.deepEqual(
		fake.registrations[0].config.models.map((m) => m.id).sort(),
		["MiniMax-M2.7", "MiniMax-M2.7-highspeed", "MiniMax-M3"],
	);
});

test("registerMiniMaxProvider works with empty baseModels (custom only)", () => {
	const fake = makeFakeRegistry();
	const result = registerMiniMaxProvider(fake.api, { baseModels: [] });

	assert.equal(result.models, 1);
	assert.deepEqual(
		fake.registrations[0].config.models.map((m) => m.id),
		["MiniMax-M3"],
	);
});

test("registerMiniMaxProvider selects CN base URL for minimax-cn", () => {
	const fake = makeFakeRegistry();
	registerMiniMaxProvider(fake.api, {
		providerId: MINIMAX_CN_PROVIDER_ID,
		baseModels: builtInModels.map((m) => ({ ...m, provider: MINIMAX_CN_PROVIDER_ID })),
	});

	assert.equal(fake.registrations[0].name, MINIMAX_CN_PROVIDER_ID);
	assert.equal(fake.registrations[0].config.baseUrl, "https://api.minimax.cn/v1");
});

test("registerMiniMaxProvider is idempotent within a process", () => {
	const fake = makeFakeRegistry();

	registerMiniMaxProvider(fake.api, { baseModels: builtInModels });
	registerMiniMaxProvider(fake.api, { baseModels: builtInModels });

	assert.equal(fake.registrations.length, 1);
});

test("unregisterMiniMaxProvider clears the registration slot", () => {
	const fake = makeFakeRegistry();

	registerMiniMaxProvider(fake.api, { baseModels: builtInModels });
	unregisterMiniMaxProvider(fake.api);
	registerMiniMaxProvider(fake.api, { baseModels: builtInModels });

	assert.equal(fake.registrations.length, 2);
	assert.deepEqual(fake.unregistrations, [MINIMAX_PROVIDER_ID]);
});

test("isMiniMaxProvider recognizes minimax and minimax-cn", () => {
	assert.equal(isMiniMaxProvider("minimax"), true);
	assert.equal(isMiniMaxProvider("minimax-cn"), true);
	assert.equal(isMiniMaxProvider("openai"), false);
	assert.equal(isMiniMaxProvider(undefined), false);
	assert.equal(isMiniMaxProvider(null), false);
});

test("findMiniMaxModel returns registered model for matching input", () => {
	const fake = makeFakeRegistry();
	registerMiniMaxProvider(fake.api, { baseModels: builtInModels });

	const m3 = findMiniMaxModel(fake.api, { provider: "minimax", id: "MiniMax-M3" });
	const m27 = findMiniMaxModel(fake.api, { provider: "minimax", id: "MiniMax-M2.7" });

	assert.ok(m3);
	assert.equal(m3.provider, "minimax");
	assert.equal(m3.id, "MiniMax-M3");
	assert.ok(m27);
	assert.equal(m27.id, "MiniMax-M2.7");
});

test("findMiniMaxModel returns undefined for non-minimax input", () => {
	const fake = makeFakeRegistry();
	registerMiniMaxProvider(fake.api, { baseModels: builtInModels });

	assert.equal(findMiniMaxModel(fake.api, { provider: "openai", id: "gpt-5" }), undefined);
	assert.equal(findMiniMaxModel(fake.api, { provider: "minimax" }), undefined);
	assert.equal(findMiniMaxModel(fake.api, undefined), undefined);
});

test("getDefaultMiniMaxModels includes MiniMax-M3", () => {
	const models = getDefaultMiniMaxModels();
	assert.equal(models.length, 1);
	assert.equal(models[0].id, "MiniMax-M3");
});

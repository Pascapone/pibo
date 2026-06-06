import assert from "node:assert/strict";
import test from "node:test";
import {
	OPENAI_COMPLETIONS_API,
	buildOpenAiCompatConfig,
	registerOpenAiCompatProvider,
	resetOpenAiCompatProviderRegistration,
	unregisterOpenAiCompatProvider,
} from "../dist/providers/openai-compat.js";

function makeFakeRegistry() {
	const registrations = [];
	const unregistrations = [];
	return {
		registrations,
		unregistrations,
		api: {
			registerProvider(name, config) {
				registrations.push({ name, config });
			},
			unregisterProvider(name) {
				unregistrations.push(name);
			},
		},
	};
}

const BASE_MINIMAX = "https://api.minimax.io/v1";
const MINIMAX_KEY_ENV = "MINIMAX_API_KEY";

const sampleSpec = {
	id: "minimax",
	baseUrl: BASE_MINIMAX,
	apiKeyEnv: MINIMAX_KEY_ENV,
	models: [
		{
			id: "MiniMax-M3",
			name: "MiniMax M3",
			reasoning: false,
			contextWindow: 128000,
			maxTokens: 8192,
			cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
			input: ["text"],
		},
	],
};

const builtInModels = [
	{
		id: "MiniMax-M2.7",
		name: "MiniMax M2.7",
		provider: "minimax",
		api: "openai-completions",
		baseUrl: BASE_MINIMAX,
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
		baseUrl: BASE_MINIMAX,
		reasoning: false,
		input: ["text"],
		cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
		contextWindow: 128000,
		maxTokens: 8192,
	},
];

test.beforeEach(() => {
	resetOpenAiCompatProviderRegistration();
});

test("buildOpenAiCompatConfig without base models returns only custom models", () => {
	const config = buildOpenAiCompatConfig(sampleSpec);

	assert.equal(config.api, OPENAI_COMPLETIONS_API);
	assert.equal(config.baseUrl, BASE_MINIMAX);
	assert.equal(config.apiKey, MINIMAX_KEY_ENV);
	assert.deepEqual(
		config.models.map((m) => m.id),
		["MiniMax-M3"],
	);
});

test("buildOpenAiCompatConfig merges built-in models with custom models", () => {
	const config = buildOpenAiCompatConfig(sampleSpec, builtInModels);

	assert.deepEqual(
		config.models.map((m) => m.id).sort(),
		["MiniMax-M2.7", "MiniMax-M2.7-highspeed", "MiniMax-M3"],
	);
});

test("buildOpenAiCompatConfig keeps custom model when it collides with a built-in id", () => {
	const builtInWithM3 = [
		...builtInModels,
		{
			id: "MiniMax-M3",
			name: "MiniMax M3 (built-in)",
			provider: "minimax",
			api: "openai-completions",
			baseUrl: BASE_MINIMAX,
			reasoning: false,
			input: ["text"],
			cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
			contextWindow: 64000,
			maxTokens: 4096,
		},
	];
	const config = buildOpenAiCompatConfig(sampleSpec, builtInWithM3);

	const m3 = config.models.find((m) => m.id === "MiniMax-M3");
	assert.ok(m3);
	assert.equal(m3.name, "MiniMax M3");
	assert.equal(m3.contextWindow, 128000);
});

test("buildOpenAiCompatConfig filters base models to the spec provider id", () => {
	const mixed = [
		...builtInModels,
		{
			id: "gpt-5",
			name: "GPT-5",
			provider: "openai",
			api: "openai-completions",
			baseUrl: "https://api.openai.com/v1",
			reasoning: true,
			input: ["text"],
			cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
			contextWindow: 200000,
			maxTokens: 16000,
		},
	];
	const config = buildOpenAiCompatConfig(sampleSpec, mixed);

	assert.equal(
		config.models.some((m) => m.id === "gpt-5"),
		false,
	);
});

test("registerOpenAiCompatProvider calls registerProvider with merged config", () => {
	const fake = makeFakeRegistry();
	const result = registerOpenAiCompatProvider(fake.api, sampleSpec, {
		baseModels: builtInModels,
	});

	assert.equal(result.registered, true);
	assert.equal(result.models, 3);
	assert.equal(fake.registrations.length, 1);
	assert.equal(fake.registrations[0].name, "minimax");
	assert.deepEqual(
		fake.registrations[0].config.models.map((m) => m.id).sort(),
		["MiniMax-M2.7", "MiniMax-M2.7-highspeed", "MiniMax-M3"],
	);
});

test("registerOpenAiCompatProvider re-registers on a fresh registry", () => {
	const fakeA = makeFakeRegistry();
	const fakeB = makeFakeRegistry();

	registerOpenAiCompatProvider(fakeA.api, sampleSpec, { baseModels: builtInModels });
	const result = registerOpenAiCompatProvider(fakeB.api, sampleSpec, {
		baseModels: builtInModels,
	});

	assert.equal(result.registered, true);
	assert.equal(fakeA.registrations.length, 1);
	assert.equal(fakeB.registrations.length, 1);
});

test("unregisterOpenAiCompatProvider clears the registration slot", () => {
	const fake = makeFakeRegistry();

	registerOpenAiCompatProvider(fake.api, sampleSpec, { baseModels: builtInModels });
	unregisterOpenAiCompatProvider(fake.api, "minimax");
	registerOpenAiCompatProvider(fake.api, sampleSpec, { baseModels: builtInModels });

	assert.equal(fake.registrations.length, 2);
	assert.deepEqual(fake.unregistrations, ["minimax"]);
});

test("registerOpenAiCompatProvider copies input and cost immutably", () => {
	const fake = makeFakeRegistry();
	const inputCost = {
		input: 1,
		output: 2,
		cacheRead: 3,
		cacheWrite: 4,
	};
	const spec = {
		id: "minimax",
		baseUrl: BASE_MINIMAX,
		apiKeyEnv: MINIMAX_KEY_ENV,
		models: [
			{
				id: "MiniMax-M3",
				name: "MiniMax M3",
				reasoning: false,
				contextWindow: 128000,
				maxTokens: 8192,
				cost: inputCost,
				input: ["text"],
			},
		],
	};

	registerOpenAiCompatProvider(fake.api, spec, { baseModels: [] });

	const registered = fake.registrations[0].config.models[0];
	assert.notEqual(registered.cost, inputCost);
	assert.notEqual(registered.input, spec.models[0].input);
	inputCost.input = 999;
	assert.equal(registered.cost.input, 1);
});

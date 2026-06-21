import assert from "node:assert/strict";
import test from "node:test";
import {
	GLM_5_2_MODEL,
	GLM_API_KEY_ENV,
	GLM_DEFAULT_BASE_URL,
	GLM_PROVIDER_ID,
	findGlmModel,
	getDefaultGlmModels,
	isGlmProvider,
	registerGlmProvider,
	resetGlmProviderRegistration,
	unregisterGlmProvider,
} from "../dist/providers/glm.js";

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
	resetGlmProviderRegistration();
});

test("GLM_5_2_MODEL is GLM-5.2 with text input", () => {
	assert.equal(GLM_5_2_MODEL.id, "GLM-5.2");
	assert.equal(GLM_5_2_MODEL.name, "GLM 5.2");
	assert.deepEqual([...GLM_5_2_MODEL.input], ["text"]);
	assert.equal(typeof GLM_5_2_MODEL.contextWindow, "number");
	assert.equal(typeof GLM_5_2_MODEL.maxTokens, "number");
});

test("registerGlmProvider uses z.ai coding base URL and GLM_API_KEY env", () => {
	const fake = makeFakeRegistry();
	const result = registerGlmProvider(fake.api, { baseModels: [] });

	assert.equal(result.registered, true);
	assert.equal(result.models, 1);
	assert.equal(fake.registrations.length, 1);
	assert.equal(fake.registrations[0].name, GLM_PROVIDER_ID);
	assert.equal(fake.registrations[0].config.baseUrl, GLM_DEFAULT_BASE_URL);
	assert.equal(fake.registrations[0].config.baseUrl, "https://api.z.ai/api/coding/paas/v4");
	assert.equal(fake.registrations[0].config.apiKey, GLM_API_KEY_ENV);
	assert.deepEqual(
		fake.registrations[0].config.models.map((m) => m.id),
		["GLM-5.2"],
	);
});

test("registerGlmProvider honors PIBO_GLM_BASE_URL override", () => {
	const previous = process.env.PIBO_GLM_BASE_URL;
	process.env.PIBO_GLM_BASE_URL = "https://example.test/v4";
	try {
		const fake = makeFakeRegistry();
		registerGlmProvider(fake.api, { baseModels: [] });
		assert.equal(fake.registrations[0].config.baseUrl, "https://example.test/v4");
	} finally {
		if (previous === undefined) delete process.env.PIBO_GLM_BASE_URL;
		else process.env.PIBO_GLM_BASE_URL = previous;
	}
});

test("registerGlmProvider merges built-in models with GLM-5.2", () => {
	const fake = makeFakeRegistry();
	const builtIn = [
		{
			id: "GLM-4.6",
			name: "GLM 4.6",
			provider: "glm",
			api: "openai-completions",
			baseUrl: GLM_DEFAULT_BASE_URL,
			reasoning: false,
			input: ["text"],
			cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
			contextWindow: 200000,
			maxTokens: 8192,
		},
	];

	const result = registerGlmProvider(fake.api, { baseModels: builtIn });

	assert.equal(result.models, 2);
	assert.deepEqual(
		fake.registrations[0].config.models.map((m) => m.id).sort(),
		["GLM-4.6", "GLM-5.2"],
	);
});

test("registerGlmProvider re-registers on a fresh registry", () => {
	const fakeA = makeFakeRegistry();
	const fakeB = makeFakeRegistry();

	registerGlmProvider(fakeA.api, { baseModels: [] });
	registerGlmProvider(fakeB.api, { baseModels: [] });

	assert.equal(fakeA.registrations.length, 1);
	assert.equal(fakeB.registrations.length, 1);
});

test("unregisterGlmProvider clears the registration slot", () => {
	const fake = makeFakeRegistry();

	registerGlmProvider(fake.api, { baseModels: [] });
	unregisterGlmProvider(fake.api);
	registerGlmProvider(fake.api, { baseModels: [] });

	assert.equal(fake.registrations.length, 2);
	assert.deepEqual(fake.unregistrations, [GLM_PROVIDER_ID]);
});

test("isGlmProvider recognizes only the glm provider id", () => {
	assert.equal(isGlmProvider("glm"), true);
	assert.equal(isGlmProvider("openai"), false);
	assert.equal(isGlmProvider("minimax"), false);
	assert.equal(isGlmProvider(undefined), false);
	assert.equal(isGlmProvider(null), false);
});

test("findGlmModel returns registered model for matching input", () => {
	const fake = makeFakeRegistry();
	registerGlmProvider(fake.api, { baseModels: [] });

	const found = findGlmModel(fake.api, { provider: "glm", id: "GLM-5.2" });
	assert.ok(found);
	assert.equal(found.provider, "glm");
	assert.equal(found.id, "GLM-5.2");
});

test("findGlmModel returns undefined for non-glm input", () => {
	const fake = makeFakeRegistry();
	registerGlmProvider(fake.api, { baseModels: [] });

	assert.equal(findGlmModel(fake.api, { provider: "openai", id: "gpt-5" }), undefined);
	assert.equal(findGlmModel(fake.api, { provider: "glm" }), undefined);
	assert.equal(findGlmModel(fake.api, undefined), undefined);
});

test("getDefaultGlmModels includes GLM-5.2", () => {
	const models = getDefaultGlmModels();
	assert.equal(models.length, 1);
	assert.equal(models[0].id, "GLM-5.2");
});

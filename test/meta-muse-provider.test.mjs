import assert from "node:assert/strict";
import test from "node:test";
import {
	META_MUSE_API_KEY_ENV,
	META_MUSE_DEFAULT_BASE_URL,
	META_MUSE_MODELS,
	META_MUSE_PROVIDER_ID,
	registerMetaMuseProvider,
} from "../dist/providers/meta-muse.js";

function registry() {
	const registrations = [];
	return {
		registrations,
		registerProvider(id, config) { registrations.push({ id, config }); },
	};
}

test("registerMetaMuseProvider configures the Meta Model API and current Muse Spark models", () => {
	const fake = registry();
	const result = registerMetaMuseProvider(fake);
	assert.equal(result.registered, true);
	assert.equal(result.models, 2);
	assert.equal(fake.registrations[0].id, META_MUSE_PROVIDER_ID);
	assert.equal(fake.registrations[0].config.baseUrl, META_MUSE_DEFAULT_BASE_URL);
	assert.equal(fake.registrations[0].config.apiKey, `$${META_MUSE_API_KEY_ENV}`);
	assert.deepEqual(fake.registrations[0].config.models.map((model) => model.id), META_MUSE_MODELS.map((model) => model.id));
	assert.deepEqual(fake.registrations[0].config.models[0].thinkingLevelMap, {
		off: null,
		minimal: "minimal",
		low: "low",
		medium: "medium",
		high: "high",
		xhigh: "xhigh",
		max: "max",
	});
	assert.deepEqual(fake.registrations[0].config.models[1].thinkingLevelMap, {
		off: null,
		minimal: "minimal",
		low: "low",
		medium: "medium",
		high: "high",
		xhigh: "xhigh",
		max: null,
	});
});

test("registerMetaMuseProvider honors PIBO_META_MUSE_BASE_URL", () => {
	const previous = process.env.PIBO_META_MUSE_BASE_URL;
	process.env.PIBO_META_MUSE_BASE_URL = "http://127.0.0.1:9999/v1";
	try {
		const fake = registry();
		registerMetaMuseProvider(fake);
		assert.equal(fake.registrations[0].config.baseUrl, "http://127.0.0.1:9999/v1");
	} finally {
		if (previous === undefined) delete process.env.PIBO_META_MUSE_BASE_URL;
		else process.env.PIBO_META_MUSE_BASE_URL = previous;
	}
});

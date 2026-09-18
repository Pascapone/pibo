import assert from "node:assert/strict";
import test from "node:test";
import { selectDefaultCatalogModel } from "../dist/agent-runtimes/muse-native/models.js";

test("Muse native default model prefers the catalog default", () => {
	assert.deepEqual(
		selectDefaultCatalogModel({ models: [{ id: "b" }, { id: "a", isDefault: true }] }),
		{ id: "a", provider: "meta-muse" },
	);
});

test("Muse native default model falls back to the first entry", () => {
	assert.deepEqual(
		selectDefaultCatalogModel({ models: [{ id: "b" }, { id: "a" }] }),
		{ id: "b", provider: "meta-muse" },
	);
	assert.equal(selectDefaultCatalogModel({ models: [] }), undefined);
});

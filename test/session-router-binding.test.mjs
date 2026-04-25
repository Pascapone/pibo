import assert from "node:assert/strict";
import test from "node:test";
import { PiboSessionRouter } from "../dist/core/session-router.js";

class StaticBindingStore {
	constructor(binding) {
		this.binding = binding;
	}

	get(sessionKey) {
		return this.binding.sessionKey === sessionKey ? this.binding : undefined;
	}

	resolve() {
		return this.binding;
	}
}

test("session router uses the binding original profile when creating a session", async () => {
	const router = new PiboSessionRouter({
		persistSession: false,
		bindingStore: new StaticBindingStore({
			sessionKey: "web:user-1",
			channel: "web",
			externalId: "user-1",
			originalProfile: "pibo-example-plugin",
			createdAt: new Date().toISOString(),
			updatedAt: new Date().toISOString(),
		}),
	});

	try {
		const output = await router.emit({
			type: "execution",
			sessionKey: "web:user-1",
			action: "status",
		});

		assert.equal(output.type, "execution_result");
		assert.equal(output.result.activeTools.includes("pibo_example_plugin_note"), true);
	} finally {
		await router.disposeAll();
	}
});

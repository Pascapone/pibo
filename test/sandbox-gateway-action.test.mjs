import assert from "node:assert/strict";
import test from "node:test";
import { definePiboCoreContributions } from "../dist/core/capabilities.js";

function coreActions() {
	const actions = new Map();
	definePiboCoreContributions({ addGatewayAction: (action) => actions.set(action.name, action) });
	return actions;
}

function executionEvent(action) {
	return { type: "execution", id: "evt_sandbox", piboSessionId: "ps_sandbox", action };
}

test("sandbox gateway action toggles the runtime sandbox", async () => {
	const sandbox = coreActions().get("sandbox");
	assert.ok(sandbox);
	assert.deepEqual([...sandbox.slashCommands], ["sandbox"]);
	let enabled = true;
	const switches = [];
	const context = {
		getSandbox: () => ({ supported: true, enabled }),
		setSandbox: async (next) => {
			switches.push(next);
			enabled = next;
			return { supported: true, enabled: next, changed: true, restarted: true };
		},
	};
	const off = await sandbox.execute(context, executionEvent("sandbox"));
	assert.equal(off.enabled, false);
	assert.equal(off.changed, true);
	const on = await sandbox.execute(context, executionEvent("sandbox"));
	assert.equal(on.enabled, true);
	assert.deepEqual(switches, [false, true]);
});

test("sandbox gateway action reports unsupported runtimes without switching", async () => {
	const sandbox = coreActions().get("sandbox");
	let switched = false;
	const context = {
		getSandbox: () => ({ supported: false, enabled: false }),
		setSandbox: async () => {
			switched = true;
			throw new Error("unsupported runtimes must not switch");
		},
	};
	const result = await sandbox.execute(context, executionEvent("sandbox"));
	assert.equal(result.supported, false);
	assert.equal(result.changed, false);
	assert.equal(switched, false);
});

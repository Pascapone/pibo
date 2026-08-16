import assert from "node:assert/strict";
import test from "node:test";
import { AgentRuntimeAdapterRegistry } from "../dist/agent-runtime/registry.js";
import { createFakeAgentRuntimeDriver } from "../dist/agent-runtime/testing/fake-adapter.js";

function driverWithAuth(adapterId, auth, createAuth, { defaultDispose = true } = {}) {
	const base = createFakeAgentRuntimeDriver({ adapterId });
	base.descriptor.capabilities.auth = auth;
	const createBase = base.create.bind(base);
	return {
		...base,
		create(input) {
			const operations = createAuth?.(input) ?? {};
			if (defaultDispose && auth.methods.some((method) => method.completion !== "immediate") && !operations.disposeAuth) {
				operations.disposeAuth = async () => {};
			}
			return Object.assign(createBase(input), operations);
		},
	};
}

const unsupportedAuth = {
	status: false,
	methods: [],
	cancel: false,
	logout: false,
	credentialScope: "runtime-instance",
};

const deviceAuth = {
	status: true,
	methods: [
		{ id: "device_code", completion: "notification" },
		{ id: "api_key", completion: "immediate" },
	],
	cancel: true,
	logout: true,
	credentialScope: "runtime-instance",
};

test("runtime registry validates auth capability shape and matching adapter operations", () => {
	const invalidShape = createFakeAgentRuntimeDriver({ adapterId: "auth-invalid-shape" });
	invalidShape.descriptor.capabilities.auth = {
		...unsupportedAuth,
		status: true,
		methods: [{ id: "device_code", completion: "later" }],
	};
	const invalidShapeRegistry = new AgentRuntimeAdapterRegistry();
	assert.throws(() => invalidShapeRegistry.registerDriver(invalidShape), /auth\.methods\[0\]\.completion is invalid/);

	const missingStatus = new AgentRuntimeAdapterRegistry();
	missingStatus.registerDriver(driverWithAuth("auth-missing-status", { ...deviceAuth, methods: [] }, () => ({
		startAuth: undefined,
		completeAuth: undefined,
		cancelAuth: async () => ({ providerId: "fixture", state: "disconnected", configured: false }),
		logoutAuth: async () => ({ providerId: "fixture", state: "disconnected", configured: false }),
	})));
	assert.throws(
		() => missingStatus.registerInstance({ id: "auth-missing-status", adapterId: "auth-missing-status" }),
		/auth\.status must match getAuthStatus/,
	);

	const missingStart = new AgentRuntimeAdapterRegistry();
	missingStart.registerDriver(driverWithAuth("auth-missing-start", deviceAuth, () => ({
		getAuthStatus: async () => [],
		completeAuth: async () => ({ providerId: "fixture", state: "connected", configured: true }),
		cancelAuth: async () => ({ providerId: "fixture", state: "disconnected", configured: false }),
		logoutAuth: async () => ({ providerId: "fixture", state: "disconnected", configured: false }),
	})));
	assert.throws(
		() => missingStart.registerInstance({ id: "auth-missing-start", adapterId: "auth-missing-start" }),
		/declared auth methods must match startAuth/,
	);

	const missingCompletion = new AgentRuntimeAdapterRegistry();
	missingCompletion.registerDriver(driverWithAuth("auth-missing-completion", deviceAuth, () => ({
		getAuthStatus: async () => [],
		startAuth: async () => ({ providerId: "fixture", state: "connected", configured: true }),
		cancelAuth: async () => ({ providerId: "fixture", state: "disconnected", configured: false }),
		logoutAuth: async () => ({ providerId: "fixture", state: "disconnected", configured: false }),
	})));
	assert.throws(
		() => missingCompletion.registerInstance({ id: "auth-missing-completion", adapterId: "auth-missing-completion" }),
		/non-immediate auth methods must match completeAuth/,
	);

	const missingDisposal = new AgentRuntimeAdapterRegistry();
	missingDisposal.registerDriver(driverWithAuth("auth-missing-disposal", deviceAuth, () => ({
		getAuthStatus: async () => [],
		startAuth: async () => ({ providerId: "fixture", state: "connected", configured: true }),
		completeAuth: async () => ({ providerId: "fixture", state: "connected", configured: true }),
		cancelAuth: async () => ({ providerId: "fixture", state: "disconnected", configured: false }),
		logoutAuth: async () => ({ providerId: "fixture", state: "disconnected", configured: false }),
	}), { defaultDispose: false }));
	assert.throws(
		() => missingDisposal.registerInstance({ id: "auth-missing-disposal", adapterId: "auth-missing-disposal" }),
		/non-immediate auth methods require disposeAuth/,
	);
});

test("runtime auth dispatch targets the selected configured instance and strips adapter-private fields", async () => {
	const calls = [];
	const registry = new AgentRuntimeAdapterRegistry();
	registry.registerDriver(driverWithAuth("auth-dispatch", deviceAuth, ({ instanceId }) => ({
		getAuthStatus: async () => [{
			id: "fixture-provider",
			displayName: "Fixture Provider",
			state: "disconnected",
			configured: false,
			methods: [...deviceAuth.methods],
			details: { accountType: "unknown", accountId: "adapter-private-account" },
			nativeLoginId: "adapter-private-login",
		}],
		startAuth: async (input) => {
			calls.push({ instanceId, operation: "start", input: { providerId: input.providerId, method: input.method } });
			return {
				providerId: input.providerId,
				state: "pending",
				configured: false,
				flow: {
					flowId: `flow-${instanceId}`,
					method: "device_code",
					completion: "notification",
					startedAt: "2026-08-16T00:00:00.000Z",
					verificationUrl: "https://example.invalid/device",
					userCode: "FAKE-CODE",
					nativeLoginId: "adapter-private-login",
				},
				accessToken: "adapter-private-token",
			};
		},
		completeAuth: async (input) => ({ providerId: input.providerId, state: "connected", configured: true }),
		cancelAuth: async (input) => ({ providerId: input.providerId, state: "disconnected", configured: false }),
		logoutAuth: async (input) => ({ providerId: input.providerId, state: "disconnected", configured: false }),
	})));
	registry.registerInstance({ id: "auth-dispatch-one", adapterId: "auth-dispatch" });
	registry.registerInstance({ id: "auth-dispatch-two", adapterId: "auth-dispatch" });

	const statuses = await registry.getAuthStatus("auth-dispatch-one");
	assert.deepEqual(statuses[0].details, { accountType: "unknown" });
	assert.doesNotMatch(JSON.stringify(statuses), /adapter-private-account|adapter-private-login|accountId|nativeLoginId/);

	const started = await registry.startAuth("auth-dispatch-two", {
		providerId: "fixture-provider",
		method: "device_code",
	});
	assert.equal(started.runtimeInstanceId, "auth-dispatch-two");
	assert.equal(started.flow.flowId, "flow-auth-dispatch-two");
	assert.deepEqual(calls, [{
		instanceId: "auth-dispatch-two",
		operation: "start",
		input: { providerId: "fixture-provider", method: "device_code" },
	}]);
	assert.doesNotMatch(JSON.stringify(started), /adapter-private-login|adapter-private-token|nativeLoginId|accessToken/);
});

test("runtime auth unsupported and inconsistent result paths fail explicitly", async () => {
	const unsupported = new AgentRuntimeAdapterRegistry();
	unsupported.registerDriver(driverWithAuth("auth-unsupported", unsupportedAuth));
	unsupported.registerInstance({ id: "auth-unsupported", adapterId: "auth-unsupported" });
	await assert.rejects(
		() => unsupported.startAuth("auth-unsupported", { providerId: "fixture-provider", method: "device_code" }),
		(error) => error?.name === "AgentRuntimeCapabilityUnavailableError",
	);

	const mismatch = new AgentRuntimeAdapterRegistry();
	mismatch.registerDriver(driverWithAuth("auth-mismatch", deviceAuth, () => ({
		getAuthStatus: async () => [],
		startAuth: async () => ({ providerId: "wrong-provider", state: "connected", configured: true }),
		completeAuth: async (input) => ({ providerId: input.providerId, state: "connected", configured: true }),
		cancelAuth: async (input) => ({ providerId: input.providerId, state: "disconnected", configured: false }),
		logoutAuth: async (input) => ({ providerId: input.providerId, state: "disconnected", configured: false }),
	})));
	mismatch.registerInstance({ id: "auth-mismatch", adapterId: "auth-mismatch" });
	await assert.rejects(
		() => mismatch.startAuth("auth-mismatch", { providerId: "fixture-provider", method: "api_key", apiKey: "fake" }),
		(error) => error?.name === "AgentRuntimeContractError"
			&& error.runtimeInstanceId === "auth-mismatch"
			&& /provider "wrong-provider" does not match requested provider "fixture-provider"/.test(error.message),
	);
	await assert.rejects(
		() => mismatch.startAuth("auth-mismatch", { providerId: "fixture-provider", method: "api_key", apiKey: "x".repeat(65_537) }),
		/API-key authentication requires a non-empty key no longer than 65536 characters/,
	);
	await assert.rejects(
		() => mismatch.completeAuth("auth-mismatch", {
			providerId: "fixture-provider",
			flowId: "fixture-flow",
			code: "x".repeat(16_385),
		}),
		/Authentication completion code must be non-empty and no longer than 16384 characters/,
	);

	const redaction = new AgentRuntimeAdapterRegistry();
	redaction.registerDriver(driverWithAuth("auth-redaction", deviceAuth, () => ({
		getAuthStatus: async () => [],
		startAuth: async () => {
			const error = new Error("Authorization: Bearer fixture-sensitive-value account_id=private@example.invalid");
			error.name = "AgentRuntimeAuthError";
			throw error;
		},
		completeAuth: async (input) => ({ providerId: input.providerId, state: "connected", configured: true }),
		cancelAuth: async (input) => ({ providerId: input.providerId, state: "disconnected", configured: false }),
		logoutAuth: async (input) => ({ providerId: input.providerId, state: "disconnected", configured: false }),
	})));
	redaction.registerInstance({ id: "auth-redaction", adapterId: "auth-redaction" });
	await assert.rejects(
		() => redaction.startAuth("auth-redaction", { providerId: "fixture-provider", method: "api_key", apiKey: "fake" }),
		(error) => error?.name === "AgentRuntimeAuthError"
			&& /failed safely/.test(error.message)
			&& !/fixture-sensitive-value|private@example\.invalid/.test(error.message),
	);
});

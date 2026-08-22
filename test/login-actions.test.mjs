import assert from "node:assert/strict";
import { mkdirSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { completeLogin, getLoginStatus, startLogin } from "../dist/auth/login-actions.js";
import { createDefaultPiboPluginRegistry } from "../dist/plugins/builtin.js";

function makeJwt(payload) {
	const encode = (value) => Buffer.from(JSON.stringify(value)).toString("base64url");
	return `${encode({ alg: "none" })}.${encode(payload)}.sig`;
}

test("OpenAI Codex login uses device code flow and stores OAuth credentials", async () => {
	const agentDir = join(tmpdir(), `pibo-login-actions-${Date.now()}-${Math.random().toString(16).slice(2)}`);
	mkdirSync(agentDir, { recursive: true });
	const previousAgentDir = process.env.PI_CODING_AGENT_DIR;
	const previousFetch = globalThis.fetch;
	const requests = [];
	const accessToken = makeJwt({
		"https://api.openai.com/auth": { chatgpt_account_id: "acct-test" },
	});

	process.env.PI_CODING_AGENT_DIR = agentDir;
	globalThis.fetch = async (url, init) => {
		requests.push({ url: String(url), body: init?.body ? String(init.body) : "" });
		if (String(url).endsWith("/api/accounts/deviceauth/usercode")) {
			return Response.json({ device_auth_id: "device-1", user_code: "ABCD-1234", interval: "1" });
		}
		if (String(url).endsWith("/api/accounts/deviceauth/token")) {
			return Response.json({
				authorization_code: "auth-code",
				code_challenge: "challenge",
				code_verifier: "verifier",
			});
		}
		if (String(url).endsWith("/oauth/token")) {
			return Response.json({ access_token: accessToken, refresh_token: "refresh-token", expires_in: 3600 });
		}
		throw new Error(`Unexpected fetch URL: ${url}`);
	};

	try {
		const started = await startLogin("openai-codex");
		assert.equal(started.url, "https://auth.openai.com/codex/device");
		assert.equal(started.userCode, "ABCD-1234");
		assert.equal(started.provider, "openai-codex");
		assert.equal(typeof started.state, "string");

		const completed = await completeLogin("openai-codex", undefined, started.state);
		assert.deepEqual(completed, { success: true, provider: "openai-codex", accountId: "acct-test" });

		assert.equal(requests.length, 3);
		assert.equal(requests[0].body, JSON.stringify({ client_id: "app_EMoamEEZ73f0CkXaXp7hrann" }));
		assert.equal(requests[1].body, JSON.stringify({ device_auth_id: "device-1", user_code: "ABCD-1234" }));
		assert.match(requests[2].body, /redirect_uri=https%3A%2F%2Fauth\.openai\.com%2Fdeviceauth%2Fcallback/);
		assert.match(requests[2].body, /code=auth-code/);
		assert.match(requests[2].body, /code_verifier=verifier/);

		const authJson = JSON.parse(readFileSync(join(agentDir, "auth.json"), "utf8"));
		assert.equal(authJson["openai-codex"].type, "oauth");
		assert.equal(authJson["openai-codex"].access, accessToken);
		assert.equal(authJson["openai-codex"].refresh, "refresh-token");
		assert.equal(authJson["openai-codex"].accountId, "acct-test");

		assert.deepEqual(await getLoginStatus("openai-codex"), [
			{
				id: "openai-codex",
				provider: "openai-codex",
				configured: true,
				source: "stored",
			},
		]);
	} finally {
		globalThis.fetch = previousFetch;
		if (previousAgentDir === undefined) delete process.env.PI_CODING_AGENT_DIR;
		else process.env.PI_CODING_AGENT_DIR = previousAgentDir;
		rmSync(agentDir, { recursive: true, force: true });
	}
});

test("Pi runtime adapter preserves device, API-key, status, logout, and shared-store compatibility behind the adapter boundary", async () => {
	const agentDir = join(tmpdir(), `pibo-pi-adapter-auth-${Date.now()}-${Math.random().toString(16).slice(2)}`);
	mkdirSync(agentDir, { recursive: true });
	const previousAgentDir = process.env.PI_CODING_AGENT_DIR;
	const previousFetch = globalThis.fetch;
	process.env.PI_CODING_AGENT_DIR = agentDir;
	globalThis.fetch = async (url) => {
		if (String(url).endsWith("/api/accounts/deviceauth/usercode")) {
			return Response.json({ device_auth_id: "device-adapter", user_code: "PI-FAKE", interval: "1" });
		}
		if (String(url).endsWith("/oauth/token")) {
			return Response.json({
				access_token: makeJwt({ "https://api.openai.com/auth": { chatgpt_account_id: "acct-browser-test" } }),
				refresh_token: "browser-refresh-fixture",
				expires_in: 3600,
			});
		}
		throw new Error(`Unexpected fetch URL: ${url}`);
	};

	try {
		const registry = createDefaultPiboPluginRegistry();
		registry.registerAgentRuntimeInstance({ id: "pi-secondary", adapterId: "pi", displayName: "Pi Secondary" });

		const started = await registry.startAgentRuntimeAuth("pi", {
			providerId: "openai-codex",
			method: "device_code",
		});
		assert.equal(started.runtimeInstanceId, "pi");
		assert.equal(started.state, "pending");
		assert.equal(started.flow.userCode, "PI-FAKE");
		assert.equal(typeof started.flow.flowId, "string");
		assert.doesNotMatch(JSON.stringify(started), /device-adapter|nativeState|verifier|accountId/);
		await assert.rejects(
			() => registry.startAgentRuntimeAuth("pi-secondary", {
				providerId: "openai-codex",
				method: "device_code",
			}),
			/adapter-shared provider credential/,
		);
		assert.equal((await registry.logoutAgentRuntimeAuth("pi-secondary", {
			providerId: "openai-codex",
		})).state, "disconnected");
		await assert.rejects(
			() => registry.cancelAgentRuntimeAuth("pi", {
				providerId: "openai-codex",
				flowId: started.flow.flowId,
			}),
			/could not be canceled safely/,
		);

		const browserStarted = await registry.startAgentRuntimeAuth("pi", {
			providerId: "openai-codex",
			method: "browser_oauth",
		});
		assert.equal(browserStarted.flow.method, "browser_oauth");
		assert.equal(new URL(browserStarted.flow.verificationUrl).origin, "https://auth.openai.com");
		assert.doesNotMatch(JSON.stringify(browserStarted), /verifier|nativeState|accountId|acct-browser-test/);
		const browserCompleted = await registry.completeAgentRuntimeAuth("pi", {
			providerId: "openai-codex",
			flowId: browserStarted.flow.flowId,
			code: "deterministic-browser-code",
		});
		assert.equal(browserCompleted.state, "connected");
		assert.deepEqual(browserCompleted.details, { accountType: "oauth" });
		assert.doesNotMatch(JSON.stringify(browserCompleted), /acct-browser-test|accountId|refresh-fixture/);
		await registry.logoutAgentRuntimeAuth("pi", { providerId: "openai-codex" });

		const configured = await registry.startAgentRuntimeAuth("pi", {
			providerId: "anthropic",
			method: "api_key",
			apiKey: "deterministic-fake-api-key",
		});
		assert.equal(configured.state, "connected");
		assert.deepEqual(configured.details, { accountType: "api_key" });
		assert.equal((await registry.getAgentRuntimeAuthStatus("pi")).find((status) => status.id === "anthropic")?.configured, true);
		assert.equal((await registry.getAgentRuntimeAuthStatus("pi-secondary")).find((status) => status.id === "anthropic")?.configured, true);

		await registry.logoutAgentRuntimeAuth("pi-secondary", { providerId: "anthropic" });
		assert.equal((await registry.getAgentRuntimeAuthStatus("pi")).find((status) => status.id === "anthropic")?.configured, false);
		await registry.disposeAgentRuntimeAuth();
	} finally {
		globalThis.fetch = previousFetch;
		if (previousAgentDir === undefined) delete process.env.PI_CODING_AGENT_DIR;
		else process.env.PI_CODING_AGENT_DIR = previousAgentDir;
		rmSync(agentDir, { recursive: true, force: true });
	}
});

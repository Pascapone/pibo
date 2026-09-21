/**
 * Offline stand-in for the OpenAI Codex OAuth token endpoint.
 *
 * The real pi refresh posts `grant_type=refresh_token` to TOKEN_URL with the
 * global fetch and persists whatever valid rotation the endpoint returns.
 * This peer intercepts that transport call in-process: the refresh logic,
 * rotation mapping and store persistence under test stay completely real,
 * only the HTTP round trip is answered locally. Any request to an
 * unexpected URL throws immediately, which proves the offline property.
 * Recorded request bodies hold synthetic fixture tokens in memory only and
 * are never logged; tests compare them without printing.
 */

export const B1_CODEX_TOKEN_URL = "https://auth.openai.com/oauth/token";

export function syntheticCodexAccessToken(accountId) {
	const payload = Buffer.from(JSON.stringify({
		"https://api.openai.com/auth": { chatgpt_account_id: accountId },
	})).toString("base64");
	return `b1-fixture-header.${payload}.b1-fixture-signature`;
}

export function createRefreshPeer(scenario) {
	const requests = [];
	async function fetch(url, init) {
		const href = typeof url === "string" ? url : String(url?.url ?? url);
		if (href !== B1_CODEX_TOKEN_URL) {
			throw new Error(`b1 refresh peer refuses unexpected network attempt to ${href}`);
		}
		const rawBody = typeof init?.body === "string" ? init.body : init?.body?.toString?.() ?? "";
		const params = Object.fromEntries(new URLSearchParams(rawBody));
		const headers = init?.headers && typeof init.headers === "object" ? { ...init.headers } : {};
		requests.push({ href, method: init?.method, headers, params });
		switch (scenario.kind) {
			case "rotate":
				return new Response(JSON.stringify({
					access_token: scenario.accessToken,
					refresh_token: scenario.refreshToken,
					expires_in: scenario.expiresIn,
				}), { status: 200, headers: { "content-type": "application/json" } });
			case "http-error":
				return new Response(scenario.body, { status: scenario.status });
			case "transport-error":
				throw new Error(scenario.message);
			case "malformed":
				return new Response(JSON.stringify(scenario.payload), {
					status: 200,
					headers: { "content-type": "application/json" },
				});
			default:
				throw new Error(`b1 refresh peer has no scenario ${scenario?.kind}`);
		}
	}
	return { fetch, requests };
}

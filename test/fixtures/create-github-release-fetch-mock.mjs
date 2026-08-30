import { writeFileSync } from "node:fs";

const calls = [];
const logPath = process.env.PIBO_RELEASE_MOCK_LOG;
const existingRelease = process.env.PIBO_RELEASE_MOCK_EXISTING === "1";
const uploadStatus = Number(process.env.PIBO_RELEASE_MOCK_UPLOAD_STATUS ?? "201");

function jsonResponse(body, status = 200) {
	return new Response(JSON.stringify(body), {
		status,
		headers: { "content-type": "application/json" },
	});
}

globalThis.fetch = async (url, init = {}) => {
	const href = String(url);
	const method = init.method ?? "GET";
	calls.push({ href, method });

	if (href === "https://api.github.com/app/installations" && method === "GET") {
		return jsonResponse([{ id: 42, account: { login: "synthetic" } }]);
	}
	if (href === "https://api.github.com/app/installations/42/access_tokens" && method === "POST") {
		return jsonResponse({ token: "synthetic-token", expires_at: "2099-01-01T00:00:00Z" }, 201);
	}
	if (href.includes("/releases/tags/") && method === "GET") {
		if (!existingRelease) return jsonResponse({ message: "Not Found" }, 404);
		return jsonResponse({
			id: 7,
			html_url: "https://github.test/synthetic/release-fixture/releases/tag/v9.9.9",
			upload_url: "https://uploads.github.test/releases/7/assets{?name,label}",
			assets: [{ name: "fixture.vsix", size: 7, browser_download_url: "https://downloads.github.test/fixture.vsix" }],
		});
	}
	if (href.endsWith("/releases") && method === "POST") {
		return jsonResponse({
			id: 7,
			html_url: "https://github.test/synthetic/release-fixture/releases/tag/v9.9.9",
			upload_url: "https://uploads.github.test/releases/7/assets{?name,label}",
			assets: [],
		}, 201);
	}
	if (href.startsWith("https://uploads.github.test/") && method === "POST") {
		if (uploadStatus !== 201) return jsonResponse({ message: "synthetic upload failure" }, uploadStatus);
		return jsonResponse({
			name: "fixture.vsix",
			size: Number(init.headers["Content-Length"]),
			browser_download_url: "https://downloads.github.test/fixture.vsix",
		}, 201);
	}
	throw new Error(`Unexpected synthetic GitHub request: ${method} ${href}`);
};

process.on("exit", () => {
	if (logPath) writeFileSync(logPath, JSON.stringify(calls, null, 2));
});

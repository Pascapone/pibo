import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { join } from "node:path";

// C1-R01 fixture server: loopback-only, temporary, no Pibo gateway contact.
// Serves the built pilot browser bundle, the fixture support bundle, fixture
// pages, and a controlled /api/chat/vscode-web imitation. Modes switch the
// integration answer; every request is logged with an abort flag.

const MIME = {
	".html": "text/html; charset=utf-8",
	".js": "text/javascript; charset=utf-8",
	".json": "application/json; charset=utf-8",
};

export async function startFixtureServer({ staticDir }) {
	const state = { mode: "fallback", failOnceUsed: false };
	const log = [];

	function record(entry) {
		const row = { t: new Date().toISOString(), aborted: false, ...entry };
		log.push(row);
		return row;
	}

	const server = createServer(async (req, res) => {
		const url = new URL(req.url ?? "/", "http://127.0.0.1");
		const row = record({ method: req.method, path: url.pathname });
		let finished = false;
		res.on("close", () => { if (!finished) row.aborted = true; });
		const send = (status, body, type) => {
			res.writeHead(status, { "content-type": type, "content-length": Buffer.byteLength(body) });
			res.end(body, () => { finished = true; });
		};
		try {
			if (url.pathname === "/api/chat/vscode-web") {
				if (req.method !== "GET") return send(405, JSON.stringify({ error: "Method not allowed" }), MIME[".json"]);
				if (state.mode === "slow") await new Promise((resolve) => setTimeout(resolve, 600));
				if (state.mode === "fail-once" && !state.failOnceUsed) {
					state.failOnceUsed = true;
					return send(500, JSON.stringify({ error: "fixture boom" }), MIME[".json"]);
				}
				if (state.mode === "ready") {
					return send(200, JSON.stringify({ integration: { url: "/fixture-vscode" } }), MIME[".json"]);
				}
				return send(200, JSON.stringify({ integration: null }), MIME[".json"]);
			}
			if (url.pathname === "/fixture-vscode") {
				const body = await readFile(join(staticDir, "fixture-vscode.html"), "utf8");
				return send(200, body, MIME[".html"]);
			}
			if (url.pathname === "/fixture.html" || url.pathname === "/pilot-browser.js" || url.pathname === "/fixture-support.js") {
				const body = await readFile(join(staticDir, url.pathname.slice(1)));
				const type = url.pathname.endsWith(".html") ? MIME[".html"] : MIME[".js"];
				return send(200, body, type);
			}
			return send(404, "not found", "text/plain; charset=utf-8");
		} catch (error) {
			if (!res.headersSent) send(500, JSON.stringify({ error: "fixture failure" }), MIME[".json"]);
		}
	});

	await new Promise((resolve, reject) => {
		server.once("error", reject);
		server.listen(0, "127.0.0.1", resolve);
	});
	const address = server.address();
	if (!address || typeof address === "string" || address.address !== "127.0.0.1") {
		server.close();
		throw new Error("Fixture server must bind to 127.0.0.1 only");
	}
	return {
		server,
		port: address.port,
		log,
		setMode(mode) { state.mode = mode; },
		resetFailOnce() { state.failOnceUsed = false; },
		async close() {
			await new Promise((resolve) => server.close(resolve));
		},
	};
}

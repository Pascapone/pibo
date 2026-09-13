import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import test from "node:test";

const repoRoot = resolve(import.meta.dirname, "..");

test("chat web runtime does not import legacy chat store implementations", () => {
	const webApp = readFileSync(join(repoRoot, "src/apps/chat/web-app.ts"), "utf8");
	assert.equal(webApp.includes("./event-log.js"), false);
	assert.equal(webApp.includes("./read-model.js"), false);
	assert.equal(webApp.includes("./rooms.js"), false);
});

test("gateway defaults to pibo.sqlite and treats pibo-sessions.sqlite only as an automatic preserved upgrade source", () => {
	const gateway = readFileSync(join(repoRoot, "src/gateway/server.ts"), "utf8");
	assert.equal(gateway.includes("createDefaultPiboSessionStore()"), false);
	assert.equal(gateway.includes('piboHomePath("pibo.sqlite")'), true);
	assert.equal(gateway.includes("migrateLegacySessionDatabaseAtStartup"), true);
	assert.equal(gateway.includes("new SqlitePiboSessionStore(options.sessionDbPath)"), true, "legacy store runtime access remains explicit-only");
});

test("runtime source does not reintroduce legacy chat data mode flags", () => {
	assert.equal(existsSync(join(repoRoot, "src/data/chat-v2-adapters.ts")), false);
	const runtimeFiles = [
		"src/apps/chat/web-app.ts",
		"src/gateway/server.ts",
	];
	for (const file of runtimeFiles) {
		const source = readFileSync(join(repoRoot, file), "utf8");
		assert.equal(source.includes("PIBO_CHAT_DATA_MODE"), false, file);
		assert.equal(source.includes("PIBO_DATA_V2_WRITE"), false, file);
		assert.equal(source.includes("web-chat.sqlite"), false, file);
	}
});

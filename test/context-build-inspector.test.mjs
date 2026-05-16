import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { InitialSessionContext } from "../dist/core/profiles.js";
import { inspectPiboContextBuild } from "../dist/core/context-build.js";
import { createDefaultPiboPluginRegistry } from "../dist/plugins/builtin.js";
import { createWebSearchToolProfile } from "../dist/tools/web-search.js";

function findNode(nodes, predicate) {
	for (const node of nodes) {
		if (predicate(node)) return node;
		const child = findNode(node.children ?? [], predicate);
		if (child) return child;
	}
	return undefined;
}

test("codex context build includes compact Pibo native tooling context", async () => {
	const snapshot = await inspectPiboContextBuild({ profile: createDefaultPiboPluginRegistry().createProfile("codex") });
	const nativeTooling = findNode(snapshot.nodes, (node) => node.path?.endsWith("context/pibo-native-tooling.md"));

	assert.ok(nativeTooling, "native tooling context file should exist");
	assert.match(nativeTooling.hydratedText, /^# Pibo Native Tooling/m);
	assert.match(nativeTooling.hydratedText, /Start with `pibo debug --help`/);
	assert.match(nativeTooling.hydratedText, /`pibo debug web \.\.\.`/);
	assert.match(nativeTooling.hydratedText, /`pibo debug pty \.\.\.`/);
	assert.match(nativeTooling.hydratedText, /`--real-provider` only with bounded `--max-iterations`/);
	assert.doesNotMatch(nativeTooling.hydratedText, /AGENTS\.md/);
});

test("context build snapshot exposes runtime context and provider-backed web search without final prompt duplicate", async () => {
	const cwd = mkdtempSync(join(tmpdir(), "pibo-context-build-"));
	const profile = new InitialSessionContext({
		profileName: "context-build-test",
		autoContextFiles: false,
		builtinToolNames: ["read", "bash"],
		tools: [createWebSearchToolProfile({ allowedDomains: ["example.com"], searchContextSize: "low" })],
	});

	const snapshot = await inspectPiboContextBuild({
		cwd,
		profile,
		sessionContext: {
			userId: "user_test",
			ownerScope: "user:user_test",
			piboSessionId: "ps_test",
			piboRoomId: "room_test",
			timezone: "UTC",
		},
	});

	assert.equal(snapshot.version, 1);
	assert.equal(snapshot.profileName, "context-build-test");
	assert.equal(snapshot.piboSessionId, "ps_test");
	assert.ok(snapshot.summary.totalNodes > snapshot.summary.topLevelNodes);
	assert.ok(snapshot.summary.estimatedTokens > 0, "summary should include estimated token usage");
	assert.equal(findNode(snapshot.nodes, (node) => /final prompt|full prompt/i.test(node.title)), undefined);

	const runtimeContext = findNode(snapshot.nodes, (node) => node.path === "pibo://runtime/session-context.md");
	assert.ok(runtimeContext, "runtime session context node should exist");
	assert.match(runtimeContext.hydratedText, /Pibo Session ID: ps_test/);
	assert.match(runtimeContext.hydratedText, /Pibo Room ID: room_test/);
	assert.ok(runtimeContext.estimatedTokens > 0, "context file node should include direct estimated tokens");
	assert.ok(runtimeContext.estimatedSubtreeTokens >= runtimeContext.estimatedTokens, "context file node should include subtree estimated tokens");

	const webSearch = findNode(snapshot.nodes, (node) => node.id === "tools/web_search");
	assert.ok(webSearch, "web_search tool node should exist");
	assert.ok(webSearch.badges.includes("PROVIDER-BACKED"));
	assert.ok(webSearch.estimatedSubtreeTokens > 0, "tool parent should aggregate child estimated tokens");

	const providerPayload = findNode([webSearch], (node) => node.kind === "provider_payload");
	assert.equal(providerPayload.payloadJson.provider, "openai");
	assert.equal(providerPayload.payloadJson.openAiWebSearch.search_context_size, "low");
	assert.deepEqual(providerPayload.payloadJson.openAiWebSearch.filters.allowed_domains, ["example.com"]);
});

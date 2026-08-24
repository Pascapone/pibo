import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { CHAT_WEB_APP_NAME } from "../dist/apps/chat/web-app.js";
import { createWebPiboPluginRegistry } from "../dist/gateway/web.js";

function channelContext(registry) {
	return {
		auth: registry.getAuthService(),
		emit() {
			throw new Error("not used");
		},
		subscribe() {
			return () => {};
		},
		getSession() {
			return undefined;
		},
		createSession() {
			throw new Error("not used");
		},
		findSessions() {
			return [];
		},
		getGatewayActions() {
			return [];
		},
		getWebApps() {
			return registry.getWebApps();
		},
	};
}

test("web gateway lands on Chat by explicit app name without changing registry order", async () => {
	const home = await mkdtemp(join(tmpdir(), "pibo-root-landing-"));
	const previousHome = process.env.PIBO_HOME;
	process.env.PIBO_HOME = home;
	let registry;
	let channel;
	try {
		registry = createWebPiboPluginRegistry({ authMode: "local", web: { port: 0 } });
		const apps = registry.getWebApps();
		const annotationsIndex = apps.findIndex((app) => app.name === "web-annotations");
		const chatIndex = apps.findIndex((app) => app.name === CHAT_WEB_APP_NAME);
		assert.ok(annotationsIndex >= 0);
		assert.ok(chatIndex > annotationsIndex, "Chat must not be moved ahead of auxiliary apps to control root landing");

		channel = registry.getChannels().find((candidate) => candidate.name === "web-host");
		assert.ok(channel?.getAddress);
		await channel.start(channelContext(registry));
		const address = channel.getAddress();
		assert.ok(address);
		const response = await fetch(`http://${address.host}:${address.port}/?view=terminal&profileRef=profile-test`, { redirect: "manual" });
		assert.equal(response.status, 302);
		assert.equal(response.headers.get("location"), "/apps/chat?view=terminal&profileRef=profile-test");
	} finally {
		await channel?.stop?.();
		for (const app of registry?.getWebApps() ?? []) await app.dispose?.();
		if (previousHome === undefined) delete process.env.PIBO_HOME;
		else process.env.PIBO_HOME = previousHome;
		await rm(home, { recursive: true, force: true });
	}
});

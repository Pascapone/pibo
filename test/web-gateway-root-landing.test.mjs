import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { CHAT_WEB_APP_NAME } from "../dist/apps/chat/web-app.js";
import { PiboGatewayServer } from "../dist/gateway/server.js";
import { createWebPiboPluginRegistry } from "../dist/gateway/web.js";

function channelContext(registry, apps) {
	return {
		auth: registry.getAuthService(),
		emit() { throw new Error("not used"); },
		subscribe() { return () => {}; },
		getSession() { return undefined; },
		createSession() { throw new Error("not used"); },
		findSessions() { return []; },
		getGatewayActions() { return []; },
		getWebApps() { return apps; },
	};
}

test("web gateway lands on Chat by explicit app name without changing registry order", async () => {
	const home = await mkdtemp(join(tmpdir(), "pibo-root-landing-"));
	const previousHome = process.env.PIBO_HOME;
	process.env.PIBO_HOME = home;
	let registry;
	let server;
	let channel;
	try {
		registry = createWebPiboPluginRegistry({ authMode: "local", web: { host: "127.0.0.1", port: 0 } });
		server = new PiboGatewayServer({ pluginRegistry: registry, persistSession: false, host: "127.0.0.1", port: 0, startChannels: false });
		await server.start();
		const apps = registry.getWebApps();
		const annotations = apps.find((app) => app.name === "web-annotations");
		const chat = apps.find((app) => app.name === CHAT_WEB_APP_NAME);
		assert.ok(annotations);
		assert.ok(chat);
		const reorderedApps = [annotations, ...apps.filter((app) => app !== annotations && app !== chat), chat];
		assert.equal(reorderedApps[0].name, "web-annotations");

		channel = registry.getChannels().find((candidate) => candidate.name === "web-host");
		assert.ok(channel?.getAddress);
		await channel.start(channelContext(registry, reorderedApps));
		const address = channel.getAddress();
		assert.ok(address);
		const response = await fetch(`http://${address.host}:${address.port}/?view=terminal&profileRef=profile-test`, { redirect: "manual" });
		assert.equal(response.status, 302);
		assert.equal(response.headers.get("location"), "/apps/chat?view=terminal&profileRef=profile-test");
	} finally {
		await channel?.stop?.();
		await server?.stop();
		for (const app of registry?.getWebApps() ?? []) await app.dispose?.();
		await registry?.disposePlugins();
		if (previousHome === undefined) delete process.env.PIBO_HOME;
		else process.env.PIBO_HOME = previousHome;
		await rm(home, { recursive: true, force: true });
	}
});

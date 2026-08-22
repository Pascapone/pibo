import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { createWebPiboPluginRegistry } from "../dist/gateway/web.js";

test("web gateway registers the chat web app first so the root URL lands on sessions", async () => {
	const home = await mkdtemp(join(tmpdir(), "pibo-root-landing-"));
	const previousHome = process.env.PIBO_HOME;
	process.env.PIBO_HOME = home;
	try {
		const registry = createWebPiboPluginRegistry({ authMode: "local" });
		const apps = registry.getWebApps();

		assert.ok(apps.length > 0);
		assert.equal(apps[0].name, "pibo.chat-web");
		assert.equal(apps[0].mountPath, "/apps/chat");
	} finally {
		if (previousHome === undefined) delete process.env.PIBO_HOME;
		else process.env.PIBO_HOME = previousHome;
		await rm(home, { recursive: true, force: true }).catch((error) => {
			if (error?.code !== "EBUSY") throw error;
		});
	}
});
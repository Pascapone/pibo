import assert from "node:assert/strict";
import test from "node:test";
import { PiboGatewayServer } from "../dist/gateway/server.js";
import { piboCorePlugin } from "../dist/plugins/builtin.js";
import { piboCodexCompatPlugin } from "../dist/plugins/codex-compat.js";
import { definePiboPlugin, PiboPluginRegistry } from "../dist/plugins/registry.js";
import { InMemoryPiboSessionStore } from "../dist/sessions/store.js";

test("gateway starts plugin channels with router and session session context", async () => {
	const registry = PiboPluginRegistry.create({ plugins: [piboCorePlugin, piboCodexCompatPlugin] });
	const store = new InMemoryPiboSessionStore();
	let startedSession;
	let stopped = false;

	registry.registerPlugin(
		definePiboPlugin({
			id: "test.channel",
			register(api) {
				api.registerAuthService({
					name: "test-auth",
					getSession() {
						return Promise.resolve(undefined);
					},
					requireSession() {
						throw new Error("not used");
					},
				});
				api.registerChannel({
					name: "test-web-channel",
					kind: "web",
					auth: { mode: "required" },
					start(context) {
						startedSession = context.createSession({
							id: "ps_web_user_1",
							channel: "web",
							kind: "chat",
							profile: "base",
							ownerScope: "user:user-1",
						});
					},
					stop() {
						stopped = true;
					},
				});
			},
		}),
	);

	const server = new PiboGatewayServer({
		port: 0,
		persistSession: false,
		pluginRegistry: registry,
		sessionStore: store,
	});

	await server.start();
	await server.stop();

	assert.equal(startedSession.id, "ps_web_user_1");
	assert.equal(startedSession.profile, "base");
	assert.equal(store.get("ps_web_user_1"), startedSession);
	assert.equal(stopped, true);
});

test("gateway stops plugin channels in reverse start order", async () => {
	const registry = PiboPluginRegistry.create({ plugins: [piboCorePlugin] });
	const events = [];

	registry.registerPlugin(
		definePiboPlugin({
			id: "test.channel-stop-order",
			register(api) {
				for (const name of ["a", "b"]) {
					api.registerChannel({
						name: `ordered-channel-${name}`,
						kind: "local",
						auth: { mode: "trusted-local" },
						start() {
							events.push(`start:${name}`);
						},
						stop() {
							events.push(`stop:${name}`);
						},
					});
				}
			},
		}),
	);

	const server = new PiboGatewayServer({
		port: 0,
		persistSession: false,
		pluginRegistry: registry,
		sessionStore: new InMemoryPiboSessionStore(),
	});

	await server.start();
	await server.stop();

	assert.deepEqual(events, ["start:a", "start:b", "stop:b", "stop:a"]);
});

test("gateway rejects required-auth channels without an auth service", async () => {
	const registry = PiboPluginRegistry.create({ plugins: [piboCorePlugin] });

	registry.registerPlugin(
		definePiboPlugin({
			id: "test.required-channel",
			register(api) {
				api.registerChannel({
					name: "required-web-channel",
					kind: "web",
					auth: { mode: "required" },
					start() {},
				});
			},
		}),
	);

	const server = new PiboGatewayServer({
		port: 0,
		persistSession: false,
		pluginRegistry: registry,
		sessionStore: new InMemoryPiboSessionStore(),
	});

	await assert.rejects(
		() => server.start(),
		/Channel "required-web-channel" requires auth, but no auth service is registered/,
	);
	await server.stop();
});

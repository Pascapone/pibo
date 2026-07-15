import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { createPiboContextFilesPlugin } from "../dist/plugins/context-files.js";
import { PiboPluginRegistry } from "../dist/plugins/registry.js";
import { createWebHostChannel } from "../dist/web/channel.js";
import { InMemoryPiboSessionStore } from "../dist/sessions/store.js";

function createFakeAuthService() {
	return {
		name: "fake-auth",
		async getSession(headers) {
			const userId = headers.get("x-test-user");
			if (!userId) return undefined;
			return {
				identity: {
					userId,
					email: `${userId}@example.test`,
					provider: "test",
				},
			};
		},
		async requireSession(headers) {
			const session = await this.getSession(headers);
			if (!session) throw new Error("Unauthenticated");
			return session;
		},
	};
}

async function startContextFilesHost(setup) {
	const sessions = new InMemoryPiboSessionStore();
	const registry = PiboPluginRegistry.create({
		plugins: [
			{
				id: "test.context",
				register(api) {
					api.registerContextFile({
						key: "plugin-doc",
						label: "Plugin Doc",
						path: setup.pluginFilePath,
					});
				},
			},
			createPiboContextFilesPlugin({
				managedRoot: setup.managedRoot,
				globalDir: setup.globalDir,
				agentWorkspaceRoot: setup.agentWorkspaceRoot,
				storePath: setup.storePath,
				metadataPath: setup.metadataPath,
			}),
		],
	});
	const channel = createWebHostChannel({ port: 0, announce: false });
	await channel.start({
		auth: createFakeAuthService(),
		async emit() {
			return { type: "message_queued", piboSessionId: "ps_test", eventId: "evt_test", queuedMessages: 0 };
		},
		subscribe() {
			return () => {};
		},
		getSession(id) {
			return sessions.get(id);
		},
		createSession(input) {
			return sessions.create(input);
		},
		findSessions(input) {
			return sessions.find(input);
		},
		getGatewayActions() {
			return [];
		},
		getCapabilityCatalog() {
			return registry.getCapabilityCatalog();
		},
		upsertContextFile(contextFile) {
			registry.upsertContextFile(contextFile);
		},
		removeContextFile(key) {
			registry.removeContextFile(key);
		},
		emitProductEvent(event) {
			return registry.emitProductEvent(event);
		},
		subscribeProductEvents(listener) {
			return registry.onProductEvent(listener);
		},
		getWebApps() {
			return registry.getWebApps();
		},
	});
	const address = channel.getAddress();
	assert.ok(address);
	return {
		channel,
		baseURL: `http://${address.host}:${address.port}`,
	};
}

async function getJson(url, init = {}) {
	const response = await fetch(url, init);
	return {
		response,
		data: await response.json(),
	};
}

function authHeaders(baseURL) {
	return {
		"x-test-user": "user-1",
		"content-type": "application/json",
		origin: baseURL,
	};
}

test("context files web app links plugin files into managed revisions and restores history", async () => {
	const dir = mkdtempSync(join(tmpdir(), "pibo-context-files-web-"));
	const managedRoot = join(dir, "managed");
	const agentWorkspaceRoot = join(dir, "agent-workspaces");
	const pluginFilePath = join(dir, "plugin-doc.md");
	writeFileSync(pluginFilePath, "# Plugin V1\n", "utf8");
	const { channel, baseURL } = await startContextFilesHost({
		pluginFilePath,
		managedRoot,
		agentWorkspaceRoot,
		metadataPath: join(managedRoot, "context-files.sqlite"),
	});

	try {
		const listed = await getJson(`${baseURL}/api/context-files`, {
			headers: { "x-test-user": "user-1" },
		});
		assert.equal(listed.response.status, 200);
		assert.equal(listed.data.files[0].linkState, "plugin-only");
		assert.equal(listed.data.files[0].editable, false);

		const linked = await getJson(`${baseURL}/api/context-files/plugin-doc/link-from-plugin`, {
			method: "POST",
			headers: authHeaders(baseURL),
			body: JSON.stringify({ scope: "agent", agentProfileName: "designer" }),
		});
		assert.equal(linked.response.status, 201);
		assert.equal(linked.data.file.managed, true);
		assert.equal(linked.data.file.linkState, "linked-clean");
		assert.equal(linked.data.file.scope, "agent");
		assert.equal(linked.data.file.agentProfileName, "designer");
		assert.equal(linked.data.file.sourceRef, "plugin:test.context:plugin-doc");
		const managedKey = linked.data.file.key;

		const updated = await getJson(`${baseURL}/api/context-files/${encodeURIComponent(managedKey)}`, {
			method: "PUT",
			headers: authHeaders(baseURL),
			body: JSON.stringify({
				markdown: "# Customized\n",
				expectedVersion: linked.data.file.version,
			}),
		});
		assert.equal(updated.response.status, 200);
		assert.equal(updated.data.file.linkState, "linked-dirty");

		const conflict = await getJson(`${baseURL}/api/context-files/${encodeURIComponent(managedKey)}`, {
			method: "PUT",
			headers: authHeaders(baseURL),
			body: JSON.stringify({
				markdown: "# Concurrent Edit\n",
				expectedVersion: linked.data.file.version,
			}),
		});
		assert.equal(conflict.response.status, 409);
		assert.equal(conflict.data.error, "Context file changed before save");
		assert.equal(conflict.data.file.version, updated.data.file.version);
		assert.equal(conflict.data.file.markdown, "# Customized\n");

		const pluginRead = await getJson(`${baseURL}/api/context-files/plugin-doc`, {
			headers: { "x-test-user": "user-1" },
		});
		assert.equal(pluginRead.data.file.markdown, "# Plugin V1\n");

		const revisionsBeforeReset = await getJson(`${baseURL}/api/context-files/${encodeURIComponent(managedKey)}/revisions`, {
			headers: { "x-test-user": "user-1" },
		});
		const customizedRevision = revisionsBeforeReset.data.revisions.find((revision) => revision.content === "# Customized\n");
		assert.ok(customizedRevision);

		writeFileSync(pluginFilePath, "# Plugin V2\n", "utf8");
		const staleRead = await getJson(`${baseURL}/api/context-files/${encodeURIComponent(managedKey)}`, {
			headers: { "x-test-user": "user-1" },
		});
		assert.equal(staleRead.data.file.linkState, "linked-stale");

		const reset = await getJson(`${baseURL}/api/context-files/${encodeURIComponent(managedKey)}/reset-to-source`, {
			method: "POST",
			headers: authHeaders(baseURL),
			body: "{}",
		});
		assert.equal(reset.response.status, 200);
		assert.equal(reset.data.file.markdown, "# Plugin V2\n");
		assert.equal(reset.data.file.linkState, "linked-clean");

		const restored = await getJson(`${baseURL}/api/context-files/${encodeURIComponent(managedKey)}/restore-revision`, {
			method: "POST",
			headers: authHeaders(baseURL),
			body: JSON.stringify({ revisionId: customizedRevision.id }),
		});
		assert.equal(restored.response.status, 200);
		assert.equal(restored.data.file.markdown, "# Customized\n");

		const diff = await getJson(`${baseURL}/api/context-files/${encodeURIComponent(managedKey)}/diff?base=source&target=working`, {
			headers: { "x-test-user": "user-1" },
		});
		assert.equal(diff.response.status, 200);
		assert.ok(diff.data.chunks.some((chunk) => chunk.type === "remove"));
		assert.ok(diff.data.chunks.some((chunk) => chunk.type === "add"));
	} finally {
		await channel.stop?.();
		rmSync(dir, { recursive: true, force: true });
	}
});

test("context files web app creates one catalog entry per global managed file", async () => {
	const dir = mkdtempSync(join(tmpdir(), "pibo-context-files-create-"));
	const managedRoot = join(dir, "managed");
	const globalDir = join(managedRoot, "global");
	const agentWorkspaceRoot = join(dir, "agent-workspaces");
	const pluginFilePath = join(dir, "plugin-doc.md");
	writeFileSync(pluginFilePath, "# Plugin Source\n", "utf8");

	const { channel, baseURL } = await startContextFilesHost({
		pluginFilePath,
		managedRoot,
		globalDir,
		agentWorkspaceRoot,
		metadataPath: join(managedRoot, "context-files.sqlite"),
	});

	try {
		const created = await getJson(`${baseURL}/api/context-files`, {
			method: "POST",
			headers: authHeaders(baseURL),
			body: JSON.stringify({ label: "Ralph test context", scope: "global", markdown: "# Test\n" }),
		});
		assert.equal(created.response.status, 201);
		assert.equal(created.data.file.key, "ctx:ralph-test-context");
		assert.equal(created.data.file.label, "Ralph test context");

		const linked = await getJson(`${baseURL}/api/context-files/plugin-doc/link-from-plugin`, {
			method: "POST",
			headers: authHeaders(baseURL),
			body: JSON.stringify({ scope: "global" }),
		});
		assert.equal(linked.response.status, 201);
		assert.equal(linked.data.file.key, "ctx:plugin-doc");

		const listed = await getJson(`${baseURL}/api/context-files`, {
			headers: { "x-test-user": "user-1" },
		});
		assert.equal(listed.response.status, 200);
		assert.equal(listed.data.files.filter((file) => file.path === created.data.file.path).length, 1);
		assert.equal(listed.data.files.filter((file) => file.path === linked.data.file.path).length, 1);
	} finally {
		await channel.stop?.();
		rmSync(dir, { recursive: true, force: true });
	}
});

test("context files web app auto-registers markdown files dropped into the global context directory", async () => {
	const dir = mkdtempSync(join(tmpdir(), "pibo-context-files-discovery-"));
	const managedRoot = join(dir, "managed");
	const globalDir = join(managedRoot, "global");
	const agentWorkspaceRoot = join(dir, "agent-workspaces");
	const pluginFilePath = join(dir, "plugin-doc.md");
	mkdirSync(globalDir, { recursive: true });
	writeFileSync(pluginFilePath, "# Plugin Source\n", "utf8");
	writeFileSync(join(globalDir, "docker-system.md"), "# Docker System\n", "utf8");

	const { channel, baseURL } = await startContextFilesHost({
		pluginFilePath,
		managedRoot,
		globalDir,
		agentWorkspaceRoot,
		metadataPath: join(managedRoot, "context-files.sqlite"),
	});

	try {
		const listed = await getJson(`${baseURL}/api/context-files`, {
			headers: { "x-test-user": "user-1" },
		});
		assert.equal(listed.response.status, 200);
		const discovered = listed.data.files.find((file) => file.key === "ctx:docker-system");
		assert.ok(discovered);
		assert.equal(discovered.label, "Docker System");
		assert.equal(discovered.source, "managed");
		assert.equal(discovered.scope, "global");
		assert.equal(discovered.linkState, "managed-unlinked");

		const read = await getJson(`${baseURL}/api/context-files/ctx%3Adocker-system`, {
			headers: { "x-test-user": "user-1" },
		});
		assert.equal(read.response.status, 200);
		assert.equal(read.data.file.markdown, "# Docker System\n");

		writeFileSync(join(globalDir, "operator-notes.md"), "# Operator Notes\n", "utf8");
		const relisted = await getJson(`${baseURL}/api/context-files`, {
			headers: { "x-test-user": "user-1" },
		});
		assert.equal(relisted.response.status, 200);
		assert.ok(relisted.data.files.find((file) => file.key === "ctx:operator-notes"));
	} finally {
		await channel.stop?.();
		rmSync(dir, { recursive: true, force: true });
	}
});

test("context files web app migrates legacy managed files and preserves orphaned working copies", async () => {
	const dir = mkdtempSync(join(tmpdir(), "pibo-context-files-legacy-"));
	const managedRoot = join(dir, "managed");
	const agentWorkspaceRoot = join(dir, "agent-workspaces");
	const pluginFilePath = join(dir, "plugin-doc.md");
	const managedFilePath = join(managedRoot, "global", "legacy.md");
	mkdirSync(join(managedRoot, "global"), { recursive: true });
	writeFileSync(pluginFilePath, "# Plugin Source\n", "utf8");
	writeFileSync(managedFilePath, "# Legacy Managed\n", "utf8");
	writeFileSync(join(managedRoot, "index.json"), JSON.stringify({
		files: [
			{
				key: "ctx:legacy",
				label: "Legacy",
				path: managedFilePath,
				scope: "global",
			},
		],
	}, null, 2));

	const { channel, baseURL } = await startContextFilesHost({
		pluginFilePath,
		managedRoot,
		agentWorkspaceRoot,
		metadataPath: join(managedRoot, "context-files.sqlite"),
	});

	try {
		const migrated = await getJson(`${baseURL}/api/context-files/ctx%3Alegacy`, {
			headers: { "x-test-user": "user-1" },
		});
		assert.equal(migrated.response.status, 200);
		assert.equal(migrated.data.file.linkState, "managed-unlinked");
		assert.equal(migrated.data.file.markdown, "# Legacy Managed\n");

		const linked = await getJson(`${baseURL}/api/context-files/plugin-doc/link-from-plugin`, {
			method: "POST",
			headers: authHeaders(baseURL),
			body: "{}",
		});
		assert.equal(linked.response.status, 201);
		const linkedKey = linked.data.file.key;

		rmSync(pluginFilePath, { force: true });
		const orphaned = await getJson(`${baseURL}/api/context-files/${encodeURIComponent(linkedKey)}`, {
			headers: { "x-test-user": "user-1" },
		});
		assert.equal(orphaned.response.status, 200);
		assert.equal(orphaned.data.file.linkState, "orphaned");
		assert.equal(orphaned.data.file.markdown, "# Plugin Source\n");
	} finally {
		await channel.stop?.();
		rmSync(dir, { recursive: true, force: true });
	}
});

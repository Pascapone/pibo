import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import test from "node:test";
import { createPiboContextFilesPlugin } from "../dist/plugins/context-files.js";
import { ContextFileMetadataStore, hashContextFileContent } from "../dist/plugins/context-files-store.js";
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

async function startContextFilesHost(setup, createContextFilesPlugin = createPiboContextFilesPlugin) {
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
			createContextFilesPlugin({
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
		async dispose() {
			for (const app of registry.getWebApps()) await app.dispose?.();
		},
	};
}

async function getJson(url, init = {}) {
	const response = await fetch(url, init);
	return {
		response,
		data: await response.json(),
	};
}

function delay(ms) {
	return new Promise((resolve) => setTimeout(resolve, ms));
}

function authHeaders(baseURL) {
	return {
		"x-test-user": "user-1",
		"content-type": "application/json",
		origin: baseURL,
	};
}

test("context files web app serves its packaged UI independently of the process working directory", async () => {
	const dir = mkdtempSync(join(tmpdir(), "pibo-context-files-ui-cwd-"));
	const originalCwd = process.cwd();
	let channel;
	let dispose;
	try {
		process.chdir(dir);
		const moduleUrl = new URL(`../dist/plugins/context-files.js?cwd-test=${Date.now()}`, import.meta.url);
		const module = await import(moduleUrl.href);
		const started = await startContextFilesHost({
			pluginFilePath: join(dir, "plugin-doc.md"),
			managedRoot: join(dir, "managed"),
			agentWorkspaceRoot: join(dir, "agent-workspaces"),
			metadataPath: join(dir, "managed", "context-files.sqlite"),
		}, module.createPiboContextFilesPlugin);
		channel = started.channel;
		dispose = started.dispose;

		const response = await fetch(`${started.baseURL}/apps/context-files`, {
			headers: { "x-test-user": "user-1" },
		});
		const html = await response.text();
		assert.equal(response.status, 200);
		assert.match(html, /<div id="root"><\/div>/);
		assert.match(html, /<script type="module"/);
		assert.doesNotMatch(html, /Context Files UI has not been built/);
	} finally {
		await channel?.stop?.();
		await dispose?.();
		process.chdir(originalCwd);
		rmSync(dir, { recursive: true, force: true });
	}
});

test("context files autosave working content but create named revisions only on manual request", async () => {
	const dir = mkdtempSync(join(tmpdir(), "pibo-context-files-web-"));
	const managedRoot = join(dir, "managed");
	const agentWorkspaceRoot = join(dir, "agent-workspaces");
	const pluginFilePath = join(dir, "plugin-doc.md");
	writeFileSync(pluginFilePath, "# Plugin V1\n", "utf8");
	const { channel, baseURL, dispose } = await startContextFilesHost({
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

		const revisionsAfterLink = await getJson(`${baseURL}/api/context-files/${encodeURIComponent(managedKey)}/revisions`, {
			headers: { "x-test-user": "user-1" },
		});
		assert.deepEqual(revisionsAfterLink.data.revisions, []);

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

		const revisionsAfterAutosave = await getJson(`${baseURL}/api/context-files/${encodeURIComponent(managedKey)}/revisions`, {
			headers: { "x-test-user": "user-1" },
		});
		assert.deepEqual(revisionsAfterAutosave.data.revisions, []);

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

		const unnamedRevision = await getJson(`${baseURL}/api/context-files/${encodeURIComponent(managedKey)}/revisions`, {
			method: "POST",
			headers: authHeaders(baseURL),
			body: JSON.stringify({ name: "   " }),
		});
		assert.equal(unnamedRevision.response.status, 400);

		const createdRevision = await getJson(`${baseURL}/api/context-files/${encodeURIComponent(managedKey)}/revisions`, {
			method: "POST",
			headers: authHeaders(baseURL),
			body: JSON.stringify({ name: " Customized baseline " }),
		});
		assert.equal(createdRevision.response.status, 201);
		assert.match(createdRevision.data.revision.id, /^rev_/);
		assert.equal(createdRevision.data.revision.name, "Customized baseline");
		assert.equal(createdRevision.data.revision.content, "# Customized\n");
		assert.equal(createdRevision.data.revision.actorId, "user-1");
		assert.ok(Number.isFinite(Date.parse(createdRevision.data.revision.createdAt)));

		const updatedAgain = await getJson(`${baseURL}/api/context-files/${encodeURIComponent(managedKey)}`, {
			method: "PUT",
			headers: authHeaders(baseURL),
			body: JSON.stringify({
				markdown: "# Customized V2\n",
				expectedVersion: updated.data.file.version,
			}),
		});
		assert.equal(updatedAgain.response.status, 200);

		const revisionsAfterMoreAutosave = await getJson(`${baseURL}/api/context-files/${encodeURIComponent(managedKey)}/revisions`, {
			headers: { "x-test-user": "user-1" },
		});
		assert.equal(revisionsAfterMoreAutosave.data.revisions.length, 1);
		assert.equal(revisionsAfterMoreAutosave.data.revisions[0].id, createdRevision.data.revision.id);
		assert.equal(revisionsAfterMoreAutosave.data.revisions[0].content, "# Customized\n");

		const pluginRead = await getJson(`${baseURL}/api/context-files/plugin-doc`, {
			headers: { "x-test-user": "user-1" },
		});
		assert.equal(pluginRead.data.file.markdown, "# Plugin V1\n");

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

		const revisionsAfterReset = await getJson(`${baseURL}/api/context-files/${encodeURIComponent(managedKey)}/revisions`, {
			headers: { "x-test-user": "user-1" },
		});
		assert.equal(revisionsAfterReset.data.revisions.length, 1);

		const restored = await getJson(`${baseURL}/api/context-files/${encodeURIComponent(managedKey)}/restore-revision`, {
			method: "POST",
			headers: authHeaders(baseURL),
			body: JSON.stringify({ revisionId: createdRevision.data.revision.id }),
		});
		assert.equal(restored.response.status, 200);
		assert.equal(restored.data.file.markdown, "# Customized\n");

		const revisionsAfterRestore = await getJson(`${baseURL}/api/context-files/${encodeURIComponent(managedKey)}/revisions`, {
			headers: { "x-test-user": "user-1" },
		});
		assert.equal(revisionsAfterRestore.data.revisions.length, 1);

		const diff = await getJson(`${baseURL}/api/context-files/${encodeURIComponent(managedKey)}/diff?base=source&target=working`, {
			headers: { "x-test-user": "user-1" },
		});
		assert.equal(diff.response.status, 200);
		assert.ok(diff.data.chunks.some((chunk) => chunk.type === "remove"));
		assert.ok(diff.data.chunks.some((chunk) => chunk.type === "add"));
	} finally {
		await channel.stop?.();
		await dispose();
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

	const { channel, baseURL, dispose } = await startContextFilesHost({
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
		await dispose();
		rmSync(dir, { recursive: true, force: true });
	}
});

test("context files polling reports persistent storage failures once without crashing the host", async () => {
	const dir = mkdtempSync(join(tmpdir(), "pibo-context-files-poll-failure-"));
	const managedRoot = join(dir, "managed");
	const globalDir = join(managedRoot, "global");
	const metadataPath = join(managedRoot, "context-files.sqlite");
	const agentWorkspaceRoot = join(dir, "agent-workspaces");
	const pluginFilePath = join(dir, "plugin-doc.md");
	writeFileSync(pluginFilePath, "# Plugin Source\n", "utf8");
	const messages = [];
	const originalConsoleError = console.error;

	const { channel, baseURL, dispose } = await startContextFilesHost({
		pluginFilePath,
		managedRoot,
		globalDir,
		agentWorkspaceRoot,
		metadataPath,
	});

	try {
		const created = await getJson(`${baseURL}/api/context-files`, {
			method: "POST",
			headers: authHeaders(baseURL),
			body: JSON.stringify({ label: "Polling failure", scope: "global", markdown: "# Before\n" }),
		});
		assert.equal(created.response.status, 201);
		console.error = (...args) => messages.push(args.map(String).join(" "));

		const database = new DatabaseSync(metadataPath);
		database.exec("DROP TABLE context_file_manual_revisions");
		database.close();
		writeFileSync(created.data.file.absolutePath, "# After\n", "utf8");

		await delay(2_200);
		assert.equal(messages.filter((message) => message.includes("Context Files polling failed")).length, 1);

		const repair = new DatabaseSync(metadataPath);
		repair.exec(`
			CREATE TABLE context_file_manual_revisions (
				id TEXT PRIMARY KEY,
				context_file_key TEXT NOT NULL,
				name TEXT NOT NULL,
				content_hash TEXT NOT NULL,
				content TEXT NOT NULL,
				created_at TEXT NOT NULL,
				actor_id TEXT
			);
			CREATE INDEX idx_context_file_manual_revisions_key
				ON context_file_manual_revisions(context_file_key, created_at DESC);
		`);
		repair.close();
		await delay(1_100);
	} finally {
		console.error = originalConsoleError;
		await channel.stop?.();
		await dispose();
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

	const { channel, baseURL, dispose } = await startContextFilesHost({
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
		await dispose();
		rmSync(dir, { recursive: true, force: true });
	}
});

test("context files refuses to migrate storage owned by another live gateway", async () => {
	const root = mkdtempSync(join(tmpdir(), "pibo-context-files-owned-storage-"));
	const managedRoot = join(root, "context-files");
	const metadataPath = join(managedRoot, "context-files.sqlite");
	const previousPiboHome = process.env.PIBO_HOME;
	const owner = spawn(process.execPath, ["-e", "setInterval(() => {}, 1000)"], { stdio: "ignore" });
	await new Promise((resolve, reject) => {
		owner.once("spawn", resolve);
		owner.once("error", reject);
	});

	try {
		process.env.PIBO_HOME = root;
		mkdirSync(managedRoot, { recursive: true });
		const database = new DatabaseSync(metadataPath);
		database.exec(`
			CREATE TABLE context_files (
				key TEXT PRIMARY KEY,
				label TEXT NOT NULL,
				managed_path TEXT NOT NULL,
				scope TEXT NOT NULL,
				source_type TEXT NOT NULL,
				agent_profile_name TEXT,
				active_revision_id TEXT,
				source_ref TEXT,
				source_hash TEXT,
				created_at TEXT NOT NULL,
				updated_at TEXT NOT NULL
			);
			CREATE TABLE context_file_revisions (
				id TEXT PRIMARY KEY,
				context_file_key TEXT NOT NULL,
				kind TEXT NOT NULL,
				content_hash TEXT NOT NULL,
				content TEXT NOT NULL,
				created_at TEXT NOT NULL,
				actor_id TEXT,
				based_on_revision_id TEXT,
				source_hash_at_creation TEXT,
				note TEXT
			);
		`);
		database.close();

		for (const pidFile of ["gateway.pid", "gateway-fallback.pid"]) {
			rmSync(join(root, "gateway.pid"), { force: true });
			rmSync(join(root, "gateway-fallback.pid"), { force: true });
			writeFileSync(join(root, pidFile), String(owner.pid), "utf8");
			assert.throws(
				() => PiboPluginRegistry.create({ plugins: [createPiboContextFilesPlugin()] }),
				/owned by the active gateway process.*isolated PIBO_HOME/,
			);
		}

		const verification = new DatabaseSync(metadataPath);
		try {
			const tables = verification.prepare("SELECT name FROM sqlite_master WHERE type = 'table' ORDER BY name").all().map((row) => row.name);
			assert.deepEqual(tables, ["context_file_revisions", "context_files"]);
			assert.equal(verification.prepare("PRAGMA table_info(context_files)").all().some((column) => column.name === "working_content"), false);
			assert.equal(verification.prepare("PRAGMA table_info(context_file_revisions)").all().some((column) => column.name === "kind"), true);
		} finally {
			verification.close();
		}
	} finally {
		owner.kill("SIGTERM");
		if (previousPiboHome === undefined) delete process.env.PIBO_HOME;
		else process.env.PIBO_HOME = previousPiboHome;
		rmSync(root, { recursive: true, force: true });
	}
});

test("context files revision migration preserves current content and old-writer compatibility", async () => {
	const dir = mkdtempSync(join(tmpdir(), "pibo-context-files-revision-migration-"));
	const managedRoot = join(dir, "managed");
	const agentWorkspaceRoot = join(dir, "agent-workspaces");
	const pluginFilePath = join(dir, "plugin-doc.md");
	const managedFilePath = join(managedRoot, "global", "current.md");
	const metadataPath = join(managedRoot, "context-files.sqlite");
	mkdirSync(managedRoot, { recursive: true });
	writeFileSync(pluginFilePath, "# Plugin Source\n", "utf8");

	const database = new DatabaseSync(metadataPath);
	database.exec(`
		CREATE TABLE context_files (
			key TEXT PRIMARY KEY,
			label TEXT NOT NULL,
			managed_path TEXT NOT NULL,
			scope TEXT NOT NULL,
			source_type TEXT NOT NULL,
			agent_profile_name TEXT,
			active_revision_id TEXT,
			source_ref TEXT,
			source_hash TEXT,
			created_at TEXT NOT NULL,
			updated_at TEXT NOT NULL
		);
		CREATE TABLE context_file_revisions (
			id TEXT PRIMARY KEY,
			context_file_key TEXT NOT NULL,
			kind TEXT NOT NULL,
			content_hash TEXT NOT NULL,
			content TEXT NOT NULL,
			created_at TEXT NOT NULL,
			actor_id TEXT,
			based_on_revision_id TEXT,
			source_hash_at_creation TEXT,
			note TEXT
		);
	`);
	database.prepare(`
		INSERT INTO context_files (
			key, label, managed_path, scope, source_type, agent_profile_name,
			active_revision_id, source_ref, source_hash, created_at, updated_at
		) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
	`).run(
		"ctx:current",
		"Current",
		managedFilePath,
		"global",
		"managed",
		null,
		"rev_current",
		null,
		null,
		"2026-08-09T10:00:00.000Z",
		"2026-08-09T10:00:02.000Z",
	);
	database.prepare(`
		INSERT INTO context_file_revisions (
			id, context_file_key, kind, content_hash, content, created_at,
			actor_id, based_on_revision_id, source_hash_at_creation, note
		) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
	`).run(
		"rev_current",
		"ctx:current",
		"working",
		"sha256:legacy-current",
		"# Preserved Current Version\n",
		"2026-08-09T10:00:02.000Z",
		"user-1",
		null,
		null,
		"Automatic autosave",
	);
	database.close();

	const { channel, baseURL, dispose } = await startContextFilesHost({
		pluginFilePath,
		managedRoot,
		agentWorkspaceRoot,
		metadataPath,
	});

	try {
		const current = await getJson(`${baseURL}/api/context-files/ctx%3Acurrent`, {
			headers: { "x-test-user": "user-1" },
		});
		assert.equal(current.response.status, 200);
		assert.equal(current.data.file.markdown, "# Preserved Current Version\n");
		assert.equal(current.data.file.exists, true);

		const revisions = await getJson(`${baseURL}/api/context-files/ctx%3Acurrent/revisions`, {
			headers: { "x-test-user": "user-1" },
		});
		assert.deepEqual(revisions.data.revisions, []);

		const manualRevision = await getJson(`${baseURL}/api/context-files/ctx%3Acurrent/revisions`, {
			method: "POST",
			headers: authHeaders(baseURL),
			body: JSON.stringify({ name: "Migration checkpoint" }),
		});
		assert.equal(manualRevision.response.status, 201);
		assert.equal(manualRevision.data.revision.name, "Migration checkpoint");
		assert.equal(manualRevision.data.revision.content, "# Preserved Current Version\n");

		const compatibility = new DatabaseSync(metadataPath);
		try {
			const automaticColumns = compatibility.prepare("PRAGMA table_info(context_file_revisions)").all().map((column) => column.name);
			assert.ok(automaticColumns.includes("kind"));
			assert.ok(automaticColumns.includes("note"));
			assert.equal(automaticColumns.includes("name"), false);
			assert.equal(compatibility.prepare("SELECT value FROM context_file_store_meta WHERE key = 'schema-version'").get().value, "2");
			compatibility.prepare(`
				INSERT INTO context_file_revisions (
					id, context_file_key, kind, content_hash, content, created_at,
					actor_id, based_on_revision_id, source_hash_at_creation, note
				) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
			`).run(
				"rev_legacy_writer",
				"ctx:current",
				"working",
				"sha256:legacy-writer",
				"# Legacy writer remains compatible\n",
				"2026-08-10T17:00:00.000Z",
				"legacy-runtime",
				null,
				null,
				"Old gateway compatibility probe",
			);
			assert.equal(compatibility.prepare("SELECT COUNT(*) AS count FROM context_file_manual_revisions WHERE context_file_key = ?").get("ctx:current").count, 1);
		} finally {
			compatibility.close();
		}

		const revisionsAfterLegacyWrite = await getJson(`${baseURL}/api/context-files/ctx%3Acurrent/revisions`, {
			headers: { "x-test-user": "user-1" },
		});
		assert.deepEqual(revisionsAfterLegacyWrite.data.revisions.map((revision) => revision.name), ["Migration checkpoint"]);
	} finally {
		await channel.stop?.();
		await dispose();
		rmSync(dir, { recursive: true, force: true });
	}
});

test("manual-revisions v1 storage upgrades transactionally to the compatible schema", () => {
	const dir = mkdtempSync(join(tmpdir(), "pibo-context-files-manual-v1-upgrade-"));
	const metadataPath = join(dir, "context-files.sqlite");
	const managedFilePath = join(dir, "managed.md");
	writeFileSync(managedFilePath, "# Current content\n", "utf8");
	const database = new DatabaseSync(metadataPath);
	database.exec(`
		CREATE TABLE context_files (
			key TEXT PRIMARY KEY,
			label TEXT NOT NULL,
			managed_path TEXT NOT NULL,
			scope TEXT NOT NULL,
			source_type TEXT NOT NULL,
			agent_profile_name TEXT,
			active_revision_id TEXT,
			working_content TEXT,
			source_ref TEXT,
			source_hash TEXT,
			source_content TEXT,
			created_at TEXT NOT NULL,
			updated_at TEXT NOT NULL
		);
		CREATE TABLE context_file_store_meta (
			key TEXT PRIMARY KEY,
			value TEXT NOT NULL
		);
		CREATE TABLE context_file_revisions (
			id TEXT PRIMARY KEY,
			context_file_key TEXT NOT NULL,
			name TEXT NOT NULL,
			content_hash TEXT NOT NULL,
			content TEXT NOT NULL,
			created_at TEXT NOT NULL,
			actor_id TEXT
		);
		CREATE INDEX idx_context_file_revisions_key
			ON context_file_revisions(context_file_key, created_at DESC);
	`);
	database.prepare(`
		INSERT INTO context_files (
			key, label, managed_path, scope, source_type, agent_profile_name,
			active_revision_id, working_content, source_ref, source_hash, source_content,
			created_at, updated_at
		) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
	`).run(
		"ctx:v1",
		"V1",
		managedFilePath,
		"global",
		"managed",
		null,
		null,
		"# Current content\n",
		null,
		null,
		null,
		"2026-08-10T14:18:05.023Z",
		"2026-08-10T14:18:05.023Z",
	);
	database.prepare(`
		INSERT INTO context_file_revisions (
			id, context_file_key, name, content_hash, content, created_at, actor_id
		) VALUES (?, ?, ?, ?, ?, ?, ?)
	`).run(
		"rev_manual_v1",
		"ctx:v1",
		"Before upgrade",
		"sha256:v1",
		"# Current content\n",
		"2026-08-10T14:18:05.023Z",
		"user-1",
	);
	database.prepare("INSERT INTO context_file_store_meta (key, value) VALUES (?, ?)").run("manual-revisions-v1", "2026-08-10T14:18:05.023Z");
	database.close();

	try {
		const store = new ContextFileMetadataStore(metadataPath);
		assert.deepEqual(store.listRevisions("ctx:v1").map((revision) => revision.name), ["Before upgrade"]);
		store.close();

		const verification = new DatabaseSync(metadataPath);
		try {
			assert.equal(verification.prepare("SELECT value FROM context_file_store_meta WHERE key = 'schema-version'").get().value, "2");
			assert.ok(verification.prepare("PRAGMA table_info(context_file_revisions)").all().some((column) => column.name === "kind"));
			assert.ok(verification.prepare("PRAGMA table_info(context_file_manual_revisions)").all().some((column) => column.name === "name"));
			verification.prepare(`
				INSERT INTO context_file_revisions (
					id, context_file_key, kind, content_hash, content, created_at,
					actor_id, based_on_revision_id, source_hash_at_creation, note
				) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
			`).run(
				"rev_old_after_upgrade",
				"ctx:v1",
				"working",
				"sha256:old-after-upgrade",
				"# Old writer still works\n",
				"2026-08-10T17:30:00.000Z",
				"legacy-runtime",
				null,
				null,
				"Compatibility probe",
			);
		} finally {
			verification.close();
		}
	} finally {
		rmSync(dir, { recursive: true, force: true });
	}
});

test("manual context file revisions persist across store restarts", () => {
	const dir = mkdtempSync(join(tmpdir(), "pibo-context-files-manual-revision-restart-"));
	const managedFilePath = join(dir, "managed", "global", "restart.md");
	const metadataPath = join(dir, "managed", "context-files.sqlite");
	mkdirSync(join(dir, "managed", "global"), { recursive: true });
	writeFileSync(managedFilePath, "# Restart-safe current content\n", "utf8");

	try {
		const store = new ContextFileMetadataStore(metadataPath);
		store.createFile({
			key: "ctx:restart",
			label: "Restart",
			managedPath: managedFilePath,
			scope: "global",
			workingContent: "# Restart-safe current content\n",
		});
		const revision = store.appendRevision({
			contextFileKey: "ctx:restart",
			name: "Before restart",
			contentHash: hashContextFileContent("# Restart-safe current content\n"),
			content: "# Restart-safe current content\n",
			actorId: "user-1",
		});
		store.close();

		const reopened = new ContextFileMetadataStore(metadataPath);
		assert.equal(reopened.getFile("ctx:restart")?.workingContent, "# Restart-safe current content\n");
		assert.deepEqual(reopened.listRevisions("ctx:restart").map((candidate) => candidate.id), [revision.id]);
		assert.equal(reopened.listRevisions("ctx:restart")[0].name, "Before restart");
		reopened.close();
	} finally {
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

	const { channel, baseURL, dispose } = await startContextFilesHost({
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
		await dispose();
		rmSync(dir, { recursive: true, force: true });
	}
});

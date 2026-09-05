import assert from "node:assert/strict";
import { chmodSync, mkdirSync, mkdtempSync, readFileSync, rmSync, statSync, symlinkSync, writeFileSync } from "node:fs";
import { request as nodeHttpRequest } from "node:http";
import { homedir, tmpdir } from "node:os";
import { basename, dirname, join } from "node:path";
import test from "node:test";
import { DatabaseSync } from "node:sqlite";
import { createChatWebApp } from "../dist/apps/chat/web-app.js";
import { ChatReadStateService } from "../dist/apps/chat/data/read-state-service.js";
import { ChatSessionQueryService } from "../dist/apps/chat/data/session-query-service.js";
import { ChatDataIngestService } from "../dist/data/ingest-service.js";
import { PiboDataStore } from "../dist/data/pibo-store.js";
import { PiboReliabilityStore } from "../dist/reliability/store.js";
import { qualifiedToolNodeId } from "../dist/shared/trace-tool-identity.js";
import { PiboAuthError } from "../dist/auth/types.js";
import { createWebHostChannel } from "../dist/web/channel.js";
import { InMemoryPiboSessionStore } from "../dist/sessions/store.js";
import { PiboDataSessionStore } from "../dist/sessions/pibo-data-store.js";
import { upsertPiPackage } from "../dist/pi-packages/store.js";
import { InitialSessionContextBuilder } from "../dist/core/profiles.js";
import { configCommand } from "../dist/mcp/config-command.js";
import { AgentRuntimeBindingMissingError } from "../dist/agent-runtime/errors.js";
import { assertPrivateWindowsAcl } from "./fixtures/windows-acl.mjs";
import { createBuiltInCodexHistory } from "./fixtures/built-in-history.mjs";

const retiredPartitionField = `${String.fromCharCode(111, 119, 110, 101, 114)}Scope`;

function fakeRuntimeCapabilities() {
	const unsupported = { support: "unsupported", reason: "Not supported by this fixture runtime." };
	return {
		lifecycle: { persistent: true, lazyBinding: true, resume: true, attach: false, listNativeSessions: false, fork: false, forkWhileRunning: false, clone: false, tree: false },
		input: { text: true, images: false, audio: false, steering: false, structuredOutput: false },
		output: { assistantDeltas: true, reasoning: true, toolEvents: true, usage: true, plans: false, diffs: false, rawNativeEvents: false },
		tools: {
			piboManaged: { support: "mcp", transports: ["streamable-http"] },
			nativeToolInspection: { support: "degraded", mode: "observed-runtime-items", reason: "Observed only." },
			nativeToolYielding: unsupported,
		},
		mcp: { externalServers: { support: "native" }, statusInspection: true },
		skills: { support: "materialized", modes: ["isolated-directory"] },
		context: { support: "materialized", modes: ["developer-instructions"] },
		contextDiscovery: { supported: false, configurable: false, enabledByDefault: false },
		nativeSubagents: { supported: false, configurable: false, enabledByDefault: false },
		historyImport: false,
		auth: { status: false, methods: [], cancel: false, logout: false, credentialScope: "runtime-instance" },
		models: { catalog: true, switchInSession: false, optionsSchema: { type: "object" } },
		reasoning: { supported: true, values: ["low", "high"] },
		approvals: { supported: true, structuredUserInput: true },
		maintenance: { compaction: false, contextUsage: true, history: true, health: true },
	};
}

function fakeRuntimeInspection(id, overrides = {}) {
	return {
		id,
		adapterId: overrides.adapterId ?? id,
		displayName: overrides.displayName ?? id,
		enabled: overrides.enabled ?? true,
		available: overrides.available ?? true,
		transport: overrides.transport ?? "stdio-rpc",
		capabilities: overrides.capabilities ?? fakeRuntimeCapabilities(),
		configSchema: { type: "object", additionalProperties: false },
		protocol: { name: overrides.protocol ?? "fixture-protocol" },
		diagnostics: overrides.diagnostics ?? [],
		...(overrides.models ? { models: overrides.models } : {}),
		...(overrides.auth ? { auth: overrides.auth } : {}),
	};
}

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

async function withCwd(cwd, run) {
	const previous = process.cwd();
	process.chdir(cwd);
	try {
		return await run();
	} finally {
		process.chdir(previous);
	}
}

async function withHome(home, run) {
	const previousHome = process.env.HOME;
	const previousUserProfile = process.env.USERPROFILE;
	process.env.HOME = home;
	process.env.USERPROFILE = home;
	try {
		return await run();
	} finally {
		if (previousHome === undefined) delete process.env.HOME;
		else process.env.HOME = previousHome;
		if (previousUserProfile === undefined) delete process.env.USERPROFILE;
		else process.env.USERPROFILE = previousUserProfile;
	}
}

function assertStructuredMissingRefDiagnostic(diagnostics, expected) {
	const diagnostic = diagnostics.find((candidate) => {
		return candidate.code === expected.code &&
			candidate.registryRef === expected.registryRef &&
			candidate.path === expected.path &&
			(expected.nodeId === undefined || candidate.nodeId === expected.nodeId) &&
			(expected.edgeId === undefined || candidate.edgeId === expected.edgeId);
	});
	assert.ok(diagnostic, `missing structured diagnostic ${JSON.stringify(expected)} in ${JSON.stringify(diagnostics)}`);
	assert.equal(diagnostic.severity, "error");
	assert.equal(typeof diagnostic.message, "string");
	assert.ok(diagnostic.message.includes(expected.registryRef));
}

function flattenTraceResponseNodes(nodes) {
	return nodes.flatMap((node) => [node, ...flattenTraceResponseNodes(node.children ?? [])]);
}

async function startLandingChannel(apps, landingAppName) {
	const channel = createWebHostChannel({ port: 0, announce: false, ...(landingAppName ? { landingAppName } : {}) });
	await channel.start({
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
			return apps;
		},
	});
	const address = channel.getAddress();
	assert.ok(address);
	return { channel, baseURL: `http://${address.host}:${address.port}` };
}

function createLandingApps() {
	return [
		{
			name: "test.auxiliary-web-app",
			mountPath: "/apps/auxiliary",
			apiPrefix: "/api/auxiliary",
			handleRequest(request) {
				const url = new URL(request.url);
				return Response.json({ app: "auxiliary", pathname: url.pathname, search: url.search });
			},
		},
		{
			name: "pibo.chat-web",
			mountPath: "/apps/chat",
			apiPrefix: "/api/chat",
			handleRequest(request) {
				const url = new URL(request.url);
				return Response.json({ app: "chat", pathname: url.pathname, search: url.search });
			},
		},
	];
}

async function startWebHostChannel(options = {}) {
	const emitted = [];
	const listeners = new Set();
	const storageDir = options.storageDir ?? mkdtempSync(join(tmpdir(), "pibo-web-channel-"));
	const sessionStorePath = join(storageDir, "pibo.sqlite");
	const sessions = options.sessions ?? (options.persistSessions ? new PiboDataSessionStore(sessionStorePath) : new InMemoryPiboSessionStore());
	const registeredSkills = [];
	const unregisteredSkills = [];
	const registeredUserSkillCatalog = new Map();
	let profiles = [...(options.profiles ?? [])];
	const agentStorePath = join(storageDir, "agents.sqlite");
	const dataStorePath = join(storageDir, "pibo-chat-v2.sqlite");
	const dataPayloadRootDir = join(storageDir, "payloads");
	const workflowStorePath = join(storageDir, "pibo-workflows.sqlite");
	const reliabilityStorePath = join(storageDir, "pibo-events.sqlite");
	const webApps = [createChatWebApp({
		agentStorePath,
		dataStorePath,
		dataPayloadRootDir,
		workflowStorePath,
		reliabilityStorePath,
		...options.chat,
	})];
	const channel = createWebHostChannel({ port: 0, announce: false, ...options.web });

	await channel.start({
		auth: options.auth,
		emit(event) {
			emitted.push(event);
			if (options.emit) return options.emit(event, sessions);
			return Promise.resolve({
				type: event.type === "message" ? "message_queued" : "execution_result",
				piboSessionId: event.piboSessionId,
				eventId: event.id,
				queuedMessages: event.type === "message" ? 1 : undefined,
				text: event.type === "message" ? event.text : undefined,
				action: event.type === "execution" ? event.action : undefined,
				result: event.type === "execution" ? { ok: true } : undefined,
			});
		},
		subscribe(listener) {
			listeners.add(listener);
			return () => {
				listeners.delete(listener);
			};
		},
		getSession(id) {
			return sessions.get(id);
		},
		createSession(input) {
			return sessions.create(input);
		},
		updateSession(id, input) {
			return sessions.update(id, input);
		},
		async deleteSession(id) {
			if (options.deleteSession) return await options.deleteSession(id, sessions);
			return sessions.delete(id);
		},
		findSessions(input) {
			return sessions.find(input);
		},
		listSessions() {
			return sessions.list();
		},
		getSessionRuntimeBinding(id) {
			return sessions.getRuntimeBinding(id);
		},
		...(options.getSessionRuntimeProfile ? {
			getSessionRuntimeProfile(id) {
				return options.getSessionRuntimeProfile(id, sessions);
			},
		} : {}),
		...(options.inspectSessionRuntimeHistory ? {
			inspectSessionRuntimeHistory: options.inspectSessionRuntimeHistory,
		} : {}),
		...(options.readSessionRuntimeHistory ? {
			readSessionRuntimeHistory: options.readSessionRuntimeHistory,
		} : {}),
		async rebindSessionRuntime(id, input) {
			if (options.rebindSessionRuntime) return await options.rebindSessionRuntime(id, input, sessions);
			const current = sessions.getRuntimeBinding(id);
			if (!current) throw new Error("Runtime binding not found");
			const adapterId = input.runtimeInstanceId === "pi" ? "pi" : input.runtimeInstanceId;
			return sessions.updateRuntimeBinding(id, {
				...current,
				runtimeInstanceId: input.runtimeInstanceId,
				adapterId,
				nativeSessionId: input.nativeSessionId,
				state: input.state ?? (input.nativeSessionId ? "bound" : "unbound"),
				locator: input.locator,
			}, { expectedRevision: input.expectedRevision, mode: "rebind" });
		},
		...(options.getSessionStatusSnapshot ? {
			getSessionStatusSnapshot: options.getSessionStatusSnapshot,
		} : {}),
		...(options.getSessionForkCandidates ? {
			getSessionForkCandidates: options.getSessionForkCandidates,
		} : {}),
		getGatewayActions() {
			return [];
		},
		getProfiles() {
			return options.getProfiles ? options.getProfiles(profiles) : profiles;
		},
		...(options.createProfile ? { createProfile: options.createProfile } : {}),
		getCapabilityCatalog() {
			return options.capabilityCatalog ?? {
				nativeTools: [],
				skills: [
					{ name: "pi-agent-harness", path: "skills/builtin/pi-agent-harness/SKILL.md", kind: "builtin" },
					...registeredUserSkillCatalog.values(),
				],
				subagents: [],
				contextFiles: [],
				packages: [{ name: "pibo-run-control", description: "Run control", toolNames: ["pibo_run_start"] }],
				piboTools: [],
				mcpServers: [],
			};
		},
		...(options.inspectAgentRuntimeInstances ? {
			inspectAgentRuntimeInstances: options.inspectAgentRuntimeInstances,
		} : {}),
		...(options.getAgentRuntimeAuthStatus ? {
			getAgentRuntimeAuthStatus: options.getAgentRuntimeAuthStatus,
		} : {}),
		...(options.startAgentRuntimeAuth ? {
			startAgentRuntimeAuth: options.startAgentRuntimeAuth,
		} : {}),
		...(options.completeAgentRuntimeAuth ? {
			completeAgentRuntimeAuth: options.completeAgentRuntimeAuth,
		} : {}),
		...(options.cancelAgentRuntimeAuth ? {
			cancelAgentRuntimeAuth: options.cancelAgentRuntimeAuth,
		} : {}),
		...(options.logoutAgentRuntimeAuth ? {
			logoutAgentRuntimeAuth: options.logoutAgentRuntimeAuth,
		} : {}),
		...(options.validateAgentRuntimeProfile ? {
			validateAgentRuntimeProfile: options.validateAgentRuntimeProfile,
		} : {}),
		upsertProfile(profile) {
			profiles = profiles.filter((item) => item.name !== profile.name);
			profiles.push({
				name: profile.name,
				description: profile.description,
				aliases: [...(profile.aliases ?? [])],
			});
		},
		removeProfile(name) {
			profiles = profiles.filter((item) => item.name !== name);
		},
		...(options.trackUserSkillRegistry ? {
			registerSkill(skill) {
				registeredSkills.push(skill);
				registeredUserSkillCatalog.set(skill.name, skill);
			},
			unregisterSkill(name) {
				unregisteredSkills.push(name);
				registeredUserSkillCatalog.delete(name);
			},
		} : {}),
		getWebApps() {
			return webApps;
		},
	});

	const address = channel.getAddress();
	assert.ok(address);
	return {
		channel,
		emitted,
		emitOutput(event) {
			for (const listener of listeners) listener(event);
		},
		setProfiles(nextProfiles) {
			profiles = [...nextProfiles];
		},
		sessions,
		registeredSkills,
		unregisteredSkills,
		storageDir,
		agentStorePath,
		sessionStorePath,
		dataStorePath,
		dataPayloadRootDir,
		reliabilityStorePath,
		workflowStorePath,
		baseURL: `http://${address.host}:${address.port}`, 
	};
}

async function readSseTextUntil(reader, match, options = {}) {
	const decoder = new TextDecoder();
	const timeoutMs = options.timeoutMs ?? 1000;
	const maxChunks = options.maxChunks ?? 20;
	let text = "";
	for (let index = 0; index < maxChunks; index += 1) {
		const chunk = await Promise.race([
			reader.read().then((value) => ({ kind: "chunk", value })),
			new Promise((resolve) => setTimeout(() => resolve({ kind: "timeout" }), timeoutMs)),
		]);
		if (chunk.kind === "timeout") return { matched: false, text };
		assert.equal(chunk.value.done, false);
		text += decoder.decode(chunk.value.value, { stream: true });
		if (match(text)) return { matched: true, text };
	}
	return { matched: false, text };
}

async function waitForCondition(predicate, message, timeoutMs = 2_000) {
	const deadline = Date.now() + timeoutMs;
	while (Date.now() < deadline) {
		if (predicate()) return;
		await new Promise((resolve) => setTimeout(resolve, 5));
	}
	throw new Error(message);
}

test("chat web app requires auth for localhost requests", async () => {
	const { channel, baseURL } = await startWebHostChannel();

	try {
		const response = await fetch(`${baseURL}/api/chat/session`);
		assert.equal(response.status, 401);
		assert.deepEqual(await response.json(), { error: "Unauthenticated" });
	} finally {
		await channel.stop?.();
	}
});

test("chat web app exposes authenticated VS Code Web integration metadata and a proxy auth check", async () => {
	const { channel, baseURL } = await startWebHostChannel({
		auth: createFakeAuthService(),
		chat: {
			vscodeWeb: {
				url: "/apps/vscode/",
				workspaceRoot: "/srv/pibo-workspaces",
			},
		},
	});

	try {
		const unauthenticated = await fetch(`${baseURL}/api/chat/auth-check`);
		assert.equal(unauthenticated.status, 401);

		const authenticated = await fetch(`${baseURL}/api/chat/auth-check`, { headers: { "x-test-user": "user-vscode" } });
		assert.equal(authenticated.status, 204);
		assert.equal(authenticated.headers.get("cache-control"), "no-store");

		const bootstrap = await fetch(`${baseURL}/api/chat/bootstrap`, { headers: { "x-test-user": "user-vscode" } });
		assert.equal(bootstrap.status, 200);
		const payload = await bootstrap.json();
		assert.deepEqual(payload.integrations, {
			vscode: {
				url: "/apps/vscode/",
				workspaceRoot: "/srv/pibo-workspaces",
			},
		});
	} finally {
		await channel.stop?.();
	}
});

test("chat web app rejects cross-origin and ambiguous VS Code Web URLs before opening stores", () => {
	for (const url of ["https://code.example/", "//code.example/", "/\\code.example/", "apps/vscode/"]) {
		assert.throws(
			() => createChatWebApp({ vscodeWeb: { url } }),
			/VS Code Web URL must be a same-origin absolute path beginning with \//,
		);
	}
});

test("chat web app serves the React shell for deep app links", async () => {
	const { channel, baseURL } = await startWebHostChannel();

	try {
		const response = await fetch(`${baseURL}/apps/chat/rooms/room_test/sessions/ps_test`);
		assert.equal(response.status, 200);
		assert.match(response.headers.get("content-type") ?? "", /^text\/html/);
		assert.match(await response.text(), /<div id="root"><\/div>/);
	} finally {
		await channel.stop?.();
	}
});

test("web host resolves an explicit landing app independently of registration order and preserves the raw query", async () => {
	const { channel, baseURL } = await startLandingChannel(createLandingApps(), "pibo.chat-web");
	const query = "?tag=one&tag=two&encoded=a%2Fb%20c&empty=&flag";
	try {
		const response = await fetch(`${baseURL}/${query}`, { redirect: "manual" });
		assert.equal(response.status, 302);
		assert.equal(response.headers.get("location"), `/apps/chat${query}`);
	} finally {
		await channel.stop?.();
	}
});

test("generic web host without an explicit landing app keeps the first-app fallback", async () => {
	const { channel, baseURL } = await startLandingChannel(createLandingApps());
	const query = "?tag=one&tag=two&empty=";
	try {
		const response = await fetch(`${baseURL}/${query}`, { redirect: "manual" });
		assert.equal(response.status, 302);
		assert.equal(response.headers.get("location"), `/apps/auxiliary${query}`);
	} finally {
		await channel.stop?.();
	}
});

test("explicit root landing does not intercept auxiliary app or API routes", async () => {
	const { channel, baseURL } = await startLandingChannel(createLandingApps(), "pibo.chat-web");
	try {
		for (const path of [
			"/apps/auxiliary/deep?encoded=a%2Fb&empty=",
			"/api/auxiliary/status?tag=one&tag=two",
		]) {
			const response = await fetch(`${baseURL}${path}`);
			assert.equal(response.status, 200);
			assert.deepEqual(await response.json(), {
				app: "auxiliary",
				pathname: new URL(path, baseURL).pathname,
				search: new URL(path, baseURL).search,
			});
		}
	} finally {
		await channel.stop?.();
	}
});

test("chat web app serves shell metadata, favicon, and built assets", async () => {
	const { channel, baseURL } = await startWebHostChannel();

	try {
		const shell = await fetch(`${baseURL}/apps/chat`);
		assert.equal(shell.status, 200);
		const html = await shell.text();
		assert.ok(html.includes('<meta name="mobile-web-app-capable" content="yes"'));
		assert.ok(html.includes('<meta name="apple-mobile-web-app-capable" content="yes"'));
		assert.ok(html.includes('<link rel="icon" type="image/svg+xml" href="/apps/chat/favicon.svg"'));

		const favicon = await fetch(`${baseURL}/apps/chat/favicon.svg`);
		assert.equal(favicon.status, 200);
		assert.equal(favicon.headers.get("content-type"), "image/svg+xml");
		assert.equal(favicon.headers.get("cache-control"), "public, max-age=31536000, immutable");
		assert.ok((await favicon.text()).startsWith('<svg xmlns="http://www.w3.org/2000/svg"'));

		const assetPath = html.match(/\/apps\/chat\/assets\/[^"]+\.js/)?.[0];
		assert.ok(assetPath);

		const asset = await fetch(`${baseURL}${assetPath}`, {
			method: "HEAD",
			headers: { "accept-encoding": "br, gzip" },
		});
		assert.equal(asset.status, 200);
		assert.match(asset.headers.get("content-type") ?? "", /^text\/javascript/);
		assert.equal(asset.headers.get("cache-control"), "public, max-age=31536000, immutable");
		assert.equal(asset.headers.get("content-encoding"), "br");
		assert.equal(asset.headers.get("vary"), "accept-encoding");
	} finally {
		await channel.stop?.();
	}
});

test("chat web app uploads multipart files to the private Pibo uploads directory", async () => {
	const uploadDir = join(process.env.PIBO_HOME ?? join(homedir(), ".pibo"), "uploads");
	mkdirSync(uploadDir, { recursive: true });
	if (process.platform !== "win32") chmodSync(uploadDir, 0o755);
	const { channel, baseURL } = await startWebHostChannel({
		auth: createFakeAuthService(),
	});
	const uploadedPaths = [];
	const filename = `upload-test-${Date.now()}.txt`;
	const suffixedFilename = filename.replace(/\.txt$/, "-1.txt");

	try {
		const form = new FormData();
		form.append("files", new File(["hello upload"], filename, { type: "text/plain" }));
		form.append("files", new File(["hello upload again"], filename, { type: "text/plain" }));

		const response = await fetch(`${baseURL}/api/chat/upload`, {
			method: "POST",
			headers: {
				"x-test-user": "user-1",
				origin: baseURL,
			},
			body: form,
		});
		assert.equal(response.status, 201);
		const payload = await response.json();
		assert.equal(payload.uploadDir, uploadDir);
		assert.equal(payload.files.length, 2);
		if (process.platform === "win32") assertPrivateWindowsAcl(payload.uploadDir, "directory");
		else assert.equal(statSync(payload.uploadDir).mode & 0o777, 0o700);
		for (const file of payload.files) {
			uploadedPaths.push(file.path);
			assert.equal(dirname(file.path), payload.uploadDir);
			if (process.platform === "win32") assertPrivateWindowsAcl(file.path, "file");
			else assert.equal(statSync(file.path).mode & 0o777, 0o600);
		}
		assert.equal(basename(uploadedPaths[0]), filename);
		assert.equal(basename(uploadedPaths[1]), suffixedFilename);
		assert.equal(readFileSync(uploadedPaths[0], "utf8"), "hello upload");
		assert.equal(readFileSync(uploadedPaths[1], "utf8"), "hello upload again");
	} finally {
		for (const uploadedPath of uploadedPaths) rmSync(uploadedPath, { force: true });
		await channel.stop?.();
	}
});

test("chat web app downloads files relative to the selected session workspace", async () => {
	const { channel, baseURL } = await startWebHostChannel({
		auth: createFakeAuthService(),
	});
	const workspace = mkdtempSync(join(tmpdir(), "pibo-chat-download-"));
	writeFileSync(join(workspace, "report.txt"), "download body");

	try {
		const roomResponse = await fetch(`${baseURL}/api/chat/rooms`, {
			method: "POST",
			headers: {
				"content-type": "application/json",
				origin: baseURL,
				"x-test-user": "user-1",
			},
			body: JSON.stringify({ name: "Download Room", workspace }),
		});
		assert.equal(roomResponse.status, 201);
		const roomPayload = await roomResponse.json();

		const sessionResponse = await fetch(`${baseURL}/api/chat/sessions`, {
			method: "POST",
			headers: {
				"content-type": "application/json",
				origin: baseURL,
				"x-test-user": "user-1",
			},
			body: JSON.stringify({ roomId: roomPayload.room.id }),
		});
		assert.equal(sessionResponse.status, 201);
		const sessionPayload = await sessionResponse.json();

		const response = await fetch(
			`${baseURL}/api/chat/download?path=${encodeURIComponent("report.txt")}&piboSessionId=${encodeURIComponent(sessionPayload.session.id)}`,
			{ headers: { "x-test-user": "user-1" } },
		);
		assert.equal(response.status, 200);
		assert.match(response.headers.get("content-type") ?? "", /^text\/plain/);
		assert.match(response.headers.get("content-disposition") ?? "", /report\.txt/);
		assert.equal(await response.text(), "download body");
	} finally {
		rmSync(workspace, { recursive: true, force: true });
		await channel.stop?.();
	}
});

test("chat web app image paths stay authenticated, bounded, sniffed, and non-cacheable", async () => {
	const { channel, baseURL } = await startWebHostChannel({ auth: createFakeAuthService() });
	const workspace = mkdtempSync(join(tmpdir(), "pibo-chat-image-path-"));
	const outsideDir = mkdtempSync(join(tmpdir(), "pibo-chat-image-outside-"));
	const outsidePath = join(outsideDir, "private.png");
	let uploadedPreviewPath;
	const png = Buffer.concat([
		Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
		Buffer.alloc(32, 3),
	]);
	writeFileSync(join(workspace, "preview.png"), png);
	writeFileSync(join(workspace, "unsafe.svg"), "<svg xmlns='http://www.w3.org/2000/svg'><script/></svg>");
	writeFileSync(join(workspace, "unsafe.html"), "<html><script/></html>");
	writeFileSync(join(workspace, "oversized.png"), Buffer.alloc(10 * 1024 * 1024 + 1, 1));
	writeFileSync(outsidePath, png);
	symlinkSync(outsidePath, join(workspace, "escaped-link.png"));

	try {
		const roomResponse = await fetch(`${baseURL}/api/chat/rooms`, {
			method: "POST",
			headers: { "content-type": "application/json", origin: baseURL, "x-test-user": "user-1" },
			body: JSON.stringify({ name: "Image Path Room", workspace }),
		});
		const roomPayload = await roomResponse.json();
		const sessionResponse = await fetch(`${baseURL}/api/chat/sessions`, {
			method: "POST",
			headers: { "content-type": "application/json", origin: baseURL, "x-test-user": "user-1" },
			body: JSON.stringify({ roomId: roomPayload.room.id }),
		});
		const sessionPayload = await sessionResponse.json();
		const previewUrl = `${baseURL}/api/chat/image-preview?path=preview.png&piboSessionId=${encodeURIComponent(sessionPayload.session.id)}`;
		const uploadForm = new FormData();
		uploadForm.append("files", new File([png], "private-preview.png", { type: "image/png" }));
		const uploadResponse = await fetch(`${baseURL}/api/chat/upload`, {
			method: "POST",
			headers: { origin: baseURL, "x-test-user": "user-1" },
			body: uploadForm,
		});
		assert.equal(uploadResponse.status, 201);
		uploadedPreviewPath = (await uploadResponse.json()).files[0].path;

		assert.equal((await fetch(previewUrl)).status, 401);
		const response = await fetch(previewUrl, { headers: { "x-test-user": "user-1" } });
		assert.equal(response.status, 200);
		assert.equal(response.headers.get("content-type"), "image/png");
		assert.match(response.headers.get("content-disposition") ?? "", /^inline;/);
		assert.equal(response.headers.get("cache-control"), "no-store");
		assert.equal(response.headers.get("x-content-type-options"), "nosniff");
		assert.equal(response.headers.get("cross-origin-resource-policy"), "same-origin");
		assert.deepEqual(Buffer.from(await response.arrayBuffer()), png);
		const uploadedPreview = await fetch(`${baseURL}/api/chat/image-preview?path=${encodeURIComponent(uploadedPreviewPath)}&piboSessionId=${encodeURIComponent(sessionPayload.session.id)}`, {
			headers: { "x-test-user": "user-1" },
		});
		assert.equal(uploadedPreview.status, 200);
		assert.deepEqual(Buffer.from(await uploadedPreview.arrayBuffer()), png);

		for (const unsafePath of ["unsafe.svg", "unsafe.html"]) {
			const unsafe = await fetch(`${baseURL}/api/chat/image-preview?path=${unsafePath}&piboSessionId=${encodeURIComponent(sessionPayload.session.id)}`, {
				headers: { "x-test-user": "user-1" },
			});
			assert.equal(unsafe.status, 415, unsafePath);
		}
		const oversized = await fetch(`${baseURL}/api/chat/image-preview?path=oversized.png&piboSessionId=${encodeURIComponent(sessionPayload.session.id)}`, {
			headers: { "x-test-user": "user-1" },
		});
		assert.equal(oversized.status, 413);
		for (const forbiddenPath of [outsidePath, join("..", basename(outsideDir), "private.png"), "escaped-link.png"]) {
			const forbidden = await fetch(`${baseURL}/api/chat/image-preview?path=${encodeURIComponent(forbiddenPath)}&piboSessionId=${encodeURIComponent(sessionPayload.session.id)}`, {
				headers: { "x-test-user": "user-1" },
			});
			assert.equal(forbidden.status, 403, forbiddenPath);
		}
	} finally {
		rmSync(workspace, { recursive: true, force: true });
		rmSync(outsideDir, { recursive: true, force: true });
		if (uploadedPreviewPath) rmSync(uploadedPreviewPath, { force: true });
		await channel.stop?.();
	}
});

test("chat web app serves node-bound exact images concurrently and never falls back to changed path bytes", async () => {
	const { channel, baseURL, emitOutput, dataStorePath, dataPayloadRootDir } = await startWebHostChannel({ auth: createFakeAuthService() });
	const workspace = mkdtempSync(join(tmpdir(), "pibo-chat-exact-image-"));
	const exactBytes = Buffer.concat([
		Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
		Buffer.alloc(20 * 1024, 5),
	]);
	const newerPathBytes = Buffer.concat([
		Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
		Buffer.alloc(64, 9),
	]);
	const imagePath = join(workspace, "mutable.png");
	writeFileSync(imagePath, exactBytes);

	try {
		const roomResponse = await fetch(`${baseURL}/api/chat/rooms`, {
			method: "POST",
			headers: { "content-type": "application/json", origin: baseURL, "x-test-user": "user-1" },
			body: JSON.stringify({ name: "Exact Image Room", workspace }),
		});
		const roomPayload = await roomResponse.json();
		const sessionResponse = await fetch(`${baseURL}/api/chat/sessions`, {
			method: "POST",
			headers: { "content-type": "application/json", origin: baseURL, "x-test-user": "user-1" },
			body: JSON.stringify({ roomId: roomPayload.room.id }),
		});
		const sessionPayload = await sessionResponse.json();
		const piboSessionId = sessionPayload.session.id;
		emitOutput({
			type: "tool_execution_finished",
			piboSessionId,
			eventId: "image-turn",
			toolCallId: "image-call",
			toolName: "view_image",
			result: {
				content: [{ type: "image", data: exactBytes.toString("base64"), mimeType: "image/png" }],
				details: { path: imagePath },
			},
			isError: false,
		});

		const timelineResponse = await fetch(`${baseURL}/api/chat/trace/timeline?piboSessionId=${encodeURIComponent(piboSessionId)}&limit=50`, {
			headers: { "x-test-user": "user-1" },
		});
		assert.equal(timelineResponse.status, 200);
		const timeline = await timelineResponse.json();
		const imageNode = timeline.nodes.find((node) => node.toolCallId === "image-call");
		assert.ok(imageNode?.payloadRefs?.output?.ref);
		assert.equal(imageNode.payloadRefs.output.nodeId, qualifiedToolNodeId("image-call", "image-turn", 0));
		assert.equal(JSON.stringify(timeline).includes(exactBytes.toString("base64").slice(0, 80)), false);
		const params = new URLSearchParams({
			ref: imageNode.payloadRefs.output.ref,
			nodeId: imageNode.payloadRefs.output.nodeId,
			piboSessionId,
			index: "0",
		});
		const exactUrl = `${baseURL}/api/chat/image-preview?${params}`;

		assert.equal((await fetch(exactUrl)).status, 401);
		const secondSessionResponse = await fetch(`${baseURL}/api/chat/sessions`, {
			method: "POST",
			headers: { "content-type": "application/json", origin: baseURL, "x-test-user": "user-1" },
			body: JSON.stringify({ roomId: roomPayload.room.id }),
		});
		const secondSession = await secondSessionResponse.json();
		const mismatchParams = new URLSearchParams(params);
		mismatchParams.set("piboSessionId", secondSession.session.id);
		assert.equal((await fetch(`${baseURL}/api/chat/image-preview?${mismatchParams}`, { headers: { "x-test-user": "user-1" } })).status, 400);
		const nodeMismatchParams = new URLSearchParams(params);
		nodeMismatchParams.set("nodeId", qualifiedToolNodeId("other-call", "image-turn", 0));
		assert.equal((await fetch(`${baseURL}/api/chat/image-preview?${nodeMismatchParams}`, { headers: { "x-test-user": "user-1" } })).status, 400);
		const outOfBoundsParams = new URLSearchParams(params);
		outOfBoundsParams.set("index", "20");
		assert.equal((await fetch(`${baseURL}/api/chat/image-preview?${outOfBoundsParams}`, { headers: { "x-test-user": "user-1" } })).status, 400);
		const mixedParams = new URLSearchParams(params);
		mixedParams.set("path", imagePath);
		assert.equal((await fetch(`${baseURL}/api/chat/image-preview?${mixedParams}`, { headers: { "x-test-user": "user-1" } })).status, 400);

		const inlineBytesA = Buffer.concat([
			Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
			Buffer.alloc(7 * 1024 - 8, 4),
		]);
		const inlineBytesB = Buffer.concat([
			Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
			Buffer.alloc(7 * 1024 - 8, 5),
		]);
		for (const [toolCallId, bytes] of [["inline-image-a", inlineBytesA], ["inline-image-b", inlineBytesB], ["inline-image-c", inlineBytesA]]) {
			emitOutput({
				type: "tool_execution_finished",
				piboSessionId,
				eventId: `turn-${toolCallId}`,
				toolCallId,
				toolName: "view_image",
				result: { content: [{ type: "image", data: bytes.toString("base64"), mimeType: "image/png" }] },
				isError: false,
			});
		}
		const inlineTimelineResponse = await fetch(`${baseURL}/api/chat/trace/timeline?piboSessionId=${encodeURIComponent(piboSessionId)}&limit=50`, {
			headers: { "x-test-user": "user-1" },
		});
		assert.equal(inlineTimelineResponse.status, 200);
		const inlineTimeline = await inlineTimelineResponse.json();
		const inlineA = inlineTimeline.nodes.find((node) => node.toolCallId === "inline-image-a");
		const inlineB = inlineTimeline.nodes.find((node) => node.toolCallId === "inline-image-b");
		const inlineC = inlineTimeline.nodes.find((node) => node.toolCallId === "inline-image-c");
		assert.ok(inlineA?.payloadRefs?.output?.ref);
		assert.ok(inlineB?.payloadRefs?.output?.ref);
		assert.ok(inlineC?.payloadRefs?.output?.ref);
		const parsedInlineA = JSON.parse(Buffer.from(inlineA.payloadRefs.output.ref.slice("trace_".length), "base64url").toString("utf8"));
		const parsedInlineB = JSON.parse(Buffer.from(inlineB.payloadRefs.output.ref.slice("trace_".length), "base64url").toString("utf8"));
		const parsedInlineC = JSON.parse(Buffer.from(inlineC.payloadRefs.output.ref.slice("trace_".length), "base64url").toString("utf8"));
		assert.notEqual(parsedInlineA.id, parsedInlineB.id, "different bytes must retain different payload identities");
		assert.equal(parsedInlineA.id, parsedInlineC.id, "equal bytes use the PayloadStore canonical identity");
		const forgedEqualContentRef = `trace_${Buffer.from(JSON.stringify({ ...parsedInlineA, n: inlineB.nodeId }), "utf8").toString("base64url")}`;
		const forgedEqualContentParams = new URLSearchParams({
			ref: forgedEqualContentRef,
			nodeId: inlineB.nodeId,
			piboSessionId,
			index: "0",
		});
		assert.equal(
			(await fetch(`${baseURL}/api/chat/image-preview?${forgedEqualContentParams}`, { headers: { "x-test-user": "user-1" } })).status,
			404,
			"equal content from another node must not authorize a forged payload id",
		);

		writeFileSync(imagePath, newerPathBytes);
		const concurrent = await Promise.all(Array.from({ length: 8 }, () => fetch(exactUrl, { headers: { "x-test-user": "user-1" } })));
		for (const response of concurrent) {
			assert.equal(response.status, 200);
			assert.equal(response.headers.get("cache-control"), "private, max-age=31536000, immutable");
			assert.equal(response.headers.get("x-content-type-options"), "nosniff");
			assert.deepEqual(Buffer.from(await response.arrayBuffer()), exactBytes);
		}
		const mutable = await fetch(`${baseURL}/api/chat/image-preview?path=${encodeURIComponent(imagePath)}&piboSessionId=${encodeURIComponent(piboSessionId)}`, {
			headers: { "x-test-user": "user-1" },
		});
		assert.deepEqual(Buffer.from(await mutable.arrayBuffer()), newerPathBytes);

		const database = new DatabaseSync(dataStorePath, { readOnly: true });
		let storedPath;
		try {
			const row = database.prepare(`
				SELECT p.storage_path
				FROM event_log e JOIN payloads p ON p.id = e.payload_ref
				WHERE e.session_id = ? AND json_extract(e.attributes_json, '$.toolCallId') = ?
			`).get(piboSessionId, "image-call");
			storedPath = row.storage_path;
		} finally {
			database.close();
		}
		rmSync(join(dataPayloadRootDir, storedPath), { force: true });
		assert.equal((await fetch(exactUrl, { headers: { "x-test-user": "user-1" } })).status, 404);
	} finally {
		rmSync(workspace, { recursive: true, force: true });
		await channel.stop?.();
	}
});

test("web host redirects app links to the canonical auth origin", async () => {
	const { channel, baseURL } = await startWebHostChannel({
		web: { canonicalBaseURL: "http://pibo.example.test:4788" },
	});

	try {
		const response = await fetch(`${baseURL}/apps/chat/settings`, { redirect: "manual" });
		assert.equal(response.status, 302);
		assert.equal(response.headers.get("location"), "http://pibo.example.test:4788/apps/chat/settings");
	} finally {
		await channel.stop?.();
	}
});

test("chat web trace returns raw events only when requested", async () => {
	const { channel, baseURL, emitOutput } = await startWebHostChannel({
		auth: createFakeAuthService(),
	});

	try {
		const sessionResponse = await fetch(`${baseURL}/api/chat/session`, {
			headers: { "x-test-user": "user-1" },
		});
		assert.equal(sessionResponse.status, 200);
		const sessionPayload = await sessionResponse.json();
		for (let index = 0; index < 3; index += 1) {
			emitOutput({
				type: "assistant_delta",
				piboSessionId: sessionPayload.session.id,
				eventId: `answer-${index}`,
				text: `part ${index}`,
			});
		}

		const compactResponse = await fetch(
			`${baseURL}/api/chat/trace?piboSessionId=${encodeURIComponent(sessionPayload.session.id)}`,
			{ headers: { "x-test-user": "user-1" } },
		);
		assert.equal(compactResponse.status, 200);
		assert.ok(compactResponse.headers.get("etag"));
		const compactTrace = await compactResponse.json();
		assert.equal(typeof compactTrace.version, "string");
		assert.equal(compactTrace.rawEvents.length, 0);

		const cachedResponse = await fetch(
			`${baseURL}/api/chat/trace?piboSessionId=${encodeURIComponent(sessionPayload.session.id)}`,
			{
				headers: {
					"x-test-user": "user-1",
					"if-none-match": compactResponse.headers.get("etag"),
				},
			},
		);
		assert.equal(cachedResponse.status, 304);

		const rawResponse = await fetch(
			`${baseURL}/api/chat/trace?piboSessionId=${encodeURIComponent(sessionPayload.session.id)}&includeRawEvents=true&rawEventsLimit=2`,
			{ headers: { "x-test-user": "user-1" } },
		);
		assert.equal(rawResponse.status, 200);
		const rawTrace = await rawResponse.json();
		assert.equal(rawTrace.rawEvents.length, 0);
	} finally {
		await channel.stop?.();
	}
});

test("chat web trace includes live compactor snapshots without raw events", async () => {
	const { channel, baseURL, emitOutput } = await startWebHostChannel({
		auth: createFakeAuthService(),
	});

	try {
		const sessionResponse = await fetch(`${baseURL}/api/chat/session`, {
			headers: { "x-test-user": "user-1" },
		});
		assert.equal(sessionResponse.status, 200);
		const sessionPayload = await sessionResponse.json();
		const piboSessionId = sessionPayload.session.id;
		emitOutput({ type: "assistant_delta", piboSessionId, eventId: "answer-live", text: "Hello" });
		emitOutput({ type: "assistant_delta", piboSessionId, eventId: "answer-live", text: " world" });

		const response = await fetch(`${baseURL}/api/chat/trace?piboSessionId=${encodeURIComponent(piboSessionId)}`, {
			headers: { "x-test-user": "user-1" },
		});
		assert.equal(response.status, 200);
		const trace = await response.json();
		assert.equal(trace.rawEvents.length, 0);
		assert.equal(findAssistantOutput(trace.nodes), "Hello world");

		emitOutput({ type: "assistant_delta", piboSessionId, eventId: "answer-live", text: " again" });
		const refreshed = await fetch(`${baseURL}/api/chat/trace?piboSessionId=${encodeURIComponent(piboSessionId)}`, {
			headers: { "x-test-user": "user-1", "if-none-match": response.headers.get("etag") },
		});
		assert.equal(refreshed.status, 200);
		const refreshedTrace = await refreshed.json();
		assert.equal(findAssistantOutput(refreshedTrace.nodes), "Hello world again");
	} finally {
		await channel.stop?.();
	}
});

test("chat web persists terminal boundaries after a buffered output collision", async () => {
	for (const boundaryType of ["message_finished", "session_error"]) {
		const host = await startWebHostChannel({ auth: createFakeAuthService() });
		try {
			const sessionResponse = await fetch(`${host.baseURL}/api/chat/session`, {
				headers: { "x-test-user": "user-1" },
			});
			assert.equal(sessionResponse.status, 200);
			const { session } = await sessionResponse.json();
			const eventId = `web-boundary-collision-${boundaryType}`;

			const seedStore = new PiboDataStore(host.dataStorePath);
			try {
				new ChatDataIngestService(seedStore).ingestOutputEvent({
					session,
					event: {
						type: "assistant_message",
						piboSessionId: session.id,
						eventId,
						assistantIndex: 0,
						renderSequence: 1,
						text: "stored answer",
					},
				});
			} finally {
				seedStore.close();
			}

			host.emitOutput({ type: "assistant_delta", piboSessionId: session.id, eventId, assistantIndex: 0, text: "conflicting boundary flush" });
			host.emitOutput(boundaryType === "message_finished"
				? { type: boundaryType, piboSessionId: session.id, eventId, source: "user" }
				: { type: boundaryType, piboSessionId: session.id, eventId, error: "forced boundary error" });

			await waitForCondition(() => {
				const data = new DatabaseSync(host.dataStorePath, { readOnly: true });
				const reliability = new DatabaseSync(host.reliabilityStorePath, { readOnly: true });
				try {
					const terminalCount = Number(data.prepare("SELECT COUNT(*) AS count FROM event_log WHERE session_id = ? AND type = ?").get(session.id, boundaryType).count);
					const collisionCount = Number(data.prepare("SELECT COUNT(*) AS count FROM event_log WHERE session_id = ? AND type = 'pibo.output.identity_collision'").get(session.id).count);
					const terminalDeliveryCount = Number(reliability.prepare("SELECT COUNT(*) AS count FROM pibo_event_stream WHERE topic = 'pibo.output' AND key = ? AND event_id LIKE ?").get(session.id, `%:${boundaryType}:%`).count);
					const deadCount = Number(reliability.prepare("SELECT COUNT(*) AS count FROM pibo_dead_jobs WHERE queue = 'output-persistence'").get().count);
					return terminalCount === 1 && terminalDeliveryCount === 1 && collisionCount === 1 && deadCount === 1;
				} finally {
					data.close();
					reliability.close();
				}
			}, `${boundaryType} was suppressed by the buffered collision`);

			const traceResponse = await fetch(`${host.baseURL}/api/chat/trace?piboSessionId=${encodeURIComponent(session.id)}`, {
				headers: { "x-test-user": "user-1" },
			});
			assert.equal(traceResponse.status, 200);
			assert.doesNotMatch(JSON.stringify((await traceResponse.json()).nodes), /conflicting boundary flush/);

			host.emitOutput(boundaryType === "message_finished"
				? { type: boundaryType, piboSessionId: session.id, eventId, source: "user" }
				: { type: boundaryType, piboSessionId: session.id, eventId, error: "forced boundary error" });
			await waitForCondition(() => {
				const reliability = new DatabaseSync(host.reliabilityStorePath, { readOnly: true });
				try {
					return Number(reliability.prepare("SELECT COUNT(*) AS count FROM pibo_jobs WHERE queue = 'output-persistence'").get().count) === 0;
				} finally {
					reliability.close();
				}
			}, `${boundaryType} replay did not settle`);
			const data = new DatabaseSync(host.dataStorePath, { readOnly: true });
			const reliability = new DatabaseSync(host.reliabilityStorePath, { readOnly: true });
			try {
				assert.equal(Number(data.prepare("SELECT COUNT(*) AS count FROM event_log WHERE session_id = ? AND type = ?").get(session.id, boundaryType).count), 1);
				assert.equal(Number(reliability.prepare("SELECT COUNT(*) AS count FROM pibo_event_stream WHERE topic = 'pibo.output' AND key = ? AND event_id LIKE ?").get(session.id, `%:${boundaryType}:%`).count), 1);
				assert.equal(Number(reliability.prepare("SELECT COUNT(*) AS count FROM pibo_dead_jobs WHERE queue = 'output-persistence'").get().count), 1);
			} finally {
				data.close();
				reliability.close();
			}
		} finally {
			await host.channel.stop?.();
		}
	}
});

test("chat web stops a delivery batch after losing durable checkpoint ownership", async () => {
	const originalUpdateJobPayload = PiboReliabilityStore.prototype.updateJobPayload;
	PiboReliabilityStore.prototype.updateJobPayload = () => false;
	const host = await startWebHostChannel({ auth: createFakeAuthService() });
	try {
		const sessionResponse = await fetch(`${host.baseURL}/api/chat/session`, {
			headers: { "x-test-user": "user-1" },
		});
		assert.equal(sessionResponse.status, 200);
		const { session } = await sessionResponse.json();
		const eventId = "web-checkpoint-ownership-loss";
		host.emitOutput({ type: "assistant_delta", piboSessionId: session.id, eventId, assistantIndex: 0, text: "buffered" });
		host.emitOutput({ type: "message_finished", piboSessionId: session.id, eventId, source: "user" });

		await waitForCondition(() => {
			const data = new DatabaseSync(host.dataStorePath, { readOnly: true });
			try {
				return Number(data.prepare("SELECT COUNT(*) AS count FROM event_log WHERE session_id = ? AND type = 'assistant_message'").get(session.id).count) === 1;
			} finally {
				data.close();
			}
		}, "first delivery did not reach the failed durable checkpoint");
		await new Promise((resolve) => setTimeout(resolve, 100));
		const data = new DatabaseSync(host.dataStorePath, { readOnly: true });
		try {
			assert.equal(Number(data.prepare("SELECT COUNT(*) AS count FROM event_log WHERE session_id = ? AND type = 'message_finished'").get(session.id).count), 0);
		} finally {
			data.close();
		}
	} finally {
		PiboReliabilityStore.prototype.updateJobPayload = originalUpdateJobPayload;
		await host.channel.stop?.();
	}
});

test("chat web dead-letters output identity collisions after one attempt", async () => {
	const host = await startWebHostChannel({ auth: createFakeAuthService() });
	try {
		const sessionResponse = await fetch(`${host.baseURL}/api/chat/session`, {
			headers: { "x-test-user": "user-1" },
		});
		assert.equal(sessionResponse.status, 200);
		const { session } = await sessionResponse.json();
		const eventId = "web-permanent-collision";
		const seedStore = new PiboDataStore(host.dataStorePath);
		try {
			new ChatDataIngestService(seedStore).ingestOutputEvent({
				session,
				event: {
					type: "assistant_message",
					piboSessionId: session.id,
					eventId,
					assistantIndex: 0,
					renderSequence: 1,
					text: "stored answer",
				},
			});
		} finally {
			seedStore.close();
		}

		host.emitOutput({
			type: "assistant_message",
			piboSessionId: session.id,
			eventId,
			assistantIndex: 0,
			renderSequence: 2,
			text: "conflicting answer",
		});

		await waitForCondition(() => {
			const reliability = new DatabaseSync(host.reliabilityStorePath, { readOnly: true });
			try {
				return Number(reliability.prepare("SELECT COUNT(*) AS count FROM pibo_dead_jobs WHERE queue = 'output-persistence'").get().count) === 1;
			} finally {
				reliability.close();
			}
		}, "output identity collision was not dead-lettered");

		const reliability = new PiboReliabilityStore(host.reliabilityStorePath);
		try {
			assert.equal(reliability.listJobs({ queue: "output-persistence" }).length, 0);
			const dead = reliability.listDead({ queue: "output-persistence" });
			assert.equal(dead.length, 1);
			assert.equal(dead[0].attempts, 1);
			assert.equal(dead[0].deadReason, "permanent");
			assert.match(dead[0].lastError, /Pibo output identity collision/);
		} finally {
			reliability.close();
		}
		const data = new DatabaseSync(host.dataStorePath, { readOnly: true });
		try {
			assert.equal(Number(data.prepare("SELECT COUNT(*) AS count FROM event_log WHERE session_id = ? AND type = 'assistant_message'").get(session.id).count), 1);
			assert.equal(Number(data.prepare("SELECT COUNT(*) AS count FROM event_log WHERE session_id = ? AND type = 'pibo.output.identity_collision'").get(session.id).count), 1);
		} finally {
			data.close();
		}
		const debugResponse = await fetch(`${host.baseURL}/api/chat/debug/persistence`, {
			headers: { "x-test-user": "user-1" },
		});
		assert.equal(debugResponse.status, 200);
		assert.deepEqual((await debugResponse.json()).retryCounters, { retriable: 0, permanent: 1, quarantined: 0 });
	} finally {
		await host.channel.stop?.();
	}
});

test("chat web automatically retries a once-only final persistence failure without producer replay", async () => {
	const originalIngest = ChatDataIngestService.prototype.ingestOutputEvent;
	let injected = false;
	ChatDataIngestService.prototype.ingestOutputEvent = function(input) {
		if (!injected && input.event.type === "assistant_message") {
			injected = true;
			throw new Error("injected once-only web final failure");
		}
		return originalIngest.call(this, input);
	};
	const { channel, baseURL, emitOutput, dataStorePath, reliabilityStorePath } = await startWebHostChannel({
		auth: createFakeAuthService(),
	});

	try {
		const sessionResponse = await fetch(`${baseURL}/api/chat/session`, {
			headers: { "x-test-user": "user-1" },
		});
		assert.equal(sessionResponse.status, 200);
		const { session } = await sessionResponse.json();
		emitOutput({ type: "assistant_delta", piboSessionId: session.id, eventId: "web-auto-retry", assistantIndex: 0, text: "persist once" });
		emitOutput({ type: "assistant_message", piboSessionId: session.id, eventId: "web-auto-retry", assistantIndex: 0, text: "" });

		let rows = [];
		const deadline = Date.now() + 2_000;
		while (Date.now() < deadline) {
			const database = new DatabaseSync(dataStorePath, { readOnly: true });
			try {
				rows = database.prepare("SELECT * FROM event_log WHERE session_id = ? AND type = 'assistant_message'").all(session.id);
			} finally {
				database.close();
			}
			if (rows.length === 1) break;
			await new Promise((resolve) => setTimeout(resolve, 10));
		}
		assert.equal(injected, true);
		assert.equal(rows.length, 1);
		assert.equal(rows[0].preview_text, "persist once");

		const reliability = new DatabaseSync(reliabilityStorePath, { readOnly: true });
		try {
			const deliveries = reliability.prepare("SELECT event_id, idempotency_key FROM pibo_event_stream WHERE topic = 'pibo.output' AND key = ?").all(session.id);
			assert.equal(deliveries.length, 1);
			assert.equal(deliveries[0].event_id, deliveries[0].idempotency_key);
		} finally {
			reliability.close();
		}
	} finally {
		ChatDataIngestService.prototype.ingestOutputEvent = originalIngest;
		await channel.stop?.();
	}
});

test("chat web retry deduplicates the V2 write when reliability append fails once", async () => {
	const originalAppendOnce = PiboReliabilityStore.prototype.appendOnce;
	const originalRecordEvent = ChatSessionQueryService.prototype.recordEvent;
	const originalMarkSessionRead = ChatReadStateService.prototype.markSessionRead;
	let injected = false;
	let recordEventCount = 0;
	let markReadCount = 0;
	PiboReliabilityStore.prototype.appendOnce = function(input) {
		if (!injected && input.topic === "pibo.output") {
			injected = true;
			throw new Error("injected once-only reliability append failure");
		}
		return originalAppendOnce.call(this, input);
	};
	ChatSessionQueryService.prototype.recordEvent = function(event, ...rest) {
		if (event.eventId === "web-reliability-retry") recordEventCount += 1;
		return originalRecordEvent.call(this, event, ...rest);
	};
	ChatReadStateService.prototype.markSessionRead = function(piboSessionId, streamId) {
		markReadCount += 1;
		return originalMarkSessionRead.call(this, piboSessionId, streamId);
	};
	const { channel, baseURL, emitOutput, dataStorePath, reliabilityStorePath } = await startWebHostChannel({
		auth: createFakeAuthService(),
	});

	try {
		const sessionResponse = await fetch(`${baseURL}/api/chat/session`, { headers: { "x-test-user": "user-1" } });
		const { session } = await sessionResponse.json();
		const controller = new AbortController();
		const eventsResponse = await fetch(
			`${baseURL}/api/chat/events?piboSessionId=${encodeURIComponent(session.id)}&mode=live&since=0`,
			{ headers: { "x-test-user": "user-1" }, signal: controller.signal },
		);
		assert.equal(eventsResponse.status, 200);
		const reader = eventsResponse.body.getReader();
		await reader.read();
		emitOutput({ type: "assistant_message", piboSessionId: session.id, eventId: "web-reliability-retry", assistantIndex: 0, text: "one durable answer" });
		const deadline = Date.now() + 2_000;
		let reliabilityCount = 0;
		while (Date.now() < deadline) {
			const reliability = new DatabaseSync(reliabilityStorePath, { readOnly: true });
			try {
				reliabilityCount = Number(reliability.prepare("SELECT COUNT(*) AS count FROM pibo_event_stream WHERE topic = 'pibo.output' AND key = ?").get(session.id).count);
			} finally {
				reliability.close();
			}
			if (reliabilityCount === 1) break;
			await new Promise((resolve) => setTimeout(resolve, 10));
		}
		const database = new DatabaseSync(dataStorePath, { readOnly: true });
		try {
			const v2Count = Number(database.prepare("SELECT COUNT(*) AS count FROM event_log WHERE session_id = ? AND type = 'assistant_message'").get(session.id).count);
			assert.equal(v2Count, 1);
		} finally {
			database.close();
		}
		assert.equal(injected, true);
		assert.equal(reliabilityCount, 1);
		const liveFrame = await readSseTextUntil(reader, (text) => text.includes("web-reliability-retry"));
		assert.equal(liveFrame.matched, true, liveFrame.text);
		assert.equal(recordEventCount, 1);
		assert.equal(markReadCount, 1);
		emitOutput({ type: "assistant_message", piboSessionId: session.id, eventId: "web-reliability-retry", assistantIndex: 0, text: "one durable answer" });
		await new Promise((resolve) => setTimeout(resolve, 75));
		assert.equal(recordEventCount, 1, "producer replay must not redeliver read-model side effects");
		assert.equal(markReadCount, 1, "producer replay must not remark the session read");
		controller.abort();
	} finally {
		PiboReliabilityStore.prototype.appendOnce = originalAppendOnce;
		ChatSessionQueryService.prototype.recordEvent = originalRecordEvent;
		ChatReadStateService.prototype.markSessionRead = originalMarkSessionRead;
		await channel.stop?.();
	}
});

test("chat web resumes a pending phased delivery after app restart", async () => {
	const originalAppendOnce = PiboReliabilityStore.prototype.appendOnce;
	let blockReliability = true;
	PiboReliabilityStore.prototype.appendOnce = function(input) {
		if (blockReliability && input.topic === "pibo.output") throw new Error("hold reliability until restart");
		return originalAppendOnce.call(this, input);
	};
	let first;
	let second;
	try {
		first = await startWebHostChannel({ auth: createFakeAuthService() });
		const sessionResponse = await fetch(`${first.baseURL}/api/chat/session`, { headers: { "x-test-user": "user-1" } });
		const { session } = await sessionResponse.json();
		const sharedSessions = first.sessions;
		const sharedPaths = {
			dataStorePath: first.dataStorePath,
			dataPayloadRootDir: first.dataPayloadRootDir,
			reliabilityStorePath: first.reliabilityStorePath,
			workflowStorePath: first.workflowStorePath,
		};
		first.emitOutput({ type: "assistant_message", piboSessionId: session.id, eventId: "web-restart-pending", assistantIndex: 0, text: "survives process restart" });
		const beforeRestart = new DatabaseSync(first.reliabilityStorePath, { readOnly: true });
		try {
			assert.equal(Number(beforeRestart.prepare("SELECT COUNT(*) AS count FROM pibo_jobs WHERE queue = 'output-persistence'").get().count), 1);
		} finally {
			beforeRestart.close();
		}
		await first.channel.stop?.();
		first = undefined;
		blockReliability = false;

		second = await startWebHostChannel({
			auth: createFakeAuthService(),
			sessions: sharedSessions,
			chat: sharedPaths,
		});
		const recoveryTrigger = await fetch(`${second.baseURL}/api/chat/sessions`, { headers: { "x-test-user": "user-1" } });
		assert.equal(recoveryTrigger.status, 200);
		const deadline = Date.now() + 2_000;
		let pendingCount = 1;
		let reliabilityCount = 0;
		while (Date.now() < deadline) {
			const reliability = new DatabaseSync(sharedPaths.reliabilityStorePath, { readOnly: true });
			try {
				pendingCount = Number(reliability.prepare("SELECT COUNT(*) AS count FROM pibo_jobs WHERE queue = 'output-persistence'").get().count);
				reliabilityCount = Number(reliability.prepare("SELECT COUNT(*) AS count FROM pibo_event_stream WHERE topic = 'pibo.output' AND key = ?").get(session.id).count);
			} finally {
				reliability.close();
			}
			if (pendingCount === 0 && reliabilityCount === 1) break;
			await new Promise((resolve) => setTimeout(resolve, 10));
		}
		assert.equal(pendingCount, 0);
		assert.equal(reliabilityCount, 1);
		const data = new DatabaseSync(sharedPaths.dataStorePath, { readOnly: true });
		try {
			assert.equal(Number(data.prepare("SELECT COUNT(*) AS count FROM event_log WHERE session_id = ? AND type = 'assistant_message'").get(session.id).count), 1);
		} finally {
			data.close();
		}
		await second.channel.stop?.();
		second = undefined;
	} finally {
		PiboReliabilityStore.prototype.appendOnce = originalAppendOnce;
		await first?.channel.stop?.();
		await second?.channel.stop?.();
	}
});

test("chat web quarantines a versionless durable envelope without writing V2 state", async () => {
	const sessions = new InMemoryPiboSessionStore();
	const piboSessionId = "ps_web_versionless_envelope";
	sessions.create({ id: piboSessionId, channel: "test", kind: "chat", profile: "base" });
	const secret = "web-versionless-secret-marker";
	const host = await startWebHostChannel({ auth: createFakeAuthService(), sessions });
	try {
		const reliability = new PiboReliabilityStore(host.reliabilityStorePath);
		try {
			reliability.enqueue({
				queue: "output-persistence",
				idempotencyKey: "legacy-web-versionless",
				payload: {
					key: "legacy-web-versionless",
					state: {
						version: 1,
						piboSessionId,
						deliveries: [{ event: { type: "assistant_message", piboSessionId, eventId: "legacy-web", text: secret, renderSequence: 1 } }],
					},
				},
			});
		} finally {
			reliability.close();
		}
		const trigger = await fetch(`${host.baseURL}/api/chat/sessions`, { headers: { "x-test-user": "user-1" } });
		assert.equal(trigger.status, 200);
		await waitForCondition(() => {
			const db = new DatabaseSync(host.reliabilityStorePath, { readOnly: true });
			try {
				return Number(db.prepare("SELECT COUNT(*) AS count FROM pibo_dead_jobs WHERE queue = 'output-persistence'").get().count) === 1;
			} finally {
				db.close();
			}
		}, "versionless web envelope was not quarantined");
		const data = new DatabaseSync(host.dataStorePath, { readOnly: true });
		try {
			assert.equal(Number(data.prepare("SELECT COUNT(*) AS count FROM event_log WHERE session_id = ?").get(piboSessionId).count), 0);
		} finally {
			data.close();
		}
		const reopened = new PiboReliabilityStore(host.reliabilityStorePath);
		try {
			const dead = reopened.listDead({ queue: "output-persistence" });
			assert.equal(dead.length, 1);
			assert.equal(dead[0].deadReason, "payload_version_unsupported");
			assert.equal(JSON.stringify(dead).includes(secret), false);
		} finally {
			reopened.close();
		}
	} finally {
		await host.channel.stop?.();
	}
});

test("chat web persists and live-projects the declared message_steered runtime payload", async () => {
	const host = await startWebHostChannel({ auth: createFakeAuthService() });
	const controller = new AbortController();
	try {
		const sessionResponse = await fetch(`${host.baseURL}/api/chat/session`, { headers: { "x-test-user": "user-1" } });
		assert.equal(sessionResponse.status, 200);
		const { session } = await sessionResponse.json();
		const eventsResponse = await fetch(
			`${host.baseURL}/api/chat/events?piboSessionId=${encodeURIComponent(session.id)}&mode=live&since=0`,
			{ headers: { "x-test-user": "user-1" }, signal: controller.signal },
		);
		assert.equal(eventsResponse.status, 200);
		const reader = eventsResponse.body.getReader();
		await reader.read();
		host.emitOutput({
			type: "message_steered",
			piboSessionId: session.id,
			eventId: "steer-real-contract",
			activeEventId: "active-turn",
			text: "valid steer",
			source: "user",
		});
		await waitForCondition(() => {
			const db = new DatabaseSync(host.dataStorePath, { readOnly: true });
			try {
				return Number(db.prepare("SELECT COUNT(*) AS count FROM event_log WHERE session_id = ? AND type = 'message_steered'").get(session.id).count) === 1;
			} finally {
				db.close();
			}
		}, "valid steering output was not persisted");
		const liveFrame = await readSseTextUntil(reader, (text) => text.includes("steer-real-contract"));
		assert.equal(liveFrame.matched, true, liveFrame.text);
		const data = new DatabaseSync(host.dataStorePath, { readOnly: true });
		try {
			const row = data.prepare("SELECT event_id, idempotency_key, preview_text, attributes_json FROM event_log WHERE session_id = ? AND type = 'message_steered'").get(session.id);
			assert.equal(row.event_id, "steer-real-contract");
			assert.equal(row.idempotency_key, `pibo.output:${session.id}:message_steered:steer-real-contract:main`);
			assert.equal(row.preview_text, "valid steer");
			assert.equal(JSON.parse(row.attributes_json).activeEventId, "active-turn");
		} finally {
			data.close();
		}
		const reliability = new PiboReliabilityStore(host.reliabilityStorePath);
		try {
			assert.equal(reliability.listJobs({ queue: "output-persistence" }).length, 0);
			assert.equal(reliability.listDead({ queue: "output-persistence" }).length, 0);
			assert.equal(reliability.list({ topic: "pibo.output" }).length, 1);
		} finally {
			reliability.close();
		}
	} finally {
		controller.abort();
		await host.channel.stop?.();
	}
});

test("chat web recovers a valid V1 message_steered envelope without quarantine", async () => {
	const sessions = new InMemoryPiboSessionStore();
	const piboSessionId = "ps_web_steered_recovery";
	const eventId = "steer-web-recovery";
	const deliveryKey = `pibo.output:${piboSessionId}:message_steered:${eventId}:main`;
	sessions.create({ id: piboSessionId, channel: "test", kind: "chat", profile: "base" });
	const host = await startWebHostChannel({ auth: createFakeAuthService(), sessions });
	try {
		const reliability = new PiboReliabilityStore(host.reliabilityStorePath);
		try {
			reliability.enqueue({
				queue: "output-persistence",
				idempotencyKey: JSON.stringify([deliveryKey]),
				payload: {
					version: 1,
					key: JSON.stringify([deliveryKey]),
					piboSessionId,
					eventId: deliveryKey,
					state: {
						version: 1,
						piboSessionId,
						deliveries: [{ event: { type: "message_steered", piboSessionId, eventId, activeEventId: "active-web-turn", text: "recover valid steer", source: "user", renderSequence: 1 } }],
					},
				},
			});
		} finally {
			reliability.close();
		}
		const trigger = await fetch(`${host.baseURL}/api/chat/sessions`, { headers: { "x-test-user": "user-1" } });
		assert.equal(trigger.status, 200);
		await waitForCondition(() => {
			const db = new DatabaseSync(host.reliabilityStorePath, { readOnly: true });
			try {
				return Number(db.prepare("SELECT COUNT(*) AS count FROM pibo_jobs WHERE queue = 'output-persistence'").get().count) === 0;
			} finally {
				db.close();
			}
		}, "valid steering recovery did not drain");
		const data = new DatabaseSync(host.dataStorePath, { readOnly: true });
		try {
			const row = data.prepare("SELECT event_id, idempotency_key, preview_text FROM event_log WHERE session_id = ? AND type = 'message_steered'").get(piboSessionId);
			assert.deepEqual({ ...row }, { event_id: eventId, idempotency_key: deliveryKey, preview_text: "recover valid steer" });
		} finally {
			data.close();
		}
		const reopened = new PiboReliabilityStore(host.reliabilityStorePath);
		try {
			assert.equal(reopened.listDead({ queue: "output-persistence" }).length, 0);
			assert.equal(reopened.list({ topic: "pibo.output" }).length, 1);
		} finally {
			reopened.close();
		}
	} finally {
		await host.channel.stop?.();
	}
});

test("chat web quarantines unknown runtime output before compaction, retry, or V2 write", async () => {
	const secret = "unknown-web-secret-marker";
	const host = await startWebHostChannel({ auth: createFakeAuthService() });
	try {
		const sessionResponse = await fetch(`${host.baseURL}/api/chat/session`, { headers: { "x-test-user": "user-1" } });
		assert.equal(sessionResponse.status, 200);
		const { session } = await sessionResponse.json();
		host.emitOutput({ type: "text_message", piboSessionId: session.id, text: "legacy output", secret });
		await waitForCondition(() => {
			const db = new DatabaseSync(host.reliabilityStorePath, { readOnly: true });
			try {
				return Number(db.prepare("SELECT COUNT(*) AS count FROM pibo_dead_jobs WHERE queue = 'output-persistence'").get().count) === 1;
			} finally {
				db.close();
			}
		}, "unknown web output was not quarantined");
		const data = new DatabaseSync(host.dataStorePath, { readOnly: true });
		try {
			assert.equal(Number(data.prepare("SELECT COUNT(*) AS count FROM event_log WHERE session_id = ?").get(session.id).count), 0);
		} finally {
			data.close();
		}
		const reliability = new PiboReliabilityStore(host.reliabilityStorePath);
		try {
			assert.equal(reliability.listJobs({ queue: "output-persistence" }).length, 0);
			const dead = reliability.listDead({ queue: "output-persistence" });
			assert.equal(dead.length, 1);
			assert.equal(dead[0].deadReason, "runtime_output_event_invalid");
			const serialized = JSON.stringify(dead);
			assert.equal(serialized.includes(secret), false);
			assert.equal(serialized.includes("legacy output"), false);
			assert.equal(serialized.includes("text_message"), false);
		} finally {
			reliability.close();
		}
	} finally {
		await host.channel.stop?.();
	}
});

test("chat web recovery quarantines an unknown output variant with sanitized metadata", async () => {
	const sessions = new InMemoryPiboSessionStore();
	const piboSessionId = "ps_web_unknown_recovery";
	sessions.create({ id: piboSessionId, channel: "test", kind: "chat", profile: "base" });
	const secret = "unknown-web-recovery-secret-marker";
	const host = await startWebHostChannel({ auth: createFakeAuthService(), sessions });
	try {
		const reliability = new PiboReliabilityStore(host.reliabilityStorePath);
		try {
			reliability.enqueue({
				queue: "output-persistence",
				idempotencyKey: "unknown-web-recovery",
				payload: {
					version: 1,
					key: `unknown-web-recovery-${secret}`,
					state: { version: 1, piboSessionId, deliveries: [{ event: { type: "text_message", piboSessionId, text: secret } }] },
				},
			});
		} finally {
			reliability.close();
		}
		const trigger = await fetch(`${host.baseURL}/api/chat/sessions`, { headers: { "x-test-user": "user-1" } });
		assert.equal(trigger.status, 200);
		await waitForCondition(() => {
			const db = new DatabaseSync(host.reliabilityStorePath, { readOnly: true });
			try {
				return Number(db.prepare("SELECT COUNT(*) AS count FROM pibo_dead_jobs WHERE queue = 'output-persistence'").get().count) === 1;
			} finally {
				db.close();
			}
		}, "unknown recovered web output was not quarantined");
		const data = new DatabaseSync(host.dataStorePath, { readOnly: true });
		try {
			assert.equal(Number(data.prepare("SELECT COUNT(*) AS count FROM event_log WHERE session_id = ?").get(piboSessionId).count), 0);
		} finally {
			data.close();
		}
		const reopened = new PiboReliabilityStore(host.reliabilityStorePath);
		try {
			const dead = reopened.listDead({ queue: "output-persistence" });
			assert.equal(dead.length, 1);
			assert.equal(dead[0].deadReason, "payload_invalid");
			assert.equal(JSON.stringify(dead).includes(secret), false);
		} finally {
			reopened.close();
		}
	} finally {
		await host.channel.stop?.();
	}
});

for (const crashBoundary of [
	"before-v2-write",
	"after-v2-write",
	"after-reliability-append",
	"during-projection",
	"after-live-send-before-receipt",
	"after-receipt-before-checkpoint",
]) {
	test(`chat web outbox retries an in-process fault at ${crashBoundary} with one visible render identity`, async () => {
		const originalIngest = ChatDataIngestService.prototype.ingestOutputEvent;
		const originalAppendOnce = PiboReliabilityStore.prototype.appendOnce;
		const originalRecordEvent = ChatSessionQueryService.prototype.recordEvent;
		const originalMarkSessionRead = ChatReadStateService.prototype.markSessionRead;
		const originalRecordReceipt = PiboReliabilityStore.prototype.recordDeliveryReceipt;
		const targetEventId = `web-outbox-${crashBoundary}`;
		const crashMessage = `crash:web-outbox:${crashBoundary}`;
		let crashEnabled = true;
		let crashObserved = false;
		let recordEventCount = 0;
		let markReadCount = 0;
		const projectedStreamIds = [];
		const projectedCreatedAts = [];
		let first;
		let second;
		let firstStreamController;

		const crash = () => {
			crashObserved = true;
			throw new Error(crashMessage);
		};
		ChatDataIngestService.prototype.ingestOutputEvent = function(input) {
			if (crashEnabled && input.event.eventId === targetEventId && crashBoundary === "before-v2-write") crash();
			const result = originalIngest.call(this, input);
			if (crashEnabled && input.event.eventId === targetEventId && crashBoundary === "after-v2-write") crash();
			return result;
		};
		PiboReliabilityStore.prototype.appendOnce = function(input) {
			const result = originalAppendOnce.call(this, input);
			if (crashEnabled && input.topic === "pibo.output" && input.payload?.eventId === targetEventId && crashBoundary === "after-reliability-append") crash();
			return result;
		};
		ChatReadStateService.prototype.markSessionRead = function(piboSessionId, streamId) {
			markReadCount += 1;
			return originalMarkSessionRead.call(this, piboSessionId, streamId);
		};
		ChatSessionQueryService.prototype.recordEvent = function(event, session, streamId, createdAt) {
			const result = originalRecordEvent.call(this, event, session, streamId, createdAt);
			if (event.eventId === targetEventId) {
				recordEventCount += 1;
				projectedStreamIds.push(streamId);
				projectedCreatedAts.push(createdAt);
				if (crashEnabled && crashBoundary === "during-projection") crash();
			}
			return result;
		};
		PiboReliabilityStore.prototype.recordDeliveryReceipt = function(deliveryId, projection, deliveredAt) {
			if (crashEnabled && deliveryId.includes(targetEventId) && crashBoundary === "after-live-send-before-receipt") crash();
			const result = originalRecordReceipt.call(this, deliveryId, projection, deliveredAt);
			if (crashEnabled && deliveryId.includes(targetEventId) && crashBoundary === "after-receipt-before-checkpoint") crash();
			return result;
		};

		try {
			first = await startWebHostChannel({ auth: createFakeAuthService() });
			const sessionResponse = await fetch(`${first.baseURL}/api/chat/session`, { headers: { "x-test-user": "user-1" } });
			assert.equal(sessionResponse.status, 200);
			const { session } = await sessionResponse.json();
			firstStreamController = new AbortController();
			const eventsResponse = await fetch(
				`${first.baseURL}/api/chat/events?piboSessionId=${encodeURIComponent(session.id)}&mode=live&since=0`,
				{ headers: { "x-test-user": "user-1" }, signal: firstStreamController.signal },
			);
			assert.equal(eventsResponse.status, 200);
			const reader = eventsResponse.body.getReader();
			await reader.read();
			let firstLiveFrame;
			if (crashBoundary === "after-live-send-before-receipt" || crashBoundary === "after-receipt-before-checkpoint") {
				firstLiveFrame = readSseTextUntil(reader, (text) => text.includes(targetEventId));
			}

			first.emitOutput({
				type: "assistant_message",
				piboSessionId: session.id,
				eventId: targetEventId,
				assistantIndex: 0,
				text: `durable ${crashBoundary}`,
			});
			await waitForCondition(() => crashObserved, `did not reach ${crashBoundary}`);
			await waitForCondition(() => {
				const reliability = new DatabaseSync(first.reliabilityStorePath, { readOnly: true });
				try {
					return reliability.prepare("SELECT last_error FROM pibo_jobs WHERE queue = 'output-persistence'").get()?.last_error === crashMessage;
				} finally {
					reliability.close();
				}
			}, `durable job did not checkpoint ${crashBoundary}`);
			if (firstLiveFrame) {
				const observed = await firstLiveFrame;
				assert.equal(observed.matched, true, observed.text);
			}

			const sharedSessions = first.sessions;
			const sharedPaths = {
				dataStorePath: first.dataStorePath,
				dataPayloadRootDir: first.dataPayloadRootDir,
				reliabilityStorePath: first.reliabilityStorePath,
				workflowStorePath: first.workflowStorePath,
			};
			const firstData = new DatabaseSync(sharedPaths.dataStorePath, { readOnly: true });
			let durableBeforeRestart;
			try {
				durableBeforeRestart = firstData.prepare("SELECT stream_id, created_at, idempotency_key FROM event_log WHERE session_id = ? AND type = 'assistant_message'").get(session.id);
			} finally {
				firstData.close();
			}
			const firstReliability = new DatabaseSync(sharedPaths.reliabilityStorePath, { readOnly: true });
			let receiptBeforeRestart;
			try {
				receiptBeforeRestart = Number(firstReliability.prepare("SELECT COUNT(*) AS count FROM pibo_delivery_receipts").get().count);
			} finally {
				firstReliability.close();
			}
			assert.equal(receiptBeforeRestart, crashBoundary === "after-receipt-before-checkpoint" ? 1 : 0);
			firstStreamController?.abort();
			await first.channel.stop?.();
			first = undefined;
			crashEnabled = false;

			second = await startWebHostChannel({ auth: createFakeAuthService(), sessions: sharedSessions, chat: sharedPaths });
			const recoveryTrigger = await fetch(`${second.baseURL}/api/chat/sessions`, { headers: { "x-test-user": "user-1" } });
			assert.equal(recoveryTrigger.status, 200);
			await waitForCondition(() => {
				const reliability = new DatabaseSync(sharedPaths.reliabilityStorePath, { readOnly: true });
				try {
					return Number(reliability.prepare("SELECT COUNT(*) AS count FROM pibo_jobs WHERE queue = 'output-persistence'").get().count) === 0;
				} finally {
					reliability.close();
				}
			}, `durable job did not recover ${crashBoundary}`);

			const data = new DatabaseSync(sharedPaths.dataStorePath, { readOnly: true });
			let durable;
			let readState;
			try {
				const rows = data.prepare("SELECT stream_id, created_at, idempotency_key FROM event_log WHERE session_id = ? AND type = 'assistant_message'").all(session.id);
				assert.equal(rows.length, 1);
				durable = rows[0];
				readState = data.prepare("SELECT last_read_stream_id FROM app_session_read_state WHERE session_id = ?").get(session.id);
			} finally {
				data.close();
			}
			if (durableBeforeRestart) assert.equal(durable.stream_id, durableBeforeRestart.stream_id);
			const projectedBeforeCrash = new Set(["during-projection", "after-live-send-before-receipt", "after-receipt-before-checkpoint"]).has(crashBoundary);
			assert.equal(readState?.last_read_stream_id, projectedBeforeCrash ? durable.stream_id : undefined);
			assert.ok(projectedStreamIds.every((streamId) => streamId === durable.stream_id));
			assert.ok(projectedCreatedAts.every((createdAt) => createdAt === durable.created_at));

			const reliability = new DatabaseSync(sharedPaths.reliabilityStorePath, { readOnly: true });
			try {
				const events = reliability.prepare("SELECT event_id, idempotency_key FROM pibo_event_stream WHERE topic = 'pibo.output' AND key = ?").all(session.id);
				assert.equal(events.length, 1);
				assert.equal(events[0].event_id, durable.idempotency_key);
				assert.equal(events[0].idempotency_key, durable.idempotency_key);
				const receipt = reliability.prepare("SELECT delivery_id, projection FROM pibo_delivery_receipts").get();
				assert.deepEqual({ ...receipt }, { delivery_id: durable.idempotency_key, projection: "chat-web-observable-v1" });
			} finally {
				reliability.close();
			}

			const traceResponse = await fetch(`${second.baseURL}/api/chat/trace?piboSessionId=${encodeURIComponent(session.id)}`, { headers: { "x-test-user": "user-1" } });
			assert.equal(traceResponse.status, 200);
			const trace = await traceResponse.json();
			const rendered = flattenTraceResponseNodes(trace.nodes).filter((node) => node.type === "assistant.message" && node.eventId === targetEventId);
			assert.equal(rendered.length, 1);
			assert.equal(rendered[0].output, `durable ${crashBoundary}`);
			const expectedProjectionAttempts = new Set(["during-projection", "after-live-send-before-receipt"]).has(crashBoundary) ? 2 : 1;
			assert.equal(recordEventCount, expectedProjectionAttempts);
			assert.equal(markReadCount, projectedBeforeCrash ? 1 : 0);
		} finally {
			crashEnabled = false;
			firstStreamController?.abort();
			ChatDataIngestService.prototype.ingestOutputEvent = originalIngest;
			PiboReliabilityStore.prototype.appendOnce = originalAppendOnce;
			ChatSessionQueryService.prototype.recordEvent = originalRecordEvent;
			ChatReadStateService.prototype.markSessionRead = originalMarkSessionRead;
			PiboReliabilityStore.prototype.recordDeliveryReceipt = originalRecordReceipt;
			await first?.channel.stop?.();
			await second?.channel.stop?.();
		}
	});
}

function findAssistantOutput(nodes) {
	for (const node of nodes) {
		if (node.type === "assistant.message") return node.output;
		const child = findAssistantOutput(node.children ?? []);
		if (child) return child;
	}
	return undefined;
}

test("chat web trace supports cursor pages", async () => {
	const { channel, baseURL, emitOutput } = await startWebHostChannel({
		auth: createFakeAuthService(),
	});

	try {
		const sessionResponse = await fetch(`${baseURL}/api/chat/session`, {
			headers: { "x-test-user": "user-1" },
		});
		assert.equal(sessionResponse.status, 200);
		const sessionPayload = await sessionResponse.json();
		for (let index = 1; index <= 5; index += 1) {
			emitOutput({
				type: "assistant_message",
				piboSessionId: sessionPayload.session.id,
				eventId: `answer-${index}`,
				text: `message ${index}`,
			});
		}

		const tailResponse = await fetch(
			`${baseURL}/api/chat/trace?piboSessionId=${encodeURIComponent(sessionPayload.session.id)}&pageSize=2`,
			{ headers: { "x-test-user": "user-1" } },
		);
		assert.equal(tailResponse.status, 200);
		const tail = await tailResponse.json();
		assert.equal(tail.pageSize, 2);
		assert.equal(tail.firstEventSequence, 4);
		assert.equal(tail.lastEventSequence, 5);
		assert.equal(tail.nextBeforeSequence, 4);
		assert.equal(tail.hasOlderEvents, true);

		const olderResponse = await fetch(
			`${baseURL}/api/chat/trace?piboSessionId=${encodeURIComponent(sessionPayload.session.id)}&pageSize=2&beforeSequence=${tail.nextBeforeSequence}`,
			{ headers: { "x-test-user": "user-1" } },
		);
		assert.equal(olderResponse.status, 200);
		const older = await olderResponse.json();
		assert.equal(older.beforeSequence, 4);
		assert.equal(older.firstEventSequence, 2);
		assert.equal(older.lastEventSequence, 3);
		assert.equal(older.nextBeforeSequence, 2);
		assert.equal(older.hasOlderEvents, true);
	} finally {
		await channel.stop?.();
	}
});

test("deprecated chat web trace caps oversized compatibility page requests", async () => {
	const { channel, baseURL, emitOutput } = await startWebHostChannel({
		auth: createFakeAuthService(),
	});

	try {
		const sessionResponse = await fetch(`${baseURL}/api/chat/session`, {
			headers: { "x-test-user": "user-1" },
		});
		assert.equal(sessionResponse.status, 200);
		const sessionPayload = await sessionResponse.json();
		for (let index = 1; index <= 200; index += 1) {
			emitOutput({
				type: "assistant_message",
				piboSessionId: sessionPayload.session.id,
				eventId: `compat-answer-${index}`,
				text: `compat message ${index}`,
			});
		}

		const response = await fetch(
			`${baseURL}/api/chat/trace?piboSessionId=${encodeURIComponent(sessionPayload.session.id)}&pageSize=2000`,
			{ headers: { "x-test-user": "user-1" } },
		);
		assert.equal(response.status, 200);
		assert.equal(response.headers.get("x-pibo-trace-v1-deprecated"), "true");
		const text = await response.text();
		assert.ok(Buffer.byteLength(text, "utf8") < 256 * 1024);
		const trace = JSON.parse(text);
		assert.equal(trace.pageSize, 50);
		assert.equal(trace.firstEventSequence, 151);
		assert.equal(trace.lastEventSequence, 200);
		assert.equal(trace.hasOlderEvents, true);
	} finally {
		await channel.stop?.();
	}
});

test("chat web sessions supports cursor pages", async () => {
	const { channel, baseURL } = await startWebHostChannel({
		auth: createFakeAuthService(),
	});

	try {
		const bootstrapResponse = await fetch(`${baseURL}/api/chat/bootstrap`, {
			headers: { "x-test-user": "user-1" },
		});
		assert.equal(bootstrapResponse.status, 200);
		const bootstrap = await bootstrapResponse.json();
		for (let index = 0; index < 3; index += 1) {
			const created = await fetch(`${baseURL}/api/chat/sessions`, {
				method: "POST",
				headers: { "x-test-user": "user-1", "content-type": "application/json", origin: baseURL },
				body: JSON.stringify({ roomId: bootstrap.selectedRoomId }),
			});
			assert.equal(created.status, 201);
		}

		const firstResponse = await fetch(
			`${baseURL}/api/chat/sessions?roomId=${encodeURIComponent(bootstrap.selectedRoomId)}&limit=2`,
			{ headers: { "x-test-user": "user-1" } },
		);
		assert.equal(firstResponse.status, 200);
		const first = await firstResponse.json();
		assert.equal(first.roomId, bootstrap.selectedRoomId);
		assert.equal(first.archived, false);
		assert.equal(first.sessions.length, 2);
		assert.equal(typeof first.nextCursor, "string");
		assert.equal(first.totalCount >= 3, true);
		assert.equal(typeof first.version, "string");

		const secondResponse = await fetch(
			`${baseURL}/api/chat/sessions?roomId=${encodeURIComponent(bootstrap.selectedRoomId)}&limit=2&cursor=${encodeURIComponent(first.nextCursor)}`,
			{ headers: { "x-test-user": "user-1" } },
		);
		assert.equal(secondResponse.status, 200);
		const second = await secondResponse.json();
		assert.equal(second.sessions.some((session) => session.piboSessionId === first.sessions[0].piboSessionId), false);
	} finally {
		await channel.stop?.();
	}
});

test("chat web trace summary is small and cacheable", async () => {
	const { channel, baseURL, emitOutput } = await startWebHostChannel({
		auth: createFakeAuthService(),
	});

	try {
		const sessionResponse = await fetch(`${baseURL}/api/chat/session`, {
			headers: { "x-test-user": "user-1" },
		});
		assert.equal(sessionResponse.status, 200);
		const sessionPayload = await sessionResponse.json();
		emitOutput({
			type: "text_message",
			piboSessionId: sessionPayload.session.id,
			text: "hello",
		});

		const response = await fetch(
			`${baseURL}/api/chat/trace/summary?piboSessionId=${encodeURIComponent(sessionPayload.session.id)}`,
			{ headers: { "x-test-user": "user-1" } },
		);
		assert.equal(response.status, 200);
		assert.ok(response.headers.get("etag"));
		const summary = await response.json();
		assert.equal(summary.piboSessionId, sessionPayload.session.id);
		assert.equal(typeof summary.version, "string");
		assert.equal(typeof summary.eventCount, "number");
		assert.equal("nodes" in summary, false);
		assert.equal("rawEvents" in summary, false);

		const cachedResponse = await fetch(
			`${baseURL}/api/chat/trace/summary?piboSessionId=${encodeURIComponent(sessionPayload.session.id)}`,
			{
				headers: {
					"x-test-user": "user-1",
					"if-none-match": response.headers.get("etag"),
				},
			},
		);
		assert.equal(cachedResponse.status, 304);
	} finally {
		await channel.stop?.();
	}
});

test("new Chat Web traces use Pibo product history without reading native runtime history", async () => {
	let inspectHistoryCalls = 0;
	let readHistoryCalls = 0;
	const capabilities = fakeRuntimeCapabilities();
	const { channel, baseURL, emitOutput } = await startWebHostChannel({
		auth: createFakeAuthService(),
		capabilityCatalog: {
			agentRuntimes: [fakeRuntimeInspection("pi", { adapterId: "pi", capabilities })],
			nativeTools: [], skills: [], subagents: [], contextFiles: [], packages: [], piboTools: [], mcpServers: [], piPackages: [],
		},
		async inspectSessionRuntimeHistory() {
			inspectHistoryCalls += 1;
			throw new Error("native history must not be inspected for a new Pibo-routed session");
		},
		async readSessionRuntimeHistory() {
			readHistoryCalls += 1;
			throw new Error("native history must not be read for a new Pibo-routed session");
		},
	});

	try {
		const sessionResponse = await fetch(`${baseURL}/api/chat/session`, { headers: { "x-test-user": "user-1" } });
		assert.equal(sessionResponse.status, 200);
		const sessionPayload = await sessionResponse.json();
		const piboSessionId = sessionPayload.session.id;
		const messageResponse = await fetch(`${baseURL}/api/chat/message`, {
			method: "POST",
			headers: { "x-test-user": "user-1", "content-type": "application/json", origin: baseURL },
			body: JSON.stringify({ piboSessionId, text: "product-owned prompt", clientTxnId: "txn-product-history-web" }),
		});
		assert.equal(messageResponse.status, 200);
		const messagePayload = await messageResponse.json();
		const eventId = messagePayload.output.eventId;
		emitOutput({ type: "message_started", piboSessionId, eventId, text: "product-owned prompt", source: "user" });
		emitOutput({ type: "assistant_message", piboSessionId, eventId, assistantIndex: 0, contentIndex: 0, text: "product-owned answer" });
		emitOutput({ type: "message_finished", piboSessionId, eventId });

		const summaryResponse = await fetch(
			`${baseURL}/api/chat/trace/summary?piboSessionId=${encodeURIComponent(piboSessionId)}`,
			{ headers: { "x-test-user": "user-1" } },
		);
		assert.equal(summaryResponse.status, 200);
		const response = await fetch(
			`${baseURL}/api/chat/trace/timeline?piboSessionId=${encodeURIComponent(piboSessionId)}&limit=50`,
			{ headers: { "x-test-user": "user-1" } },
		);
		assert.equal(response.status, 200);
		const page = await response.json();
		const compatibilityResponse = await fetch(
			`${baseURL}/api/chat/trace?piboSessionId=${encodeURIComponent(piboSessionId)}`,
			{ headers: { "x-test-user": "user-1" } },
		);
		assert.equal(compatibilityResponse.status, 200);
		assert.equal(inspectHistoryCalls, 0);
		assert.equal(readHistoryCalls, 0);
		assert.equal(page.runtimeBinding.runtimeInstanceId, "pi");
		assert.equal(page.runtimeBinding.adapterId, "pi");
		assert.match(JSON.stringify(page.nodes), /product-owned prompt/);
		assert.match(JSON.stringify(page.nodes), /product-owned answer/);
		assert.ok(page.nodes.some((node) => node.source === "product-history") || page.nodes.some((node) => node.children?.some((child) => child.source === "product-history")));
	} finally {
		await channel.stop?.();
	}
});

test("origin branch trace routes reconcile native runtime turns to stable product identities", async (t) => {
	let readHistoryCalls = 0;
	const capabilities = fakeRuntimeCapabilities();
	const history = await createBuiltInCodexHistory(t, {
		piboSessionId: "ps_web_origin",
		thread: {
			id: "thread-X",
			createdAt: Date.parse("2026-08-27T12:00:00.000Z") / 1_000,
			updatedAt: Date.parse("2026-08-27T12:00:01.000Z") / 1_000,
			status: { type: "idle" },
			turns: [{
				id: "runtime-X",
				status: "completed",
				startedAt: Date.parse("2026-08-27T12:00:00.000Z") / 1_000,
				completedAt: Date.parse("2026-08-27T12:00:01.000Z") / 1_000,
				items: [
					{ id: "user-X", type: "userMessage", content: [{ type: "text", text: "branch prompt" }] },
					{ id: "assistant-X", type: "agentMessage", text: "branch answer" },
				],
			}],
		},
	});
	assert.equal((await history.read({ limit: 20 })).entries.length, 2);
	const { channel, baseURL, sessions, emitOutput, dataStorePath } = await startWebHostChannel({
		auth: createFakeAuthService(),
		async emit(event) {
			return {
				type: "message_queued",
				piboSessionId: event.piboSessionId,
				eventId: "stable-Y",
				queuedMessages: 1,
				text: event.text,
			};
		},
		capabilityCatalog: {
			agentRuntimes: [fakeRuntimeInspection("codex-native", { adapterId: "codex-native", capabilities })],
			nativeTools: [], skills: [], subagents: [], contextFiles: [], packages: [], piboTools: [], mcpServers: [], piPackages: [],
		},
		async readSessionRuntimeHistory(_piboSessionId, input = {}) {
			readHistoryCalls += 1;
			return await history.read(input);
		},
	});

	try {
		const source = sessions.create({
			channel: "pibo.chat-web",
			kind: "chat",
			profile: "default",
		});
		const branch = sessions.create({
			channel: "pibo.chat-web",
			kind: "branch",
			profile: "codex-native",
			originId: source.id,
			runtimeBinding: {
				runtimeInstanceId: "codex-native",
				adapterId: "codex-native",
				nativeSessionId: "thread-X",
				state: "bound",
				protocol: "codex-app-server",
			},
		});
		const messageResponse = await fetch(`${baseURL}/api/chat/message`, {
			method: "POST",
			headers: { "x-test-user": "user-1", "content-type": "application/json", origin: baseURL },
			body: JSON.stringify({ piboSessionId: branch.id, text: "branch prompt", clientTxnId: "txn-origin-runtime-product-identity" }),
		});
		assert.equal(messageResponse.status, 200);
		assert.equal((await messageResponse.json()).output.eventId, "stable-Y");
		emitOutput({ type: "message_started", piboSessionId: branch.id, eventId: "stable-Y", text: "branch prompt", source: "user" });
		emitOutput({ type: "assistant_message", piboSessionId: branch.id, eventId: "stable-Y", assistantIndex: 0, contentIndex: 0, text: "branch answer" });
		emitOutput({ type: "message_finished", piboSessionId: branch.id, eventId: "stable-Y", source: "user" });
		await new Promise((resolve) => setImmediate(resolve));
		const db = new DatabaseSync(dataStorePath);
		try {
			assert.ok(db.prepare("UPDATE event_log SET created_at = ? WHERE session_id = ? AND event_id = ?")
				.run("2026-08-27T12:00:00.000Z", branch.id, "stable-Y").changes >= 1);
		} finally {
			db.close();
		}

		const legacyResponse = await fetch(
			`${baseURL}/api/chat/trace?piboSessionId=${encodeURIComponent(branch.id)}`,
			{ headers: { "x-test-user": "user-1" } },
		);
		assert.equal(legacyResponse.status, 200);
		const legacy = await legacyResponse.json();
		const legacyMessages = flattenTraceResponseNodes(legacy.nodes)
			.filter((node) => node.type === "user.message" || node.type === "assistant.message");
		assert.deepEqual(legacyMessages.map((node) => node.id), [
			"event:message_queued:stable-Y",
			"event:assistant:stable-Y:assistant:0",
		]);
		assert.deepEqual(legacyMessages.map((node) => node.nativeTurnId), ["runtime-X", "runtime-X"]);
		assert.ok(legacyMessages.every((node) => node.source === "transcript"));

		const timelineResponse = await fetch(
			`${baseURL}/api/chat/trace/timeline?piboSessionId=${encodeURIComponent(branch.id)}&limit=50`,
			{ headers: { "x-test-user": "user-1" } },
		);
		assert.equal(timelineResponse.status, 200);
		const timeline = await timelineResponse.json();
		const timelineMessages = timeline.nodes
			.filter((node) => node.type === "user.message" || node.type === "assistant.message");
		assert.deepEqual(timelineMessages.map((node) => node.nodeId), [
			"event:message_queued:stable-Y",
			"event:assistant:stable-Y:assistant:0",
		]);
		assert.deepEqual(timelineMessages.map((node) => node.nativeTurnId), ["runtime-X", "runtime-X"]);
		assert.ok(timelineMessages.every((node) => node.source === "transcript"));
		assert.ok(readHistoryCalls >= 1);
	} finally {
		await channel.stop?.();
	}
});

test("public trace routes fail closed when persisted timing evidence exceeds the SQL bound", async (t) => {
	const startedAt = "2026-08-27T14:00:00.000Z";
	const assistantAt = new Date(Date.parse(startedAt) + 1_000).toISOString();
	const capabilities = fakeRuntimeCapabilities();
	const history = await createBuiltInCodexHistory(t, {
		piboSessionId: "ps_web_overflow",
		thread: {
			id: "overflow-thread",
			createdAt: Date.parse(startedAt) / 1_000,
			updatedAt: Date.parse(assistantAt) / 1_000,
			status: { type: "idle" },
			turns: [{
				id: "runtime-overflow",
				status: "completed",
				startedAt: Date.parse(startedAt) / 1_000,
				completedAt: Date.parse(assistantAt) / 1_000,
				items: [
					{ id: "overflow-user", type: "userMessage", content: [{ type: "text", text: "overflow prompt" }] },
					{ id: "overflow-assistant", type: "agentMessage", text: "overflow answer" },
				],
			}],
		},
	});
	assert.equal((await history.read({ limit: 20 })).entries.length, 2);
	let readHistoryCalls = 0;
	const { channel, baseURL, sessions, emitOutput } = await startWebHostChannel({
		auth: createFakeAuthService(),
		async emit() { throw new Error("message input is not used"); },
		capabilityCatalog: {
			agentRuntimes: [fakeRuntimeInspection("codex-native", { adapterId: "codex-native", capabilities })],
			nativeTools: [], skills: [], subagents: [], contextFiles: [], packages: [], piboTools: [], mcpServers: [], piPackages: [],
		},
		async readSessionRuntimeHistory(_piboSessionId, input = {}) {
			readHistoryCalls += 1;
			return await history.read(input);
		},
	});
	try {
		const source = sessions.create({ channel: "pibo.chat-web", kind: "chat", profile: "default" });
		const branch = sessions.create({
			channel: "pibo.chat-web",
			kind: "branch",
			profile: "codex-native",
			originId: source.id,
			runtimeBinding: { runtimeInstanceId: "codex-native", adapterId: "codex-native", nativeSessionId: "overflow-thread", state: "bound", protocol: "codex-app-server" },
		});
		for (let index = 0; index < 501; index += 1) {
			emitOutput({
				type: "message_started",
				piboSessionId: branch.id,
				eventId: index === 0 ? "stable-overflow" : "timing-overflow-noise",
				text: index === 0 ? "overflow prompt" : `noise ${index}`,
				source: "user",
			});
		}
		await new Promise((resolve) => setImmediate(resolve));
		for (const path of ["/api/chat/trace", "/api/chat/trace/timeline?limit=50"]) {
			const separator = path.includes("?") ? "&" : "?";
			const response = await fetch(`${baseURL}${path}${separator}piboSessionId=${encodeURIComponent(branch.id)}`, { headers: { "x-test-user": "user-1" } });
			assert.equal(response.status, 200);
			const payload = await response.json();
			assert.equal(payload.integrityStatus, undefined);
			assert.doesNotMatch(JSON.stringify(payload), /incomplete-turn|Incomplete Turn/);
			const projectedNodes = path.includes("timeline") ? payload.nodes : flattenTraceResponseNodes(payload.nodes);
			const nativeMessages = projectedNodes
				.filter((node) => node.nativeTurnId === "runtime-overflow" && (node.type === "user.message" || node.type === "assistant.message"));
			assert.equal(nativeMessages.length, 2);
			assert.ok(nativeMessages.every((node) => node.eventId === "runtime-overflow"));
			assert.ok(nativeMessages.every((node) => node.eventId !== "stable-overflow"));
		}
		assert.ok(readHistoryCalls >= 2);
	} finally {
		await channel.stop?.();
	}
});

test("origin branch older native-history pages reconcile repeated prompts by start time", async (t) => {
	const oldStartedAt = "2026-08-27T12:00:00.000Z";
	const newStartedAt = "2026-08-27T13:00:00.000Z";
	const stableEventIds = ["stable-old", "stable-new"];
	let emittedMessageCount = 0;
	const capabilities = fakeRuntimeCapabilities();
	const history = await createBuiltInCodexHistory(t, {
		piboSessionId: "ps_web_repeated",
		thread: {
			id: "thread-repeated",
			createdAt: Date.parse(oldStartedAt) / 1_000,
			updatedAt: Date.parse(newStartedAt) / 1_000,
			status: { type: "idle" },
			turns: [
				["old", oldStartedAt],
				["new", newStartedAt],
			].map(([suffix, startedAt]) => ({
				id: `runtime-${suffix}`,
				status: "completed",
				startedAt: Date.parse(startedAt) / 1_000,
				completedAt: Date.parse(startedAt) / 1_000,
				items: [
					{ id: `user-${suffix}`, type: "userMessage", content: [{ type: "text", text: "identical prompt" }] },
					{ id: `assistant-${suffix}`, type: "agentMessage", text: `${suffix} answer` },
				],
			})),
		},
	});
	const { channel, baseURL, sessions, emitOutput, dataStorePath } = await startWebHostChannel({
		auth: createFakeAuthService(),
		async emit(event) {
			const eventId = stableEventIds[emittedMessageCount++];
			assert.ok(eventId);
			return { type: "message_queued", piboSessionId: event.piboSessionId, eventId, source: "user", text: event.text, queuedMessages: 1 };
		},
		capabilityCatalog: {
			agentRuntimes: [fakeRuntimeInspection("codex-native", { adapterId: "codex-native", capabilities })],
			nativeTools: [], skills: [], subagents: [], contextFiles: [], packages: [], piboTools: [], mcpServers: [], piPackages: [],
		},
		async readSessionRuntimeHistory(_piboSessionId, input = {}) {
			return await history.read({ ...input, limit: 2 });
		},
	});

	try {
		const source = sessions.create({ channel: "pibo.chat-web", kind: "chat", profile: "default" });
		const branch = sessions.create({
			channel: "pibo.chat-web",
			kind: "branch",
			profile: "codex-native",
			originId: source.id,
			runtimeBinding: {
				runtimeInstanceId: "codex-native",
				adapterId: "codex-native",
				nativeSessionId: "thread-repeated",
				state: "bound",
				protocol: "codex-app-server",
			},
		});
		for (const eventId of stableEventIds) {
			const messageResponse = await fetch(`${baseURL}/api/chat/message`, {
				method: "POST",
				headers: { "x-test-user": "user-1", "content-type": "application/json", origin: baseURL },
				body: JSON.stringify({ piboSessionId: branch.id, text: "identical prompt", clientTxnId: `txn-${eventId}` }),
			});
			assert.equal(messageResponse.status, 200);
			assert.equal((await messageResponse.json()).output.eventId, eventId);
			emitOutput({ type: "message_started", piboSessionId: branch.id, eventId, source: "user", text: "identical prompt" });
		}
		await new Promise((resolve) => setImmediate(resolve));
		const db = new DatabaseSync(dataStorePath);
		try {
			assert.ok(db.prepare("UPDATE event_log SET created_at = ? WHERE session_id = ? AND event_id = ?")
				.run(oldStartedAt, branch.id, "stable-old").changes >= 1);
			assert.ok(db.prepare("UPDATE event_log SET created_at = ? WHERE session_id = ? AND event_id = ?")
				.run(newStartedAt, branch.id, "stable-new").changes >= 1);
		} finally {
			db.close();
		}

		const tailResponse = await fetch(
			`${baseURL}/api/chat/trace/timeline?piboSessionId=${encodeURIComponent(branch.id)}&limit=50`,
			{ headers: { "x-test-user": "user-1" } },
		);
		assert.equal(tailResponse.status, 200);
		const tail = await tailResponse.json();
		assert.match(tail.cursor.before, /^runtime-history:/);

		const olderResponse = await fetch(
			`${baseURL}/api/chat/trace/timeline?piboSessionId=${encodeURIComponent(branch.id)}&before=${encodeURIComponent(tail.cursor.before)}&limit=50`,
			{ headers: { "x-test-user": "user-1" } },
		);
		assert.equal(olderResponse.status, 200);
		const older = await olderResponse.json();
		const messages = older.nodes.filter((node) => node.type === "user.message" || node.type === "assistant.message");
		assert.deepEqual(messages.map((node) => ({ nodeId: node.nodeId, eventId: node.eventId, nativeTurnId: node.nativeTurnId })), [
			{ nodeId: "event:message_queued:stable-old", eventId: "stable-old", nativeTurnId: "runtime-old" },
			{ nodeId: "event:assistant:stable-old:assistant:0", eventId: "stable-old", nativeTurnId: "runtime-old" },
		]);
		assert.equal(older.cursor.hasOlder, false);
	} finally {
		await channel.stop?.();
	}
});

test("legacy Pi traces use the adapter history provider without direct Chat Web JSONL access", async () => {
	let inspectHistoryCalls = 0;
	let readHistoryCalls = 0;
	const capabilities = fakeRuntimeCapabilities();
	const { channel, baseURL, sessions } = await startWebHostChannel({
		auth: createFakeAuthService(),
		capabilityCatalog: {
			agentRuntimes: [fakeRuntimeInspection("pi", { adapterId: "pi", capabilities })],
			nativeTools: [], skills: [], subagents: [], contextFiles: [], packages: [], piboTools: [], mcpServers: [], piPackages: [],
		},
		async inspectSessionRuntimeHistory(piboSessionId) {
			inspectHistoryCalls += 1;
			return {
				runtimeInstanceId: "pi",
				adapterId: "pi",
				bindingState: "bound",
				available: true,
				title: "Legacy history",
				version: "legacy-v1",
				diagnostics: [],
			};
		},
		async readSessionRuntimeHistory(piboSessionId, input = {}) {
			readHistoryCalls += 1;
			if (input.cursor === "provider-error") throw new Error("token=runtime-history-secret-must-not-leak");
			const older = input.cursor === "provider-page-2";
			return {
				runtimeInstanceId: "pi",
				adapterId: "pi",
				source: "native",
				entries: older ? [
					{ id: "pi:older-user", type: "message", source: "native", createdAt: "2026-08-14T09:00:00.000Z", nativeEntryId: "legacy-older-user", nativeTurnId: "legacy-older-user", role: "user", content: "older legacy prompt" },
				] : [
					{ id: "pi:user", type: "message", source: "native", createdAt: "2026-08-14T10:00:00.000Z", nativeEntryId: "legacy-user", nativeTurnId: "legacy-user", role: "user", content: "legacy prompt" },
					{ id: "pi:assistant", type: "message", source: "native", createdAt: "2026-08-14T10:00:01.000Z", nativeEntryId: "legacy-assistant", nativeTurnId: "legacy-user", role: "assistant", content: [{ type: "text", text: "legacy native answer" }], status: "complete" },
				],
				nextCursor: older ? undefined : "provider-page-2",
				hasMore: !older,
				inspection: {
					runtimeInstanceId: "pi", adapterId: "pi", bindingState: "bound", available: true, title: "Legacy history", version: "legacy-v1", diagnostics: [],
				},
			};
		},
	});

	try {
		const sessionResponse = await fetch(`${baseURL}/api/chat/session`, { headers: { "x-test-user": "user-1" } });
		assert.equal(sessionResponse.status, 200);
		const sessionPayload = await sessionResponse.json();
		const current = sessions.getRuntimeBinding(sessionPayload.session.id);
		assert.ok(current);
		sessions.updateRuntimeBinding(sessionPayload.session.id, {
			...current,
			metadata: { ...(current.metadata ?? {}), migrationSource: "schema-v4" },
		}, { expectedRevision: current.revision, mode: "repair" });

		const response = await fetch(
			`${baseURL}/api/chat/trace/timeline?piboSessionId=${encodeURIComponent(sessionPayload.session.id)}&limit=50`,
			{ headers: { "x-test-user": "user-1" } },
		);
		assert.equal(response.status, 200);
		const page = await response.json();
		assert.equal(inspectHistoryCalls, 1);
		assert.equal(readHistoryCalls, 1);
		assert.match(JSON.stringify(page.nodes), /legacy native answer/);
		assert.ok(page.nodes.some((node) => node.source === "transcript"));
		assert.match(page.cursor.before, /^runtime-history:/);
		assert.doesNotMatch(JSON.stringify(page), /sessionPath|PI_CODING_AGENT_DIR/);
		const cursorPayload = JSON.parse(Buffer.from(page.cursor.before.slice("runtime-history:".length), "base64url").toString("utf8"));
		const crossSessionCursor = `runtime-history:${Buffer.from(JSON.stringify({ ...cursorPayload, piboSessionId: "ps_other" }), "utf8").toString("base64url")}`;
		const crossSessionResponse = await fetch(
			`${baseURL}/api/chat/trace/timeline?piboSessionId=${encodeURIComponent(sessionPayload.session.id)}&before=${encodeURIComponent(crossSessionCursor)}&limit=50`,
			{ headers: { "x-test-user": "user-1" } },
		);
		assert.equal(crossSessionResponse.status, 409);
		assert.equal(await crossSessionResponse.text(), '{"error":"Runtime history cursor belongs to a different Pibo session"}');
		const crossRuntimeCursor = `runtime-history:${Buffer.from(JSON.stringify({ ...cursorPayload, runtimeInstanceId: "other-runtime" }), "utf8").toString("base64url")}`;
		const crossRuntimeResponse = await fetch(
			`${baseURL}/api/chat/trace/timeline?piboSessionId=${encodeURIComponent(sessionPayload.session.id)}&before=${encodeURIComponent(crossRuntimeCursor)}&limit=50`,
			{ headers: { "x-test-user": "user-1" } },
		);
		assert.equal(crossRuntimeResponse.status, 409);
		assert.equal(await crossRuntimeResponse.text(), '{"error":"Runtime history cursor belongs to a different runtime instance"}');
		const crossAdapterCursor = `runtime-history:${Buffer.from(JSON.stringify({ ...cursorPayload, adapterId: "other-adapter" }), "utf8").toString("base64url")}`;
		const crossAdapterResponse = await fetch(
			`${baseURL}/api/chat/trace/timeline?piboSessionId=${encodeURIComponent(sessionPayload.session.id)}&before=${encodeURIComponent(crossAdapterCursor)}&limit=50`,
			{ headers: { "x-test-user": "user-1" } },
		);
		assert.equal(crossAdapterResponse.status, 409);
		assert.equal(await crossAdapterResponse.text(), '{"error":"Runtime history cursor belongs to a different runtime adapter"}');
		assert.equal(readHistoryCalls, 1);
		const providerErrorCursor = `runtime-history:${Buffer.from(JSON.stringify({ ...cursorPayload, providerCursor: "provider-error" }), "utf8").toString("base64url")}`;
		const providerErrorResponse = await fetch(
			`${baseURL}/api/chat/trace/timeline?piboSessionId=${encodeURIComponent(sessionPayload.session.id)}&before=${encodeURIComponent(providerErrorCursor)}&limit=50`,
			{ headers: { "x-test-user": "user-1" } },
		);
		assert.equal(providerErrorResponse.status, 502);
		assert.doesNotMatch(await providerErrorResponse.text(), /runtime-history-secret-must-not-leak|token=/);
		assert.equal(readHistoryCalls, 2);

		const olderResponse = await fetch(
			`${baseURL}/api/chat/trace/timeline?piboSessionId=${encodeURIComponent(sessionPayload.session.id)}&before=${encodeURIComponent(page.cursor.before)}&limit=50`,
			{ headers: { "x-test-user": "user-1" } },
		);
		assert.equal(olderResponse.status, 200);
		const olderPage = await olderResponse.json();
		assert.equal(readHistoryCalls, 3);
		assert.match(JSON.stringify(olderPage.nodes), /older legacy prompt/);
		assert.equal(olderPage.cursor.hasOlder, false);
	} finally {
		await channel.stop?.();
	}
});

test("missing legacy native history preserves surviving Pibo product history", async () => {
	let readHistoryCalls = 0;
	const capabilities = fakeRuntimeCapabilities();
	const { channel, baseURL, sessions, emitOutput } = await startWebHostChannel({
		auth: createFakeAuthService(),
		capabilityCatalog: {
			agentRuntimes: [fakeRuntimeInspection("pi", { adapterId: "pi", capabilities })],
			nativeTools: [], skills: [], subagents: [], contextFiles: [], packages: [], piboTools: [], mcpServers: [], piPackages: [],
		},
		async inspectSessionRuntimeHistory() {
			return {
				runtimeInstanceId: "pi",
				adapterId: "pi",
				bindingState: "missing",
				available: false,
				diagnostics: [{ severity: "error", code: "pi_history_not_found", message: "Native history is missing" }],
			};
		},
		async readSessionRuntimeHistory() {
			readHistoryCalls += 1;
			return {
				runtimeInstanceId: "pi",
				adapterId: "pi",
				source: "native",
				entries: [],
				hasMore: false,
				inspection: {
					runtimeInstanceId: "pi",
					adapterId: "pi",
					bindingState: "missing",
					available: false,
					diagnostics: [{ severity: "error", code: "pi_history_not_found", message: "Native history is missing" }],
				},
			};
		},
	});

	try {
		const sessionResponse = await fetch(`${baseURL}/api/chat/session`, { headers: { "x-test-user": "user-1" } });
		const sessionPayload = await sessionResponse.json();
		const piboSessionId = sessionPayload.session.id;
		const current = sessions.getRuntimeBinding(piboSessionId);
		assert.ok(current);
		sessions.updateRuntimeBinding(piboSessionId, {
			...current,
			state: "missing",
			metadata: { ...(current.metadata ?? {}), nativeHistoryFallback: true },
		}, { expectedRevision: current.revision, mode: "repair" });
		const messageResponse = await fetch(`${baseURL}/api/chat/message`, {
			method: "POST",
			headers: { "x-test-user": "user-1", "content-type": "application/json", origin: baseURL },
			body: JSON.stringify({ piboSessionId, text: "surviving product prompt", clientTxnId: "txn-missing-native-history" }),
		});
		assert.equal(messageResponse.status, 200);
		const messagePayload = await messageResponse.json();
		const eventId = messagePayload.output.eventId;
		emitOutput({ type: "message_started", piboSessionId, eventId, text: "surviving product prompt", source: "user" });
		emitOutput({ type: "assistant_message", piboSessionId, eventId, assistantIndex: 0, contentIndex: 0, text: "surviving product answer" });
		emitOutput({ type: "message_finished", piboSessionId, eventId });

		const response = await fetch(
			`${baseURL}/api/chat/trace/timeline?piboSessionId=${encodeURIComponent(piboSessionId)}&limit=50`,
			{ headers: { "x-test-user": "user-1" } },
		);
		assert.equal(response.status, 200);
		const page = await response.json();
		assert.equal(readHistoryCalls, 1);
		assert.match(JSON.stringify(page.nodes), /surviving product prompt/);
		assert.match(JSON.stringify(page.nodes), /surviving product answer/);
		assert.ok(page.nodes.some((node) => node.source === "product-history") || page.nodes.some((node) => node.children?.some((child) => child.source === "product-history")));
	} finally {
		await channel.stop?.();
	}
});

test("chat web trace returns fresh payload when a known trace version changes", async () => {
	const { channel, baseURL, emitOutput } = await startWebHostChannel({
		auth: createFakeAuthService(),
	});

	try {
		const sessionResponse = await fetch(`${baseURL}/api/chat/session`, {
			headers: { "x-test-user": "user-1" },
		});
		assert.equal(sessionResponse.status, 200);
		const sessionPayload = await sessionResponse.json();

		emitOutput({
			type: "assistant_message",
			piboSessionId: sessionPayload.session.id,
			eventId: "answer-1",
			text: "first",
		});

		const first = await fetch(
			`${baseURL}/api/chat/trace?piboSessionId=${encodeURIComponent(sessionPayload.session.id)}`,
			{ headers: { "x-test-user": "user-1" } },
		);
		assert.equal(first.status, 200);
		const firstEtag = first.headers.get("etag");
		const firstVersion = first.headers.get("x-pibo-trace-version");
		assert.ok(firstEtag);
		assert.ok(firstVersion);

		emitOutput({
			type: "assistant_message",
			piboSessionId: sessionPayload.session.id,
			eventId: "answer-2",
			text: "second",
		});

		const changed = await fetch(
			`${baseURL}/api/chat/trace?piboSessionId=${encodeURIComponent(sessionPayload.session.id)}`,
			{
				headers: {
					"x-test-user": "user-1",
					"if-none-match": firstEtag,
				},
			},
		);
		assert.equal(changed.status, 200);
		assert.notEqual(changed.headers.get("etag"), firstEtag);
		assert.notEqual(changed.headers.get("x-pibo-trace-version"), firstVersion);
		const changedTrace = await changed.json();
		assert.match(JSON.stringify(changedTrace.nodes), /second/);
	} finally {
		await channel.stop?.();
	}
});

test("chat bootstrap includes model catalog data", async () => {
	const { channel, baseURL } = await startWebHostChannel({
		auth: createFakeAuthService(),
	});

	try {
		const response = await fetch(`${baseURL}/api/chat/bootstrap`, {
			headers: { "x-test-user": "user-1" },
		});
		assert.equal(response.status, 200);
		const payload = await response.json();
		assert.ok(payload.modelCatalog);
		assert.ok(Array.isArray(payload.modelCatalog.providers));
		const provider = payload.modelCatalog.providers[0];
		assert.equal(typeof provider?.id, "string");
		assert.equal(typeof provider?.label, "string");
		assert.equal(typeof provider?.authConfigured, "boolean");
		assert.ok(Array.isArray(provider?.models));
	} finally {
		await channel.stop?.();
	}
});

test("chat navigation returns sidebar data without catalog payload", async () => {
	const { channel, baseURL } = await startWebHostChannel({
		auth: createFakeAuthService(),
	});

	try {
		const response = await fetch(`${baseURL}/api/chat/navigation`, {
			headers: { "x-test-user": "user-1" },
		});
		assert.equal(response.status, 200);
		assert.match(response.headers.get("server-timing") ?? "", /navigation/);
		const payload = await response.json();
		assert.equal(payload.identity.userId, "user-1");
		assert.match(payload.session.id, /^ps_[0-9a-f-]{36}$/);
		assert.equal(payload.selectedPiboSessionId, payload.session.id);
		assert.equal(typeof payload.selectedRoomId, "string");
		assert.ok(Array.isArray(payload.rooms));
		assert.ok(Array.isArray(payload.sessions));
		assert.equal(Object.hasOwn(payload, "agents"), false);
		assert.equal(Object.hasOwn(payload, "customAgents"), false);
		assert.equal(Object.hasOwn(payload, "modelCatalog"), false);
		assert.equal(Object.hasOwn(payload, "agentCatalog"), false);
		assert.equal(Object.hasOwn(payload, "capabilities"), false);
	} finally {
		await channel.stop?.();
	}
});

test("chat navigation snapshots profile metadata once while canonicalizing the session list", async () => {
	const sessions = new InMemoryPiboSessionStore();
	const created = Array.from({ length: 5 }, (_, index) => sessions.create({
		id: `ps_profile_snapshot_${index}`,
		channel: "pibo.chat-web",
		kind: "chat",
		profile: "base",
	}));
	let getProfilesCalls = 0;
	const { channel, baseURL } = await startWebHostChannel({
		auth: createFakeAuthService(),
		sessions,
		profiles: [{ name: "base", aliases: [] }],
		getProfiles(registeredProfiles) {
			getProfilesCalls += 1;
			return registeredProfiles;
		},
	});

	try {
		const response = await fetch(`${baseURL}/api/chat/navigation?piboSessionId=${encodeURIComponent(created[0].id)}`, {
			headers: { "x-test-user": "user-1" },
		});
		assert.equal(response.status, 200);
		assert.equal(getProfilesCalls, 2, "selected-session and list canonicalization should each use one profile snapshot");
	} finally {
		await channel.stop?.();
	}
});

test("chat web app maps authenticated users to chat sessions", async () => {
	const { channel, baseURL, emitted } = await startWebHostChannel({
		auth: createFakeAuthService(),
	});

	try {
		const accepted = await fetch(`${baseURL}/api/chat/session`, {
			headers: { "x-test-user": "user-1" },
		});
		assert.equal(accepted.status, 200);
		const session = await accepted.json();
		assert.equal(session.identity.userId, "user-1");
		assert.match(session.session.id, /^ps_[0-9a-f-]{36}$/);
		assert.equal(session.session.channel, "pibo.chat-web");
		assert.equal(session.session.kind, "chat");
		assert.equal(session.session.profile, "base");
		assert.equal(retiredPartitionField in session.session, false);

		const message = await fetch(`${baseURL}/api/chat/message`, {
			method: "POST",
			headers: {
				"content-type": "application/json",
				origin: baseURL,
				"x-test-user": "user-1",
			},
			body: JSON.stringify({ text: "hello" }),
		});
		assert.equal(message.status, 200);
		assert.equal(emitted.length, 1);
		assert.equal(emitted[0].piboSessionId, session.session.id);
		assert.equal(emitted[0].text, "hello");
	} finally {
		await channel.stop?.();
	}
});

test("chat web app default data path runs without creating the legacy web-chat store", async () => {
	const { channel, baseURL, dataStorePath, storageDir } = await startWebHostChannel({ auth: createFakeAuthService() });

	try {
		const createResponse = await fetch(`${baseURL}/api/chat/sessions`, {
			method: "POST",
			headers: { "x-test-user": "user-v2", "content-type": "application/json", origin: baseURL },
			body: JSON.stringify({}),
		});
		assert.equal(createResponse.status, 201);
		const created = await createResponse.json();
		const piboSessionId = created.session.id;
		assert.ok(piboSessionId);

		const messageResponse = await fetch(`${baseURL}/api/chat/message`, {
			method: "POST",
			headers: { "x-test-user": "user-v2", "content-type": "application/json", origin: baseURL },
			body: JSON.stringify({ piboSessionId, text: "hello v2", clientTxnId: "txn-v2" }),
		});
		assert.equal(messageResponse.status, 200);

		const bootstrapResponse = await fetch(`${baseURL}/api/chat/bootstrap?piboSessionId=${encodeURIComponent(piboSessionId)}`, {
			headers: { "x-test-user": "user-v2" },
		});
		assert.equal(bootstrapResponse.status, 200);
		const bootstrap = await bootstrapResponse.json();
		assert.equal(bootstrap.selectedPiboSessionId, piboSessionId);
		assert.ok(bootstrap.sessions.length > 0);

		const v2 = new DatabaseSync(dataStorePath, { readOnly: true });
		try {
			const events = v2.prepare("SELECT COUNT(*) AS count FROM event_log WHERE session_id = ?").get(piboSessionId);
			assert.ok(Number(events.count) > 0);
		} finally {
			v2.close();
		}

		assert.throws(() => new DatabaseSync(join(storageDir, "chat.sqlite"), { readOnly: true }));
	} finally {
		await channel.stop?.();
	}
});

test("chat web app creates app context sessions", async () => {
	const { channel, baseURL, emitted } = await startWebHostChannel({
		auth: createFakeAuthService(),
	});

	try {
		const created = await fetch(`${baseURL}/api/chat/sessions`, {
			method: "POST",
			headers: {
				"content-type": "application/json",
				origin: baseURL,
				"x-test-user": "user-1",
			},
			body: "{}",
		});
		assert.equal(created.status, 201);
		const payload = await created.json();
		assert.match(payload.session.id, /^ps_[0-9a-f-]{36}$/);
		assert.equal(retiredPartitionField in payload.session, false);
		assert.equal(payload.session.parentId, undefined);
		assert.equal(payload.session.workspace, homedir());
		assert.equal(payload.session.runtimeBinding.runtimeInstanceId, "pi");
		assert.equal(payload.session.runtimeBinding.adapterId, "pi");
		assert.equal(payload.session.runtimeBinding.state, "unbound");
		assert.equal(payload.session.runtimeBinding.nativeSessionId, payload.session.piSessionId);

		const bindingResponse = await fetch(`${baseURL}/api/chat/sessions/${encodeURIComponent(payload.session.id)}/runtime-binding`, {
			headers: { "x-test-user": "user-1" },
		});
		assert.equal(bindingResponse.status, 200);
		const bindingPayload = await bindingResponse.json();
		assert.equal(bindingPayload.binding.revision, 1);

		const bindResponse = await fetch(`${baseURL}/api/chat/sessions/${encodeURIComponent(payload.session.id)}/runtime-binding`, {
			method: "PATCH",
			headers: { "content-type": "application/json", origin: baseURL, "x-test-user": "user-1" },
			body: JSON.stringify({
				runtimeInstanceId: "pi",
				nativeSessionId: payload.session.piSessionId,
				state: "bound",
				expectedRevision: 1,
			}),
		});
		assert.equal(bindResponse.status, 200);
		const boundPayload = await bindResponse.json();
		assert.equal(boundPayload.binding.state, "bound");
		assert.equal(boundPayload.binding.revision, 2);

		const staleBindResponse = await fetch(`${baseURL}/api/chat/sessions/${encodeURIComponent(payload.session.id)}/runtime-binding`, {
			method: "PATCH",
			headers: { "content-type": "application/json", origin: baseURL, "x-test-user": "user-1" },
			body: JSON.stringify({ runtimeInstanceId: "pi", state: "unbound", expectedRevision: 1 }),
		});
		assert.equal(staleBindResponse.status, 409);

		const bootstrap = await fetch(`${baseURL}/api/chat/bootstrap?piboSessionId=${encodeURIComponent(payload.session.id)}`, {
			headers: { "x-test-user": "user-1" },
		});
		assert.equal(bootstrap.status, 200);
		const data = await bootstrap.json();
		assert.equal(data.selectedPiboSessionId, payload.session.id);
		const createdNode = data.sessions.find((session) => session.piboSessionId === payload.session.id);
		assert.ok(createdNode);
		assert.equal(createdNode.parentId, undefined);

		const message = await fetch(`${baseURL}/api/chat/message`, {
			method: "POST",
			headers: {
				"content-type": "application/json",
				origin: baseURL,
				"x-test-user": "user-1",
			},
			body: JSON.stringify({ piboSessionId: payload.session.id, text: "hello new session" }),
		});
		assert.equal(message.status, 200);
		assert.equal(emitted.length, 1);
		assert.equal(emitted[0].piboSessionId, payload.session.id);
		assert.equal(emitted[0].text, "hello new session");
	} finally {
		await channel.stop?.();
	}
});

test("chat web app exposes read-only fork candidates for a selected session", async () => {
	const requested = [];
	const { channel, baseURL } = await startWebHostChannel({
		auth: createFakeAuthService(),
		getSessionForkCandidates: async (piboSessionId) => {
			requested.push(piboSessionId);
			return [{ entryId: "native-user-1", text: "Fork this prompt" }];
		},
	});

	try {
		const created = await fetch(`${baseURL}/api/chat/sessions`, {
			method: "POST",
			headers: { "content-type": "application/json", origin: baseURL, "x-test-user": "user-1" },
			body: "{}",
		});
		assert.equal(created.status, 201);
		const payload = await created.json();
		const response = await fetch(`${baseURL}/api/chat/sessions/${encodeURIComponent(payload.session.id)}/fork-candidates`, {
			headers: { "x-test-user": "user-1" },
		});
		assert.equal(response.status, 200);
		assert.deepEqual(await response.json(), {
			messages: [{ entryId: "native-user-1", text: "Fork this prompt" }],
		});
		assert.deepEqual(requested, [payload.session.id]);
	} finally {
		await channel.stop?.();
	}
});

test("chat web app starts new room sessions in the room workspace", async () => {
	const { channel, baseURL } = await startWebHostChannel({
		auth: createFakeAuthService(),
	});

	try {
		const roomWorkspace = mkdtempSync(join(tmpdir(), "pibo-room-workspace-"));
		const roomResponse = await fetch(`${baseURL}/api/chat/rooms`, {
			method: "POST",
			headers: {
				"content-type": "application/json",
				origin: baseURL,
				"x-test-user": "user-1",
			},
			body: JSON.stringify({ name: "Workspace Room", workspace: roomWorkspace }),
		});
		assert.equal(roomResponse.status, 201);
		const roomPayload = await roomResponse.json();
		assert.equal(roomPayload.room.workspace, roomWorkspace);

		const sessionResponse = await fetch(`${baseURL}/api/chat/sessions`, {
			method: "POST",
			headers: {
				"content-type": "application/json",
				origin: baseURL,
				"x-test-user": "user-1",
			},
			body: JSON.stringify({ roomId: roomPayload.room.id }),
		});
		assert.equal(sessionResponse.status, 201);
		const sessionPayload = await sessionResponse.json();
		assert.equal(sessionPayload.session.workspace, roomWorkspace);
	} finally {
		await channel.stop?.();
	}
});

test("chat web app scopes bootstrap sessions to the selected room", async () => {
	const { channel, baseURL } = await startWebHostChannel({
		auth: createFakeAuthService(),
	});

	try {
		const defaultSession = await fetch(`${baseURL}/api/chat/session`, {
			headers: { "x-test-user": "user-1" },
		});
		assert.equal(defaultSession.status, 200);
		const defaultPayload = await defaultSession.json();

		const roomResponse = await fetch(`${baseURL}/api/chat/rooms`, {
			method: "POST",
			headers: {
				"content-type": "application/json",
				origin: baseURL,
				"x-test-user": "user-1",
			},
			body: JSON.stringify({ name: "Room Two" }),
		});
		assert.equal(roomResponse.status, 201);
		const roomPayload = await roomResponse.json();

		const roomBootstrap = await fetch(
			`${baseURL}/api/chat/bootstrap?roomId=${encodeURIComponent(roomPayload.room.id)}`,
			{
				headers: { "x-test-user": "user-1" },
			},
		);
		assert.equal(roomBootstrap.status, 200);
		const roomData = await roomBootstrap.json();
		assert.equal(roomData.selectedRoomId, roomPayload.room.id);
		assert.equal(roomData.sessions.length, 1);
		assert.notEqual(roomData.selectedPiboSessionId, defaultPayload.session.id);
		assert.equal(roomData.sessions[0].piboSessionId, roomData.selectedPiboSessionId);

		const defaultBootstrap = await fetch(`${baseURL}/api/chat/bootstrap`, {
			headers: { "x-test-user": "user-1" },
		});
		assert.equal(defaultBootstrap.status, 200);
		const defaultData = await defaultBootstrap.json();
		assert.equal(defaultData.sessions.some((session) => session.piboSessionId === roomData.selectedPiboSessionId), false);
	} finally {
		await channel.stop?.();
	}
});

test("chat web app keeps the default room locked", async () => {
	const { channel, baseURL } = await startWebHostChannel({
		auth: createFakeAuthService(),
	});

	try {
		const sessionResponse = await fetch(`${baseURL}/api/chat/session`, {
			headers: { "x-test-user": "user-1" },
		});
		assert.equal(sessionResponse.status, 200);
		const sessionPayload = await sessionResponse.json();
		const room = sessionPayload.room;

		const patchResponse = await fetch(`${baseURL}/api/chat/rooms/${encodeURIComponent(room.id)}`, {
			method: "PATCH",
			headers: {
				"content-type": "application/json",
				origin: baseURL,
				"x-test-user": "user-1",
			},
			body: JSON.stringify({ name: "Renamed Default Chat" }),
		});
		assert.equal(patchResponse.status, 400);

		const archiveResponse = await fetch(`${baseURL}/api/chat/rooms/${encodeURIComponent(room.id)}`, {
			method: "PATCH",
			headers: {
				"content-type": "application/json",
				origin: baseURL,
				"x-test-user": "user-1",
			},
			body: JSON.stringify({ archived: true }),
		});
		assert.equal(archiveResponse.status, 400);

		const deleteResponse = await fetch(`${baseURL}/api/chat/rooms/${encodeURIComponent(room.id)}`, {
			method: "DELETE",
			headers: {
				"content-type": "application/json",
				origin: baseURL,
				"x-test-user": "user-1",
			},
			body: JSON.stringify({ confirmName: room.name }),
		});
		assert.equal(deleteResponse.status, 400);
	} finally {
		await channel.stop?.();
	}
});

test("chat web app rejects cyclic room parents and preserves valid room lifecycles", async () => {
	const { channel, baseURL } = await startWebHostChannel({
		auth: createFakeAuthService(),
	});
	const headers = {
		"content-type": "application/json",
		origin: baseURL,
		"x-test-user": "user-1",
	};

	try {
		const createRoom = async (name, parentRoomId) => {
			const response = await fetch(`${baseURL}/api/chat/rooms`, {
				method: "POST",
				headers,
				body: JSON.stringify({ name, ...(parentRoomId ? { parentRoomId } : {}) }),
			});
			assert.equal(response.status, 201);
			return (await response.json()).room;
		};
		const patchParent = (roomId, parentRoomId) => fetch(`${baseURL}/api/chat/rooms/${encodeURIComponent(roomId)}`, {
			method: "PATCH",
			headers,
			body: JSON.stringify({ parentRoomId }),
		});

		const roomA = await createRoom("Hierarchy A");
		const roomB = await createRoom("Hierarchy B", roomA.id);
		const roomC = await createRoom("Hierarchy C", roomB.id);

		const selfParentResponse = await patchParent(roomA.id, roomA.id);
		assert.equal(selfParentResponse.status, 400);
		assert.deepEqual(await selfParentResponse.json(), { error: "Room parent assignment would create a cycle." });

		const validReparentResponse = await patchParent(roomC.id, roomA.id);
		assert.equal(validReparentResponse.status, 200);
		assert.equal((await validReparentResponse.json()).room.parentRoomId, roomA.id);
		assert.equal((await patchParent(roomC.id, roomB.id)).status, 200);

		const ancestorCycleResponse = await patchParent(roomA.id, roomC.id);
		assert.equal(ancestorCycleResponse.status, 400);
		assert.deepEqual(await ancestorCycleResponse.json(), { error: "Room parent assignment would create a cycle." });

		const roomsResponse = await fetch(`${baseURL}/api/chat/rooms`, {
			headers: { "x-test-user": "user-1" },
		});
		assert.equal(roomsResponse.status, 200);
		const roomTree = (await roomsResponse.json()).rooms;
		const persistedA = roomTree.find((room) => room.id === roomA.id);
		assert.ok(persistedA);
		assert.equal(persistedA.parentRoomId, undefined);
		assert.equal(persistedA.children[0]?.id, roomB.id);
		assert.equal(persistedA.children[0]?.children[0]?.id, roomC.id);

		const archiveResponse = await fetch(`${baseURL}/api/chat/rooms/${encodeURIComponent(roomA.id)}`, {
			method: "PATCH",
			headers,
			body: JSON.stringify({ archived: true }),
		});
		assert.equal(archiveResponse.status, 200);

		const deleteResponse = await fetch(`${baseURL}/api/chat/rooms/${encodeURIComponent(roomA.id)}`, {
			method: "DELETE",
			headers,
			body: JSON.stringify({ confirmName: roomA.name }),
		});
		assert.equal(deleteResponse.status, 200);
		assert.deepEqual(new Set((await deleteResponse.json()).deletedRoomIds), new Set([roomA.id, roomB.id, roomC.id]));
	} finally {
		await channel.stop?.();
	}
});

test("chat web app archives and deletes rooms with contained session subtrees", async () => {
	const { channel, baseURL, sessions } = await startWebHostChannel({
		auth: createFakeAuthService(),
	});

	try {
		const roomResponse = await fetch(`${baseURL}/api/chat/rooms`, {
			method: "POST",
			headers: {
				"content-type": "application/json",
				origin: baseURL,
				"x-test-user": "user-1",
			},
			body: JSON.stringify({ name: "Workspace Room" }),
		});
		assert.equal(roomResponse.status, 201);
		const roomPayload = await roomResponse.json();
		const room = roomPayload.room;

		const sessionResponse = await fetch(`${baseURL}/api/chat/bootstrap?roomId=${encodeURIComponent(room.id)}`, {
			headers: { "x-test-user": "user-1" },
		});
		assert.equal(sessionResponse.status, 200);
		const sessionPayload = await sessionResponse.json();
		const parent = sessionPayload.session;
		const child = sessions.create({
			channel: "pibo.subagents",
			kind: "subagent",
			profile: parent.profile,
			parentId: parent.id,
			metadata: { chatRoomId: room.id },
		});

		const deleteBeforeArchive = await fetch(`${baseURL}/api/chat/rooms/${encodeURIComponent(room.id)}`, {
			method: "DELETE",
			headers: {
				"content-type": "application/json",
				origin: baseURL,
				"x-test-user": "user-1",
			},
			body: JSON.stringify({ confirmName: room.name }),
		});
		assert.equal(deleteBeforeArchive.status, 400);

		const archiveResponse = await fetch(`${baseURL}/api/chat/rooms/${encodeURIComponent(room.id)}`, {
			method: "PATCH",
			headers: {
				"content-type": "application/json",
				origin: baseURL,
				"x-test-user": "user-1",
			},
			body: JSON.stringify({ archived: true }),
		});
		assert.equal(archiveResponse.status, 200);
		const archivePayload = await archiveResponse.json();
		assert.equal(typeof archivePayload.room.metadata.chatRoomArchivedAt, "string");

		const archivedBootstrap = await fetch(
			`${baseURL}/api/chat/bootstrap?roomId=${encodeURIComponent(room.id)}&piboSessionId=${encodeURIComponent(parent.id)}`,
			{
				headers: { "x-test-user": "user-1" },
			},
		);
		assert.equal(archivedBootstrap.status, 200);
		const archivedBootstrapPayload = await archivedBootstrap.json();
		assert.equal(archivedBootstrapPayload.selectedRoomId, room.id);
		assert.equal(archivedBootstrapPayload.selectedPiboSessionId, parent.id);
		assert.equal(
			archivedBootstrapPayload.sessions.some((session) => session.piboSessionId === parent.id),
			true,
		);

		const createInArchivedRoom = await fetch(`${baseURL}/api/chat/sessions`, {
			method: "POST",
			headers: {
				"content-type": "application/json",
				origin: baseURL,
				"x-test-user": "user-1",
			},
			body: JSON.stringify({ roomId: room.id }),
		});
		assert.equal(createInArchivedRoom.status, 403);

		const messageInArchivedRoom = await fetch(`${baseURL}/api/chat/message`, {
			method: "POST",
			headers: {
				"content-type": "application/json",
				origin: baseURL,
				"x-test-user": "user-1",
			},
			body: JSON.stringify({
				roomId: room.id,
				piboSessionId: parent.id,
				text: "Should stay read-only",
				clientTxnId: "archived-room-message",
			}),
		});
		assert.equal(messageInArchivedRoom.status, 403);

		const deleteResponse = await fetch(`${baseURL}/api/chat/rooms/${encodeURIComponent(room.id)}`, {
			method: "DELETE",
			headers: {
				"content-type": "application/json",
				origin: baseURL,
				"x-test-user": "user-1",
			},
			body: JSON.stringify({ confirmName: room.name }),
		});
		assert.equal(deleteResponse.status, 200);
		const deletePayload = await deleteResponse.json();
		assert.deepEqual(new Set(deletePayload.deletedSessionIds), new Set([parent.id, child.id]));
		assert.equal(sessions.get(parent.id), undefined);
		assert.equal(sessions.get(child.id), undefined);

		const roomsResponse = await fetch(`${baseURL}/api/chat/rooms`, {
			headers: { "x-test-user": "user-1" },
		});
		assert.equal(roomsResponse.status, 200);
		const roomsPayload = await roomsResponse.json();
		assert.equal(roomsPayload.rooms.some((item) => item.id === room.id), false);
	} finally {
		await channel.stop?.();
	}
});

test("chat web app exposes unread room and session counts", async () => {
	const { channel, baseURL, emitOutput } = await startWebHostChannel({
		auth: createFakeAuthService(),
	});

	try {
		const sessionResponse = await fetch(`${baseURL}/api/chat/session`, {
			headers: { "x-test-user": "user-1" },
		});
		assert.equal(sessionResponse.status, 200);
		const sessionPayload = await sessionResponse.json();

		emitOutput({
			type: "assistant_message",
			piboSessionId: sessionPayload.session.id,
			eventId: "turn-1",
			text: "new answer",
		});
		emitOutput({
			type: "message_finished",
			piboSessionId: sessionPayload.session.id,
			eventId: "turn-1",
		});

		const unreadResponse = await fetch(`${baseURL}/api/chat/bootstrap?markRead=false`, {
			headers: { "x-test-user": "user-1" },
		});
		assert.equal(unreadResponse.status, 200);
		const unreadData = await unreadResponse.json();
		assert.equal(unreadData.sessions[0].unreadCount, 1);
		assert.equal(unreadData.rooms[0].unreadCount, 1);

		const readResponse = await fetch(
			`${baseURL}/api/chat/bootstrap?markRead=true&piboSessionId=${encodeURIComponent(sessionPayload.session.id)}`,
			{
				headers: { "x-test-user": "user-1" },
			},
		);
		assert.equal(readResponse.status, 200);
		const readData = await readResponse.json();
		assert.equal(readData.sessions[0].unreadCount, undefined);
		assert.equal(readData.rooms[0].unreadCount, undefined);
	} finally {
		await channel.stop?.();
	}
});

test("chat web app marks the selected session subtree read during bootstrap", async () => {
	const { channel, baseURL, emitOutput, sessions } = await startWebHostChannel({
		auth: createFakeAuthService(),
	});

	try {
		const sessionResponse = await fetch(`${baseURL}/api/chat/session`, {
			headers: { "x-test-user": "user-1" },
		});
		assert.equal(sessionResponse.status, 200);
		const sessionPayload = await sessionResponse.json();
		const parent = sessionPayload.session;
		const room = sessionPayload.room;
		const child = sessions.create({
			channel: parent.channel,
			kind: parent.kind,
			profile: parent.profile,
			parentId: parent.id,
			metadata: { chatRoomId: room.id },
		});

		emitOutput({
			type: "assistant_message",
			piboSessionId: child.id,
			eventId: "child-turn-1",
			text: "child answer one",
		});
		emitOutput({
			type: "message_finished",
			piboSessionId: child.id,
			eventId: "child-turn-1",
		});
		emitOutput({
			type: "assistant_message",
			piboSessionId: child.id,
			eventId: "child-turn-2",
			text: "child answer two",
		});
		emitOutput({
			type: "message_finished",
			piboSessionId: child.id,
			eventId: "child-turn-2",
		});

		const unreadResponse = await fetch(
			`${baseURL}/api/chat/bootstrap?markRead=false&piboSessionId=${encodeURIComponent(parent.id)}`,
			{
				headers: { "x-test-user": "user-1" },
			},
		);
		assert.equal(unreadResponse.status, 200);
		const unreadData = await unreadResponse.json();
		assert.equal(unreadData.rooms[0].unreadCount, 2);
		assert.equal(unreadData.sessions[0].children[0].unreadCount, 2);

		const readResponse = await fetch(
			`${baseURL}/api/chat/bootstrap?markRead=true&roomId=${encodeURIComponent(room.id)}`,
			{
				headers: { "x-test-user": "user-1" },
			},
		);
		assert.equal(readResponse.status, 200);
		const readData = await readResponse.json();
		assert.equal(readData.rooms[0].unreadCount, undefined);
		assert.equal(readData.sessions[0].children[0].unreadCount, undefined);
	} finally {
		await channel.stop?.();
	}
});

test("chat web app room event streams do not mark assistant messages read", async () => {
	const { channel, baseURL, emitOutput } = await startWebHostChannel({
		auth: createFakeAuthService(),
	});

	try {
		const sessionResponse = await fetch(`${baseURL}/api/chat/session`, {
			headers: { "x-test-user": "user-1" },
		});
		assert.equal(sessionResponse.status, 200);
		const sessionPayload = await sessionResponse.json();
		const session = sessionPayload.session;
		const room = sessionPayload.room;

		const controller = new AbortController();
		const eventsResponse = await fetch(
			`${baseURL}/api/chat/events?roomId=${encodeURIComponent(room.id)}&since=0`,
			{
				headers: { "x-test-user": "user-1" },
				signal: controller.signal,
			},
		);
		assert.equal(eventsResponse.status, 200);
		const reader = eventsResponse.body.getReader();
		await reader.read();

		emitOutput({
			type: "assistant_message",
			piboSessionId: session.id,
			eventId: "room-stream-turn",
			text: "background answer",
		});
		emitOutput({
			type: "message_finished",
			piboSessionId: session.id,
			eventId: "room-stream-turn",
		});

		const bootstrapResponse = await fetch(`${baseURL}/api/chat/bootstrap?markRead=false&piboSessionId=${encodeURIComponent(session.id)}`, {
			headers: { "x-test-user": "user-1" },
		});
		assert.equal(bootstrapResponse.status, 200);
		const bootstrap = await bootstrapResponse.json();
		assert.equal(bootstrap.rooms[0].unreadCount, 1);
		assert.equal(bootstrap.sessions[0].unreadCount, 1);

		controller.abort();
	} finally {
		await channel.stop?.();
	}
});

test("chat web app summary event streams suppress live assistant deltas", async () => {
	const { channel, baseURL, emitOutput } = await startWebHostChannel({
		auth: createFakeAuthService(),
	});

	try {
		const sessionResponse = await fetch(`${baseURL}/api/chat/session`, {
			headers: { "x-test-user": "user-1" },
		});
		assert.equal(sessionResponse.status, 200);
		const sessionPayload = await sessionResponse.json();
		const session = sessionPayload.session;
		const room = sessionPayload.room;

		const controller = new AbortController();
		const eventsResponse = await fetch(
			`${baseURL}/api/chat/events?roomId=${encodeURIComponent(room.id)}&mode=summary&since=0`,
			{
				headers: { "x-test-user": "user-1" },
				signal: controller.signal,
			},
		);
		assert.equal(eventsResponse.status, 200);
		const reader = eventsResponse.body.getReader();
		await reader.read();

		emitOutput({
			type: "assistant_delta",
			piboSessionId: session.id,
			eventId: "summary-hidden-live",
			text: "hidden live token",
		});
		await new Promise((resolve) => setTimeout(resolve, 150));

		emitOutput({
			type: "assistant_message",
			piboSessionId: session.id,
			eventId: "summary-hidden-live",
			text: "final visible answer",
		});
		const finalFrame = await readSseTextUntil(reader, (text) => text.includes("final visible answer"));
		assert.equal(finalFrame.matched, true, finalFrame.text);
		assert.doesNotMatch(finalFrame.text, /hidden live token/);

		controller.abort();
	} finally {
		await channel.stop?.();
	}
});

test("chat web app selected live event streams receive assistant deltas", async () => {
	const { channel, baseURL, emitOutput } = await startWebHostChannel({
		auth: createFakeAuthService(),
	});

	try {
		const sessionResponse = await fetch(`${baseURL}/api/chat/session`, {
			headers: { "x-test-user": "user-1" },
		});
		assert.equal(sessionResponse.status, 200);
		const sessionPayload = await sessionResponse.json();

		const controller = new AbortController();
		const eventsResponse = await fetch(
			`${baseURL}/api/chat/events?piboSessionId=${encodeURIComponent(sessionPayload.session.id)}&mode=live&since=0`,
			{
				headers: { "x-test-user": "user-1" },
				signal: controller.signal,
			},
		);
		assert.equal(eventsResponse.status, 200);
		assert.equal(eventsResponse.headers.get("x-accel-buffering"), "no");
		const reader = eventsResponse.body.getReader();
		await reader.read();

		emitOutput({
			type: "assistant_delta",
			piboSessionId: sessionPayload.session.id,
			eventId: "live-visible",
			text: "visible live token",
		});
		const liveFrame = await readSseTextUntil(reader, (text) => text.includes("TEXT_MESSAGE_CONTENT") && text.includes("visible live token"));
		assert.equal(liveFrame.matched, true, liveFrame.text);
		assert.match(liveFrame.text, /id: live:\d+/);

		controller.abort();
	} finally {
		await channel.stop?.();
	}
});

test("chat web app selected live event streams replay buffered transient deltas after reconnect", async () => {
	const { channel, baseURL, emitOutput } = await startWebHostChannel({
		auth: createFakeAuthService(),
	});
	const firstController = new AbortController();
	const replayController = new AbortController();

	try {
		const sessionResponse = await fetch(`${baseURL}/api/chat/session`, {
			headers: { "x-test-user": "user-1" },
		});
		assert.equal(sessionResponse.status, 200);
		const sessionPayload = await sessionResponse.json();

		const firstResponse = await fetch(
			`${baseURL}/api/chat/events?piboSessionId=${encodeURIComponent(sessionPayload.session.id)}&mode=live&since=0`,
			{
				headers: { "x-test-user": "user-1" },
				signal: firstController.signal,
			},
		);
		assert.equal(firstResponse.status, 200);
		const firstReader = firstResponse.body.getReader();
		await firstReader.read();

		emitOutput({
			type: "assistant_delta",
			piboSessionId: sessionPayload.session.id,
			eventId: "buffered-reconnect",
			text: "first before reconnect",
		});
		const firstFrame = await readSseTextUntil(firstReader, (text) => text.includes("first before reconnect"));
		assert.equal(firstFrame.matched, true, firstFrame.text);
		const liveReplayMatch = firstFrame.text.match(/"liveReplayId":(\d+)/);
		assert.ok(liveReplayMatch, firstFrame.text);
		firstController.abort();
		await new Promise((resolve) => setTimeout(resolve, 50));

		emitOutput({
			type: "assistant_delta",
			piboSessionId: sessionPayload.session.id,
			eventId: "buffered-reconnect",
			text: " second during reconnect",
		});

		const replayResponse = await fetch(
			`${baseURL}/api/chat/events?piboSessionId=${encodeURIComponent(sessionPayload.session.id)}&mode=live&since=0&liveSince=${liveReplayMatch[1]}`,
			{
				headers: { "x-test-user": "user-1" },
				signal: replayController.signal,
			},
		);
		assert.equal(replayResponse.status, 200);
		const replayReader = replayResponse.body.getReader();
		const replayFrame = await readSseTextUntil(replayReader, (text) => text.includes("second during reconnect"));
		assert.equal(replayFrame.matched, true, replayFrame.text);
		assert.doesNotMatch(replayFrame.text, /first before reconnect/);
		assert.match(replayFrame.text, /id: live:\d+/);
		assert.match(replayFrame.text, /"createdAt":"\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z"/);
	} finally {
		firstController.abort();
		replayController.abort();
		await channel.stop?.();
	}
});

test("chat web app selected live replay reports missed transient deltas after buffer eviction", async () => {
	const { channel, baseURL, emitOutput } = await startWebHostChannel({
		auth: createFakeAuthService(),
	});
	const firstController = new AbortController();
	const replayController = new AbortController();

	try {
		const sessionResponse = await fetch(`${baseURL}/api/chat/session`, {
			headers: { "x-test-user": "user-1" },
		});
		assert.equal(sessionResponse.status, 200);
		const sessionPayload = await sessionResponse.json();

		const firstResponse = await fetch(
			`${baseURL}/api/chat/events?piboSessionId=${encodeURIComponent(sessionPayload.session.id)}&mode=live&since=0`,
			{
				headers: { "x-test-user": "user-1" },
				signal: firstController.signal,
			},
		);
		assert.equal(firstResponse.status, 200);
		const firstReader = firstResponse.body.getReader();
		await firstReader.read();

		emitOutput({
			type: "assistant_delta",
			piboSessionId: sessionPayload.session.id,
			eventId: "evicted-reconnect",
			text: "first before eviction",
		});
		const firstFrame = await readSseTextUntil(firstReader, (text) => text.includes("first before eviction"));
		assert.equal(firstFrame.matched, true, firstFrame.text);
		const liveReplayMatch = firstFrame.text.match(/"liveReplayId":(\d+)/);
		assert.ok(liveReplayMatch, firstFrame.text);
		firstController.abort();

		for (let index = 0; index < 1001; index += 1) {
			emitOutput({
				type: "assistant_delta",
				piboSessionId: sessionPayload.session.id,
				eventId: "evicted-reconnect",
				text: ` overflow ${index}`,
			});
		}

		const replayResponse = await fetch(
			`${baseURL}/api/chat/events?piboSessionId=${encodeURIComponent(sessionPayload.session.id)}&mode=live&since=0&liveSince=${liveReplayMatch[1]}`,
			{
				headers: { "x-test-user": "user-1" },
				signal: replayController.signal,
			},
		);
		assert.equal(replayResponse.status, 200);
		const replayReader = replayResponse.body.getReader();
		const readyFrame = await readSseTextUntil(replayReader, (text) => text.includes('"type":"ready"') && text.includes('"liveReplay"'));
		assert.equal(readyFrame.matched, true, readyFrame.text);
		assert.match(readyFrame.text, /"missed":true/);
		assert.match(readyFrame.text, /"evictedBefore":\d+/);
		assert.match(readyFrame.text, /"replayed":1000/);
	} finally {
		firstController.abort();
		replayController.abort();
		await channel.stop?.();
	}
});

test("chat web app invalid event stream modes fall back to selected-session live mode", async () => {
	const { channel, baseURL, emitOutput } = await startWebHostChannel({
		auth: createFakeAuthService(),
	});

	try {
		const sessionResponse = await fetch(`${baseURL}/api/chat/session`, {
			headers: { "x-test-user": "user-1" },
		});
		assert.equal(sessionResponse.status, 200);
		const sessionPayload = await sessionResponse.json();

		const controller = new AbortController();
		const eventsResponse = await fetch(
			`${baseURL}/api/chat/events?piboSessionId=${encodeURIComponent(sessionPayload.session.id)}&mode=invalid&since=0`,
			{
				headers: { "x-test-user": "user-1" },
				signal: controller.signal,
			},
		);
		assert.equal(eventsResponse.status, 200);
		const reader = eventsResponse.body.getReader();
		await reader.read();

		emitOutput({
			type: "assistant_delta",
			piboSessionId: sessionPayload.session.id,
			eventId: "fallback-live",
			text: "fallback live token",
		});
		const liveFrame = await readSseTextUntil(reader, (text) => text.includes("fallback live token"));
		assert.equal(liveFrame.matched, true, liveFrame.text);

		controller.abort();
	} finally {
		await channel.stop?.();
	}
});

test("chat web app live observers can join mid-turn from compactor snapshots", async () => {
	const { channel, baseURL, emitOutput } = await startWebHostChannel({
		auth: createFakeAuthService(),
	});
	const summaryController = new AbortController();
	const liveController = new AbortController();

	try {
		const sessionResponse = await fetch(`${baseURL}/api/chat/session`, {
			headers: { "x-test-user": "user-1" },
		});
		assert.equal(sessionResponse.status, 200);
		const sessionPayload = await sessionResponse.json();

		const summaryResponse = await fetch(
			`${baseURL}/api/chat/events?roomId=${encodeURIComponent(sessionPayload.room.id)}&mode=summary&since=0`,
			{
				headers: { "x-test-user": "user-1" },
				signal: summaryController.signal,
			},
		);
		assert.equal(summaryResponse.status, 200);
		await summaryResponse.body.getReader().read();

		emitOutput({
			type: "assistant_delta",
			piboSessionId: sessionPayload.session.id,
			eventId: "mid-turn",
			text: "early token",
		});
		await new Promise((resolve) => setTimeout(resolve, 50));

		const eventsResponse = await fetch(
			`${baseURL}/api/chat/events?piboSessionId=${encodeURIComponent(sessionPayload.session.id)}&mode=live&since=0`,
			{
				headers: { "x-test-user": "user-1" },
				signal: liveController.signal,
			},
		);
		assert.equal(eventsResponse.status, 200);
		const reader = eventsResponse.body.getReader();
		const snapshot = await readSseTextUntil(reader, (text) => text.includes("early token"));
		assert.equal(snapshot.matched, true, snapshot.text);

		emitOutput({
			type: "assistant_delta",
			piboSessionId: sessionPayload.session.id,
			eventId: "mid-turn",
			text: " later token",
		});
		const liveFrame = await readSseTextUntil(reader, (text) => text.includes("later token"));
		assert.equal(liveFrame.matched, true, liveFrame.text);
	} finally {
		liveController.abort();
		summaryController.abort();
		await channel.stop?.();
	}
});

test("chat web app persists final output with no live observer", async () => {
	const { channel, baseURL, emitOutput } = await startWebHostChannel({
		auth: createFakeAuthService(),
	});

	try {
		const sessionResponse = await fetch(`${baseURL}/api/chat/session`, {
			headers: { "x-test-user": "user-1" },
		});
		assert.equal(sessionResponse.status, 200);
		const sessionPayload = await sessionResponse.json();

		emitOutput({
			type: "assistant_delta",
			piboSessionId: sessionPayload.session.id,
			eventId: "no-observer-final",
			text: "persisted",
		});
		emitOutput({
			type: "assistant_delta",
			piboSessionId: sessionPayload.session.id,
			eventId: "no-observer-final",
			text: " final text",
		});
		emitOutput({
			type: "message_finished",
			piboSessionId: sessionPayload.session.id,
			eventId: "no-observer-final",
		});

		const traceResponse = await fetch(
			`${baseURL}/api/chat/trace?piboSessionId=${encodeURIComponent(sessionPayload.session.id)}&includeRawEvents=true`,
			{ headers: { "x-test-user": "user-1" } },
		);
		assert.equal(traceResponse.status, 200);
		const trace = await traceResponse.json();
		assert.match(JSON.stringify(trace), /persisted final text/);
	} finally {
		await channel.stop?.();
	}
});

test("chat web app removes live observer accounting on disconnect", async () => {
	const { channel, baseURL, emitOutput } = await startWebHostChannel({
		auth: createFakeAuthService(),
	});

	try {
		const sessionResponse = await fetch(`${baseURL}/api/chat/session`, {
			headers: { "x-test-user": "user-1" },
		});
		assert.equal(sessionResponse.status, 200);
		const sessionPayload = await sessionResponse.json();

		const controller = new AbortController();
		const eventsResponse = await fetch(
			`${baseURL}/api/chat/events?piboSessionId=${encodeURIComponent(sessionPayload.session.id)}&mode=live&since=0`,
			{
				headers: { "x-test-user": "user-1" },
				signal: controller.signal,
			},
		);
		assert.equal(eventsResponse.status, 200);
		const reader = eventsResponse.body.getReader();
		await reader.read();

		let debugResponse = await fetch(`${baseURL}/api/chat/debug/persistence`, {
			headers: { "x-test-user": "user-1" },
		});
		assert.equal(debugResponse.status, 200);
		let debug = await debugResponse.json();
		assert.deepEqual(debug.liveObservers, [{ piboSessionId: sessionPayload.session.id, count: 1 }]);

		emitOutput({
			type: "assistant_delta",
			piboSessionId: sessionPayload.session.id,
			eventId: "disconnect-live",
			text: "before disconnect",
		});
		const liveFrame = await readSseTextUntil(reader, (text) => text.includes("before disconnect"));
		assert.equal(liveFrame.matched, true, liveFrame.text);

		controller.abort();
		await new Promise((resolve) => setTimeout(resolve, 50));

		debugResponse = await fetch(`${baseURL}/api/chat/debug/persistence`, {
			headers: { "x-test-user": "user-1" },
		});
		assert.equal(debugResponse.status, 200);
		debug = await debugResponse.json();
		assert.deepEqual(debug.liveObservers, []);

		emitOutput({
			type: "assistant_delta",
			piboSessionId: sessionPayload.session.id,
			eventId: "disconnect-live",
			text: " after disconnect",
		});
		emitOutput({
			type: "message_finished",
			piboSessionId: sessionPayload.session.id,
			eventId: "disconnect-live",
		});
		const traceResponse = await fetch(
			`${baseURL}/api/chat/trace?piboSessionId=${encodeURIComponent(sessionPayload.session.id)}&includeRawEvents=true`,
			{ headers: { "x-test-user": "user-1" } },
		);
		assert.equal(traceResponse.status, 200);
		const trace = await traceResponse.json();
		assert.match(JSON.stringify(trace), /before disconnect after disconnect/);
	} finally {
		await channel.stop?.();
	}
});

test("chat web app keeps active session completions read while preserving unfocused unread", async () => {
	const { channel, baseURL, emitOutput, sessions } = await startWebHostChannel({
		auth: createFakeAuthService(),
	});

	try {
		const sessionResponse = await fetch(`${baseURL}/api/chat/session`, {
			headers: { "x-test-user": "user-1" },
		});
		assert.equal(sessionResponse.status, 200);
		const sessionPayload = await sessionResponse.json();
		const parent = sessionPayload.session;
		const room = sessionPayload.room;
		const child = sessions.create({
			channel: parent.channel,
			kind: parent.kind,
			profile: parent.profile,
			parentId: parent.id,
			metadata: { chatRoomId: room.id },
		});

		const controller = new AbortController();
		const eventsResponse = await fetch(
			`${baseURL}/api/chat/events?roomId=${encodeURIComponent(room.id)}&piboSessionId=${encodeURIComponent(parent.id)}&since=0`,
			{
				headers: { "x-test-user": "user-1" },
				signal: controller.signal,
			},
		);
		assert.equal(eventsResponse.status, 200);
		const reader = eventsResponse.body.getReader();
		await reader.read();

		emitOutput({
			type: "assistant_message",
			piboSessionId: parent.id,
			eventId: "active-turn",
			text: "visible answer",
		});
		emitOutput({
			type: "message_finished",
			piboSessionId: parent.id,
			eventId: "active-turn",
		});

		let bootstrapResponse = await fetch(`${baseURL}/api/chat/bootstrap?markRead=false&piboSessionId=${encodeURIComponent(parent.id)}`, {
			headers: { "x-test-user": "user-1" },
		});
		assert.equal(bootstrapResponse.status, 200);
		let bootstrap = await bootstrapResponse.json();
		assert.equal(bootstrap.rooms[0].unreadCount, undefined);
		assert.equal(bootstrap.sessions[0].unreadCount, undefined);

		emitOutput({
			type: "assistant_message",
			piboSessionId: child.id,
			eventId: "unfocused-turn",
			text: "background answer",
		});
		emitOutput({
			type: "message_finished",
			piboSessionId: child.id,
			eventId: "unfocused-turn",
		});

		bootstrapResponse = await fetch(`${baseURL}/api/chat/bootstrap?markRead=false&piboSessionId=${encodeURIComponent(parent.id)}`, {
			headers: { "x-test-user": "user-1" },
		});
		assert.equal(bootstrapResponse.status, 200);
		bootstrap = await bootstrapResponse.json();
		assert.equal(bootstrap.rooms[0].unreadCount, 1);
		assert.equal(bootstrap.sessions[0].children[0].unreadCount, 1);

		controller.abort();
	} finally {
		await channel.stop?.();
	}
});

test("chat web app makes message sends idempotent by client transaction id", async () => {
	const { channel, baseURL, emitted } = await startWebHostChannel({
		auth: createFakeAuthService(),
	});

	try {
		const sessionResponse = await fetch(`${baseURL}/api/chat/session`, {
			headers: { "x-test-user": "user-1" },
		});
		assert.equal(sessionResponse.status, 200);
		const sessionPayload = await sessionResponse.json();
		const body = JSON.stringify({
			piboSessionId: sessionPayload.session.id,
			text: "retry me",
			clientTxnId: "txn-retry-1",
		});

		const first = await fetch(`${baseURL}/api/chat/message`, {
			method: "POST",
			headers: {
				"content-type": "application/json",
				origin: baseURL,
				"x-test-user": "user-1",
			},
			body,
		});
		assert.equal(first.status, 200);
		const second = await fetch(`${baseURL}/api/chat/message`, {
			method: "POST",
			headers: {
				"content-type": "application/json",
				origin: baseURL,
				"x-test-user": "user-1",
			},
			body,
		});
		assert.equal(second.status, 200);
		const duplicate = await second.json();

		assert.equal(emitted.length, 1);
		assert.equal(duplicate.duplicate, true);
		assert.equal(duplicate.event.clientTxnId, "txn-retry-1");
	} finally {
		await channel.stop?.();
	}
});

test("chat web app returns a safe conflict when a bound native session is missing", async () => {
	const { channel, baseURL } = await startWebHostChannel({
		auth: createFakeAuthService(),
		emit(event) {
			throw new AgentRuntimeBindingMissingError(event.piboSessionId, "codex-native", "thread-missing");
		},
	});

	try {
		const sessionResponse = await fetch(`${baseURL}/api/chat/session`, {
			headers: { "x-test-user": "user-1" },
		});
		assert.equal(sessionResponse.status, 200);
		const sessionPayload = await sessionResponse.json();
		const response = await fetch(`${baseURL}/api/chat/message`, {
			method: "POST",
			headers: {
				"content-type": "application/json",
				origin: baseURL,
				"x-test-user": "user-1",
			},
			body: JSON.stringify({
				piboSessionId: sessionPayload.session.id,
				text: "resume missing native thread",
				clientTxnId: "txn-missing-runtime-1",
			}),
		});
		assert.equal(response.status, 409);
		const payload = await response.json();
		assert.match(payload.error, /native session "thread-missing".*is missing/);
		assert.doesNotMatch(JSON.stringify(payload), /private|rollout|config\.toml/);
	} finally {
		await channel.stop?.();
	}
});

test("chat web app writes user messages into the V2 data store", async () => {
	const { channel, baseURL, dataStorePath } = await startWebHostChannel({
		auth: createFakeAuthService(),
	});

	try {
		const sessionResponse = await fetch(`${baseURL}/api/chat/session`, {
			headers: { "x-test-user": "user-1" },
		});
		assert.equal(sessionResponse.status, 200);
		const sessionPayload = await sessionResponse.json();
		const body = JSON.stringify({
			piboSessionId: sessionPayload.session.id,
			text: "persist me",
			clientTxnId: "txn-persist-1",
		});

		for (let index = 0; index < 2; index += 1) {
			const response = await fetch(`${baseURL}/api/chat/message`, {
				method: "POST",
				headers: {
					"content-type": "application/json",
					origin: baseURL,
					"x-test-user": "user-1",
				},
				body,
			});
			assert.equal(response.status, 200);
		}

		const db = new DatabaseSync(dataStorePath, { readOnly: true });
		try {
			const eventCount = db.prepare("SELECT COUNT(*) AS count FROM event_log WHERE session_id = ?").get(sessionPayload.session.id).count;
			const messageCount = db.prepare("SELECT COUNT(*) AS count FROM chat_messages WHERE session_id = ?").get(sessionPayload.session.id).count;
			const message = db.prepare("SELECT * FROM chat_messages WHERE session_id = ?").get(sessionPayload.session.id);
			const navigation = db.prepare("SELECT * FROM session_navigation WHERE session_id = ?").get(sessionPayload.session.id);
			assert.equal(eventCount, 1);
			assert.equal(messageCount, 1);
			assert.equal(message.content_preview, "persist me");
			assert.equal(JSON.parse(message.attributes_json).inlineText, "persist me");
			assert.equal(navigation.last_message_preview, "persist me");
		} finally {
			db.close();
		}
	} finally {
		await channel.stop?.();
	}
});

test("chat web app writes assistant and tool output into the V2 data store", async () => {
	const { channel, baseURL, emitOutput, dataStorePath } = await startWebHostChannel({
		auth: createFakeAuthService(),
	});

	try {
		const sessionResponse = await fetch(`${baseURL}/api/chat/session`, {
			headers: { "x-test-user": "user-1" },
		});
		assert.equal(sessionResponse.status, 200);
		const sessionPayload = await sessionResponse.json();

		const assistantOutput = {
			type: "assistant_message",
			piboSessionId: sessionPayload.session.id,
			eventId: "persist-run-1",
			assistantIndex: 0,
			renderSequence: 42,
			text: "assistant v2 persist",
		};
		emitOutput(assistantOutput);
		emitOutput(assistantOutput);
		emitOutput({
			type: "tool_execution_finished",
			piboSessionId: sessionPayload.session.id,
			eventId: "persist-run-1",
			toolCallId: "tool-persist-1",
			toolName: "read",
			result: { ok: true },
			isError: false,
		});

		const db = new DatabaseSync(dataStorePath, { readOnly: true });
		try {
			const eventRows = db.prepare("SELECT type, attributes_json FROM event_log WHERE session_id = ? ORDER BY stream_id ASC").all(sessionPayload.session.id);
			const messageRows = db.prepare("SELECT role, content_preview FROM chat_messages WHERE session_id = ? ORDER BY sequence ASC").all(sessionPayload.session.id);
			const observationRows = db.prepare("SELECT kind, name, status FROM observations WHERE session_id = ? ORDER BY sequence ASC").all(sessionPayload.session.id);
			assert.deepEqual(eventRows.map((row) => row.type), ["assistant_message", "tool_execution_finished"]);
			const assistantAttributes = JSON.parse(eventRows[0].attributes_json);
			assert.equal(assistantAttributes.assistantIndex, 0);
			assert.equal(assistantAttributes.renderSequence, 42);
			assert.deepEqual(messageRows.map((row) => ({ role: row.role, content_preview: row.content_preview })), [{ role: "assistant", content_preview: "assistant v2 persist" }]);
			assert.deepEqual(observationRows.map((row) => row.kind), ["message", "tool"]);
			assert.equal(observationRows[1].name, "read");
		} finally {
			db.close();
		}
	} finally {
		await channel.stop?.();
	}
});

test("chat web app marks a selected session read through the read endpoint", async () => {
	const { channel, baseURL, emitOutput } = await startWebHostChannel({
		auth: createFakeAuthService(),
	});

	try {
		const sessionResponse = await fetch(`${baseURL}/api/chat/session`, {
			headers: { "x-test-user": "user-1" },
		});
		assert.equal(sessionResponse.status, 200);
		const sessionPayload = await sessionResponse.json();

		emitOutput({
			type: "assistant_message",
			piboSessionId: sessionPayload.session.id,
			eventId: "read-run-1",
			text: "read me",
		});
		emitOutput({
			type: "message_finished",
			piboSessionId: sessionPayload.session.id,
			eventId: "read-run-1",
		});

		let bootstrap = await fetch(`${baseURL}/api/chat/bootstrap?markRead=false&piboSessionId=${encodeURIComponent(sessionPayload.session.id)}`, {
			headers: { "x-test-user": "user-1" },
		});
		assert.equal(bootstrap.status, 200);
		let payload = await bootstrap.json();
		assert.equal(payload.sessions[0].unreadCount, 1);

		const marked = await fetch(`${baseURL}/api/chat/sessions/${encodeURIComponent(sessionPayload.session.id)}/read`, {
			method: "POST",
			headers: {
				"content-type": "application/json",
				origin: baseURL,
				"x-test-user": "user-1",
			},
			body: "{}",
		});
		assert.equal(marked.status, 200);
		assert.deepEqual(await marked.json(), { ok: true, piboSessionId: sessionPayload.session.id });

		bootstrap = await fetch(`${baseURL}/api/chat/bootstrap?markRead=false&piboSessionId=${encodeURIComponent(sessionPayload.session.id)}`, {
			headers: { "x-test-user": "user-1" },
		});
		assert.equal(bootstrap.status, 200);
		payload = await bootstrap.json();
		assert.equal(payload.sessions[0].unreadCount, undefined);
	} finally {
		await channel.stop?.();
	}
});

test("chat web app marks all room sessions read through the room read endpoint", async () => {
	const { channel, baseURL, emitOutput } = await startWebHostChannel({
		auth: createFakeAuthService(),
	});

	try {
		const firstResponse = await fetch(`${baseURL}/api/chat/session`, {
			headers: { "x-test-user": "user-1" },
		});
		assert.equal(firstResponse.status, 200);
		const firstPayload = await firstResponse.json();
		const room = firstPayload.room;

		const secondResponse = await fetch(`${baseURL}/api/chat/sessions`, {
			method: "POST",
			headers: {
				"content-type": "application/json",
				origin: baseURL,
				"x-test-user": "user-1",
			},
			body: JSON.stringify({ roomId: room.id }),
		});
		assert.equal(secondResponse.status, 201);
		const secondPayload = await secondResponse.json();

		for (const [session, eventId] of [[firstPayload.session, "room-read-all-1"], [secondPayload.session, "room-read-all-2"]]) {
			emitOutput({
				type: "assistant_message",
				piboSessionId: session.id,
				eventId,
				text: `answer for ${session.id}`,
			});
			emitOutput({
				type: "message_finished",
				piboSessionId: session.id,
				eventId,
			});
		}

		let bootstrap = await fetch(`${baseURL}/api/chat/bootstrap?markRead=false&roomId=${encodeURIComponent(room.id)}&piboSessionId=${encodeURIComponent(firstPayload.session.id)}`, {
			headers: { "x-test-user": "user-1" },
		});
		assert.equal(bootstrap.status, 200);
		let payload = await bootstrap.json();
		assert.equal(payload.rooms[0].unreadCount, 2);
		assert.equal(payload.sessions.find((session) => session.piboSessionId === firstPayload.session.id)?.unreadCount, 1);
		assert.equal(payload.sessions.find((session) => session.piboSessionId === secondPayload.session.id)?.unreadCount, 1);

		const marked = await fetch(`${baseURL}/api/chat/rooms/${encodeURIComponent(room.id)}/read`, {
			method: "POST",
			headers: {
				"content-type": "application/json",
				origin: baseURL,
				"x-test-user": "user-1",
			},
			body: "{}",
		});
		assert.equal(marked.status, 200);
		const markedPayload = await marked.json();
		assert.equal(markedPayload.ok, true);
		assert.equal(markedPayload.roomId, room.id);
		assert.deepEqual(new Set(markedPayload.readSessionIds), new Set([firstPayload.session.id, secondPayload.session.id]));

		bootstrap = await fetch(`${baseURL}/api/chat/bootstrap?markRead=false&roomId=${encodeURIComponent(room.id)}&piboSessionId=${encodeURIComponent(firstPayload.session.id)}`, {
			headers: { "x-test-user": "user-1" },
		});
		assert.equal(bootstrap.status, 200);
		payload = await bootstrap.json();
		assert.equal(payload.rooms[0].unreadCount, undefined);
		assert.equal(payload.sessions.find((session) => session.piboSessionId === firstPayload.session.id)?.unreadCount, undefined);
		assert.equal(payload.sessions.find((session) => session.piboSessionId === secondPayload.session.id)?.unreadCount, undefined);
	} finally {
		await channel.stop?.();
	}
});

test("chat web app replays durable SSE frames with stream cursors", async () => {
	const { channel, baseURL, emitOutput } = await startWebHostChannel({
		auth: createFakeAuthService(),
	});

	try {
		const sessionResponse = await fetch(`${baseURL}/api/chat/session`, {
			headers: { "x-test-user": "user-1" },
		});
		assert.equal(sessionResponse.status, 200);
		const sessionPayload = await sessionResponse.json();
		emitOutput({
			type: "assistant_message",
			piboSessionId: sessionPayload.session.id,
			eventId: "run-1",
			text: "hello from history",
		});

		const controller = new AbortController();
		const response = await fetch(
			`${baseURL}/api/chat/events?piboSessionId=${encodeURIComponent(sessionPayload.session.id)}&since=0`,
			{
				headers: { "x-test-user": "user-1" },
				signal: controller.signal,
			},
		);
		assert.equal(response.status, 200);
		const reader = response.body.getReader();
		const decoder = new TextDecoder();
		let text = "";
		for (let index = 0; index < 5 && !text.includes("TEXT_MESSAGE_END"); index += 1) {
			const chunk = await reader.read();
			assert.equal(chunk.done, false);
			text += decoder.decode(chunk.value, { stream: true });
		}
		controller.abort();

		assert.match(text, /id: \d+:0/);
		assert.match(text, /id: \d+:1/);
		assert.match(text, /TEXT_MESSAGE_END/);
		assert.match(text, /hello from history/);
		const replayCreatedAt = [...text.matchAll(/"createdAt":"([^"]+)"/g)].map((match) => match[1]);
		assert.ok(replayCreatedAt.length >= 2, text);
		assert.equal(new Set(replayCreatedAt).size, 1, "all frames from one durable event should keep its stored timestamp");
		assert.equal(Number.isFinite(Date.parse(replayCreatedAt[0])), true);
	} finally {
		await channel.stop?.();
	}
});

test("chat web app trace exposes an SSE cursor that skips replayed history", async () => {
	const { channel, baseURL, emitOutput } = await startWebHostChannel({
		auth: createFakeAuthService(),
	});

	try {
		const sessionResponse = await fetch(`${baseURL}/api/chat/session`, {
			headers: { "x-test-user": "user-1" },
		});
		assert.equal(sessionResponse.status, 200);
		const sessionPayload = await sessionResponse.json();
		emitOutput({
			type: "assistant_message",
			piboSessionId: sessionPayload.session.id,
			eventId: "run-1",
			text: "old before cursor",
		});

		const traceResponse = await fetch(
			`${baseURL}/api/chat/trace?piboSessionId=${encodeURIComponent(sessionPayload.session.id)}`,
			{ headers: { "x-test-user": "user-1" } },
		);
		assert.equal(traceResponse.status, 200);
		const trace = await traceResponse.json();
		assert.equal(typeof trace.latestStreamId, "number");

		const controller = new AbortController();
		const response = await fetch(
			`${baseURL}/api/chat/events?piboSessionId=${encodeURIComponent(sessionPayload.session.id)}&since=${trace.latestStreamId}:999999`,
			{
				headers: { "x-test-user": "user-1" },
				signal: controller.signal,
			},
		);
		assert.equal(response.status, 200);
		const reader = response.body.getReader();
		const decoder = new TextDecoder();
		let text = "";
		text += decoder.decode((await reader.read()).value, { stream: true });

		emitOutput({
			type: "assistant_message",
			piboSessionId: sessionPayload.session.id,
			eventId: "run-2",
			text: "new after cursor",
		});
		for (let index = 0; index < 6 && !text.includes("new after cursor"); index += 1) {
			const chunk = await reader.read();
			assert.equal(chunk.done, false);
			text += decoder.decode(chunk.value, { stream: true });
		}
		controller.abort();

		assert.doesNotMatch(text, /old before cursor/);
		assert.match(text, /new after cursor/);
	} finally {
		await channel.stop?.();
	}
});

test("chat web app room SSE frames include unfocused session ids", async () => {
	const { channel, baseURL, emitOutput } = await startWebHostChannel({
		auth: createFakeAuthService(),
	});

	try {
		const sessionResponse = await fetch(`${baseURL}/api/chat/session`, {
			headers: { "x-test-user": "user-1" },
		});
		assert.equal(sessionResponse.status, 200);
		const bootstrapResponse = await fetch(`${baseURL}/api/chat/bootstrap`, {
			headers: { "x-test-user": "user-1" },
		});
		assert.equal(bootstrapResponse.status, 200);
		const bootstrap = await bootstrapResponse.json();
		const secondResponse = await fetch(`${baseURL}/api/chat/sessions`, {
			method: "POST",
			headers: { "x-test-user": "user-1", "content-type": "application/json", origin: baseURL },
			body: JSON.stringify({ roomId: bootstrap.selectedRoomId }),
		});
		assert.equal(secondResponse.status, 201);
		const secondPayload = await secondResponse.json();

		emitOutput({
			type: "assistant_message",
			piboSessionId: secondPayload.session.id,
			eventId: "unfocused-answer",
			text: "hello while unfocused",
		});

		const controller = new AbortController();
		const response = await fetch(
			`${baseURL}/api/chat/events?roomId=${encodeURIComponent(bootstrap.selectedRoomId)}&since=0`,
			{
				headers: { "x-test-user": "user-1" },
				signal: controller.signal,
			},
		);
		assert.equal(response.status, 200);
		const reader = response.body.getReader();
		const decoder = new TextDecoder();
		let text = "";
		for (let index = 0; index < 8 && !text.includes("hello while unfocused"); index += 1) {
			const chunk = await reader.read();
			assert.equal(chunk.done, false);
			text += decoder.decode(chunk.value, { stream: true });
		}
		controller.abort();

		assert.match(text, new RegExp(`"piboSessionId":"${secondPayload.session.id}"`));
		assert.match(text, /hello while unfocused/);
	} finally {
		await channel.stop?.();
	}
});

test("chat web app scopes room-authenticated session SSE to the selected session", async () => {
	const { channel, baseURL, emitOutput } = await startWebHostChannel({
		auth: createFakeAuthService(),
	});

	try {
		const sessionResponse = await fetch(`${baseURL}/api/chat/session`, {
			headers: { "x-test-user": "user-1" },
		});
		assert.equal(sessionResponse.status, 200);
		const sessionPayload = await sessionResponse.json();
		const bootstrapResponse = await fetch(`${baseURL}/api/chat/bootstrap`, {
			headers: { "x-test-user": "user-1" },
		});
		assert.equal(bootstrapResponse.status, 200);
		const bootstrap = await bootstrapResponse.json();
		const secondResponse = await fetch(`${baseURL}/api/chat/sessions`, {
			method: "POST",
			headers: { "x-test-user": "user-1", "content-type": "application/json", origin: baseURL },
			body: JSON.stringify({ roomId: bootstrap.selectedRoomId }),
		});
		assert.equal(secondResponse.status, 201);
		const secondPayload = await secondResponse.json();

		emitOutput({
			type: "assistant_message",
			piboSessionId: sessionPayload.session.id,
			eventId: "focused-before-cursor",
			text: "focused before cursor",
		});
		const traceResponse = await fetch(
			`${baseURL}/api/chat/trace?piboSessionId=${encodeURIComponent(sessionPayload.session.id)}`,
			{ headers: { "x-test-user": "user-1" } },
		);
		assert.equal(traceResponse.status, 200);
		const trace = await traceResponse.json();
		assert.equal(typeof trace.latestStreamId, "number");

		emitOutput({
			type: "assistant_message",
			piboSessionId: secondPayload.session.id,
			eventId: "unfocused-after-cursor",
			text: "unfocused after selected cursor",
		});

		const controller = new AbortController();
		const response = await fetch(
			`${baseURL}/api/chat/events?roomId=${encodeURIComponent(bootstrap.selectedRoomId)}&piboSessionId=${encodeURIComponent(sessionPayload.session.id)}&since=${trace.latestStreamId}:999999`,
			{
				headers: { "x-test-user": "user-1" },
				signal: controller.signal,
			},
		);
		assert.equal(response.status, 200);
		const reader = response.body.getReader();
		const decoder = new TextDecoder();
		let text = "";
		text += decoder.decode((await reader.read()).value, { stream: true });

		emitOutput({
			type: "assistant_message",
			piboSessionId: sessionPayload.session.id,
			eventId: "focused-after-cursor",
			text: "focused after cursor",
		});
		for (let index = 0; index < 8 && !text.includes("focused after cursor"); index += 1) {
			const chunk = await reader.read();
			assert.equal(chunk.done, false);
			text += decoder.decode(chunk.value, { stream: true });
		}
		controller.abort();

		assert.match(text, /focused after cursor/);
		assert.doesNotMatch(text, /unfocused after selected cursor/);
		assert.doesNotMatch(text, new RegExp(`"piboSessionId":"${secondPayload.session.id}"`));
	} finally {
		await channel.stop?.();
	}
});

test("chat web app creates sessions with selected agent profiles", async () => {
	const { channel, baseURL } = await startWebHostChannel({
		auth: createFakeAuthService(),
		profiles: [
			{ name: "codex-compat-openai-web", aliases: ["codex"] },
			{ name: "pibo-kimi-coding", aliases: ["kimi"] },
		],
	});

	try {
		const created = await fetch(`${baseURL}/api/chat/sessions`, {
			method: "POST",
			headers: {
				"content-type": "application/json",
				origin: baseURL,
				"x-test-user": "user-1",
			},
			body: JSON.stringify({ profile: "codex" }),
		});
		assert.equal(created.status, 201);
		const payload = await created.json();
		assert.equal(payload.session.profile, "codex-compat-openai-web");

		const rejected = await fetch(`${baseURL}/api/chat/sessions`, {
			method: "POST",
			headers: {
				"content-type": "application/json",
				origin: baseURL,
				"x-test-user": "user-1",
			},
			body: JSON.stringify({ profile: "missing-profile" }),
		});
		assert.equal(rejected.status, 400);
		assert.deepEqual(await rejected.json(), { error: 'Unknown profile "missing-profile"' });
	} finally {
		await channel.stop?.();
	}
});

test("chat web app creates custom agents from the native capability catalog", async () => {
	const { channel, baseURL } = await startWebHostChannel({
		auth: createFakeAuthService(),
		profiles: [{ name: "codex-compat-openai-web", aliases: ["codex"] }],
	});

	try {
		const catalog = await fetch(`${baseURL}/api/chat/agent-catalog`, {
			headers: { "x-test-user": "user-1" },
		});
		assert.equal(catalog.status, 200);
		const catalogPayload = await catalog.json();
		assert.deepEqual(catalogPayload.catalog.nativeTools.map((tool) => tool.name), []);

		const createdAgent = await fetch(`${baseURL}/api/chat/agents`, {
			method: "POST",
			headers: {
				"content-type": "application/json",
				origin: baseURL,
				"x-test-user": "user-1",
			},
			body: JSON.stringify({
				displayName: "research-agent",
				description: "Uses native catalog entries only.",
				nativeTools: [],
				skills: ["pi-agent-harness"],
				builtinToolNames: ["read", "bash"],
				autoContextFiles: false,
				runControl: true,
				mainModel: { provider: "openai", id: "gpt-5.6" },
				mainModelFallbacks: [
					{ provider: "anthropic", id: "claude-sonnet-5" },
					{ provider: "moonshot", id: "kimi-k2" },
				],
				subagents: [{
					name: "helper",
					description: "Research evidence for the parent agent.",
					targetProfile: "codex-compat-openai-web",
					model: { provider: "openai", id: "gpt-5.6-mini" },
					modelFallbacks: [{ provider: "anthropic", id: "claude-haiku-5" }],
					thinkingLevel: "high",
				}],
			}),
		});
		assert.equal(createdAgent.status, 201);
		const agentPayload = await createdAgent.json();
		assert.equal(agentPayload.agent.profileName, "research-agent");
		assert.equal(agentPayload.agent.displayName, "research-agent");
		assert.deepEqual(agentPayload.agent.nativeTools, []);
		assert.deepEqual(agentPayload.agent.builtinToolNames, ["read", "bash"]);
		assert.equal(agentPayload.agent.autoContextFiles, false);
		assert.equal(agentPayload.agent.runControl, true);
		assert.deepEqual(agentPayload.agent.mainModel, { provider: "openai", id: "gpt-5.6" });
		assert.deepEqual(agentPayload.agent.mainModelFallbacks, [
			{ provider: "anthropic", id: "claude-sonnet-5" },
			{ provider: "moonshot", id: "kimi-k2" },
		]);
		assert.deepEqual(agentPayload.agent.subagents, [{
			name: "helper",
			description: "Research evidence for the parent agent.",
			targetProfile: "codex-compat-openai-web",
			model: { provider: "openai", id: "gpt-5.6-mini" },
			modelFallbacks: [{ provider: "anthropic", id: "claude-haiku-5" }],
			thinkingLevel: "high",
		}]);
		assert.equal(retiredPartitionField in agentPayload.agent, false);

		const session = await fetch(`${baseURL}/api/chat/sessions`, {
			method: "POST",
			headers: {
				"content-type": "application/json",
				origin: baseURL,
				"x-test-user": "user-1",
			},
			body: JSON.stringify({ profile: agentPayload.agent.profileName }),
		});
		assert.equal(session.status, 201);
		const sessionPayload = await session.json();
		assert.equal(sessionPayload.session.profile, agentPayload.agent.profileName);

		const listed = await fetch(`${baseURL}/api/chat/agents`, {
			headers: { "x-test-user": "user-1" },
		});
		assert.equal(listed.status, 200);
		const listedPayload = await listed.json();
		assert.deepEqual(listedPayload.agents.map((agent) => agent.displayName), ["research-agent"]);
		assert.equal(listedPayload.agents[0].autoContextFiles, false);
	} finally {
		await channel.stop?.();
	}
});

test("chat Agent Designer manages app-wide agent folders and folder assignments", async () => {
	const { channel, baseURL } = await startWebHostChannel({
		auth: createFakeAuthService(),
		profiles: [{ name: "base", aliases: [] }],
	});
	const mutationHeaders = {
		"content-type": "application/json",
		origin: baseURL,
		"x-test-user": "user-1",
	};

	try {
		const createdFolderResponse = await fetch(`${baseURL}/api/chat/agent-folders`, {
			method: "POST",
			headers: mutationHeaders,
			body: JSON.stringify({ name: "Research" }),
		});
		assert.equal(createdFolderResponse.status, 201);
		const createdFolder = (await createdFolderResponse.json()).folder;
		assert.equal(createdFolder.name, "Research");

		const listedFoldersResponse = await fetch(`${baseURL}/api/chat/agent-folders`, {
			headers: { "x-test-user": "user-1" },
		});
		assert.equal(listedFoldersResponse.status, 200);
		assert.deepEqual((await listedFoldersResponse.json()).folders.map((folder) => folder.id), [createdFolder.id]);

		const duplicateFolderResponse = await fetch(`${baseURL}/api/chat/agent-folders`, {
			method: "POST",
			headers: mutationHeaders,
			body: JSON.stringify({ name: "research" }),
		});
		assert.equal(duplicateFolderResponse.status, 409);

		const missingFolderAgentResponse = await fetch(`${baseURL}/api/chat/agents`, {
			method: "POST",
			headers: mutationHeaders,
			body: JSON.stringify({ displayName: "missing-folder-agent", folderId: "agent_folder_missing" }),
		});
		assert.equal(missingFolderAgentResponse.status, 404);

		const createdAgentResponse = await fetch(`${baseURL}/api/chat/agents`, {
			method: "POST",
			headers: mutationHeaders,
			body: JSON.stringify({ displayName: "folder-agent", folderId: createdFolder.id }),
		});
		assert.equal(createdAgentResponse.status, 201);
		const createdAgent = (await createdAgentResponse.json()).agent;
		assert.equal(createdAgent.folderId, createdFolder.id);

		const blockedDeleteResponse = await fetch(`${baseURL}/api/chat/agent-folders/${encodeURIComponent(createdFolder.id)}`, {
			method: "DELETE",
			headers: mutationHeaders,
			body: "{}",
		});
		assert.equal(blockedDeleteResponse.status, 409);

		const renamedFolderResponse = await fetch(`${baseURL}/api/chat/agent-folders/${encodeURIComponent(createdFolder.id)}`, {
			method: "PATCH",
			headers: mutationHeaders,
			body: JSON.stringify({ name: "Production" }),
		});
		assert.equal(renamedFolderResponse.status, 200);
		assert.equal((await renamedFolderResponse.json()).folder.name, "Production");

		const unfiledAgentResponse = await fetch(`${baseURL}/api/chat/agents/${encodeURIComponent(createdAgent.id)}`, {
			method: "PATCH",
			headers: mutationHeaders,
			body: JSON.stringify({ folderId: null }),
		});
		assert.equal(unfiledAgentResponse.status, 200);
		assert.equal((await unfiledAgentResponse.json()).agent.folderId, undefined);

		const deletedFolderResponse = await fetch(`${baseURL}/api/chat/agent-folders/${encodeURIComponent(createdFolder.id)}`, {
			method: "DELETE",
			headers: mutationHeaders,
			body: "{}",
		});
		assert.equal(deletedFolderResponse.status, 200);

		const bootstrapResponse = await fetch(`${baseURL}/api/chat/bootstrap`, {
			headers: { "x-test-user": "user-1" },
		});
		assert.equal(bootstrapResponse.status, 200);
		const bootstrap = await bootstrapResponse.json();
		assert.deepEqual(bootstrap.agentFolders, []);
		assert.equal(bootstrap.customAgents.find((agent) => agent.id === createdAgent.id).folderId, undefined);
	} finally {
		await channel.stop?.();
	}
});

test("chat Agent Designer exposes runtime diagnostics and rejects invalid runtime selections", async () => {
	const piCapabilities = fakeRuntimeCapabilities();
	piCapabilities.contextDiscovery = { supported: true, configurable: true, enabledByDefault: true, knownFileNames: ["AGENTS.md", "CLAUDE.md"] };
	const codexCapabilities = fakeRuntimeCapabilities();
	codexCapabilities.contextDiscovery = { supported: true, configurable: false, enabledByDefault: true, knownFileNames: ["AGENTS.override.md", "AGENTS.md"] };
	codexCapabilities.nativeSubagents = { supported: true, configurable: true, enabledByDefault: true };
	codexCapabilities.historyImport = true;
	const runtimes = [
		fakeRuntimeInspection("pi", { adapterId: "pi", displayName: "Pi", transport: "embedded", protocol: "pi-sdk", capabilities: piCapabilities, diagnostics: [{ severity: "info", code: "pi_runtime_available", message: "Pi is available." }] }),
		fakeRuntimeInspection("codex-native", {
			adapterId: "codex",
			displayName: "Codex Native",
			protocol: "codex-app-server",
			capabilities: codexCapabilities,
			models: { runtimeInstanceId: "codex-native", models: [{ id: "gpt-5.6-codex", provider: "openai", displayName: "GPT-5.6 Codex", reasoningOptions: ["low", "high"] }] },
			auth: [{ id: "openai", displayName: "OpenAI", configured: true }],
		}),
		fakeRuntimeInspection("offline-runtime", { enabled: false, available: false, diagnostics: [{ severity: "error", code: "runtime_instance_disabled", message: "Runtime is disabled." }] }),
	];
	const { channel, baseURL } = await startWebHostChannel({
		auth: createFakeAuthService(),
		profiles: [{ name: "base", aliases: [] }],
		capabilityCatalog: {
			agentRuntimes: runtimes.map(({ available: _available, diagnostics: _diagnostics, ...runtime }) => runtime),
			nativeTools: [],
			skills: [],
			subagents: [],
			contextFiles: [],
			packages: [],
			piboTools: [],
			mcpServers: [],
			piPackages: [],
		},
		inspectAgentRuntimeInstances: async () => runtimes,
		validateAgentRuntimeProfile: async (profile) => {
			const runtime = runtimes.find((candidate) => candidate.id === profile.runtimeInstanceId);
			if (!runtime) return [{ severity: "error", code: "runtime_instance_unknown", message: `Unknown runtime ${profile.runtimeInstanceId}.` }];
			if (!runtime.available) return runtime.diagnostics;
			if (profile.runtimeInstanceId === "codex-native" && profile.runtimeOptions.mode !== "isolated") {
				return [{ severity: "error", code: "codex_profile_options_invalid", message: "Codex mode must be isolated." }];
			}
			return [];
		},
	});

	try {
		const catalogResponse = await fetch(`${baseURL}/api/chat/agent-catalog`, {
			headers: { "x-test-user": "user-1" },
		});
		assert.equal(catalogResponse.status, 200);
		const catalogPayload = await catalogResponse.json();
		assert.deepEqual(catalogPayload.catalog.agentRuntimes.map((runtime) => [runtime.id, runtime.available]), [
			["pi", true],
			["codex-native", true],
			["offline-runtime", false],
		]);
		assert.equal(catalogPayload.catalog.agentRuntimes[1].models.models[0].id, "gpt-5.6-codex");
		assert.equal(catalogPayload.catalog.agentRuntimes[1].auth[0].configured, true);
		assert.equal(catalogPayload.catalog.agentRuntimes[2].diagnostics[0].code, "runtime_instance_disabled");

		const createdResponse = await fetch(`${baseURL}/api/chat/agents`, {
			method: "POST",
			headers: { "content-type": "application/json", origin: baseURL, "x-test-user": "user-1" },
			body: JSON.stringify({
				displayName: "codex-native-agent",
				runtimeInstanceId: "codex-native",
				runtimeOptions: { mode: "isolated", reasoningEffort: "high" },
				autoContextFiles: false,
				nativeSubagents: false,
			}),
		});
		assert.equal(createdResponse.status, 201);
		const created = await createdResponse.json();
		assert.equal(created.agent.runtimeInstanceId, "codex-native");
		assert.deepEqual(created.agent.runtimeOptions, { mode: "isolated", reasoningEffort: "high" });
		assert.equal(created.agent.autoContextFiles, true, "non-configurable discovery must remain at the runtime default");
		assert.equal(created.agent.nativeSubagents, false);
		assert.equal("autoContextFilesOverride" in created.agent, false);

		const rejectedPatch = await fetch(`${baseURL}/api/chat/agents/${encodeURIComponent(created.agent.id)}`, {
			method: "PATCH",
			headers: { "content-type": "application/json", origin: baseURL, "x-test-user": "user-1" },
			body: JSON.stringify({ runtimeOptions: { mode: "shared" } }),
		});
		assert.equal(rejectedPatch.status, 400);
		assert.match((await rejectedPatch.json()).error, /Codex mode must be isolated/);

		const clearedOverrideResponse = await fetch(`${baseURL}/api/chat/agents/${encodeURIComponent(created.agent.id)}`, {
			method: "PATCH",
			headers: { "content-type": "application/json", origin: baseURL, "x-test-user": "user-1" },
			body: JSON.stringify({ nativeSubagents: null }),
		});
		assert.equal(clearedOverrideResponse.status, 200);
		assert.equal((await clearedOverrideResponse.json()).agent.nativeSubagents, undefined, "an explicit null clears a runtime-specific native-subagent override");

		const disabledResponse = await fetch(`${baseURL}/api/chat/agents`, {
			method: "POST",
			headers: { "content-type": "application/json", origin: baseURL, "x-test-user": "user-1" },
			body: JSON.stringify({ displayName: "offline-agent", runtimeInstanceId: "offline-runtime" }),
		});
		assert.equal(disabledResponse.status, 400);
		assert.match((await disabledResponse.json()).error, /Runtime is disabled/);

		const unknownResponse = await fetch(`${baseURL}/api/chat/agents`, {
			method: "POST",
			headers: { "content-type": "application/json", origin: baseURL, "x-test-user": "user-1" },
			body: JSON.stringify({ displayName: "unknown-runtime-agent", runtimeInstanceId: "missing-runtime" }),
		});
		assert.equal(unknownResponse.status, 400);
		assert.match((await unknownResponse.json()).error, /Unknown runtime missing-runtime/);

		const malformedRuntimeResponse = await fetch(`${baseURL}/api/chat/agents`, {
			method: "POST",
			headers: { "content-type": "application/json", origin: baseURL, "x-test-user": "user-1" },
			body: JSON.stringify({ displayName: "malformed-runtime-agent", runtimeInstanceId: "Invalid Runtime", runtimeOptions: [] }),
		});
		assert.equal(malformedRuntimeResponse.status, 400);
		assert.match((await malformedRuntimeResponse.json()).error, /runtimeInstanceId is invalid/);

		const malformedOptionsResponse = await fetch(`${baseURL}/api/chat/agents`, {
			method: "POST",
			headers: { "content-type": "application/json", origin: baseURL, "x-test-user": "user-1" },
			body: JSON.stringify({ displayName: "malformed-options-agent", runtimeInstanceId: "codex-native", runtimeOptions: [] }),
		});
		assert.equal(malformedOptionsResponse.status, 400);
		assert.match((await malformedOptionsResponse.json()).error, /runtimeOptions must be a JSON object/);

		const switchedResponse = await fetch(`${baseURL}/api/chat/agents/${encodeURIComponent(created.agent.id)}`, {
			method: "PATCH",
			headers: { "content-type": "application/json", origin: baseURL, "x-test-user": "user-1" },
			body: JSON.stringify({ runtimeInstanceId: "pi", runtimeOptions: {}, autoContextFiles: false, nativeSubagents: false }),
		});
		assert.equal(switchedResponse.status, 200);
		const switched = await switchedResponse.json();
		assert.equal(switched.agent.runtimeInstanceId, "pi");
		assert.equal(switched.agent.autoContextFiles, false);
		assert.equal(switched.agent.nativeSubagents, undefined, "stale native-subagent overrides must be removed for Pi");

		const listed = await fetch(`${baseURL}/api/chat/agents`, { headers: { "x-test-user": "user-1" } });
		const listedPayload = await listed.json();
		assert.equal(listedPayload.agents.length, 1);
		assert.deepEqual(listedPayload.agents[0].runtimeOptions, {});
		assert.equal(listedPayload.agents[0].autoContextFiles, false);
		assert.equal("autoContextFilesOverride" in listedPayload.agents[0], false);
	} finally {
		await channel.stop?.();
	}
});

test("chat context build uses the frozen non-Pi runtime without rendering Pi startup context", async () => {
	const runtime = fakeRuntimeInspection("codex-native", {
		adapterId: "codex",
		displayName: "Codex Native",
		protocol: "codex-app-server",
	});
	const { channel, baseURL, sessions } = await startWebHostChannel({
		auth: createFakeAuthService(),
		profiles: [{ name: "native-context-agent", aliases: [], runtimeInstanceId: "pi", runtimeOptions: {} }],
		capabilityCatalog: {
			agentRuntimes: [{ ...runtime, available: undefined, diagnostics: undefined }],
			nativeTools: [], skills: [], subagents: [], contextFiles: [], packages: [], piboTools: [], mcpServers: [], piPackages: [],
		},
		inspectAgentRuntimeInstances: async () => [runtime],
		validateAgentRuntimeProfile: async () => [],
		createProfile: () => new InitialSessionContextBuilder("native-context-agent")
			.withAgentRuntime("pi", { sandbox: "workspace-write" })
			.withAutoContextFiles(false)
			.withToolPackages({ goalControl: false })
			.addSkill({ name: "review-skill", path: "/tmp/review-skill/SKILL.md" })
			.addContextFile({ key: "project-context", path: "/tmp/AGENTS.md" })
			.withMcpServers(["filesystem"])
			.createSession(),
	});
	try {
		const session = sessions.create({
			channel: "pibo.chat",
			kind: "chat",
			profile: "native-context-agent",
			runtimeBinding: {
				runtimeInstanceId: "codex-native",
				adapterId: "codex",
				nativeSessionId: "thread_fixture",
				state: "bound",
			},
		});
		const response = await fetch(`${baseURL}/api/chat/context-build?piboSessionId=${encodeURIComponent(session.id)}`, {
			headers: { "x-test-user": "user-1" },
		});
		assert.equal(response.status, 200);
		const payload = await response.json();
		assert.equal(payload.snapshot.runtime.runtimeInstanceId, "codex-native");
		assert.equal(payload.snapshot.runtime.adapterId, "codex");
		assert.equal(payload.snapshot.runtime.bindingState, "bound");
		assert.equal(payload.snapshot.nodes[0].id, "runtime-manifest");
		const manifestNode = payload.snapshot.nodes.find((node) => node.id === "runtime-manifest");
		assert.equal(manifestNode.payloadJson.runtimeInstanceId, "codex-native");
		assert.equal(manifestNode.payloadJson.adapterId, "codex");
		assert.equal(manifestNode.payloadJson.toolSurface, "pibo-managed-only");
		assert.ok(payload.snapshot.nodes.some((node) => node.id === "runtime"));
		const skillNode = payload.snapshot.nodes.find((node) => node.id === "skills").children.find((node) => node.title === "review-skill");
		const contextNode = payload.snapshot.nodes.find((node) => node.id === "context").children.find((node) => node.title === "project-context");
		const mcpNode = payload.snapshot.nodes.find((node) => node.id === "mcp").children.find((node) => node.title === "filesystem");
		assert.equal(skillNode.metadata.deliveryStatus, "failed");
		assert.equal(contextNode.metadata.deliveryStatus, "failed");
		assert.equal(mcpNode.metadata.deliveryStatus, "failed");
		assert.ok(payload.snapshot.summary.errors >= 3);
		assert.equal(payload.snapshot.nodes.some((node) => node.title === "Base System Prompt"), false);
		assert.equal(JSON.stringify(payload.snapshot).includes("workspace-write"), false);
	} finally {
		await channel.stop?.();
	}
});

test("chat context build uses the concrete depth-filtered session profile", async () => {
	const runtime = fakeRuntimeInspection("codex-native", {
		adapterId: "codex",
		displayName: "Codex Native",
		protocol: "codex-app-server",
	});
	const configuredProfile = new InitialSessionContextBuilder("recursive-context-agent")
		.withAgentRuntime("pi")
		.withBuiltinTools("disabled")
		.withAutoContextFiles(false)
		.withToolPackages({ goalControl: false })
		.addSubagent({ name: "limited", targetProfile: "base", maxDepth: 1 })
		.createSession();
	const concreteProfile = new InitialSessionContextBuilder("recursive-context-agent")
		.withAgentRuntime("codex-native")
		.withSessionId("child-native")
		.withParentSessionId("parent-native")
		.withBuiltinTools("disabled")
		.withAutoContextFiles(false)
		.withToolPackages({ goalControl: false })
		.createSession();
	let validatedProfile;
	const { channel, baseURL, sessions } = await startWebHostChannel({
		auth: createFakeAuthService(),
		profiles: [{ name: "recursive-context-agent", aliases: [], runtimeInstanceId: "pi", runtimeOptions: {} }],
		capabilityCatalog: {
			agentRuntimes: [{ ...runtime, available: undefined, diagnostics: undefined }],
			nativeTools: [], skills: [], subagents: [], contextFiles: [], packages: [], piboTools: [], mcpServers: [], piPackages: [],
		},
		inspectAgentRuntimeInstances: async () => [runtime],
		validateAgentRuntimeProfile: async (profile) => { validatedProfile = profile; return []; },
		createProfile: () => configuredProfile,
		getSessionRuntimeProfile: () => concreteProfile,
	});
	try {
		const parent = sessions.create({
			id: "ps_context_parent",
			channel: "pibo.chat",
			kind: "chat",
			profile: "recursive-context-agent",
			runtimeBinding: { runtimeInstanceId: "codex-native", adapterId: "codex", nativeSessionId: "parent-native", state: "bound" },
		});
		const child = sessions.create({
			id: "ps_context_child",
			channel: "pibo.subagents",
			kind: "subagent",
			profile: "recursive-context-agent",
			parentId: parent.id,
			runtimeBinding: { runtimeInstanceId: "codex-native", adapterId: "codex", nativeSessionId: "child-native", state: "bound" },
		});
		const response = await fetch(`${baseURL}/api/chat/context-build?piboSessionId=${encodeURIComponent(child.id)}`, {
			headers: { "x-test-user": "user-1" },
		});
		assert.equal(response.status, 200);
		const payload = await response.json();
		const manifest = payload.snapshot.nodes.find((node) => node.id === "runtime-manifest");
		assert.deepEqual(manifest.payloadJson.delegatedAgents, []);
		assert.equal(manifest.payloadJson.contextFilePaths.includes("pibo://runtime/delegated-agents.md"), false);
		assert.equal(validatedProfile.sessionId, "child-native");
		assert.equal(validatedProfile.parentSessionId, "parent-native");
		assert.deepEqual(validatedProfile.subagents, []);
	} finally {
		await channel.stop?.();
	}
});

test("chat web app exposes custom agents across authenticated accounts", async () => {
	const { channel, baseURL, sessions } = await startWebHostChannel({
		auth: createFakeAuthService(),
		profiles: [{ name: "base", aliases: ["default"] }],
	});

	try {
		const createdAgent = await fetch(`${baseURL}/api/chat/agents`, {
			method: "POST",
			headers: {
				"content-type": "application/json",
				origin: baseURL,
				"x-test-user": "account-a",
			},
			body: JSON.stringify({
				displayName: "cross-account-agent",
				description: "Created by account A.",
				skills: ["pi-agent-harness"],
			}),
		});
		assert.equal(createdAgent.status, 201);
		const createdPayload = await createdAgent.json();
		assert.equal(retiredPartitionField in createdPayload.agent, false);

		const listedByAccountB = await fetch(`${baseURL}/api/chat/agents`, {
			headers: { "x-test-user": "account-b" },
		});
		assert.equal(listedByAccountB.status, 200);
		const listedByAccountBPayload = await listedByAccountB.json();
		assert.deepEqual(listedByAccountBPayload.agents.map((agent) => agent.profileName), ["cross-account-agent"]);

		const accountBSession = await fetch(`${baseURL}/api/chat/sessions`, {
			method: "POST",
			headers: {
				"content-type": "application/json",
				origin: baseURL,
				"x-test-user": "account-b",
			},
			body: JSON.stringify({ profile: "cross-account-agent" }),
		});
		assert.equal(accountBSession.status, 201);
		const accountBSessionPayload = await accountBSession.json();
		assert.equal(accountBSessionPayload.session.profile, "cross-account-agent");

		const updatedByAccountB = await fetch(`${baseURL}/api/chat/agents/${encodeURIComponent(createdPayload.agent.id)}`, {
			method: "PATCH",
			headers: {
				"content-type": "application/json",
				origin: baseURL,
				"x-test-user": "account-b",
			},
			body: JSON.stringify({ description: "Updated by account B." }),
		});
		assert.equal(updatedByAccountB.status, 200);
		const updatedByAccountBPayload = await updatedByAccountB.json();
		assert.equal(updatedByAccountBPayload.agent.description, "Updated by account B.");

		const archivedByAccountB = await fetch(`${baseURL}/api/chat/agents/${encodeURIComponent(createdPayload.agent.id)}`, {
			method: "PATCH",
			headers: {
				"content-type": "application/json",
				origin: baseURL,
				"x-test-user": "account-b",
			},
			body: JSON.stringify({ archived: true }),
		});
		assert.equal(archivedByAccountB.status, 200);
		assert.equal(typeof (await archivedByAccountB.json()).agent.archivedAt, "string");

		const restoredByAccountA = await fetch(`${baseURL}/api/chat/agents/${encodeURIComponent(createdPayload.agent.id)}`, {
			method: "PATCH",
			headers: {
				"content-type": "application/json",
				origin: baseURL,
				"x-test-user": "account-a",
			},
			body: JSON.stringify({ archived: false }),
		});
		assert.equal(restoredByAccountA.status, 200);
		assert.equal((await restoredByAccountA.json()).agent.archivedAt, undefined);

		await fetch(`${baseURL}/api/chat/agents/${encodeURIComponent(createdPayload.agent.id)}`, {
			method: "PATCH",
			headers: {
				"content-type": "application/json",
				origin: baseURL,
				"x-test-user": "account-b",
			},
			body: JSON.stringify({ archived: true }),
		});

		const deletedByAccountB = await fetch(`${baseURL}/api/chat/agents/${encodeURIComponent(createdPayload.agent.id)}`, {
			method: "DELETE",
			headers: {
				"content-type": "application/json",
				origin: baseURL,
				"x-test-user": "account-b",
			},
			body: JSON.stringify({ confirmName: "cross-account-agent" }),
		});
		assert.equal(deletedByAccountB.status, 200);
		const deletedByAccountBPayload = await deletedByAccountB.json();
		assert.equal(deletedByAccountBPayload.deletedAgentId, createdPayload.agent.id);
		assert.deepEqual(deletedByAccountBPayload.deletedSessionIds, [accountBSessionPayload.session.id]);
		assert.equal(sessions.get(accountBSessionPayload.session.id), undefined);
	} finally {
		await channel.stop?.();
	}
});

test("chat web app deletes renamed custom agents with their session subtrees", async () => {
	const { channel, baseURL, sessions } = await startWebHostChannel({
		auth: createFakeAuthService(),
		profiles: [{ name: "base", aliases: ["default"] }],
	});

	try {
		const createdAgent = await fetch(`${baseURL}/api/chat/agents`, {
			method: "POST",
			headers: {
				"content-type": "application/json",
				origin: baseURL,
				"x-test-user": "user-1",
			},
			body: JSON.stringify({
				displayName: "disposable-agent",
				description: "Will be archived and deleted.",
				skills: ["pi-agent-harness"],
			}),
		});
		assert.equal(createdAgent.status, 201);
		const createdPayload = await createdAgent.json();
		assert.equal(createdPayload.agent.profileName, "disposable-agent");

		const renamedAgent = await fetch(`${baseURL}/api/chat/agents/${encodeURIComponent(createdPayload.agent.id)}`, {
			method: "PATCH",
			headers: {
				"content-type": "application/json",
				origin: baseURL,
				"x-test-user": "user-1",
			},
			body: JSON.stringify({ displayName: "renamed-agent" }),
		});
		assert.equal(renamedAgent.status, 200);
		const renamedPayload = await renamedAgent.json();
		assert.equal(renamedPayload.agent.profileName, "renamed-agent");

		const oldProfileSession = await fetch(`${baseURL}/api/chat/sessions`, {
			method: "POST",
			headers: {
				"content-type": "application/json",
				origin: baseURL,
				"x-test-user": "user-1",
			},
			body: JSON.stringify({ profile: "disposable-agent" }),
		});
		assert.equal(oldProfileSession.status, 201);
		const oldProfileSessionPayload = await oldProfileSession.json();
		assert.equal(oldProfileSessionPayload.session.profile, "renamed-agent");
		const orphanedOldProfileSession = sessions.create({
			channel: "pibo.chat",
			kind: "chat",
			profile: "disposable-agent",
		});

		const sessionResponse = await fetch(`${baseURL}/api/chat/sessions`, {
			method: "POST",
			headers: {
				"content-type": "application/json",
				origin: baseURL,
				"x-test-user": "user-1",
			},
			body: JSON.stringify({ profile: "renamed-agent" }),
		});
		assert.equal(sessionResponse.status, 201);
		const sessionPayload = await sessionResponse.json();
		assert.equal(sessionPayload.session.profile, "renamed-agent");
		const child = sessions.create({
			channel: "pibo.subagents",
			kind: "subagent",
			profile: "renamed-agent",
			parentId: sessionPayload.session.id,
		});

		const archivedAgent = await fetch(`${baseURL}/api/chat/agents/${encodeURIComponent(createdPayload.agent.id)}`, {
			method: "PATCH",
			headers: {
				"content-type": "application/json",
				origin: baseURL,
				"x-test-user": "user-1",
			},
			body: JSON.stringify({ archived: true }),
		});
		assert.equal(archivedAgent.status, 200);
		const archivedPayload = await archivedAgent.json();
		assert.equal(typeof archivedPayload.agent.archivedAt, "string");

		const deletedAgent = await fetch(`${baseURL}/api/chat/agents/${encodeURIComponent(createdPayload.agent.id)}`, {
			method: "DELETE",
			headers: {
				"content-type": "application/json",
				origin: baseURL,
				"x-test-user": "user-1",
			},
			body: JSON.stringify({ confirmName: "renamed-agent" }),
		});
		assert.equal(deletedAgent.status, 200);
		const deletedPayload = await deletedAgent.json();
		assert.equal(deletedPayload.deletedAgentId, createdPayload.agent.id);
		assert.deepEqual(new Set(deletedPayload.deletedSessionIds), new Set([oldProfileSessionPayload.session.id, orphanedOldProfileSession.id, sessionPayload.session.id, child.id]));
		assert.equal(sessions.get(oldProfileSessionPayload.session.id), undefined);
		assert.equal(sessions.get(orphanedOldProfileSession.id), undefined);
		assert.equal(sessions.get(sessionPayload.session.id), undefined);
		assert.equal(sessions.get(child.id), undefined);

		const listed = await fetch(`${baseURL}/api/chat/agents?includeArchived=true`, {
			headers: { "x-test-user": "user-1" },
		});
		assert.equal(listed.status, 200);
		const listedPayload = await listed.json();
		assert.deepEqual(listedPayload.agents, []);
	} finally {
		await channel.stop?.();
	}
});

test("workflow profile picker excludes archived custom agents and reports archived refs", async () => {
	const { channel, baseURL } = await startWebHostChannel({
		auth: createFakeAuthService(),
		profiles: [{ name: "base", aliases: ["default"], description: "Global Pibo agent" }],
	});

	try {
		const createdAgent = await fetch(`${baseURL}/api/chat/agents`, {
			method: "POST",
			headers: {
				"content-type": "application/json",
				origin: baseURL,
				"x-test-user": "user-1",
			},
			body: JSON.stringify({
				displayName: "workflow-reviewer",
				description: "Reviews workflow drafts.",
				nativeTools: ["web_search"],
				skills: ["pi-agent-harness"],
			}),
		});
		assert.equal(createdAgent.status, 201);
		const createdPayload = await createdAgent.json();

		const archivedAgent = await fetch(`${baseURL}/api/chat/agents/${encodeURIComponent(createdPayload.agent.id)}`, {
			method: "PATCH",
			headers: {
				"content-type": "application/json",
				origin: baseURL,
				"x-test-user": "user-1",
			},
			body: JSON.stringify({ archived: true }),
		});
		assert.equal(archivedAgent.status, 200);

		const picker = await fetch(`${baseURL}/api/chat/workflows/pickers/profiles`, {
			headers: { "x-test-user": "user-1" },
		});
		assert.equal(picker.status, 200);
		const pickerPayload = await picker.json();
		assert.deepEqual(pickerPayload.options.map((option) => option.id), ["base"]);
		assert.equal(pickerPayload.options[0].source, "global");
		assert.equal(pickerPayload.options[0].paramsSchema, null);
		assert.deepEqual(pickerPayload.options[0].aliases, ["default"]);

		const selectedArchived = await fetch(`${baseURL}/api/chat/workflows/pickers/profiles?selectedProfileId=workflow-reviewer`, {
			headers: { "x-test-user": "user-1" },
		});
		assert.equal(selectedArchived.status, 200);
		const selectedPayload = await selectedArchived.json();
		assert.equal(selectedPayload.selectedProfileId, undefined);
		assert.equal(selectedPayload.diagnostics[0].code, "WorkflowGraphError.archivedAgentProfileRef");
		assert.equal(selectedPayload.diagnostics[0].registryRef, "workflow-reviewer");
	} finally {
		await channel.stop?.();
	}
});

test("workflow handler picker lists registered handlers and reports missing refs", async () => {
	const { channel, baseURL } = await startWebHostChannel({
		auth: createFakeAuthService(),
		profiles: [{ name: "base", aliases: ["default"] }],
	});

	try {
		const picker = await fetch(`${baseURL}/api/chat/workflows/pickers/handlers`, {
			headers: { "x-test-user": "user-1" },
		});
		assert.equal(picker.status, 200);
		const pickerPayload = await picker.json();
		assert.equal(pickerPayload.kind, "handlers");
		assert.deepEqual(pickerPayload.options.map((option) => option.id), [
			"fixture.handlers.makePlan",
			"fixture.handlers.reviseDraft",
			"fixture.handlers.summarizeDecision",
		]);
		assert.equal(pickerPayload.options[0].displayName, "Make plan");
		assert.equal(Object.hasOwn(pickerPayload.options[0], "paramsSchema"), true);
		assert.equal(Object.hasOwn(pickerPayload.options[0], "inputSchema"), true);
		assert.equal(Object.hasOwn(pickerPayload.options[0], "outputSchema"), true);
		assert.equal(pickerPayload.options[0].paramsSchema, null);
		assert.equal(pickerPayload.options[0].inputSchema, null);
		assert.equal(pickerPayload.options[0].outputSchema, null);

		const selectedHandler = await fetch(`${baseURL}/api/chat/workflows/pickers/handlers?selectedHandlerId=fixture.handlers.makePlan`, {
			headers: { "x-test-user": "user-1" },
		});
		assert.equal(selectedHandler.status, 200);
		const selectedPayload = await selectedHandler.json();
		assert.equal(selectedPayload.selectedHandlerId, "fixture.handlers.makePlan");
		assert.deepEqual(selectedPayload.diagnostics, []);

		const missingHandler = await fetch(`${baseURL}/api/chat/workflows/pickers/handlers?selectedHandlerId=missing.handlers.inline`, {
			headers: { "x-test-user": "user-1" },
		});
		assert.equal(missingHandler.status, 200);
		const missingPayload = await missingHandler.json();
		assert.equal(missingPayload.selectedHandlerId, undefined);
		assert.equal(missingPayload.diagnostics[0].code, "WorkflowGraphError.unknownHandlerRef");
		assert.equal(missingPayload.diagnostics[0].registryRef, "missing.handlers.inline");
		assert.equal(missingPayload.diagnostics[0].path, "$.nodes.code.handler");
	} finally {
		await channel.stop?.();
	}
});

test("workflow guard and adapter pickers list registered refs and report missing refs", async () => {
	const { channel, baseURL } = await startWebHostChannel({
		auth: createFakeAuthService(),
		profiles: [{ name: "base", aliases: ["default"] }],
	});

	try {
		const guardPicker = await fetch(`${baseURL}/api/chat/workflows/pickers/guards`, {
			headers: { "x-test-user": "user-1" },
		});
		assert.equal(guardPicker.status, 200);
		const guardPayload = await guardPicker.json();
		assert.equal(guardPayload.kind, "guards");
		assert.deepEqual(guardPayload.options.map((option) => option.id), [
			"fixture.guards.approved",
			"fixture.guards.needsRevision",
		]);
		const approvedGuard = guardPayload.options.find((option) => option.id === "fixture.guards.approved");
		assert.equal(approvedGuard.paramsSchema.type, "object");
		assert.deepEqual(approvedGuard.paramsSchema.required, ["expected"]);
		const revisionGuard = guardPayload.options.find((option) => option.id === "fixture.guards.needsRevision");
		assert.equal(revisionGuard.paramsSchema, null);

		const selectedGuard = await fetch(`${baseURL}/api/chat/workflows/pickers/guards?selectedRefId=fixture.guards.approved`, {
			headers: { "x-test-user": "user-1" },
		});
		assert.equal(selectedGuard.status, 200);
		const selectedGuardPayload = await selectedGuard.json();
		assert.equal(selectedGuardPayload.selectedRefId, "fixture.guards.approved");
		assert.deepEqual(selectedGuardPayload.diagnostics, []);

		const missingGuard = await fetch(`${baseURL}/api/chat/workflows/pickers/guards?selectedRefId=missing.guards.inline`, {
			headers: { "x-test-user": "user-1" },
		});
		assert.equal(missingGuard.status, 200);
		const missingGuardPayload = await missingGuard.json();
		assert.equal(missingGuardPayload.selectedRefId, undefined);
		assert.equal(missingGuardPayload.diagnostics[0].code, "WorkflowGraphError.unknownGuardRef");
		assert.equal(missingGuardPayload.diagnostics[0].registryRef, "missing.guards.inline");

		const adapterPicker = await fetch(`${baseURL}/api/chat/workflows/pickers/adapters`, {
			headers: { "x-test-user": "user-1" },
		});
		assert.equal(adapterPicker.status, 200);
		const adapterPayload = await adapterPicker.json();
		assert.equal(adapterPayload.kind, "adapters");
		assert.deepEqual(adapterPayload.options.map((option) => option.id), [
			"fixture.adapters.draftToSummary",
			"fixture.adapters.textToTopic",
		]);
		const summaryAdapter = adapterPayload.options.find((option) => option.id === "fixture.adapters.draftToSummary");
		assert.equal(summaryAdapter.paramsSchema.type, "object");
		assert.deepEqual(summaryAdapter.paramsSchema.required, ["format"]);
		const topicAdapter = adapterPayload.options.find((option) => option.id === "fixture.adapters.textToTopic");
		assert.equal(topicAdapter.paramsSchema, null);

		const missingAdapter = await fetch(`${baseURL}/api/chat/workflows/pickers/adapters?selectedRefId=missing.adapters.inline`, {
			headers: { "x-test-user": "user-1" },
		});
		assert.equal(missingAdapter.status, 200);
		const missingAdapterPayload = await missingAdapter.json();
		assert.equal(missingAdapterPayload.selectedRefId, undefined);
		assert.equal(missingAdapterPayload.diagnostics[0].code, "WorkflowGraphError.unknownAdapterRef");
		assert.equal(missingAdapterPayload.diagnostics[0].registryRef, "missing.adapters.inline");
	} finally {
		await channel.stop?.();
	}
});

test("workflow human action and prompt asset pickers list registered refs and report missing refs", async () => {
	const { channel, baseURL } = await startWebHostChannel({
		auth: createFakeAuthService(),
		profiles: [{ name: "base", aliases: ["default"] }],
	});

	try {
		const humanActionPicker = await fetch(`${baseURL}/api/chat/workflows/pickers/human-actions`, {
			headers: { "x-test-user": "user-1" },
		});
		assert.equal(humanActionPicker.status, 200);
		const humanActionPayload = await humanActionPicker.json();
		assert.equal(humanActionPayload.kind, "human-actions");
		assert.deepEqual(humanActionPayload.options.map((option) => option.id), [
			"fixture.humanActions.approve",
			"fixture.humanActions.cancel",
			"fixture.humanActions.reject",
			"fixture.humanActions.resume",
		]);
		assert.equal(humanActionPayload.options[0].displayName, "Approve");
		assert.equal(humanActionPayload.options[0].kind, "approve");
		assert.equal(humanActionPayload.options[0].paramsSchema, null);

		const selectedAction = await fetch(`${baseURL}/api/chat/workflows/pickers/human-actions?selectedRefId=fixture.humanActions.approve`, {
			headers: { "x-test-user": "user-1" },
		});
		assert.equal(selectedAction.status, 200);
		const selectedActionPayload = await selectedAction.json();
		assert.equal(selectedActionPayload.selectedRefId, "fixture.humanActions.approve");
		assert.deepEqual(selectedActionPayload.diagnostics, []);

		const missingAction = await fetch(`${baseURL}/api/chat/workflows/pickers/human-actions?selectedRefId=missing.humanActions.inline`, {
			headers: { "x-test-user": "user-1" },
		});
		assert.equal(missingAction.status, 200);
		const missingActionPayload = await missingAction.json();
		assert.equal(missingActionPayload.selectedRefId, undefined);
		assert.equal(missingActionPayload.diagnostics[0].code, "WorkflowGraphError.unknownHumanActionRef");
		assert.equal(missingActionPayload.diagnostics[0].registryRef, "missing.humanActions.inline");
		assert.equal(missingActionPayload.diagnostics[0].path, "$.nodes.human.actions.0.id");

		const promptAssetPicker = await fetch(`${baseURL}/api/chat/workflows/pickers/prompt-assets`, {
			headers: { "x-test-user": "user-1" },
		});
		assert.equal(promptAssetPicker.status, 200);
		const promptAssetPayload = await promptAssetPicker.json();
		assert.equal(promptAssetPayload.kind, "prompt-assets");
		assert.deepEqual(promptAssetPayload.options.map((option) => option.id), ["fixture.promptBuilders.draftPrompt"]);
		assert.equal(promptAssetPayload.options[0].displayName, "Draft prompt builder");
		assert.equal(promptAssetPayload.options[0].paramsSchema, null);

		const selectedPromptAsset = await fetch(`${baseURL}/api/chat/workflows/pickers/prompt-assets?selectedRefId=fixture.promptBuilders.draftPrompt`, {
			headers: { "x-test-user": "user-1" },
		});
		assert.equal(selectedPromptAsset.status, 200);
		const selectedPromptAssetPayload = await selectedPromptAsset.json();
		assert.equal(selectedPromptAssetPayload.selectedRefId, "fixture.promptBuilders.draftPrompt");
		assert.deepEqual(selectedPromptAssetPayload.diagnostics, []);

		const missingPromptAsset = await fetch(`${baseURL}/api/chat/workflows/pickers/prompt-assets?selectedRefId=missing.promptAssets.inline`, {
			headers: { "x-test-user": "user-1" },
		});
		assert.equal(missingPromptAsset.status, 200);
		const missingPromptAssetPayload = await missingPromptAsset.json();
		assert.equal(missingPromptAssetPayload.selectedRefId, undefined);
		assert.equal(missingPromptAssetPayload.diagnostics[0].code, "WorkflowGraphError.unknownPromptBuilderRef");
		assert.equal(missingPromptAssetPayload.diagnostics[0].registryRef, "missing.promptAssets.inline");
		assert.equal(missingPromptAssetPayload.diagnostics[0].path, "$.nodes.agent.promptBuilder.id");
	} finally {
		await channel.stop?.();
	}
});

test("workflow version picker lists published nested workflow refs and reports missing refs", async () => {
	const { channel, baseURL } = await startWebHostChannel({
		auth: createFakeAuthService(),
		profiles: [{ name: "base", aliases: ["default"] }],
	});

	try {
		const picker = await fetch(`${baseURL}/api/chat/workflows/pickers/workflow-versions`, {
			headers: { "x-test-user": "user-1" },
		});
		assert.equal(picker.status, 200);
		const pickerPayload = await picker.json();
		assert.equal(pickerPayload.kind, "workflow-versions");
		assert.deepEqual(pickerPayload.options.map((option) => `${option.id}@${option.version}`), [
			"standard-workflow@1.0.0",
			"simple-chat@1.0.0",
			"ui-review-workflow@2.0.0",
		]);
		assert.equal(pickerPayload.options[0].displayName, "Standard Workflow");
		assert.equal(pickerPayload.options[0].paramsSchema, null);
		assert.equal(pickerPayload.options.some((option) => option.status !== "published"), false);

		const selectedWorkflow = await fetch(`${baseURL}/api/chat/workflows/pickers/workflow-versions?selectedWorkflowId=standard-workflow&selectedWorkflowVersion=1.0.0`, {
			headers: { "x-test-user": "user-1" },
		});
		assert.equal(selectedWorkflow.status, 200);
		const selectedPayload = await selectedWorkflow.json();
		assert.equal(selectedPayload.selectedWorkflowId, "standard-workflow");
		assert.equal(selectedPayload.selectedWorkflowVersion, "1.0.0");
		assert.deepEqual(selectedPayload.diagnostics, []);

		const missingWorkflow = await fetch(`${baseURL}/api/chat/workflows/pickers/workflow-versions?selectedWorkflowId=missing-workflow&selectedWorkflowVersion=9.9.9`, {
			headers: { "x-test-user": "user-1" },
		});
		assert.equal(missingWorkflow.status, 200);
		const missingPayload = await missingWorkflow.json();
		assert.equal(missingPayload.selectedWorkflowId, undefined);
		assert.equal(missingPayload.selectedWorkflowVersion, undefined);
		assert.equal(missingPayload.diagnostics[0].code, "WorkflowCatalogError.unknownWorkflowVersion");
		assert.equal(missingPayload.diagnostics[0].registryRef, "missing-workflow@9.9.9");
		assert.equal(missingPayload.diagnostics[0].path, "$.workflow");

		const history = await fetch(`${baseURL}/api/chat/workflows/pickers/version-history`, {
			headers: { "x-test-user": "user-1" },
		});
		assert.equal(history.status, 200);
		const historyPayload = await history.json();
		assert.equal(historyPayload.kind, "version-history");
		assert.deepEqual(historyPayload.options.map((option) => `${option.id}@${option.version}:${option.status}`), [
			"archived-review-workflow@1.0.0:archived",
			"simple-chat@1.0.0:published",
			"standard-workflow@1.0.0:published",
			"ui-draft-workflow@0.1.0-draft:draft",
			"ui-review-workflow@2.0.0:published",
		]);
		const historyByKey = new Map(historyPayload.options.map((option) => [`${option.id}@${option.version}`, option]));
		const codeHistoryRow = historyByKey.get("standard-workflow@1.0.0");
		assert.ok(codeHistoryRow);
		assert.deepEqual(codeHistoryRow.actions, ["view", "duplicate", "create_workflow_session", "version_history"]);
		assert.equal(codeHistoryRow.editability.canPublish, false);
		const draftHistoryRow = historyByKey.get("ui-draft-workflow@0.1.0-draft");
		assert.ok(draftHistoryRow);
		assert.deepEqual(draftHistoryRow.actions, ["view", "edit_draft", "validate", "publish", "archive", "delete"]);
		const uiPublishedHistoryRow = historyByKey.get("ui-review-workflow@2.0.0");
		assert.ok(uiPublishedHistoryRow);
		assert.deepEqual(uiPublishedHistoryRow.actions, ["view", "duplicate", "create_workflow_session", "version_history", "create_next_draft", "archive", "delete"]);

		const archivedHistory = await fetch(`${baseURL}/api/chat/workflows/pickers/version-history?selectedWorkflowId=archived-review-workflow&selectedWorkflowVersion=1.0.0`, {
			headers: { "x-test-user": "user-1" },
		});
		assert.equal(archivedHistory.status, 200);
		const archivedHistoryPayload = await archivedHistory.json();
		assert.equal(archivedHistoryPayload.selectedWorkflowId, "archived-review-workflow");
		assert.equal(archivedHistoryPayload.selectedWorkflowVersion, "1.0.0");
		assert.equal(archivedHistoryPayload.diagnostics.length, 0);
	} finally {
		await channel.stop?.();
	}
});

test("workflow catalog authentication and permission baseline treats UI workflows as global", async () => {
	const { channel, baseURL } = await startWebHostChannel({
		auth: createFakeAuthService(),
		profiles: [{ name: "base", aliases: ["default"] }],
	});

	const userOneHeaders = {
		"content-type": "application/json",
		origin: baseURL,
		"x-test-user": "user-1",
	};
	const userTwoHeaders = {
		"content-type": "application/json",
		origin: baseURL,
		"x-test-user": "user-2",
	};

	try {
		const unauthenticatedCatalog = await fetch(`${baseURL}/api/chat/workflows`);
		assert.equal(unauthenticatedCatalog.status, 401);

		const unauthenticatedPicker = await fetch(`${baseURL}/api/chat/workflows/pickers/workflow-versions`);
		assert.equal(unauthenticatedPicker.status, 401);

		const createResponse = await fetch(`${baseURL}/api/chat/workflows`, {
			method: "POST",
			headers: userOneHeaders,
			body: JSON.stringify({
				workflowId: "ui-global-permission-draft",
				title: "Global Permission Draft",
				description: "Created by one authenticated user and editable by another.",
				tags: ["global", "permissions"],
			}),
		});
		assert.equal(createResponse.status, 201);
		const createPayload = await createResponse.json();
		const draftId = createPayload.draft.draftId;

		const userTwoCatalog = await fetch(`${baseURL}/api/chat/workflows`, {
			headers: { "x-test-user": "user-2" },
		});
		assert.equal(userTwoCatalog.status, 200);
		const userTwoCatalogPayload = await userTwoCatalog.json();
		const globalDraft = userTwoCatalogPayload.workflows.find((workflow) => workflow.id === "ui-global-permission-draft");
		assert.ok(globalDraft);
		assert.equal(globalDraft.source, "ui");
		assert.equal(globalDraft.status, "draft");
		assert.equal(globalDraft.activeDraftId, draftId);
		assert.equal(globalDraft.editability.canEditDraft, true);
		assert.equal(globalDraft.editability.canPublish, true);

		const userTwoDraftResponse = await fetch(`${baseURL}/api/chat/workflows/drafts/${encodeURIComponent(draftId)}`, {
			headers: { "x-test-user": "user-2" },
		});
		assert.equal(userTwoDraftResponse.status, 200);
		const userTwoDraftPayload = await userTwoDraftResponse.json();
		assert.equal(userTwoDraftPayload.draft.workflowId, "ui-global-permission-draft");

		const runnableDefinition = {
			id: "ui-global-permission-draft",
			version: "0.1.0",
			title: "Global Permission Draft",
			description: "Created by one authenticated user and editable by another.",
			metadata: { tags: ["global", "permissions"] },
			input: { kind: "text", description: "Input for the global permission workflow." },
			output: { kind: "text", description: "Output from the global permission workflow." },
			initial: "agent",
			nodes: {
				agent: {
					kind: "agent",
					runtime: "pibo",
					profile: { kind: "fixed", id: "base" },
					promptTemplate: "Answer with the workflow input.\n\n{{input}}",
					output: { kind: "text" },
				},
			},
			edges: {},
			ui: { layout: "auto", positions: { agent: { x: 80, y: 80 } } },
		};

		const userTwoPatch = await fetch(`${baseURL}/api/chat/workflows/drafts/${encodeURIComponent(draftId)}`, {
			method: "PATCH",
			headers: userTwoHeaders,
			body: JSON.stringify({ definition: runnableDefinition, editTrigger: "graph_edit" }),
		});
		assert.equal(userTwoPatch.status, 200);
		const userTwoPatchPayload = await userTwoPatch.json();
		assert.equal(userTwoPatchPayload.validation.ok, true);

		const userTwoPublish = await fetch(`${baseURL}/api/chat/workflows/drafts/${encodeURIComponent(draftId)}/publish`, {
			method: "POST",
			headers: userTwoHeaders,
			body: JSON.stringify({ versionIntent: "patch" }),
		});
		assert.equal(userTwoPublish.status, 201);
		const userTwoPublishPayload = await userTwoPublish.json();
		assert.equal(userTwoPublishPayload.publishedVersion.workflowId, "ui-global-permission-draft");
		assert.equal(userTwoPublishPayload.publishedVersion.version, "0.1.1");
		assert.equal(userTwoPublishPayload.publishedVersion.publishedBy, "user-2");

		const userOneVersion = await fetch(`${baseURL}/api/chat/workflows/ui-global-permission-draft/versions/0.1.1`, {
			headers: { "x-test-user": "user-1" },
		});
		assert.equal(userOneVersion.status, 200);
		const userOneVersionPayload = await userOneVersion.json();
		assert.equal(userOneVersionPayload.version.source, "ui");
		assert.equal(userOneVersionPayload.version.status, "published");

		const userOneDuplicate = await fetch(`${baseURL}/api/chat/workflows/ui-global-permission-draft/duplicate`, {
			method: "POST",
			headers: userOneHeaders,
			body: JSON.stringify({ version: "0.1.1" }),
		});
		assert.equal(userOneDuplicate.status, 201);
		const userOneDuplicatePayload = await userOneDuplicate.json();
		assert.equal(userOneDuplicatePayload.draft.baseWorkflowId, "ui-global-permission-draft");
		assert.equal(userOneDuplicatePayload.draft.baseWorkflowVersion, "0.1.1");

		const unauthenticatedInspect = await fetch(`${baseURL}/api/chat/workflows/ui-global-permission-draft?version=0.1.1`);
		assert.equal(unauthenticatedInspect.status, 401);

		const codeDeleteResponse = await fetch(`${baseURL}/api/chat/workflows/standard-workflow`, {
			method: "DELETE",
			headers: userTwoHeaders,
			body: JSON.stringify({ confirmWorkflowId: "standard-workflow" }),
		});
		assert.equal(codeDeleteResponse.status, 409);
		assert.match((await codeDeleteResponse.json()).error, /Code workflow projections are read-only/);
	} finally {
		await channel.stop?.();
	}
});

test("workflow catalog list and inspect APIs expose source/status, diagnostics, and archive filtering", async () => {
	const { channel, baseURL } = await startWebHostChannel({
		auth: createFakeAuthService(),
		profiles: [{ name: "base", aliases: ["default"] }],
	});

	const jsonHeaders = {
		"content-type": "application/json",
		origin: baseURL,
		"x-test-user": "user-1",
	};

	try {
		const catalogResponse = await fetch(`${baseURL}/api/chat/workflows`, {
			headers: { "x-test-user": "user-1" },
		});
		assert.equal(catalogResponse.status, 200);
		const catalogPayload = await catalogResponse.json();
		assert.equal(catalogPayload.kind, "workflow-catalog");
		assert.equal(catalogPayload.includeArchived, false);
		assert.deepEqual(catalogPayload.workflows.map((workflow) => `${workflow.id}:${workflow.source}:${workflow.status}`), [
			"simple-chat:code:published",
			"standard-workflow:code:published",
			"ui-review-workflow:ui:published",
		]);

		const standardWorkflow = catalogPayload.workflows.find((workflow) => workflow.id === "standard-workflow");
		assert.ok(standardWorkflow);
		assert.equal(standardWorkflow.title, "Standard Workflow");
		assert.deepEqual(standardWorkflow.tags, ["session", "workflow"]);
		assert.equal(standardWorkflow.versions[0].version, "1.0.0");
		assert.equal(standardWorkflow.versions[0].definitionHash.startsWith("sha256:"), true);
		assert.equal(standardWorkflow.validationState, "valid");
		assert.deepEqual(standardWorkflow.missingRefs, []);
		assert.equal(standardWorkflow.editability.canDuplicate, true);
		assert.equal(standardWorkflow.editability.canEditDraft, false);
		assert.ok(standardWorkflow.actions.includes("view"));
		assert.ok(standardWorkflow.actions.includes("duplicate"));
		assert.ok(standardWorkflow.actions.includes("create_workflow_session"));
		assert.ok(standardWorkflow.actions.includes("version_history"));
		assert.equal(standardWorkflow.actions.includes("edit_draft"), false);
		assert.equal(standardWorkflow.actions.includes("publish"), false);
		assert.equal(standardWorkflow.actions.includes("archive"), false);
		assert.equal(standardWorkflow.actions.includes("delete"), false);
		const uiPublishedWorkflow = catalogPayload.workflows.find((workflow) => workflow.id === "ui-review-workflow");
		assert.ok(uiPublishedWorkflow);
		assert.equal(uiPublishedWorkflow.source, "ui");
		assert.equal(uiPublishedWorkflow.status, "published");
		for (const action of ["view", "duplicate", "version_history", "create_next_draft", "create_workflow_session", "archive", "delete"]) {
			assert.ok(uiPublishedWorkflow.actions.includes(action));
		}
		assert.equal(uiPublishedWorkflow.actions.includes("edit_draft"), false);
		assert.equal(uiPublishedWorkflow.actions.includes("publish"), false);
		assert.equal(catalogPayload.workflows.some((workflow) => workflow.id === "archived-review-workflow"), false);

		const archivedResponse = await fetch(`${baseURL}/api/chat/workflows?includeArchived=true`, {
			headers: { "x-test-user": "user-1" },
		});
		assert.equal(archivedResponse.status, 200);
		const archivedPayload = await archivedResponse.json();
		const archivedWorkflow = archivedPayload.workflows.find((workflow) => workflow.id === "archived-review-workflow");
		assert.ok(archivedWorkflow);
		assert.equal(archivedWorkflow.status, "archived");
		assert.equal(archivedWorkflow.editability.canDuplicate, false);

		const duplicateResponse = await fetch(`${baseURL}/api/chat/workflows/standard-workflow/duplicate`, {
			method: "POST",
			headers: jsonHeaders,
			body: JSON.stringify({ version: "1.0.0" }),
		});
		assert.equal(duplicateResponse.status, 201);
		const duplicatePayload = await duplicateResponse.json();
		const invalidDefinition = structuredClone(duplicatePayload.draft.definition);
		invalidDefinition.nodes.agent.profile.id = "missing-catalog-profile";
		const invalidPatchResponse = await fetch(`${baseURL}/api/chat/workflows/drafts/${encodeURIComponent(duplicatePayload.draft.draftId)}`, {
			method: "PATCH",
			headers: jsonHeaders,
			body: JSON.stringify({ definition: invalidDefinition, editTrigger: "node_edit" }),
		});
		assert.equal(invalidPatchResponse.status, 200);

		const catalogAfterDraftResponse = await fetch(`${baseURL}/api/chat/workflows`, {
			headers: { "x-test-user": "user-1" },
		});
		assert.equal(catalogAfterDraftResponse.status, 200);
		const catalogAfterDraftPayload = await catalogAfterDraftResponse.json();
		const copiedWorkflow = catalogAfterDraftPayload.workflows.find((workflow) => workflow.id === "ui-standard-workflow-copy");
		assert.ok(copiedWorkflow);
		assert.equal(copiedWorkflow.source, "ui");
		assert.equal(copiedWorkflow.status, "draft");
		assert.equal(copiedWorkflow.activeDraftId, duplicatePayload.draft.draftId);
		assert.equal(copiedWorkflow.validationState, "error");
		assert.ok(copiedWorkflow.missingRefs.some((diagnostic) => diagnostic.registryRef === "missing-catalog-profile"));
		assert.equal(copiedWorkflow.editability.canEditDraft, true);
		for (const action of ["view", "edit_draft", "validate", "publish", "archive", "delete"]) {
			assert.ok(copiedWorkflow.actions.includes(action));
		}
		assert.equal(copiedWorkflow.actions.includes("duplicate"), false);
		assert.equal(copiedWorkflow.actions.includes("create_workflow_session"), false);

		const inspectDraftResponse = await fetch(`${baseURL}/api/chat/workflows/ui-standard-workflow-copy`, {
			headers: { "x-test-user": "user-1" },
		});
		assert.equal(inspectDraftResponse.status, 200);
		const inspectDraftPayload = await inspectDraftResponse.json();
		assert.equal(inspectDraftPayload.kind, "workflow-inspect");
		assert.equal(inspectDraftPayload.selected.kind, "draft");
		assert.equal(inspectDraftPayload.selected.draft.draftId, duplicatePayload.draft.draftId);
		assert.ok(inspectDraftPayload.diagnostics.some((diagnostic) => diagnostic.registryRef === "missing-catalog-profile"));

		const inspectPublishedResponse = await fetch(`${baseURL}/api/chat/workflows/standard-workflow?version=1.0.0`, {
			headers: { "x-test-user": "user-1" },
		});
		assert.equal(inspectPublishedResponse.status, 200);
		const inspectPublishedPayload = await inspectPublishedResponse.json();
		assert.equal(inspectPublishedPayload.selected.kind, "publishedVersion");
		assert.equal(inspectPublishedPayload.selected.version.id, "standard-workflow");
		assert.equal(inspectPublishedPayload.selected.version.version, "1.0.0");
		assert.equal(inspectPublishedPayload.selected.version.source, "code");
		assert.equal(inspectPublishedPayload.selected.validation.validationState, "valid");
		assert.equal(inspectPublishedPayload.selected.definition.id, "standard-workflow");

		const archivedInspectDefaultResponse = await fetch(`${baseURL}/api/chat/workflows/archived-review-workflow?version=1.0.0`, {
			headers: { "x-test-user": "user-1" },
		});
		assert.equal(archivedInspectDefaultResponse.status, 404);

		const archivedInspectResponse = await fetch(`${baseURL}/api/chat/workflows/archived-review-workflow?version=1.0.0&includeArchived=true`, {
			headers: { "x-test-user": "user-1" },
		});
		assert.equal(archivedInspectResponse.status, 200);
		const archivedInspectPayload = await archivedInspectResponse.json();
		assert.equal(archivedInspectPayload.selected.kind, "publishedVersion");
		assert.equal(archivedInspectPayload.selected.version.status, "archived");
	} finally {
		await channel.stop?.();
	}
});

test("workflow catalog lifecycle APIs create, validate, publish, and expose version resources", async () => {
	const { channel, baseURL } = await startWebHostChannel({
		auth: createFakeAuthService(),
		profiles: [{ name: "base", aliases: ["default"] }],
	});

	const jsonHeaders = {
		"content-type": "application/json",
		origin: baseURL,
		"x-test-user": "user-1",
	};

	try {
		const unauthenticatedCreate = await fetch(`${baseURL}/api/chat/workflows`, {
			method: "POST",
			headers: {
				"content-type": "application/json",
				origin: baseURL,
			},
			body: JSON.stringify({
				workflowId: "ui-lifecycle-api-draft",
				title: "Lifecycle API Draft",
			}),
		});
		assert.equal(unauthenticatedCreate.status, 401);

		const createResponse = await fetch(`${baseURL}/api/chat/workflows`, {
			method: "POST",
			headers: jsonHeaders,
			body: JSON.stringify({
				workflowId: "ui-lifecycle-api-draft",
				title: "Lifecycle API Draft",
				description: "Created through the catalog lifecycle API.",
				tags: ["lifecycle", "api"],
			}),
		});
		assert.equal(createResponse.status, 201);
		const createPayload = await createResponse.json();
		assert.equal(createPayload.draft.workflowId, "ui-lifecycle-api-draft");
		assert.equal(createPayload.draft.source, "ui");
		assert.equal(createPayload.draft.status, "draft");
		assert.equal(createPayload.draft.validationState, "error");
		assert.match(createPayload.builderPath, /^\/apps\/chat\/workflows\/drafts\/draft_ui-lifecycle-api-draft_/);

		const emptyVersionsResponse = await fetch(`${baseURL}/api/chat/workflows/ui-lifecycle-api-draft/versions`, {
			headers: { "x-test-user": "user-1" },
		});
		assert.equal(emptyVersionsResponse.status, 200);
		const emptyVersionsPayload = await emptyVersionsResponse.json();
		assert.equal(emptyVersionsPayload.kind, "workflow-version-list");
		assert.equal(emptyVersionsPayload.workflow.source, "ui");
		assert.equal(emptyVersionsPayload.workflow.status, "draft");
		assert.deepEqual(emptyVersionsPayload.versions, []);

		const runnableDefinition = {
			id: "ui-lifecycle-api-draft",
			version: "0.1.0",
			title: "Lifecycle API Draft",
			description: "Created through the catalog lifecycle API.",
			metadata: { tags: ["api", "lifecycle"] },
			input: { kind: "text", description: "Input for the lifecycle API workflow." },
			output: { kind: "text", description: "Output from the lifecycle API workflow." },
			initial: "agent",
			nodes: {
				agent: {
					kind: "agent",
					runtime: "pibo",
					profile: { kind: "fixed", id: "base" },
					promptTemplate: "Answer with the workflow input.\n\n{{input}}",
					output: { kind: "text" },
				},
			},
			edges: {},
			ui: { layout: "auto", positions: { agent: { x: 80, y: 80 } } },
		};

		const unauthenticatedPatch = await fetch(`${baseURL}/api/chat/workflows/drafts/${encodeURIComponent(createPayload.draft.draftId)}`, {
			method: "PATCH",
			headers: {
				"content-type": "application/json",
				origin: baseURL,
			},
			body: JSON.stringify({ definition: runnableDefinition, editTrigger: "graph_edit" }),
		});
		assert.equal(unauthenticatedPatch.status, 401);

		const patchResponse = await fetch(`${baseURL}/api/chat/workflows/drafts/${encodeURIComponent(createPayload.draft.draftId)}`, {
			method: "PATCH",
			headers: jsonHeaders,
			body: JSON.stringify({ definition: runnableDefinition, editTrigger: "graph_edit" }),
		});
		assert.equal(patchResponse.status, 200);
		const patchPayload = await patchResponse.json();
		assert.equal(patchPayload.validation.ok, true);
		assert.deepEqual(patchPayload.diagnostics.filter((diagnostic) => diagnostic.registryRef), []);

		const validateResponse = await fetch(`${baseURL}/api/chat/workflows/drafts/${encodeURIComponent(createPayload.draft.draftId)}/validate`, {
			method: "POST",
			headers: jsonHeaders,
			body: JSON.stringify({ trigger: "graph_edit" }),
		});
		assert.equal(validateResponse.status, 200);
		const validatePayload = await validateResponse.json();
		assert.equal(validatePayload.validation.ok, true);
		assert.equal(validatePayload.draft.source, "ui");
		assert.equal(validatePayload.draft.status, "draft");

		const unauthenticatedPublish = await fetch(`${baseURL}/api/chat/workflows/drafts/${encodeURIComponent(createPayload.draft.draftId)}/publish`, {
			method: "POST",
			headers: {
				"content-type": "application/json",
				origin: baseURL,
			},
			body: JSON.stringify({ versionIntent: "patch" }),
		});
		assert.equal(unauthenticatedPublish.status, 401);

		const publishResponse = await fetch(`${baseURL}/api/chat/workflows/drafts/${encodeURIComponent(createPayload.draft.draftId)}/publish`, {
			method: "POST",
			headers: jsonHeaders,
			body: JSON.stringify({ versionIntent: "patch" }),
		});
		assert.equal(publishResponse.status, 201);
		const publishPayload = await publishResponse.json();
		assert.equal(publishPayload.publishedVersion.workflowId, "ui-lifecycle-api-draft");
		assert.equal(publishPayload.publishedVersion.source, "ui");
		assert.equal(publishPayload.publishedVersion.status, "published");
		assert.equal(publishPayload.publishedVersion.version, "0.1.1");
		assert.match(publishPayload.publishedVersion.definitionHash, /^sha256:[a-f0-9]{64}$/);

		const versionsResponse = await fetch(`${baseURL}/api/chat/workflows/ui-lifecycle-api-draft/versions`, {
			headers: { "x-test-user": "user-1" },
		});
		assert.equal(versionsResponse.status, 200);
		const versionsPayload = await versionsResponse.json();
		assert.deepEqual(versionsPayload.versions.map((version) => `${version.version}:${version.source}:${version.status}`), ["0.1.1:ui:published"]);
		assert.deepEqual(versionsPayload.versions[0].missingRefs, []);

		const versionInspectResponse = await fetch(`${baseURL}/api/chat/workflows/ui-lifecycle-api-draft/versions/0.1.1`, {
			headers: { "x-test-user": "user-1" },
		});
		assert.equal(versionInspectResponse.status, 200);
		const versionInspectPayload = await versionInspectResponse.json();
		assert.equal(versionInspectPayload.kind, "workflow-version-inspect");
		assert.equal(versionInspectPayload.version.version, "0.1.1");
		assert.equal(versionInspectPayload.version.source, "ui");
		assert.equal(versionInspectPayload.version.status, "published");
		assert.equal(versionInspectPayload.validation.ok, true);
		assert.deepEqual(versionInspectPayload.missingRefs, []);
		assert.equal(versionInspectPayload.definition.id, "ui-lifecycle-api-draft");

		const codeNextDraftResponse = await fetch(`${baseURL}/api/chat/workflows/standard-workflow/drafts`, {
			method: "POST",
			headers: jsonHeaders,
			body: JSON.stringify({ version: "1.0.0" }),
		});
		assert.equal(codeNextDraftResponse.status, 409);
		assert.match((await codeNextDraftResponse.json()).error, /Code workflow projections are read-only/);

		const unauthenticatedArchive = await fetch(`${baseURL}/api/chat/workflows/ui-lifecycle-api-draft/archive`, {
			method: "POST",
			headers: {
				"content-type": "application/json",
				origin: baseURL,
			},
			body: JSON.stringify({ reason: "auth baseline check" }),
		});
		assert.equal(unauthenticatedArchive.status, 401);

		const unauthenticatedDelete = await fetch(`${baseURL}/api/chat/workflows/ui-lifecycle-api-draft`, {
			method: "DELETE",
			headers: {
				"content-type": "application/json",
				origin: baseURL,
			},
			body: JSON.stringify({ confirmWorkflowId: "ui-lifecycle-api-draft" }),
		});
		assert.equal(unauthenticatedDelete.status, 401);

		const archiveResponse = await fetch(`${baseURL}/api/chat/workflows/ui-lifecycle-api-draft/archive`, {
			method: "POST",
			headers: jsonHeaders,
			body: JSON.stringify({ reason: "Lifecycle API coverage complete." }),
		});
		assert.equal(archiveResponse.status, 200);
		const archivePayload = await archiveResponse.json();
		assert.equal(archivePayload.workflow.source, "ui");
		assert.equal(archivePayload.workflow.status, "archived");
		assert.equal(archivePayload.archiveState.archived, true);

		const archivedVersionDefaultResponse = await fetch(`${baseURL}/api/chat/workflows/ui-lifecycle-api-draft/versions/0.1.1`, {
			headers: { "x-test-user": "user-1" },
		});
		assert.equal(archivedVersionDefaultResponse.status, 404);

		const archivedVersionResponse = await fetch(`${baseURL}/api/chat/workflows/ui-lifecycle-api-draft/versions/0.1.1?includeArchived=true`, {
			headers: { "x-test-user": "user-1" },
		});
		assert.equal(archivedVersionResponse.status, 200);
		const archivedVersionPayload = await archivedVersionResponse.json();
		assert.equal(archivedVersionPayload.version.status, "archived");
	} finally {
		await channel.stop?.();
	}
});

test("workflow duplicate-to-draft catalog operation handles code and UI published versions", async () => {
	const { channel, baseURL } = await startWebHostChannel({
		auth: createFakeAuthService(),
		profiles: [{ name: "base", aliases: ["default"] }],
	});

	const jsonHeaders = {
		"content-type": "application/json",
		origin: baseURL,
		"x-test-user": "user-1",
	};

	try {
		const codeDuplicateResponse = await fetch(`${baseURL}/api/chat/workflows/standard-workflow/duplicate`, {
			method: "POST",
			headers: jsonHeaders,
			body: JSON.stringify({ version: "1.0.0" }),
		});
		assert.equal(codeDuplicateResponse.status, 201);
		const codeDuplicatePayload = await codeDuplicateResponse.json();
		assert.equal(codeDuplicatePayload.draft.workflowId, "ui-standard-workflow-copy");
		assert.equal(codeDuplicatePayload.draft.baseWorkflowId, "standard-workflow");
		assert.equal(codeDuplicatePayload.draft.baseWorkflowVersion, "1.0.0");
		assert.match(codeDuplicatePayload.draft.baseDefinitionHash, /^sha256:[a-f0-9]{64}$/);
		assert.equal(codeDuplicatePayload.draft.definition.id, "ui-standard-workflow-copy");
		assert.equal(codeDuplicatePayload.draft.definition.version, "1.0.0-draft");
		assert.equal(codeDuplicatePayload.draft.definition.ui.layout, "auto");
		assert.equal(codeDuplicatePayload.draft.definition.xstate, undefined);

		const codeDuplicateAgainResponse = await fetch(`${baseURL}/api/chat/workflows/standard-workflow/duplicate`, {
			method: "POST",
			headers: jsonHeaders,
			body: JSON.stringify({ version: "1.0.0" }),
		});
		assert.equal(codeDuplicateAgainResponse.status, 201);
		const codeDuplicateAgainPayload = await codeDuplicateAgainResponse.json();
		assert.equal(codeDuplicateAgainPayload.draft.draftId, codeDuplicatePayload.draft.draftId);

		const sourceCodeInspectResponse = await fetch(`${baseURL}/api/chat/workflows/standard-workflow?version=1.0.0`, {
			headers: { "x-test-user": "user-1" },
		});
		assert.equal(sourceCodeInspectResponse.status, 200);
		const sourceCodeInspectPayload = await sourceCodeInspectResponse.json();
		assert.equal(sourceCodeInspectPayload.selected.kind, "publishedVersion");
		assert.equal(sourceCodeInspectPayload.selected.version.source, "code");
		assert.equal(sourceCodeInspectPayload.selected.version.status, "published");
		assert.equal(sourceCodeInspectPayload.selected.definition.id, "standard-workflow");

		const sourceDefinition = structuredClone(codeDuplicatePayload.draft.definition);
		sourceDefinition.nodes.agent.promptTemplate = "Preserved UI published prompt.\\n\\n{{input}}";
		sourceDefinition.ui.positions.agent = { x: 321, y: 654 };
		const patchSourceDraftResponse = await fetch(`${baseURL}/api/chat/workflows/drafts/${encodeURIComponent(codeDuplicatePayload.draft.draftId)}`, {
			method: "PATCH",
			headers: jsonHeaders,
			body: JSON.stringify({ definition: sourceDefinition, editTrigger: "prompt_edit" }),
		});
		assert.equal(patchSourceDraftResponse.status, 200);

		const publishSourceDraftResponse = await fetch(`${baseURL}/api/chat/workflows/drafts/${encodeURIComponent(codeDuplicatePayload.draft.draftId)}/publish`, {
			method: "POST",
			headers: jsonHeaders,
			body: JSON.stringify({ versionIntent: "minor" }),
		});
		assert.equal(publishSourceDraftResponse.status, 201);
		const publishSourceDraftPayload = await publishSourceDraftResponse.json();
		assert.equal(publishSourceDraftPayload.publishedVersion.workflowId, "ui-standard-workflow-copy");
		assert.equal(publishSourceDraftPayload.publishedVersion.version, "1.1.0");
		assert.match(publishSourceDraftPayload.publishedVersion.definitionHash, /^sha256:[a-f0-9]{64}$/);

		const uiDuplicateResponse = await fetch(`${baseURL}/api/chat/workflows/ui-standard-workflow-copy/duplicate`, {
			method: "POST",
			headers: jsonHeaders,
			body: JSON.stringify({ version: "1.1.0" }),
		});
		assert.equal(uiDuplicateResponse.status, 201);
		const uiDuplicatePayload = await uiDuplicateResponse.json();
		assert.equal(uiDuplicatePayload.draft.workflowId, "ui-ui-standard-workflow-copy-copy");
		assert.equal(uiDuplicatePayload.draft.baseWorkflowId, "ui-standard-workflow-copy");
		assert.equal(uiDuplicatePayload.draft.baseWorkflowVersion, "1.1.0");
		assert.equal(uiDuplicatePayload.draft.baseDefinitionHash, publishSourceDraftPayload.publishedVersion.definitionHash);
		assert.equal(uiDuplicatePayload.draft.definition.id, "ui-ui-standard-workflow-copy-copy");
		assert.equal(uiDuplicatePayload.draft.definition.version, "1.1.0-draft");
		assert.equal(uiDuplicatePayload.draft.definition.nodes.agent.promptTemplate, "Preserved UI published prompt.\\n\\n{{input}}");
		assert.deepEqual(uiDuplicatePayload.draft.definition.ui.positions.agent, { x: 321, y: 654 });
		assert.equal(uiDuplicatePayload.draft.definition.metadata.migration.fromWorkflowId, "ui-standard-workflow-copy");
		assert.equal(uiDuplicatePayload.draft.definition.metadata.migration.fromDefinitionHash, publishSourceDraftPayload.publishedVersion.definitionHash);
		assert.equal(uiDuplicatePayload.draft.definition.xstate, undefined);

		const uiDuplicateAgainResponse = await fetch(`${baseURL}/api/chat/workflows/ui-standard-workflow-copy/duplicate`, {
			method: "POST",
			headers: jsonHeaders,
			body: JSON.stringify({ version: "1.1.0" }),
		});
		assert.equal(uiDuplicateAgainResponse.status, 201);
		const uiDuplicateAgainPayload = await uiDuplicateAgainResponse.json();
		assert.equal(uiDuplicateAgainPayload.draft.draftId, uiDuplicatePayload.draft.draftId);

		const sourceUiInspectResponse = await fetch(`${baseURL}/api/chat/workflows/ui-standard-workflow-copy?version=1.1.0`, {
			headers: { "x-test-user": "user-1" },
		});
		assert.equal(sourceUiInspectResponse.status, 200);
		const sourceUiInspectPayload = await sourceUiInspectResponse.json();
		assert.equal(sourceUiInspectPayload.selected.kind, "publishedVersion");
		assert.equal(sourceUiInspectPayload.selected.version.source, "ui");
		assert.equal(sourceUiInspectPayload.selected.version.status, "published");
		assert.equal(sourceUiInspectPayload.selected.version.definitionHash, publishSourceDraftPayload.publishedVersion.definitionHash);
		assert.equal(sourceUiInspectPayload.selected.definition.id, "ui-standard-workflow-copy");
		assert.equal(sourceUiInspectPayload.selected.definition.nodes.agent.promptTemplate, "Preserved UI published prompt.\\n\\n{{input}}");

		const archivedDuplicateResponse = await fetch(`${baseURL}/api/chat/workflows/archived-review-workflow/duplicate`, {
			method: "POST",
			headers: jsonHeaders,
			body: JSON.stringify({ version: "1.0.0" }),
		});
		assert.equal(archivedDuplicateResponse.status, 404);
	} finally {
		await channel.stop?.();
	}
});

test("workflow archive API applies at workflow identity scope and hides archived workflows from selection", async () => {
	const { channel, baseURL } = await startWebHostChannel({
		auth: createFakeAuthService(),
		profiles: [{ name: "base", aliases: ["default"] }],
	});

	const jsonHeaders = {
		"content-type": "application/json",
		origin: baseURL,
		"x-test-user": "user-1",
	};

	try {
		const archiveResponse = await fetch(`${baseURL}/api/chat/workflows/ui-review-workflow/archive`, {
			method: "POST",
			headers: jsonHeaders,
			body: JSON.stringify({ reason: "Deprecated by a newer review workflow." }),
		});
		assert.equal(archiveResponse.status, 200);
		const archivePayload = await archiveResponse.json();
		assert.equal(archivePayload.archiveState.workflowId, "ui-review-workflow");
		assert.equal(archivePayload.archiveState.archived, true);
		assert.equal(archivePayload.archiveState.archiveReason, "Deprecated by a newer review workflow.");
		assert.equal(archivePayload.workflow.id, "ui-review-workflow");
		assert.equal(archivePayload.workflow.status, "archived");
		assert.deepEqual(archivePayload.workflow.versions.map((version) => `${version.version}:${version.status}`), ["2.0.0:archived"]);

		const defaultCatalogResponse = await fetch(`${baseURL}/api/chat/workflows`, {
			headers: { "x-test-user": "user-1" },
		});
		assert.equal(defaultCatalogResponse.status, 200);
		const defaultCatalogPayload = await defaultCatalogResponse.json();
		assert.equal(defaultCatalogPayload.workflows.some((workflow) => workflow.id === "ui-review-workflow"), false);

		const archivedCatalogResponse = await fetch(`${baseURL}/api/chat/workflows?includeArchived=true`, {
			headers: { "x-test-user": "user-1" },
		});
		assert.equal(archivedCatalogResponse.status, 200);
		const archivedCatalogPayload = await archivedCatalogResponse.json();
		const archivedWorkflow = archivedCatalogPayload.workflows.find((workflow) => workflow.id === "ui-review-workflow");
		assert.ok(archivedWorkflow);
		assert.equal(archivedWorkflow.status, "archived");
		assert.equal(archivedWorkflow.editability.canCreateWorkflowSession, false);
		assert.equal(archivedWorkflow.editability.canArchive, false);

		const pickerResponse = await fetch(`${baseURL}/api/chat/workflows/pickers/workflow-versions`, {
			headers: { "x-test-user": "user-1" },
		});
		assert.equal(pickerResponse.status, 200);
		const pickerPayload = await pickerResponse.json();
		assert.equal(pickerPayload.options.some((option) => option.id === "ui-review-workflow"), false);

		const historyResponse = await fetch(`${baseURL}/api/chat/workflows/pickers/version-history?selectedWorkflowId=ui-review-workflow&selectedWorkflowVersion=2.0.0`, {
			headers: { "x-test-user": "user-1" },
		});
		assert.equal(historyResponse.status, 200);
		const historyPayload = await historyResponse.json();
		assert.equal(historyPayload.selectedWorkflowId, "ui-review-workflow");
		assert.equal(historyPayload.selectedWorkflowVersion, "2.0.0");
		assert.ok(historyPayload.options.some((option) => `${option.id}@${option.version}:${option.status}` === "ui-review-workflow@2.0.0:archived"));

		const defaultInspectResponse = await fetch(`${baseURL}/api/chat/workflows/ui-review-workflow?version=2.0.0`, {
			headers: { "x-test-user": "user-1" },
		});
		assert.equal(defaultInspectResponse.status, 404);

		const archivedInspectResponse = await fetch(`${baseURL}/api/chat/workflows/ui-review-workflow?version=2.0.0&includeArchived=true`, {
			headers: { "x-test-user": "user-1" },
		});
		assert.equal(archivedInspectResponse.status, 200);
		const archivedInspectPayload = await archivedInspectResponse.json();
		assert.equal(archivedInspectPayload.selected.version.status, "archived");

		const codeArchiveResponse = await fetch(`${baseURL}/api/chat/workflows/standard-workflow/archive`, {
			method: "POST",
			headers: jsonHeaders,
			body: JSON.stringify({}),
		});
		assert.equal(codeArchiveResponse.status, 409);
		assert.match((await codeArchiveResponse.json()).error, /Code workflow projections are read-only/);
	} finally {
		await channel.stop?.();
	}
});

test("workflow security boundary validates registered refs and rejects inline execution paths", async () => {
	const { channel, baseURL } = await startWebHostChannel({
		auth: createFakeAuthService(),
		profiles: [{ name: "base", aliases: ["default"] }],
	});

	const jsonHeaders = {
		"content-type": "application/json",
		origin: baseURL,
		"x-test-user": "user-1",
	};

	try {
		const duplicateResponse = await fetch(`${baseURL}/api/chat/workflows/standard-workflow/duplicate`, {
			method: "POST",
			headers: jsonHeaders,
			body: JSON.stringify({ version: "1.0.0" }),
		});
		assert.equal(duplicateResponse.status, 201);
		const duplicatePayload = await duplicateResponse.json();
		const draftId = duplicatePayload.draft.draftId;

		const textPort = { kind: "text" };
		const planPort = {
			kind: "json",
			schema: {
				type: "object",
				properties: {
					steps: { type: "array", items: { type: "string" } },
				},
				required: ["steps"],
				additionalProperties: false,
			},
		};
		const secureDefinition = {
			...duplicatePayload.draft.definition,
			input: textPort,
			output: textPort,
			initial: "collect",
			nodes: {
				collect: {
					kind: "agent",
					runtime: "pibo",
					profile: { kind: "fixed", id: "base" },
					promptTemplate: "Collect workflow input.",
					output: textPort,
				},
				plan: {
					kind: "code",
					language: "typescript",
					handler: "fixture.handlers.makePlan",
					input: textPort,
					output: planPort,
				},
				normalize: {
					kind: "adapter",
					mode: "deterministic",
					handler: { kind: "adapter", language: "typescript", id: "fixture.adapters.textToTopic" },
					input: planPort,
					output: textPort,
				},
				promptAsset: {
					kind: "agent",
					runtime: "pibo",
					profile: { kind: "fixed", id: "base" },
					promptBuilder: { kind: "promptBuilder", language: "typescript", id: "fixture.promptBuilders.draftPrompt" },
					input: textPort,
					output: textPort,
				},
				review: {
					kind: "human",
					prompt: "Review the plan.",
					input: textPort,
					output: textPort,
					actions: [{ id: "fixture.humanActions.approve", kind: "approve" }],
				},
			},
			edges: {
				"collect-to-plan": {
					id: "collect-to-plan",
					from: { nodeId: "collect" },
					to: { nodeId: "plan" },
					kind: "data",
					guard: { handler: "fixture.guards.approved", priority: 0, params: { expected: true } },
				},
				"plan-to-review": {
					id: "plan-to-review",
					from: { nodeId: "plan" },
					to: { nodeId: "review" },
					kind: "data",
					adapter: {
						kind: "edgeAdapter",
						transform: { kind: "adapter", language: "typescript", id: "fixture.adapters.draftToSummary", params: { format: "compact" } },
						output: textPort,
					},
				},
			},
		};

		const validPatchResponse = await fetch(`${baseURL}/api/chat/workflows/drafts/${encodeURIComponent(draftId)}`, {
			method: "PATCH",
			headers: jsonHeaders,
			body: JSON.stringify({ definition: secureDefinition, editTrigger: "graph_edit" }),
		});
		assert.equal(validPatchResponse.status, 200);
		const validPatchPayload = await validPatchResponse.json();
		assert.equal(validPatchPayload.validation.ok, true);
		assert.equal(validPatchPayload.diagnostics.some((diagnostic) => diagnostic.severity === "error"), false);

		const invalidParamsDefinition = structuredClone(secureDefinition);
		invalidParamsDefinition.nodes.normalize.handler.params = { unsupported: true };
		invalidParamsDefinition.edges["collect-to-plan"].guard.params = { expected: "yes", extra: true };
		invalidParamsDefinition.edges["plan-to-review"].adapter.transform.params = { format: 12 };
		const invalidParamsPatchResponse = await fetch(`${baseURL}/api/chat/workflows/drafts/${encodeURIComponent(draftId)}`, {
			method: "PATCH",
			headers: jsonHeaders,
			body: JSON.stringify({ definition: invalidParamsDefinition, editTrigger: "edge_edit" }),
		});
		assert.equal(invalidParamsPatchResponse.status, 200);
		const invalidParamsPatchPayload = await invalidParamsPatchResponse.json();
		assert.equal(invalidParamsPatchPayload.validation.ok, false);
		assert.ok(invalidParamsPatchPayload.diagnostics.some((diagnostic) => diagnostic.code === "WorkflowGraphError.unexpectedAdapterParams" && diagnostic.path === "$.nodes.normalize.handler.params" && diagnostic.nodeId === "normalize"));
		assert.ok(invalidParamsPatchPayload.diagnostics.some((diagnostic) => diagnostic.code === "WorkflowGraphError.invalidGuardParams" && diagnostic.path === "$.edges.collect-to-plan.guard.params.expected" && diagnostic.edgeId === "collect-to-plan"));
		assert.ok(invalidParamsPatchPayload.diagnostics.some((diagnostic) => diagnostic.code === "WorkflowGraphError.invalidAdapterParams" && diagnostic.path === "$.edges.plan-to-review.adapter.transform.params.format" && diagnostic.edgeId === "plan-to-review"));

		const incompatibleAdapterOutputDefinition = structuredClone(secureDefinition);
		incompatibleAdapterOutputDefinition.edges["plan-to-review"].adapter.output = planPort;
		const incompatibleAdapterOutputResponse = await fetch(`${baseURL}/api/chat/workflows/drafts/${encodeURIComponent(draftId)}`, {
			method: "PATCH",
			headers: jsonHeaders,
			body: JSON.stringify({ definition: incompatibleAdapterOutputDefinition, editTrigger: "edge_edit" }),
		});
		assert.equal(incompatibleAdapterOutputResponse.status, 200);
		const incompatibleAdapterOutputPayload = await incompatibleAdapterOutputResponse.json();
		assert.equal(incompatibleAdapterOutputPayload.validation.ok, false);
		assert.ok(incompatibleAdapterOutputPayload.diagnostics.some((diagnostic) => diagnostic.code === "WorkflowGraphError.incompatibleEdgeAdapterOutput" && diagnostic.path === "$.edges.plan-to-review.adapter.output" && diagnostic.edgeId === "plan-to-review"));

		const invalidDefinition = structuredClone(secureDefinition);
		invalidDefinition.xstate = { states: { injected: {} } };
		invalidDefinition.script = "echo bypass compute worker isolation";
		invalidDefinition.nodes.collect.profile.id = "missing.profiles.inline";
		invalidDefinition.nodes.plan.handler = "missing.handlers.inline";
		invalidDefinition.nodes.plan.inlineTypeScript = "return await eval(input);";
		invalidDefinition.nodes.normalize.handler.id = "missing.adapters.inline";
		invalidDefinition.nodes.normalize.mode = "llm";
		invalidDefinition.nodes.promptAsset.promptBuilder.id = "missing.promptAssets.inline";
		invalidDefinition.nodes.childWorkflow = {
			kind: "workflow",
			workflowId: "missing-nested-workflow",
			workflowVersion: "9.9.9",
			input: textPort,
			output: textPort,
		};
		invalidDefinition.nodes.review.actions = [
			{ id: "missing.humanActions.inline", kind: "approve" },
			{ id: "fixture.humanActions.approve", kind: "reject" },
		];
		invalidDefinition.nodes.jsonTarget = {
			kind: "code",
			language: "typescript",
			handler: "fixture.handlers.reviseDraft",
			input: planPort,
			output: planPort,
		};
		invalidDefinition.edges["collect-to-plan"].guard.handler = "missing.guards.inline";
		invalidDefinition.edges["plan-to-review"].adapter.transform.id = "missing.adapters.edge";
		invalidDefinition.edges["plan-to-review"].adapter.llmCoercion = true;
		invalidDefinition.edges["collect-to-json"] = {
			id: "collect-to-json",
			from: { nodeId: "collect" },
			to: { nodeId: "jsonTarget" },
			kind: "data",
		};

		const invalidPatchResponse = await fetch(`${baseURL}/api/chat/workflows/drafts/${encodeURIComponent(draftId)}`, {
			method: "PATCH",
			headers: jsonHeaders,
			body: JSON.stringify({ definition: invalidDefinition, editTrigger: "graph_edit" }),
		});
		assert.equal(invalidPatchResponse.status, 200);
		const invalidPatchPayload = await invalidPatchResponse.json();
		assert.equal(invalidPatchPayload.validation.ok, false);
		const diagnosticCodes = new Set(invalidPatchPayload.diagnostics.map((diagnostic) => diagnostic.code));
		assert.ok(diagnosticCodes.has("WorkflowGraphError.unknownAgentProfileRef"));
		assert.ok(diagnosticCodes.has("WorkflowGraphError.unknownHandlerRef"));
		assert.ok(diagnosticCodes.has("WorkflowGraphError.unknownAdapterRef"));
		assert.ok(diagnosticCodes.has("WorkflowGraphError.unknownGuardRef"));
		assert.ok(diagnosticCodes.has("WorkflowGraphError.unknownPromptBuilderRef"));
		assert.ok(diagnosticCodes.has("WorkflowGraphError.unknownHumanActionRef"));
		assert.ok(diagnosticCodes.has("WorkflowCatalogError.unknownWorkflowVersion"));
		assert.ok(diagnosticCodes.has("WorkflowGraphError.humanActionKindMismatch"));
		assert.ok(diagnosticCodes.has("WorkflowGraphError.incompatibleEdgePorts"));
		assert.ok(diagnosticCodes.has("WorkflowSecurityError.inlineExecutableCode"));
		assert.ok(diagnosticCodes.has("WorkflowSecurityError.hiddenLlmCoercion"));
		assert.ok(diagnosticCodes.has("WorkflowSecurityError.rawXStateAuthoring"));
		assert.ok(invalidPatchPayload.diagnostics.some((diagnostic) => diagnostic.code === "WorkflowSecurityError.inlineExecutableCode" && diagnostic.path === "$.script"));
		assert.ok(invalidPatchPayload.diagnostics.some((diagnostic) => diagnostic.code === "WorkflowSecurityError.rawXStateAuthoring" && diagnostic.path === "$.xstate"));
		assertStructuredMissingRefDiagnostic(invalidPatchPayload.diagnostics, {
			code: "WorkflowGraphError.unknownAgentProfileRef",
			registryRef: "missing.profiles.inline",
			nodeId: "collect",
			path: "$.nodes.collect.profile.id",
		});
		assertStructuredMissingRefDiagnostic(invalidPatchPayload.diagnostics, {
			code: "WorkflowGraphError.unknownHandlerRef",
			registryRef: "missing.handlers.inline",
			nodeId: "plan",
			path: "$.nodes.plan.handler",
		});
		assertStructuredMissingRefDiagnostic(invalidPatchPayload.diagnostics, {
			code: "WorkflowGraphError.unknownAdapterRef",
			registryRef: "missing.adapters.inline",
			nodeId: "normalize",
			path: "$.nodes.normalize.handler.id",
		});
		assertStructuredMissingRefDiagnostic(invalidPatchPayload.diagnostics, {
			code: "WorkflowGraphError.unknownPromptBuilderRef",
			registryRef: "missing.promptAssets.inline",
			nodeId: "promptAsset",
			path: "$.nodes.promptAsset.promptBuilder.id",
		});
		assertStructuredMissingRefDiagnostic(invalidPatchPayload.diagnostics, {
			code: "WorkflowGraphError.unknownHumanActionRef",
			registryRef: "missing.humanActions.inline",
			nodeId: "review",
			path: "$.nodes.review.actions.0.id",
		});
		assertStructuredMissingRefDiagnostic(invalidPatchPayload.diagnostics, {
			code: "WorkflowGraphError.unknownGuardRef",
			registryRef: "missing.guards.inline",
			edgeId: "collect-to-plan",
			path: "$.edges.collect-to-plan.guard.handler",
		});
		assertStructuredMissingRefDiagnostic(invalidPatchPayload.diagnostics, {
			code: "WorkflowGraphError.unknownAdapterRef",
			registryRef: "missing.adapters.edge",
			edgeId: "plan-to-review",
			path: "$.edges.plan-to-review.adapter.transform.id",
		});
		assertStructuredMissingRefDiagnostic(invalidPatchPayload.diagnostics, {
			code: "WorkflowCatalogError.unknownWorkflowVersion",
			registryRef: "missing-nested-workflow@9.9.9",
			nodeId: "childWorkflow",
			path: "$.nodes.childWorkflow.workflowId",
		});
		assert.ok(invalidPatchPayload.diagnostics.some((diagnostic) => diagnostic.hint?.includes("Hidden LLM coercion is not allowed")));

		const invalidPublishResponse = await fetch(`${baseURL}/api/chat/workflows/drafts/${encodeURIComponent(draftId)}/publish`, {
			method: "POST",
			headers: jsonHeaders,
			body: JSON.stringify({ versionIntent: "patch" }),
		});
		assert.equal(invalidPublishResponse.status, 422);
		const invalidPublishPayload = await invalidPublishResponse.json();
		assert.equal(invalidPublishPayload.validation.trigger, "before_publish");
		assert.equal(invalidPublishPayload.validation.blocksPublish, true);
		assert.ok(invalidPublishPayload.diagnostics.some((diagnostic) => diagnostic.code === "WorkflowGraphError.unknownAdapterRef" && diagnostic.registryRef === "missing.adapters.inline"));
		assert.ok(invalidPublishPayload.diagnostics.some((diagnostic) => diagnostic.code === "WorkflowGraphError.unknownAdapterRef" && diagnostic.registryRef === "missing.adapters.edge"));
		assert.ok(invalidPublishPayload.diagnostics.some((diagnostic) => diagnostic.code === "WorkflowGraphError.unknownHumanActionRef" && diagnostic.registryRef === "missing.humanActions.inline"));

		const inspectResponse = await fetch(`${baseURL}/api/chat/workflows/${encodeURIComponent(duplicatePayload.draft.workflowId)}`, {
			headers: { "x-test-user": "user-1" },
		});
		assert.equal(inspectResponse.status, 200);
		const inspectPayload = await inspectResponse.json();
		assert.equal(inspectPayload.selected.kind, "draft");
		assertStructuredMissingRefDiagnostic(inspectPayload.diagnostics, {
			code: "WorkflowGraphError.unknownHandlerRef",
			registryRef: "missing.handlers.inline",
			nodeId: "plan",
			path: "$.nodes.plan.handler",
		});
		assertStructuredMissingRefDiagnostic(inspectPayload.workflow.missingRefs, {
			code: "WorkflowCatalogError.unknownWorkflowVersion",
			registryRef: "missing-nested-workflow@9.9.9",
			nodeId: "childWorkflow",
			path: "$.nodes.childWorkflow.workflowId",
		});
		assert.equal(inspectPayload.workflow.missingRefs.some((diagnostic) => diagnostic.code === "WorkflowGraphError.humanActionKindMismatch"), false);
	} finally {
		await channel.stop?.();
	}
});

test("workflow prompt asset revisions create managed assets and draft prompt refs", async () => {
	const { channel, baseURL, dataStorePath } = await startWebHostChannel({
		auth: createFakeAuthService(),
		profiles: [{ name: "base", aliases: ["default"] }],
	});

	const jsonHeaders = {
		"content-type": "application/json",
		origin: baseURL,
		"x-test-user": "user-1",
	};

	try {
		const duplicateResponse = await fetch(`${baseURL}/api/chat/workflows/standard-workflow/duplicate`, {
			method: "POST",
			headers: jsonHeaders,
			body: JSON.stringify({ version: "1.0.0" }),
		});
		assert.equal(duplicateResponse.status, 201);
		const duplicatePayload = await duplicateResponse.json();
		const draftId = duplicatePayload.draft.draftId;

		const saveAssetResponse = await fetch(`${baseURL}/api/chat/workflows/prompt-assets`, {
			method: "POST",
			headers: jsonHeaders,
			body: JSON.stringify({
				sourceRefId: "fixture.promptBuilders.draftPrompt",
				displayName: "Agent prompt asset",
				description: "Managed prompt asset from the Workflow Builder Markdown editor.",
				markdown: "# Draft prompt\n\nUse {{input}} to write a crisp answer.",
			}),
		});
		assert.equal(saveAssetResponse.status, 201);
		const saveAssetPayload = await saveAssetResponse.json();
		assert.match(saveAssetPayload.asset.id, /^ui\.promptAssets\./);
		assert.equal(saveAssetPayload.asset.source, "ui");
		assert.equal(saveAssetPayload.asset.readOnly, false);
		assert.match(saveAssetPayload.asset.revisionId, /^wpar_/);
		assert.match(saveAssetPayload.asset.contentHash, /^sha256:/);
		assert.equal(saveAssetPayload.asset.markdown, "# Draft prompt\n\nUse {{input}} to write a crisp answer.");

		const promptAssetResponse = await fetch(`${baseURL}/api/chat/workflows/prompt-assets/${encodeURIComponent(saveAssetPayload.asset.id)}`, {
			headers: { "x-test-user": "user-1" },
		});
		assert.equal(promptAssetResponse.status, 200);
		const promptAssetPayload = await promptAssetResponse.json();
		assert.equal(promptAssetPayload.asset.revisionId, saveAssetPayload.asset.revisionId);

		const otherUserPromptAssetResponse = await fetch(`${baseURL}/api/chat/workflows/prompt-assets/${encodeURIComponent(saveAssetPayload.asset.id)}`, {
			headers: { "x-test-user": "user-2" },
		});
		assert.equal(otherUserPromptAssetResponse.status, 200);
		const otherUserPromptAssetPayload = await otherUserPromptAssetResponse.json();
		assert.equal(otherUserPromptAssetPayload.asset.revisionId, saveAssetPayload.asset.revisionId);

		const pickerResponse = await fetch(`${baseURL}/api/chat/workflows/pickers/prompt-assets?selectedRefId=${encodeURIComponent(saveAssetPayload.asset.id)}`, {
			headers: { "x-test-user": "user-2" },
		});
		assert.equal(pickerResponse.status, 200);
		const pickerPayload = await pickerResponse.json();
		assert.equal(pickerPayload.selectedRefId, saveAssetPayload.asset.id);
		assert.ok(pickerPayload.options.some((option) => option.id === saveAssetPayload.asset.id && option.kind === "ui"));

		const definition = structuredClone(duplicatePayload.draft.definition);
		definition.nodes.agent = {
			...definition.nodes.agent,
			promptBuilder: {
				kind: "promptBuilder",
				language: "typescript",
				id: saveAssetPayload.asset.id,
				revisionId: saveAssetPayload.asset.revisionId,
				contentHash: saveAssetPayload.asset.contentHash,
				source: saveAssetPayload.asset.source,
			},
			metadata: {
				...(definition.nodes.agent.metadata ?? {}),
				promptAssetRefs: [saveAssetPayload.asset.id],
				promptAssetPins: [{
					assetId: saveAssetPayload.asset.id,
					revisionId: saveAssetPayload.asset.revisionId,
					contentHash: saveAssetPayload.asset.contentHash,
					source: saveAssetPayload.asset.source,
				}],
			},
		};
		delete definition.nodes.agent.promptTemplate;
		definition.metadata = {
			...(definition.metadata ?? {}),
			promptAssetRefs: [saveAssetPayload.asset.id],
			promptAssetPins: [{
				assetId: saveAssetPayload.asset.id,
				revisionId: saveAssetPayload.asset.revisionId,
				contentHash: saveAssetPayload.asset.contentHash,
				source: saveAssetPayload.asset.source,
			}],
		};

		const patchResponse = await fetch(`${baseURL}/api/chat/workflows/drafts/${encodeURIComponent(draftId)}`, {
			method: "PATCH",
			headers: jsonHeaders,
			body: JSON.stringify({ definition, editTrigger: "prompt_edit" }),
		});
		assert.equal(patchResponse.status, 200);
		const patchPayload = await patchResponse.json();
		assert.equal(patchPayload.validation.trigger, "prompt_edit");
		assert.equal(patchPayload.validation.ok, true);
		assert.equal(patchPayload.draft.definition.nodes.agent.promptBuilder.id, saveAssetPayload.asset.id);
		assert.equal(patchPayload.draft.definition.nodes.agent.promptTemplate, undefined);
		assert.equal(patchPayload.draft.definition.nodes.agent.metadata.promptAssetPins[0].revisionId, saveAssetPayload.asset.revisionId);
		assert.equal(patchPayload.draft.definition.metadata.promptAssetPins[0].contentHash, saveAssetPayload.asset.contentHash);

		const secondRevisionResponse = await fetch(`${baseURL}/api/chat/workflows/prompt-assets`, {
			method: "POST",
			headers: { ...jsonHeaders, "x-test-user": "user-2" },
			body: JSON.stringify({
				assetId: saveAssetPayload.asset.id,
				displayName: "Agent prompt asset",
				markdown: "# Draft prompt\n\nUse {{input}} and include acceptance criteria.",
			}),
		});
		assert.equal(secondRevisionResponse.status, 201);
		const secondRevisionPayload = await secondRevisionResponse.json();
		assert.equal(secondRevisionPayload.asset.id, saveAssetPayload.asset.id);
		assert.notEqual(secondRevisionPayload.asset.revisionId, saveAssetPayload.asset.revisionId);
		assert.notEqual(secondRevisionPayload.asset.contentHash, saveAssetPayload.asset.contentHash);
		assert.equal(secondRevisionPayload.asset.markdown, "# Draft prompt\n\nUse {{input}} and include acceptance criteria.");

	} finally {
		await channel.stop?.();
	}
});

test("workflow builder draft loader opens starter and duplicated UI draft wrappers", async () => {
	const { channel, baseURL } = await startWebHostChannel({
		auth: createFakeAuthService(),
		profiles: [{ name: "base", aliases: ["default"] }],
	});

	try {
		const starterResponse = await fetch(`${baseURL}/api/chat/workflows/drafts/v2-starter-draft`, {
			headers: { "x-test-user": "user-1" },
		});
		assert.equal(starterResponse.status, 200);
		const starterPayload = await starterResponse.json();
		assert.equal(starterPayload.draft.source, "ui");
		assert.equal(starterPayload.draft.status, "draft");
		assert.equal(starterPayload.draft.definition.id, "ui-starter-workflow");
		assert.equal(starterPayload.draft.validationState, "error");
		assert.equal(starterPayload.draft.validation.trigger, "draft_load");
		assert.equal(starterPayload.draft.diagnostics[0].code, "WorkflowBuilderWarning.partialDraft");
		assert.ok(starterPayload.draft.diagnostics.some((diagnostic) => diagnostic.code === "WorkflowValidationError.emptyGraph"));
		assert.equal(starterPayload.draft.definition.xstate, undefined);

		const zeroNodeSaveDefinition = structuredClone(starterPayload.draft.definition);
		zeroNodeSaveDefinition.title = "Saved zero-node starter draft";
		zeroNodeSaveDefinition.nodes = {};
		zeroNodeSaveDefinition.edges = {};
		const zeroNodeSaveResponse = await fetch(`${baseURL}/api/chat/workflows/drafts/v2-starter-draft`, {
			method: "PATCH",
			headers: {
				"content-type": "application/json",
				origin: baseURL,
				"x-test-user": "user-1",
			},
			body: JSON.stringify({ definition: zeroNodeSaveDefinition, editTrigger: "graph_edit" }),
		});
		assert.equal(zeroNodeSaveResponse.status, 200);
		const zeroNodeSavePayload = await zeroNodeSaveResponse.json();
		assert.equal(zeroNodeSavePayload.draft.definition.title, "Saved zero-node starter draft");
		assert.deepEqual(zeroNodeSavePayload.draft.definition.nodes, {});
		assert.equal(zeroNodeSavePayload.validation.ok, false);
		assert.ok(zeroNodeSavePayload.diagnostics.some((diagnostic) => diagnostic.code === "WorkflowValidationError.emptyGraph"));

		const starterPublishResponse = await fetch(`${baseURL}/api/chat/workflows/drafts/v2-starter-draft/publish`, {
			method: "POST",
			headers: {
				"content-type": "application/json",
				origin: baseURL,
				"x-test-user": "user-1",
			},
			body: JSON.stringify({ versionIntent: "patch" }),
		});
		assert.equal(starterPublishResponse.status, 422);
		const starterPublishPayload = await starterPublishResponse.json();
		assert.equal(starterPublishPayload.validation.trigger, "before_publish");
		assert.equal(starterPublishPayload.validation.blocksPublish, true);
		assert.ok(starterPublishPayload.diagnostics.some((diagnostic) => diagnostic.code === "WorkflowValidationError.emptyGraph"));
		assert.ok(starterPublishPayload.diagnostics.some((diagnostic) => diagnostic.code === "WorkflowValidationError.missingPort" && diagnostic.path === "$.input"));
		assert.ok(starterPublishPayload.diagnostics.some((diagnostic) => diagnostic.code === "WorkflowValidationError.missingPort" && diagnostic.path === "$.output"));

		const duplicateResponse = await fetch(`${baseURL}/api/chat/workflows/standard-workflow/duplicate`, {
			method: "POST",
			headers: {
				"content-type": "application/json",
				origin: baseURL,
				"x-test-user": "user-1",
			},
			body: JSON.stringify({ version: "1.0.0" }),
		});
		assert.equal(duplicateResponse.status, 201);
		const duplicatePayload = await duplicateResponse.json();
		assert.equal(duplicatePayload.draft.baseWorkflowId, "standard-workflow");
		assert.equal(duplicatePayload.draft.baseWorkflowVersion, "1.0.0");
		assert.equal(duplicatePayload.draft.definition.id, "ui-standard-workflow-copy");
		assert.equal(duplicatePayload.draft.definition.ui.layout, "auto");
		assert.match(duplicatePayload.builderPath, /^\/apps\/chat\/workflows\/drafts\/draft_standard-workflow_1-0-0_/);

		const duplicateAgainResponse = await fetch(`${baseURL}/api/chat/workflows/standard-workflow/duplicate`, {
			method: "POST",
			headers: {
				"content-type": "application/json",
				origin: baseURL,
				"x-test-user": "user-1",
			},
			body: JSON.stringify({ version: "1.0.0" }),
		});
		assert.equal(duplicateAgainResponse.status, 201);
		const duplicateAgainPayload = await duplicateAgainResponse.json();
		assert.equal(duplicateAgainPayload.draft.draftId, duplicatePayload.draft.draftId);
		assert.equal(duplicateAgainPayload.draft.workflowId, "ui-standard-workflow-copy");

		const loadedDuplicateResponse = await fetch(`${baseURL}/api/chat/workflows/drafts/${encodeURIComponent(duplicatePayload.draft.draftId)}`, {
			headers: { "x-test-user": "user-1" },
		});
		assert.equal(loadedDuplicateResponse.status, 200);
		const loadedDuplicatePayload = await loadedDuplicateResponse.json();
		assert.equal(loadedDuplicatePayload.draft.draftId, duplicatePayload.draft.draftId);
		assert.equal(loadedDuplicatePayload.draft.definition.xstate, undefined);

		const unknownDuplicateResponse = await fetch(`${baseURL}/api/chat/workflows/missing-workflow/duplicate`, {
			method: "POST",
			headers: {
				"content-type": "application/json",
				origin: baseURL,
				"x-test-user": "user-1",
			},
			body: JSON.stringify({ version: "1.0.0" }),
		});
		assert.equal(unknownDuplicateResponse.status, 404);
	} finally {
		await channel.stop?.();
	}
});

test("workflow validation pipeline runs on draft load, edit, validate, and publish boundaries", async () => {
	const { channel, baseURL } = await startWebHostChannel({
		auth: createFakeAuthService(),
		profiles: [{ name: "base", aliases: ["default"] }],
	});

	try {
		const duplicateResponse = await fetch(`${baseURL}/api/chat/workflows/standard-workflow/duplicate`, {
			method: "POST",
			headers: {
				"content-type": "application/json",
				origin: baseURL,
				"x-test-user": "user-1",
			},
			body: JSON.stringify({ version: "1.0.0" }),
		});
		assert.equal(duplicateResponse.status, 201);
		const duplicatePayload = await duplicateResponse.json();
		const draftId = duplicatePayload.draft.draftId;

		const loadResponse = await fetch(`${baseURL}/api/chat/workflows/drafts/${encodeURIComponent(draftId)}`, {
			headers: { "x-test-user": "user-1" },
		});
		assert.equal(loadResponse.status, 200);
		const loadPayload = await loadResponse.json();
		assert.equal(loadPayload.draft.validation.trigger, "draft_load");
		assert.equal(loadPayload.draft.validation.ok, true);
		assert.equal(loadPayload.draft.validationState, "valid");

		const validDefinition = loadPayload.draft.definition;
		for (const editTrigger of ["graph_edit", "node_edit", "edge_edit", "schema_edit", "prompt_edit", "state_edit"]) {
			const patchResponse = await fetch(`${baseURL}/api/chat/workflows/drafts/${encodeURIComponent(draftId)}`, {
				method: "PATCH",
				headers: {
					"content-type": "application/json",
					origin: baseURL,
					"x-test-user": "user-1",
				},
				body: JSON.stringify({ definition: validDefinition, editTrigger }),
			});
			assert.equal(patchResponse.status, 200);
			const patchPayload = await patchResponse.json();
			assert.equal(patchPayload.validation.trigger, editTrigger);
			assert.equal(patchPayload.validation.ok, true);
			assert.equal(patchPayload.draft.validationState, "valid");
		}

		const graphEditedDefinition = structuredClone(validDefinition);
		graphEditedDefinition.nodes.agent_2 = {
			kind: "agent",
			runtime: "pibo",
			profile: { kind: "fixed", id: "base" },
			promptTemplate: "Summarize the previous agent output.",
		};
		graphEditedDefinition.edges.edge_agent_to_agent_2 = {
			id: "edge_agent_to_agent_2",
			from: { nodeId: "agent" },
			to: { nodeId: "agent_2" },
			kind: "data",
		};
		graphEditedDefinition.ui = {
			...(graphEditedDefinition.ui ?? {}),
			layout: "manual",
			positions: {
				agent: { x: 120, y: 100 },
				agent_2: { x: 420, y: 100 },
			},
		};
		const graphPatchResponse = await fetch(`${baseURL}/api/chat/workflows/drafts/${encodeURIComponent(draftId)}`, {
			method: "PATCH",
			headers: {
				"content-type": "application/json",
				origin: baseURL,
				"x-test-user": "user-1",
			},
			body: JSON.stringify({ definition: graphEditedDefinition, editTrigger: "graph_edit" }),
		});
		assert.equal(graphPatchResponse.status, 200);
		const graphPatchPayload = await graphPatchResponse.json();
		assert.equal(graphPatchPayload.validation.trigger, "graph_edit");
		assert.equal(graphPatchPayload.validation.ok, true);
		assert.equal(graphPatchPayload.draft.definition.nodes.agent_2.runtime, "pibo");
		assert.equal(graphPatchPayload.draft.definition.edges.edge_agent_to_agent_2.to.nodeId, "agent_2");
		assert.deepEqual(graphPatchPayload.draft.definition.ui.positions.agent_2, { x: 420, y: 100 });

		const rawPatchResponse = await fetch(`${baseURL}/api/chat/workflows/drafts/${encodeURIComponent(draftId)}`, {
			method: "PATCH",
			headers: {
				"content-type": "application/json",
				origin: baseURL,
				"x-test-user": "user-1",
			},
			body: JSON.stringify({ rawDefinitionText: JSON.stringify(validDefinition), editTrigger: "raw_ir_edit" }),
		});
		assert.equal(rawPatchResponse.status, 200);
		const rawPatchPayload = await rawPatchResponse.json();
		assert.equal(rawPatchPayload.validation.trigger, "raw_ir_edit");
		assert.equal(rawPatchPayload.validation.ok, true);

		const invalidRawPatchResponse = await fetch(`${baseURL}/api/chat/workflows/drafts/${encodeURIComponent(draftId)}`, {
			method: "PATCH",
			headers: {
				"content-type": "application/json",
				origin: baseURL,
				"x-test-user": "user-1",
			},
			body: JSON.stringify({ rawDefinitionText: "{ invalid raw workflow ir", editTrigger: "raw_ir_edit" }),
		});
		assert.equal(invalidRawPatchResponse.status, 200);
		const invalidRawPatchPayload = await invalidRawPatchResponse.json();
		assert.equal(invalidRawPatchPayload.validation.trigger, "raw_ir_edit");
		assert.equal(invalidRawPatchPayload.validation.validationState, "warning");
		assert.equal(invalidRawPatchPayload.draft.revision, rawPatchPayload.draft.revision);
		assert.deepEqual(invalidRawPatchPayload.draft.definition, rawPatchPayload.draft.definition);
		assert.ok(invalidRawPatchPayload.diagnostics.some((diagnostic) => diagnostic.code === "WorkflowBuilderWarning.invalidRawIrText" && diagnostic.severity === "warning"));

		const reloadedAfterInvalidRawResponse = await fetch(`${baseURL}/api/chat/workflows/drafts/${encodeURIComponent(draftId)}`, {
			headers: { "x-test-user": "user-1" },
		});
		assert.equal(reloadedAfterInvalidRawResponse.status, 200);
		const reloadedAfterInvalidRawPayload = await reloadedAfterInvalidRawResponse.json();
		assert.equal(reloadedAfterInvalidRawPayload.draft.revision, rawPatchPayload.draft.revision);
		assert.deepEqual(reloadedAfterInvalidRawPayload.draft.definition, rawPatchPayload.draft.definition);

		const rawRepairDefinition = structuredClone(rawPatchPayload.draft.definition);
		rawRepairDefinition.title = "Raw IR safe sync";
		const rawRepairResponse = await fetch(`${baseURL}/api/chat/workflows/drafts/${encodeURIComponent(draftId)}`, {
			method: "PATCH",
			headers: {
				"content-type": "application/json",
				origin: baseURL,
				"x-test-user": "user-1",
			},
			body: JSON.stringify({ rawDefinitionText: JSON.stringify(rawRepairDefinition), editTrigger: "raw_ir_edit" }),
		});
		assert.equal(rawRepairResponse.status, 200);
		const rawRepairPayload = await rawRepairResponse.json();
		assert.equal(rawRepairPayload.draft.definition.title, "Raw IR safe sync");
		assert.equal(rawRepairPayload.draft.revision, rawPatchPayload.draft.revision + 1);
		assert.equal(rawRepairPayload.diagnostics.some((diagnostic) => diagnostic.code === "WorkflowBuilderWarning.invalidRawIrText"), false);

		const unsupportedSchemaDefinition = structuredClone(rawRepairPayload.draft.definition);
		unsupportedSchemaDefinition.input = {
			kind: "json",
			schema: {
				type: "object",
				properties: {
					topic: { type: "string", pattern: "^[a-z]+$" },
				},
				required: ["topic"],
				additionalProperties: false,
			},
		};
		const schemaPatchResponse = await fetch(`${baseURL}/api/chat/workflows/drafts/${encodeURIComponent(draftId)}`, {
			method: "PATCH",
			headers: {
				"content-type": "application/json",
				origin: baseURL,
				"x-test-user": "user-1",
			},
			body: JSON.stringify({ definition: unsupportedSchemaDefinition, editTrigger: "schema_edit" }),
		});
		assert.equal(schemaPatchResponse.status, 200);
		const schemaPatchPayload = await schemaPatchResponse.json();
		assert.equal(schemaPatchPayload.validation.trigger, "schema_edit");
		assert.equal(schemaPatchPayload.validation.ok, false);
		assert.ok(schemaPatchPayload.diagnostics.some((diagnostic) => diagnostic.code === "WorkflowInterfaceError.unsupportedSchemaKeyword" && diagnostic.path === "$.input.schema.properties.topic.pattern"));

		const invalidDefinition = structuredClone(rawRepairPayload.draft.definition);
		invalidDefinition.nodes.agent.profile.id = "missing-workflow-profile";
		const invalidPatchResponse = await fetch(`${baseURL}/api/chat/workflows/drafts/${encodeURIComponent(draftId)}`, {
			method: "PATCH",
			headers: {
				"content-type": "application/json",
				origin: baseURL,
				"x-test-user": "user-1",
			},
			body: JSON.stringify({ definition: invalidDefinition, editTrigger: "node_edit" }),
		});
		assert.equal(invalidPatchResponse.status, 200);
		const invalidPatchPayload = await invalidPatchResponse.json();
		assert.equal(invalidPatchPayload.validation.trigger, "node_edit");
		assert.equal(invalidPatchPayload.validation.ok, false);
		assert.equal(invalidPatchPayload.draft.validationState, "error");
		assert.ok(invalidPatchPayload.diagnostics.some((diagnostic) => diagnostic.code === "WorkflowGraphError.unknownAgentProfileRef"));

		const reloadedInvalidResponse = await fetch(`${baseURL}/api/chat/workflows/drafts/${encodeURIComponent(draftId)}`, {
			headers: { "x-test-user": "user-1" },
		});
		assert.equal(reloadedInvalidResponse.status, 200);
		const reloadedInvalidPayload = await reloadedInvalidResponse.json();
		assert.equal(reloadedInvalidPayload.draft.definition.nodes.agent.profile.id, "missing-workflow-profile");
		assert.equal(reloadedInvalidPayload.draft.validationState, "error");

		const validateResponse = await fetch(`${baseURL}/api/chat/workflows/drafts/${encodeURIComponent(draftId)}/validate`, {
			method: "POST",
			headers: {
				"content-type": "application/json",
				origin: baseURL,
				"x-test-user": "user-1",
			},
			body: JSON.stringify({ trigger: "prompt_edit" }),
		});
		assert.equal(validateResponse.status, 200);
		const validatePayload = await validateResponse.json();
		assert.equal(validatePayload.validation.trigger, "prompt_edit");
		assert.equal(validatePayload.validation.ok, false);

		const publishResponse = await fetch(`${baseURL}/api/chat/workflows/drafts/${encodeURIComponent(draftId)}/publish`, {
			method: "POST",
			headers: {
				"content-type": "application/json",
				origin: baseURL,
				"x-test-user": "user-1",
			},
			body: JSON.stringify({ versionIntent: "patch" }),
		});
		assert.equal(publishResponse.status, 422);
		const publishPayload = await publishResponse.json();
		assert.equal(publishPayload.validation.trigger, "before_publish");
		assert.equal(publishPayload.validation.blocksPublish, true);
		assert.ok(publishPayload.diagnostics.some((diagnostic) => diagnostic.registryRef === "missing-workflow-profile"));
	} finally {
		await channel.stop?.();
	}
});

test("workflow draft publish allocates patch, minor, and major versions", async () => {
	const { channel, baseURL, workflowStorePath } = await startWebHostChannel({
		auth: createFakeAuthService(),
		profiles: [{ name: "base", aliases: ["default"] }],
	});

	const jsonHeaders = {
		"content-type": "application/json",
		origin: baseURL,
		"x-test-user": "user-1",
	};

	async function duplicateDraft(workflowId, version) {
		const response = await fetch(`${baseURL}/api/chat/workflows/${workflowId}/duplicate`, {
			method: "POST",
			headers: jsonHeaders,
			body: JSON.stringify({ version }),
		});
		assert.equal(response.status, 201);
		return response.json();
	}

	async function publishDraft(draftId, body = {}) {
		const response = await fetch(`${baseURL}/api/chat/workflows/drafts/${encodeURIComponent(draftId)}/publish`, {
			method: "POST",
			headers: jsonHeaders,
			body: JSON.stringify(body),
		});
		const payload = await response.json();
		return { response, payload };
	}

	try {
		const nextDraftResponse = await fetch(`${baseURL}/api/chat/workflows/ui-review-workflow/drafts`, {
			method: "POST",
			headers: jsonHeaders,
			body: JSON.stringify({ version: "2.0.0" }),
		});
		assert.equal(nextDraftResponse.status, 201);
		const nextDraftPayload = await nextDraftResponse.json();
		const patchPublish = await publishDraft(nextDraftPayload.draft.draftId);
		assert.equal(patchPublish.response.status, 201);
		assert.equal(patchPublish.payload.publishedVersion.workflowId, "ui-review-workflow");
		assert.equal(patchPublish.payload.publishedVersion.version, "2.0.1");
		assert.equal(patchPublish.payload.publishedVersion.definition.version, "2.0.1");
		assert.match(patchPublish.payload.publishedVersion.definitionHash, /^sha256:[a-f0-9]{64}$/);
		assert.equal(patchPublish.payload.draft.targetWorkflowVersion, "2.0.1");
		assert.match(patchPublish.payload.message, /patch version bump/);

		const repeatedPatchPublish = await publishDraft(nextDraftPayload.draft.draftId, { versionIntent: "patch" });
		assert.equal(repeatedPatchPublish.response.status, 200);
		assert.equal(repeatedPatchPublish.payload.alreadyPublished, true);
		assert.equal(repeatedPatchPublish.payload.publishedVersion.version, "2.0.1");

		const minorDraft = await duplicateDraft("standard-workflow", "1.0.0");
		const minorPublish = await publishDraft(minorDraft.draft.draftId, { versionIntent: "minor" });
		assert.equal(minorPublish.response.status, 201);
		assert.equal(minorPublish.payload.publishedVersion.workflowId, "ui-standard-workflow-copy");
		assert.equal(minorPublish.payload.publishedVersion.version, "1.1.0");
		assert.equal(minorPublish.payload.publishedVersion.definition.id, "ui-standard-workflow-copy");

		const majorDraft = await duplicateDraft("simple-chat", "1.0.0");
		const majorPublish = await publishDraft(majorDraft.draft.draftId, { versionIntent: "major" });
		assert.equal(majorPublish.response.status, 201);
		assert.equal(majorPublish.payload.publishedVersion.workflowId, "ui-simple-chat-copy");
		assert.equal(majorPublish.payload.publishedVersion.version, "2.0.0");

		const pickerResponse = await fetch(`${baseURL}/api/chat/workflows/pickers/workflow-versions`, {
			headers: { "x-test-user": "user-1" },
		});
		assert.equal(pickerResponse.status, 200);
		const pickerPayload = await pickerResponse.json();
		const pickerKeys = pickerPayload.options.map((option) => `${option.id}@${option.version}`);
		assert.ok(pickerKeys.includes("ui-review-workflow@2.0.1"));
		assert.ok(pickerKeys.includes("ui-standard-workflow-copy@1.1.0"));
		assert.ok(pickerKeys.includes("ui-simple-chat-copy@2.0.0"));

		const historyResponse = await fetch(`${baseURL}/api/chat/workflows/pickers/version-history`, {
			headers: { "x-test-user": "user-1" },
		});
		assert.equal(historyResponse.status, 200);
		const historyPayload = await historyResponse.json();
		const historyKeys = historyPayload.options.map((option) => `${option.id}@${option.version}:${option.status}`);
		assert.ok(historyKeys.includes("ui-review-workflow@2.0.0:published"));
		assert.ok(historyKeys.includes("ui-review-workflow@2.0.1:published"));
		assert.ok(historyKeys.indexOf("ui-review-workflow@2.0.0:published") < historyKeys.indexOf("ui-review-workflow@2.0.1:published"));
		assert.ok(historyKeys.includes("archived-review-workflow@1.0.0:archived"));

		const db = new DatabaseSync(workflowStorePath, { readOnly: true });
		try {
			const rows = db.prepare("SELECT workflow_id, version FROM workflow_published_versions ORDER BY workflow_id, version").all();
			assert.ok(rows.some((row) => row.workflow_id === "ui-review-workflow" && row.version === "2.0.1"));
			assert.ok(rows.some((row) => row.workflow_id === "ui-standard-workflow-copy" && row.version === "1.1.0"));
			assert.ok(rows.some((row) => row.workflow_id === "ui-simple-chat-copy" && row.version === "2.0.0"));
		} finally {
			db.close();
		}
	} finally {
		await channel.stop?.();
	}
});

test("workflow published edit creates or reuses one next-version draft", async () => {
	const { channel, baseURL } = await startWebHostChannel({
		auth: createFakeAuthService(),
		profiles: [{ name: "base", aliases: ["default"] }],
	});

	try {
		const createResponse = await fetch(`${baseURL}/api/chat/workflows/ui-review-workflow/drafts`, {
			method: "POST",
			headers: {
				"content-type": "application/json",
				origin: baseURL,
				"x-test-user": "user-1",
			},
			body: JSON.stringify({ version: "2.0.0" }),
		});
		assert.equal(createResponse.status, 201);
		const createPayload = await createResponse.json();
		assert.equal(createPayload.reused, false);
		assert.equal(createPayload.draft.workflowId, "ui-review-workflow");
		assert.equal(createPayload.draft.baseWorkflowId, "ui-review-workflow");
		assert.equal(createPayload.draft.baseWorkflowVersion, "2.0.0");
		assert.equal(createPayload.draft.targetWorkflowVersion, "2.0.1");
		assert.equal(createPayload.draft.definition.id, "ui-review-workflow");
		assert.equal(createPayload.draft.definition.version, "2.0.1");
		assert.equal(createPayload.draft.diagnostics[0].code, "WorkflowBuilderInfo.nextVersionDraft");
		assert.match(createPayload.builderPath, /^\/apps\/chat\/workflows\/drafts\/draft_ui-review-workflow_2-0-0_next_/);

		const reuseResponse = await fetch(`${baseURL}/api/chat/workflows/ui-review-workflow/drafts`, {
			method: "POST",
			headers: {
				"content-type": "application/json",
				origin: baseURL,
				"x-test-user": "user-1",
			},
			body: JSON.stringify({ version: "2.0.0" }),
		});
		assert.equal(reuseResponse.status, 200);
		const reusePayload = await reuseResponse.json();
		assert.equal(reusePayload.reused, true);
		assert.equal(reusePayload.draft.draftId, createPayload.draft.draftId);
		assert.equal(reusePayload.draft.targetWorkflowVersion, "2.0.1");

		const loadedResponse = await fetch(`${baseURL}/api/chat/workflows/drafts/${encodeURIComponent(createPayload.draft.draftId)}`, {
			headers: { "x-test-user": "user-1" },
		});
		assert.equal(loadedResponse.status, 200);
		const loadedPayload = await loadedResponse.json();
		assert.equal(loadedPayload.draft.draftId, createPayload.draft.draftId);
		assert.equal(loadedPayload.draft.definition.xstate, undefined);

		const codeEditResponse = await fetch(`${baseURL}/api/chat/workflows/standard-workflow/drafts`, {
			method: "POST",
			headers: {
				"content-type": "application/json",
				origin: baseURL,
				"x-test-user": "user-1",
			},
			body: JSON.stringify({ version: "1.0.0" }),
		});
		assert.equal(codeEditResponse.status, 409);
	} finally {
		await channel.stop?.();
	}
});

test("chat web app surfaces broken custom agent context files and allows cleanup", async () => {
	const { channel, baseURL } = await startWebHostChannel({
		auth: createFakeAuthService(),
		profiles: [{ name: "codex-compat-openai-web", aliases: ["codex"] }],
		capabilityCatalog: {
			nativeTools: [],
			skills: [{ name: "pi-agent-harness", path: "skills/builtin/pi-agent-harness/SKILL.md", kind: "builtin" }],
			subagents: [],
			contextFiles: [{
				key: "ctx:git-projekt",
				label: "Git Projekt",
				path: ".pibo/context/git-projekt.md",
				source: "managed",
				scope: "global",
			}],
			packages: [{ name: "pibo-run-control", description: "Run control", toolNames: ["pibo_run_start"] }],
			piboTools: [],
			mcpServers: [],
		},
	});

	try {
		const createdAgent = await fetch(`${baseURL}/api/chat/agents`, {
			method: "POST",
			headers: {
				"content-type": "application/json",
				origin: baseURL,
				"x-test-user": "user-1",
			},
			body: JSON.stringify({
				displayName: "broken-context-agent",
				nativeTools: ["retired-tool"],
				contextFiles: ["ctx:git-projekt", "ctx:pibo-docker-development"],
			}),
		});
		assert.equal(createdAgent.status, 201);
		const createdPayload = await createdAgent.json();
		assert.deepEqual(createdPayload.agent.brokenNativeTools, ["retired-tool"]);
		assert.deepEqual(createdPayload.agent.brokenContextFiles, ["ctx:pibo-docker-development"]);

		const bootstrap = await fetch(`${baseURL}/api/chat/bootstrap`, {
			headers: { "x-test-user": "user-1" },
		});
		assert.equal(bootstrap.status, 200);
		const bootstrapPayload = await bootstrap.json();
		assert.deepEqual(bootstrapPayload.customAgents[0].brokenNativeTools, ["retired-tool"]);
		assert.deepEqual(bootstrapPayload.customAgents[0].brokenContextFiles, ["ctx:pibo-docker-development"]);

		const patchedAgent = await fetch(`${baseURL}/api/chat/agents/${encodeURIComponent(createdPayload.agent.id)}`, {
			method: "PATCH",
			headers: {
				"content-type": "application/json",
				origin: baseURL,
				"x-test-user": "user-1",
			},
			body: JSON.stringify({
				nativeTools: [],
				contextFiles: ["ctx:git-projekt"],
			}),
		});
		assert.equal(patchedAgent.status, 200);
		const patchedPayload = await patchedAgent.json();
		assert.deepEqual(patchedPayload.agent.brokenNativeTools, []);
		assert.deepEqual(patchedPayload.agent.brokenContextFiles, []);
		assert.deepEqual(patchedPayload.agent.contextFiles, ["ctx:git-projekt"]);
	} finally {
		await channel.stop?.();
	}
});

test("chat web app manages Pi package registrations and custom agent selections", async () => {
	const cwd = mkdtempSync(join(tmpdir(), "pibo-web-pi-packages-"));
	const packageDir = join(cwd, "local-package");
	mkdirSync(join(packageDir, "skills"), { recursive: true });
	writeFileSync(join(packageDir, "skills", "demo.md"), "# Demo\n", "utf-8");
	writeFileSync(join(packageDir, "package.json"), JSON.stringify({
		name: "local-web-package",
		pi: { skills: ["skills/*.md"] },
	}), "utf-8");

	await withCwd(cwd, async () => {
		upsertPiPackage({
			id: "local-web-package",
			name: "local-web-package",
			source: packageDir,
			installSpec: packageDir,
			resourceTypes: ["skill"],
			skillNames: ["demo"],
			installStatus: "installed",
			installPath: packageDir,
			enabled: true,
			diagnostics: [],
		}, cwd);
		const { channel, baseURL } = await startWebHostChannel({
			auth: createFakeAuthService(),
			profiles: [{ name: "codex-compat-openai-web", aliases: ["codex"] }],
			createProfile: (name) => new InitialSessionContextBuilder(name)
				.withPiPackages([{ id: "local-web-package" }])
				.createSession(),
		});

		try {
			const catalog = await fetch(`${baseURL}/api/chat/agent-catalog`, {
				headers: { "x-test-user": "user-1" },
			});
			assert.equal(catalog.status, 200);
			const catalogPayload = await catalog.json();
			assert.equal(catalogPayload.catalog.piPackages[0].id, "local-web-package");
			assert.equal(catalogPayload.catalog.piPackages[0].enabled, true);

			const disabled = await fetch(`${baseURL}/api/chat/pi-packages/${encodeURIComponent("local-web-package")}`, {
				method: "PATCH",
				headers: {
					"content-type": "application/json",
					origin: baseURL,
					"x-test-user": "user-1",
				},
				body: JSON.stringify({ enabled: false }),
			});
			assert.equal(disabled.status, 200);
			const disabledPayload = await disabled.json();
			assert.equal(disabledPayload.package.enabled, false);

			const createdAgent = await fetch(`${baseURL}/api/chat/agents`, {
				method: "POST",
				headers: {
					"content-type": "application/json",
					origin: baseURL,
					"x-test-user": "user-1",
				},
				body: JSON.stringify({
					displayName: "package-agent",
					piPackages: ["local-web-package"],
				}),
			});
			assert.equal(createdAgent.status, 201);
			const agentPayload = await createdAgent.json();
			assert.deepEqual(agentPayload.agent.piPackages, ["local-web-package"]);

			const enabled = await fetch(`${baseURL}/api/chat/pi-packages/${encodeURIComponent("local-web-package")}`, {
				method: "PATCH",
				headers: {
					"content-type": "application/json",
					origin: baseURL,
					"x-test-user": "user-1",
				},
				body: JSON.stringify({ enabled: true }),
			});
			assert.equal(enabled.status, 200);

			const createdSession = await fetch(`${baseURL}/api/chat/sessions`, {
				method: "POST",
				headers: {
					"content-type": "application/json",
					origin: baseURL,
					"x-test-user": "user-1",
				},
				body: JSON.stringify({ profile: agentPayload.agent.profileName }),
			});
			assert.equal(createdSession.status, 201);
			const sessionPayload = await createdSession.json();
			assert.notEqual(sessionPayload.session.workspace, cwd);

			const contextBuild = await fetch(`${baseURL}/api/chat/context-build?piboSessionId=${encodeURIComponent(sessionPayload.session.id)}`, {
				headers: { "x-test-user": "user-1" },
			});
			const contextPayload = await contextBuild.json();
			assert.equal(contextBuild.status, 200, JSON.stringify(contextPayload));
			assert.equal(contextPayload.snapshot.summary.errors, 0);
			assert.ok(contextPayload.snapshot.diagnostics.some((diagnostic) => diagnostic.message === "Loaded Pi package local-web-package (skill)"));

			const blockedDelete = await fetch(`${baseURL}/api/chat/pi-packages/${encodeURIComponent("local-web-package")}`, {
				method: "DELETE",
				headers: {
					"content-type": "application/json",
					origin: baseURL,
					"x-test-user": "user-1",
				},
				body: "{}",
			});
			assert.equal(blockedDelete.status, 409);
			assert.match((await blockedDelete.json()).error, /package-agent/);
		} finally {
			await channel.stop?.();
		}
	});
});

test("chat web app rejects non-pi.dev package sources from browser adds", async () => {
	const { channel, baseURL } = await startWebHostChannel({
		auth: createFakeAuthService(),
		profiles: [{ name: "codex-compat-openai-web", aliases: ["codex"] }],
	});

	try {
		const rejected = await fetch(`${baseURL}/api/chat/pi-packages`, {
			method: "POST",
			headers: {
				"content-type": "application/json",
				origin: baseURL,
				"x-test-user": "user-1",
			},
			body: JSON.stringify({ source: "/tmp/local-package" }),
		});
		assert.equal(rejected.status, 400);
		assert.deepEqual(await rejected.json(), {
			error: "Pi package source must be a https://pi.dev/packages/... URL",
		});
	} finally {
		await channel.stop?.();
	}
});

test("chat web app manages user skill routes and syncs the capability catalog", async () => {
	const home = mkdtempSync(join(tmpdir(), "pibo-web-skill-account-"));
	await withHome(home, async () => {
		const { channel, baseURL, registeredSkills, unregisteredSkills } = await startWebHostChannel({
			auth: createFakeAuthService(),
			profiles: [{ name: "codex-compat-openai-web", aliases: ["codex"] }],
			trackUserSkillRegistry: true,
		});

		try {
			const builtinConflict = await fetch(`${baseURL}/api/chat/user-skills`, {
				method: "POST",
				headers: {
					"content-type": "application/json",
					origin: baseURL,
					"x-test-user": "user-1",
				},
				body: JSON.stringify({ name: "pi-agent-harness", markdown: "# Built-in" }),
			});
			assert.equal(builtinConflict.status, 409);
			assert.match((await builtinConflict.json()).error, /conflicts with an existing registered skill/);

			const created = await fetch(`${baseURL}/api/chat/user-skills`, {
				method: "POST",
				headers: {
					"content-type": "application/json",
					origin: baseURL,
					"x-test-user": "user-1",
				},
				body: JSON.stringify({
					name: "browser-skill",
					description: "Use the browser safely.",
					markdown: "# Browser Skill\n\nFollow browser steps.",
				}),
			});
			assert.equal(created.status, 201);
			const createdPayload = await created.json();
			assert.equal(createdPayload.skill.name, "browser-skill");
			assert.deepEqual(registeredSkills.map((skill) => skill.name), ["browser-skill"]);

			const listed = await fetch(`${baseURL}/api/chat/user-skills`, {
				headers: { "x-test-user": "user-1" },
			});
			assert.equal(listed.status, 200);
			assert.deepEqual((await listed.json()).skills.map((skill) => skill.name), ["browser-skill"]);

			const read = await fetch(`${baseURL}/api/chat/user-skills/${encodeURIComponent(createdPayload.skill.id)}`, {
				headers: { "x-test-user": "user-1" },
			});
			assert.equal(read.status, 200);
			const readPayload = await read.json();
			assert.equal(readPayload.skill.name, "browser-skill");
			assert.match(readPayload.markdown, /Follow browser steps/);

			const updateConflict = await fetch(`${baseURL}/api/chat/user-skills/${encodeURIComponent(createdPayload.skill.id)}`, {
				method: "PATCH",
				headers: {
					"content-type": "application/json",
					origin: baseURL,
					"x-test-user": "user-1",
				},
				body: JSON.stringify({ name: "pi-agent-harness" }),
			});
			assert.equal(updateConflict.status, 409);
			assert.match((await updateConflict.json()).error, /conflicts with an existing registered skill/);

			const renamed = await fetch(`${baseURL}/api/chat/user-skills/${encodeURIComponent(createdPayload.skill.id)}`, {
				method: "PATCH",
				headers: {
					"content-type": "application/json",
					origin: baseURL,
					"x-test-user": "user-1",
				},
				body: JSON.stringify({
					name: "renamed-browser-skill",
					description: "Renamed skill.",
					markdown: "# Renamed Browser Skill",
				}),
			});
			assert.equal(renamed.status, 200);
			assert.equal((await renamed.json()).skill.name, "renamed-browser-skill");
			assert.deepEqual(unregisteredSkills, ["browser-skill"]);
			assert.deepEqual(registeredSkills.map((skill) => skill.name), ["browser-skill", "renamed-browser-skill"]);

			const dependentAgentResponse = await fetch(`${baseURL}/api/chat/agents`, {
				method: "POST",
				headers: {
					"content-type": "application/json",
					origin: baseURL,
					"x-test-user": "user-1",
				},
				body: JSON.stringify({ displayName: "skill-dependent-agent", skills: ["renamed-browser-skill"] }),
			});
			assert.equal(dependentAgentResponse.status, 201);
			const dependentAgent = (await dependentAgentResponse.json()).agent;

			const blockedDelete = await fetch(`${baseURL}/api/chat/user-skills/${encodeURIComponent(createdPayload.skill.id)}`, {
				method: "DELETE",
				headers: {
					"content-type": "application/json",
					origin: baseURL,
					"x-test-user": "user-1",
				},
				body: "{}",
			});
			assert.equal(blockedDelete.status, 409);
			assert.match((await blockedDelete.json()).error, /selected by custom agents: skill-dependent-agent/);
			const preservedSkill = await fetch(`${baseURL}/api/chat/user-skills/${encodeURIComponent(createdPayload.skill.id)}`, {
				headers: { "x-test-user": "user-1" },
			});
			assert.equal(preservedSkill.status, 200);
			assert.equal((await preservedSkill.json()).skill.name, "renamed-browser-skill");

			const unlinkAgent = await fetch(`${baseURL}/api/chat/agents/${encodeURIComponent(dependentAgent.id)}`, {
				method: "PATCH",
				headers: {
					"content-type": "application/json",
					origin: baseURL,
					"x-test-user": "user-1",
				},
				body: JSON.stringify({ skills: [] }),
			});
			assert.equal(unlinkAgent.status, 200);

			const disabled = await fetch(`${baseURL}/api/chat/user-skills/${encodeURIComponent(createdPayload.skill.id)}`, {
				method: "PATCH",
				headers: {
					"content-type": "application/json",
					origin: baseURL,
					"x-test-user": "user-1",
				},
				body: JSON.stringify({ enabled: false }),
			});
			assert.equal(disabled.status, 200);
			assert.equal((await disabled.json()).skill.enabled, false);
			assert.deepEqual(unregisteredSkills, ["browser-skill", "renamed-browser-skill"]);

			const deleted = await fetch(`${baseURL}/api/chat/user-skills/${encodeURIComponent(createdPayload.skill.id)}`, {
				method: "DELETE",
				headers: {
					"content-type": "application/json",
					origin: baseURL,
					"x-test-user": "user-1",
				},
				body: "{}",
			});
			assert.equal(deleted.status, 200);
			assert.deepEqual(await deleted.json(), { removedSkillId: createdPayload.skill.id });

			const afterDelete = await fetch(`${baseURL}/api/chat/user-skills`, {
				headers: { "x-test-user": "user-1" },
			});
			assert.equal(afterDelete.status, 200);
			assert.deepEqual((await afterDelete.json()).skills, []);
		} finally {
			await channel.stop?.();
		}
	});
});

test("chat web app syncs workspace-local user skills into the capability catalog", async () => {
	const home = mkdtempSync(join(tmpdir(), "pibo-web-skill-home-"));
	const workspace = mkdtempSync(join(tmpdir(), "pibo-web-skill-workspace-"));
	await withHome(home, async () => {
		await withCwd(workspace, async () => {
			const { channel, baseURL, registeredSkills, unregisteredSkills } = await startWebHostChannel({
				auth: createFakeAuthService(),
				profiles: [{ name: "codex-compat-openai-web", aliases: ["codex"] }],
				trackUserSkillRegistry: true,
			});

			try {
				const globalCreated = await fetch(`${baseURL}/api/chat/user-skills`, {
					method: "POST",
					headers: {
						"content-type": "application/json",
						origin: baseURL,
						"x-test-user": "user-1",
					},
					body: JSON.stringify({
						name: "shared-helper",
						description: "Global helper.",
						markdown: "# Shared Helper\n\nUse global guidance.",
						scope: "global",
					}),
				});
				assert.equal(globalCreated.status, 201);
				assert.equal((await globalCreated.json()).skill.scope, "global");

				const workspaceCreated = await fetch(`${baseURL}/api/chat/user-skills`, {
					method: "POST",
					headers: {
						"content-type": "application/json",
						origin: baseURL,
						"x-test-user": "user-1",
					},
					body: JSON.stringify({
						name: "shared-helper",
						description: "Workspace helper.",
						markdown: "# Shared Helper\n\nUse workspace guidance.",
						scope: "workspace",
					}),
				});
				const workspaceCreatedText = await workspaceCreated.clone().text();
				assert.equal(workspaceCreated.status, 201, workspaceCreatedText);
				const workspacePayload = await workspaceCreated.json();
				assert.equal(workspacePayload.skill.scope, "workspace");
				assert.match(workspacePayload.skill.path, new RegExp(`${workspace.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}`));
				assert.ok(
					registeredSkills.some((skill) => skill.name === "shared-helper" && skill.path.includes(workspace)),
					`workspace skill should be registered for runtime loading: ${JSON.stringify(registeredSkills)}`,
				);
				if (unregisteredSkills.length > 0) assert.deepEqual(unregisteredSkills, ["shared-helper"]);

				const listed = await fetch(`${baseURL}/api/chat/user-skills?scope=all`, {
					headers: { "x-test-user": "user-1" },
				});
				assert.equal(listed.status, 200);
				assert.deepEqual((await listed.json()).skills.map((skill) => [skill.name, skill.scope]), [
					["shared-helper", "workspace"],
					["shared-helper", "global"],
				]);

				const readWorkspace = await fetch(`${baseURL}/api/chat/user-skills/${encodeURIComponent(workspacePayload.skill.id)}?scope=workspace`, {
					headers: { "x-test-user": "user-1" },
				});
				assert.equal(readWorkspace.status, 200);
				assert.match((await readWorkspace.json()).markdown, /Use workspace guidance/);
			} finally {
				await channel.stop?.();
			}
		});
	});
});

test("chat web app exposes and updates MCP server descriptions", async () => {
	const cwd = mkdtempSync(join(tmpdir(), "pibo-web-mcp-"));
	const configPath = join(cwd, "mcp_servers.json");
	writeFileSync(configPath, `${JSON.stringify({
		mcpServers: {
			filesystem: {
				command: "node",
				args: ["server.js"],
			},
		},
	}, null, 2)}\n`);
	const previousConfigPath = process.env.MCP_CONFIG_PATH;
	const previousHome = process.env.HOME;
	process.env.MCP_CONFIG_PATH = configPath;
	process.env.HOME = cwd;

	const { channel, baseURL } = await startWebHostChannel({
		auth: createFakeAuthService(),
		profiles: [{ name: "codex-compat-openai-web", aliases: ["codex"] }],
	});

	try {
		const catalog = await fetch(`${baseURL}/api/chat/agent-catalog`, {
			headers: { "x-test-user": "user-1" },
		});
		assert.equal(catalog.status, 200);
		const catalogPayload = await catalog.json();
		assert.deepEqual(catalogPayload.catalog.mcpServers, [
			{
				name: "filesystem",
				transport: "stdio",
				hasDescription: false,
				editable: true,
			},
		]);

		const patched = await fetch(`${baseURL}/api/chat/mcp-servers/filesystem/description`, {
			method: "PATCH",
			headers: {
				"content-type": "application/json",
				origin: baseURL,
				"x-test-user": "user-1",
			},
			body: JSON.stringify({ description: "Access project files through MCP." }),
		});
		assert.equal(patched.status, 200);
		const patchedPayload = await patched.json();
		assert.equal(patchedPayload.server.descriptionSource, "user");

		const config = JSON.parse(readFileSync(configPath, "utf-8"));
		assert.deepEqual(config.mcpServers.filesystem, {
			command: "node",
			args: ["server.js"],
			pibo: {
				description: "Access project files through MCP.",
				descriptionSource: "user",
			},
		});

		const createdAgent = await fetch(`${baseURL}/api/chat/agents`, {
			method: "POST",
			headers: {
				"content-type": "application/json",
				origin: baseURL,
				"x-test-user": "user-1",
			},
			body: JSON.stringify({
				displayName: "mcp-agent",
				mcpServers: ["filesystem"],
			}),
		});
		assert.equal(createdAgent.status, 201);
		const agentPayload = await createdAgent.json();
		assert.deepEqual(agentPayload.agent.mcpServers, ["filesystem"]);
	} finally {
		await channel.stop?.();
		if (previousConfigPath === undefined) {
			delete process.env.MCP_CONFIG_PATH;
		} else {
			process.env.MCP_CONFIG_PATH = previousConfigPath;
		}
		if (previousHome === undefined) {
			delete process.env.HOME;
		} else {
			process.env.HOME = previousHome;
		}
	}
});

test("chat web app updates MCP descriptions in their merged config source", async () => {
	const root = mkdtempSync(join(tmpdir(), "pibo-web-mcp-source-"));
	const project = join(root, "project");
	const home = join(root, "home");
	mkdirSync(project, { recursive: true });
	mkdirSync(home, { recursive: true });
	const projectPath = join(project, "mcp_servers.json");
	const homePath = join(home, "mcp_servers.json");
	writeFileSync(projectPath, `${JSON.stringify({
		mcpServers: {
			local: { command: "node", args: ["local.js"] },
			shared: { command: "node", args: ["project-shared.js"] },
		},
	}, null, 2)}\n`);
	writeFileSync(homePath, `${JSON.stringify({
		mcpServers: {
			inherited: { command: "node", args: ["home.js"], env: { FIXTURE: "preserved" } },
			shared: { command: "node", args: ["home-shared.js"] },
		},
	}, null, 2)}\n`);
	const previousConfigPath = process.env.MCP_CONFIG_PATH;
	const previousHome = process.env.HOME;
	const previousUserProfile = process.env.USERPROFILE;
	process.env.MCP_CONFIG_PATH = projectPath;
	process.env.HOME = home;
	process.env.USERPROFILE = home;
	let first;
	let restarted;

	try {
		first = await startWebHostChannel({
			auth: createFakeAuthService(),
			profiles: [{ name: "codex-compat-openai-web", aliases: ["codex"] }],
		});
		const headers = { "content-type": "application/json", origin: first.baseURL, "x-test-user": "user-1" };
		const catalog = await fetch(`${first.baseURL}/api/chat/agent-catalog`, { headers: { "x-test-user": "user-1" } });
		assert.equal(catalog.status, 200);
		assert.deepEqual((await catalog.json()).catalog.mcpServers.map((server) => server.name), ["local", "shared", "inherited"]);

		for (const [name, description] of [["inherited", "Home description."], ["shared", "Project description."], ["local", "Local description."]]) {
			const response = await fetch(`${first.baseURL}/api/chat/mcp-servers/${name}/description`, {
				method: "PATCH",
				headers,
				body: JSON.stringify({ description }),
			});
			assert.equal(response.status, 200, await response.text());
		}
		await first.channel.stop?.();
		first = undefined;

		restarted = await startWebHostChannel({
			auth: createFakeAuthService(),
			profiles: [{ name: "codex-compat-openai-web", aliases: ["codex"] }],
		});
		const restartedCatalog = await fetch(`${restarted.baseURL}/api/chat/agent-catalog`, { headers: { "x-test-user": "user-1" } });
		assert.equal(restartedCatalog.status, 200);
		const descriptions = new Map((await restartedCatalog.json()).catalog.mcpServers.map((server) => [server.name, server.description]));
		assert.equal(descriptions.get("inherited"), "Home description.");
		assert.equal(descriptions.get("shared"), "Project description.");

		const projectConfig = JSON.parse(readFileSync(projectPath, "utf-8"));
		const homeConfig = JSON.parse(readFileSync(homePath, "utf-8"));
		assert.equal(projectConfig.mcpServers.shared.pibo.description, "Project description.");
		assert.equal(homeConfig.mcpServers.shared.pibo, undefined);
		assert.deepEqual(homeConfig.mcpServers.inherited, {
			command: "node",
			args: ["home.js"],
			env: { FIXTURE: "preserved" },
			pibo: { description: "Home description.", descriptionSource: "user" },
		});

		chmodSync(homePath, 0o444);
		const readOnly = await fetch(`${restarted.baseURL}/api/chat/mcp-servers/inherited/description`, {
			method: "PATCH",
			headers: { "content-type": "application/json", origin: restarted.baseURL, "x-test-user": "user-1" },
			body: JSON.stringify({ description: "Must remain unchanged." }),
		});
		assert.notEqual(readOnly.status, 200);
		assert.equal(JSON.parse(readFileSync(homePath, "utf-8")).mcpServers.inherited.pibo.description, "Home description.");
		chmodSync(homePath, 0o644);

		rmSync(homePath);
		const missing = await fetch(`${restarted.baseURL}/api/chat/mcp-servers/inherited/description`, {
			method: "PATCH",
			headers: { "content-type": "application/json", origin: restarted.baseURL, "x-test-user": "user-1" },
			body: JSON.stringify({ description: "Must not move." }),
		});
		assert.notEqual(missing.status, 200);
		assert.equal(JSON.parse(readFileSync(projectPath, "utf-8")).mcpServers.inherited, undefined);
		assert.equal(statSync(projectPath).isFile(), true);
	} finally {
		await first?.channel.stop?.();
		await restarted?.channel.stop?.();
		if (previousConfigPath === undefined) delete process.env.MCP_CONFIG_PATH;
		else process.env.MCP_CONFIG_PATH = previousConfigPath;
		if (previousHome === undefined) delete process.env.HOME;
		else process.env.HOME = previousHome;
		if (previousUserProfile === undefined) delete process.env.USERPROFILE;
		else process.env.USERPROFILE = previousUserProfile;
		rmSync(root, { recursive: true, force: true });
	}
});

test("chat agent API updates release MCP config removal guards and persist across restart", async () => {
	const root = mkdtempSync(join(tmpdir(), "pibo-web-mcp-remove-"));
	const agentStorePath = join(root, "chat-agents.sqlite");
	const configPath = join(root, "mcp_servers.json");
	writeFileSync(configPath, JSON.stringify({
		mcpServers: { selected: { command: "node", args: ["selected.js"] } },
	}));
	const previousPiboHome = process.env.PIBO_HOME;
	const previousConfigPath = process.env.MCP_CONFIG_PATH;
	process.env.PIBO_HOME = root;
	process.env.MCP_CONFIG_PATH = configPath;
	let firstChannel;
	let restartedChannel;
	try {
		const first = await startWebHostChannel({
			auth: createFakeAuthService(),
			chat: { agentStorePath },
		});
		firstChannel = first.channel;
		const headers = {
			"content-type": "application/json",
			origin: first.baseURL,
			"x-test-user": "user-1",
		};
		const created = await fetch(`${first.baseURL}/api/chat/agents`, {
			method: "POST",
			headers,
			body: JSON.stringify({ displayName: "api-selected", mcpServers: ["selected"] }),
		});
		assert.equal(created.status, 201);
		const agent = (await created.json()).agent;

		await assert.rejects(
			configCommand({ action: "remove", name: "selected", configPath }),
			/MCP_SERVER_IN_USE[\s\S]*api-selected/,
		);
		const updated = await fetch(`${first.baseURL}/api/chat/agents/${encodeURIComponent(agent.id)}`, {
			method: "PATCH",
			headers,
			body: JSON.stringify({ mcpServers: [] }),
		});
		assert.equal(updated.status, 200);
		assert.deepEqual((await updated.json()).agent.mcpServers, []);
		await configCommand({ action: "remove", name: "selected", configPath });

		await first.channel.stop?.();
		firstChannel = undefined;
		const restarted = await startWebHostChannel({
			auth: createFakeAuthService(),
			chat: { agentStorePath },
		});
		restartedChannel = restarted.channel;
		const listed = await fetch(`${restarted.baseURL}/api/chat/agents?includeArchived=true`, {
			headers: { "x-test-user": "user-1" },
		});
		assert.equal(listed.status, 200);
		assert.deepEqual((await listed.json()).agents.find((item) => item.id === agent.id).mcpServers, []);

		await configCommand({
			action: "add",
			name: "selected",
			serverJson: JSON.stringify({ command: "node", args: ["restored.js"] }),
			configPath,
		});
		const restoredSelection = await fetch(`${restarted.baseURL}/api/chat/agents/${encodeURIComponent(agent.id)}`, {
			method: "PATCH",
			headers: {
				"content-type": "application/json",
				origin: restarted.baseURL,
				"x-test-user": "user-1",
			},
			body: JSON.stringify({ mcpServers: ["selected"] }),
		});
		assert.equal(restoredSelection.status, 200);
		await assert.rejects(
			configCommand({ action: "remove", name: "selected", configPath }),
			/MCP_SERVER_IN_USE[\s\S]*api-selected/,
		);
		assert.ok(JSON.parse(readFileSync(configPath, "utf8")).mcpServers.selected);
	} finally {
		await firstChannel?.stop?.();
		await restartedChannel?.stop?.();
		if (previousPiboHome === undefined) delete process.env.PIBO_HOME;
		else process.env.PIBO_HOME = previousPiboHome;
		if (previousConfigPath === undefined) delete process.env.MCP_CONFIG_PATH;
		else process.env.MCP_CONFIG_PATH = previousConfigPath;
		rmSync(root, { recursive: true, force: true });
	}
});

test("chat web app archives and permanently deletes custom agents with their sessions", async () => {
	const deletionOrder = [];
	const { channel, baseURL, sessions } = await startWebHostChannel({
		auth: createFakeAuthService(),
		profiles: [{ name: "codex-compat-openai-web", aliases: ["codex"] }],
		async deleteSession(id, store) {
			await new Promise((resolve) => setTimeout(resolve, 25));
			deletionOrder.push(id);
			return store.delete(id);
		},
	});

	try {
		const createdAgent = await fetch(`${baseURL}/api/chat/agents`, {
			method: "POST",
			headers: {
				"content-type": "application/json",
				origin: baseURL,
				"x-test-user": "user-1",
			},
			body: JSON.stringify({ displayName: "delete-agent" }),
		});
		assert.equal(createdAgent.status, 201);
		const agentPayload = await createdAgent.json();

		const createdSession = await fetch(`${baseURL}/api/chat/sessions`, {
			method: "POST",
			headers: {
				"content-type": "application/json",
				origin: baseURL,
				"x-test-user": "user-1",
			},
			body: JSON.stringify({ profile: "delete-agent" }),
		});
		assert.equal(createdSession.status, 201);
		const sessionPayload = await createdSession.json();
		const childSession = sessions.create({
			channel: "pibo.chat-web",
			kind: "chat",
			profile: "codex-compat-openai-web",
			parentId: sessionPayload.session.id,
		});

		const deleteBeforeArchive = await fetch(`${baseURL}/api/chat/agents/${encodeURIComponent(agentPayload.agent.id)}`, {
			method: "DELETE",
			headers: {
				"content-type": "application/json",
				origin: baseURL,
				"x-test-user": "user-1",
			},
			body: JSON.stringify({ confirmName: "delete-agent" }),
		});
		assert.equal(deleteBeforeArchive.status, 400);
		assert.deepEqual(await deleteBeforeArchive.json(), { error: "Archive the agent before permanently deleting it." });

		const archived = await fetch(`${baseURL}/api/chat/agents/${encodeURIComponent(agentPayload.agent.id)}`, {
			method: "PATCH",
			headers: {
				"content-type": "application/json",
				origin: baseURL,
				"x-test-user": "user-1",
			},
			body: JSON.stringify({ archived: true }),
		});
		assert.equal(archived.status, 200);
		const archivedPayload = await archived.json();
		assert.equal(typeof archivedPayload.agent.archivedAt, "string");

		const listed = await fetch(`${baseURL}/api/chat/agents`, {
			headers: { "x-test-user": "user-1" },
		});
		assert.deepEqual((await listed.json()).agents, []);
		const listedArchived = await fetch(`${baseURL}/api/chat/agents?includeArchived=true`, {
			headers: { "x-test-user": "user-1" },
		});
		assert.deepEqual((await listedArchived.json()).agents.map((agent) => agent.profileName), ["delete-agent"]);

		const rejectedSession = await fetch(`${baseURL}/api/chat/sessions`, {
			method: "POST",
			headers: {
				"content-type": "application/json",
				origin: baseURL,
				"x-test-user": "user-1",
			},
			body: JSON.stringify({ profile: "delete-agent" }),
		});
		assert.equal(rejectedSession.status, 400);
		assert.deepEqual(await rejectedSession.json(), { error: 'Unknown profile "delete-agent"' });

		const wrongConfirm = await fetch(`${baseURL}/api/chat/agents/${encodeURIComponent(agentPayload.agent.id)}`, {
			method: "DELETE",
			headers: {
				"content-type": "application/json",
				origin: baseURL,
				"x-test-user": "user-1",
			},
			body: JSON.stringify({ confirmName: "wrong-agent" }),
		});
		assert.equal(wrongConfirm.status, 400);
		assert.deepEqual(await wrongConfirm.json(), {
			error: 'Type "delete-agent" to permanently delete this agent and its sessions.',
		});

		const deleted = await fetch(`${baseURL}/api/chat/agents/${encodeURIComponent(agentPayload.agent.id)}`, {
			method: "DELETE",
			headers: {
				"content-type": "application/json",
				origin: baseURL,
				"x-test-user": "user-1",
			},
			body: JSON.stringify({ confirmName: "delete-agent" }),
		});
		assert.equal(deleted.status, 200);
		const deletedPayload = await deleted.json();
		assert.deepEqual(new Set(deletedPayload.deletedSessionIds), new Set([sessionPayload.session.id, childSession.id]));
		assert.deepEqual(deletionOrder, [childSession.id, sessionPayload.session.id]);
		assert.equal(sessions.get(sessionPayload.session.id), undefined);
		assert.equal(sessions.get(childSession.id), undefined);
	} finally {
		await channel.stop?.();
	}
});

test("chat web app preserves subagent targets until all dependents update away", async () => {
	const deletedSessionIds = [];
	const { channel, baseURL, sessions } = await startWebHostChannel({
		auth: createFakeAuthService(),
		profiles: [{ name: "codex-compat-openai-web", aliases: ["codex"] }],
		async deleteSession(id, store) {
			deletedSessionIds.push(id);
			return store.delete(id);
		},
	});
	const headers = {
		"content-type": "application/json",
		origin: baseURL,
		"x-test-user": "user-1",
	};
	const createAgent = async (body) => {
		const response = await fetch(`${baseURL}/api/chat/agents`, {
			method: "POST",
			headers,
			body: JSON.stringify(body),
		});
		assert.equal(response.status, 201);
		return (await response.json()).agent;
	};
	const patchAgent = (id, body) => fetch(`${baseURL}/api/chat/agents/${encodeURIComponent(id)}`, {
		method: "PATCH",
		headers,
		body: JSON.stringify(body),
	});
	const deleteAgent = (id, confirmName) => fetch(`${baseURL}/api/chat/agents/${encodeURIComponent(id)}`, {
		method: "DELETE",
		headers,
		body: JSON.stringify({ confirmName }),
	});

	try {
		const target = await createAgent({ displayName: "shared-target" });
		const first = await createAgent({
			displayName: "first-parent",
			subagents: [{ name: "helper", targetProfile: target.profileName }],
		});
		const second = await createAgent({
			displayName: "second-parent",
			subagents: [{ name: "reviewer", targetProfile: target.id }],
		});
		const sessionResponse = await fetch(`${baseURL}/api/chat/sessions`, {
			method: "POST",
			headers,
			body: JSON.stringify({ profile: target.profileName }),
		});
		assert.equal(sessionResponse.status, 201);
		const targetSession = (await sessionResponse.json()).session;

		const archiveWithTwoDependents = await patchAgent(target.id, { archived: true });
		assert.equal(archiveWithTwoDependents.status, 409);
		assert.deepEqual(await archiveWithTwoDependents.json(), {
			error: 'Custom agent "shared-target" is targeted by active custom agents: first-parent, second-parent',
		});

		assert.equal((await patchAgent(second.id, { archived: true })).status, 200);
		const archiveWithOneDependent = await patchAgent(target.id, { archived: true });
		assert.equal(archiveWithOneDependent.status, 409);
		assert.deepEqual(await archiveWithOneDependent.json(), {
			error: 'Custom agent "shared-target" is targeted by active custom agents: first-parent',
		});

		assert.equal((await patchAgent(first.id, { archived: true })).status, 200);
		assert.equal((await patchAgent(target.id, { archived: true })).status, 200);
		const blockedDelete = await deleteAgent(target.id, target.profileName);
		assert.equal(blockedDelete.status, 409);
		assert.deepEqual(await blockedDelete.json(), {
			error: 'Custom agent "shared-target" is targeted by custom agents: first-parent, second-parent',
		});
		assert.deepEqual(deletedSessionIds, []);
		assert.ok(sessions.get(targetSession.id));

		assert.equal((await patchAgent(first.id, { subagents: [] })).status, 200);
		assert.equal((await patchAgent(second.id, { subagents: [] })).status, 200);
		const deleted = await deleteAgent(target.id, target.profileName);
		assert.equal(deleted.status, 200);
		assert.deepEqual(await deleted.json(), {
			deletedAgentId: target.id,
			deletedSessionIds: [targetSession.id],
		});
		assert.deepEqual(deletedSessionIds, [targetSession.id]);
		assert.equal(sessions.get(targetSession.id), undefined);

		const selfTarget = await createAgent({
			displayName: "self-target",
			subagents: [{ name: "self", targetProfile: "self-target" }],
		});
		assert.equal((await patchAgent(selfTarget.id, { archived: true })).status, 200);
		assert.equal((await deleteAgent(selfTarget.id, selfTarget.profileName)).status, 200);
	} finally {
		await channel.stop?.();
	}
});

test("chat web app validates custom agent profile names", async () => {
	const { channel, baseURL } = await startWebHostChannel({
		auth: createFakeAuthService(),
		profiles: [{ name: "codex-compat-openai-web", aliases: ["codex"] }],
	});

	try {
		const invalid = await fetch(`${baseURL}/api/chat/agents`, {
			method: "POST",
			headers: {
				"content-type": "application/json",
				origin: baseURL,
				"x-test-user": "user-1",
			},
			body: JSON.stringify({ displayName: "Test Agent" }),
		});
		assert.equal(invalid.status, 400);
		assert.deepEqual(await invalid.json(), { error: "Agent name must be lowercase kebab-case, for example test-agent" });

		const conflicting = await fetch(`${baseURL}/api/chat/agents`, {
			method: "POST",
			headers: {
				"content-type": "application/json",
				origin: baseURL,
				"x-test-user": "user-1",
			},
			body: JSON.stringify({ displayName: "codex-compat-openai-web" }),
		});
		assert.equal(conflicting.status, 400);
		assert.deepEqual(await conflicting.json(), { error: 'Agent name "codex-compat-openai-web" conflicts with an existing profile' });
	} finally {
		await channel.stop?.();
	}
});

test("chat web app canonicalizes legacy custom agent session profile aliases", async () => {
	const { channel, baseURL, sessions } = await startWebHostChannel({
		auth: createFakeAuthService(),
		profiles: [
			{
				name: "test-agent",
				aliases: ["agent_02d60a56-9bd4-4606-921b-495e3daf69d8", "custom-agent:agent_02d60a56-9bd4-4606-921b-495e3daf69d8"],
			},
		],
	});

	try {
		const legacySession = sessions.create({
			channel: "pibo.chat-web",
			kind: "chat",
			profile: "custom-agent:agent_02d60a56-9bd4-4606-921b-495e3daf69d8",
		});
		const response = await fetch(`${baseURL}/api/chat/bootstrap?piboSessionId=${encodeURIComponent(legacySession.id)}`, {
			headers: { "x-test-user": "user-1" },
		});
		assert.equal(response.status, 200);
		const payload = await response.json();
		assert.equal(payload.session.profile, "test-agent");
		assert.equal(sessions.get(legacySession.id).profile, "test-agent");
		assert.equal(payload.sessions.find((session) => session.piboSessionId === legacySession.id).profile, "test-agent");
	} finally {
		await channel.stop?.();
	}
});

test("chat web app archives sessions as read and excludes them from room unread counts", async () => {
	const { channel, baseURL, emitOutput } = await startWebHostChannel({
		auth: createFakeAuthService(),
	});

	try {
		const sessionResponse = await fetch(`${baseURL}/api/chat/session`, {
			headers: { "x-test-user": "user-1" },
		});
		assert.equal(sessionResponse.status, 200);
		const payload = await sessionResponse.json();

		emitOutput({
			type: "assistant_message",
			piboSessionId: payload.session.id,
			eventId: "archive-unread-turn",
			text: "archive me",
		});
		emitOutput({
			type: "message_finished",
			piboSessionId: payload.session.id,
			eventId: "archive-unread-turn",
		});

		let bootstrap = await fetch(`${baseURL}/api/chat/bootstrap?markRead=false&piboSessionId=${encodeURIComponent(payload.session.id)}`, {
			headers: { "x-test-user": "user-1" },
		});
		assert.equal(bootstrap.status, 200);
		let bootstrapPayload = await bootstrap.json();
		assert.equal(bootstrapPayload.rooms[0].unreadCount, 1);
		assert.equal(bootstrapPayload.sessions[0].unreadCount, 1);

		const archived = await fetch(`${baseURL}/api/chat/sessions/${encodeURIComponent(payload.session.id)}`, {
			method: "PATCH",
			headers: {
				"content-type": "application/json",
				origin: baseURL,
				"x-test-user": "user-1",
			},
			body: JSON.stringify({ archived: true }),
		});
		assert.equal(archived.status, 200);

		bootstrap = await fetch(`${baseURL}/api/chat/bootstrap?markRead=false&includeArchived=true&piboSessionId=${encodeURIComponent(payload.session.id)}`, {
			headers: { "x-test-user": "user-1" },
		});
		assert.equal(bootstrap.status, 200);
		bootstrapPayload = await bootstrap.json();
		assert.equal(bootstrapPayload.rooms[0].unreadCount, undefined);
		assert.equal(bootstrapPayload.sessions[0].unreadCount, undefined);

		const restored = await fetch(`${baseURL}/api/chat/sessions/${encodeURIComponent(payload.session.id)}`, {
			method: "PATCH",
			headers: {
				"content-type": "application/json",
				origin: baseURL,
				"x-test-user": "user-1",
			},
			body: JSON.stringify({ archived: false }),
		});
		assert.equal(restored.status, 200);

		bootstrap = await fetch(`${baseURL}/api/chat/bootstrap?markRead=false&piboSessionId=${encodeURIComponent(payload.session.id)}`, {
			headers: { "x-test-user": "user-1" },
		});
		assert.equal(bootstrap.status, 200);
		bootstrapPayload = await bootstrap.json();
		assert.equal(bootstrapPayload.rooms[0].unreadCount, undefined);
		assert.equal(bootstrapPayload.sessions[0].unreadCount, undefined);
	} finally {
		await channel.stop?.();
	}
});

test("chat web app renames and archives shared sessions", async () => {
	const { channel, baseURL } = await startWebHostChannel({
		auth: createFakeAuthService(),
	});

	try {
		const created = await fetch(`${baseURL}/api/chat/sessions`, {
			method: "POST",
			headers: {
				"content-type": "application/json",
				origin: baseURL,
				"x-test-user": "user-1",
			},
			body: "{}",
		});
		assert.equal(created.status, 201);
		const payload = await created.json();

		const renamed = await fetch(`${baseURL}/api/chat/sessions/${encodeURIComponent(payload.session.id)}`, {
			method: "PATCH",
			headers: {
				"content-type": "application/json",
				origin: baseURL,
				"x-test-user": "user-1",
			},
			body: JSON.stringify({ title: "Renamed Session" }),
		});
		assert.equal(renamed.status, 200);
		const renamedPayload = await renamed.json();
		assert.equal(renamedPayload.session.title, "Renamed Session");

		const bootstrap = await fetch(`${baseURL}/api/chat/bootstrap?piboSessionId=${encodeURIComponent(payload.session.id)}`, {
			headers: { "x-test-user": "user-1" },
		});
		assert.equal(bootstrap.status, 200);
		const bootstrapPayload = await bootstrap.json();
		assert.equal(
			bootstrapPayload.sessions.find((session) => session.piboSessionId === payload.session.id)?.title,
			"Renamed Session",
		);

		const archived = await fetch(`${baseURL}/api/chat/sessions/${encodeURIComponent(payload.session.id)}`, {
			method: "PATCH",
			headers: {
				"content-type": "application/json",
				origin: baseURL,
				"x-test-user": "user-1",
			},
			body: JSON.stringify({ archived: true }),
		});
		assert.equal(archived.status, 200);
		const archivedPayload = await archived.json();
		assert.equal(typeof archivedPayload.session.metadata.chatWebArchivedAt, "string");

		const defaultBootstrap = await fetch(`${baseURL}/api/chat/bootstrap`, {
			headers: { "x-test-user": "user-1" },
		});
		assert.equal(defaultBootstrap.status, 200);
		const defaultPayload = await defaultBootstrap.json();
		assert.equal(defaultPayload.sessions.some((session) => session.piboSessionId === payload.session.id), false);

		const archivedBootstrap = await fetch(`${baseURL}/api/chat/bootstrap?includeArchived=true`, {
			headers: { "x-test-user": "user-1" },
		});
		assert.equal(archivedBootstrap.status, 200);
		const archivedBootstrapPayload = await archivedBootstrap.json();
		const archivedNode = archivedBootstrapPayload.sessions.find((session) => session.piboSessionId === payload.session.id);
		assert.ok(archivedNode);
		assert.equal(archivedNode.archived, true);
	} finally {
		await channel.stop?.();
	}
});

test("chat web app changes session profiles only before the first trace event", async () => {
	const { channel, baseURL, emitOutput } = await startWebHostChannel({
		auth: createFakeAuthService(),
		profiles: [
			{ name: "codex-compat-openai-web", aliases: ["codex"] },
			{ name: "pibo-kimi-coding", aliases: ["kimi"] },
		],
	});

	try {
		const created = await fetch(`${baseURL}/api/chat/sessions`, {
			method: "POST",
			headers: {
				"content-type": "application/json",
				origin: baseURL,
				"x-test-user": "user-1",
			},
			body: JSON.stringify({ profile: "codex" }),
		});
		assert.equal(created.status, 201);
		const payload = await created.json();

		const changed = await fetch(`${baseURL}/api/chat/sessions/${encodeURIComponent(payload.session.id)}`, {
			method: "PATCH",
			headers: {
				"content-type": "application/json",
				origin: baseURL,
				"x-test-user": "user-1",
			},
			body: JSON.stringify({ profile: "kimi" }),
		});
		assert.equal(changed.status, 200);
		const changedPayload = await changed.json();
		assert.equal(changedPayload.session.profile, "pibo-kimi-coding");

		emitOutput({
			type: "assistant_message",
			piboSessionId: payload.session.id,
			eventId: "trace-start",
			text: "started",
		});

		const rejected = await fetch(`${baseURL}/api/chat/sessions/${encodeURIComponent(payload.session.id)}`, {
			method: "PATCH",
			headers: {
				"content-type": "application/json",
				origin: baseURL,
				"x-test-user": "user-1",
			},
			body: JSON.stringify({ profile: "codex" }),
		});
		assert.equal(rejected.status, 400);
		assert.deepEqual(await rejected.json(), {
			error: "Session profile can only be changed before the first message.",
		});
	} finally {
		await channel.stop?.();
	}
});

test("chat web app permanently deletes archived sessions with their child sessions", async () => {
	const { channel, baseURL, sessions } = await startWebHostChannel({
		auth: createFakeAuthService(),
	});

	try {
		const created = await fetch(`${baseURL}/api/chat/sessions`, {
			method: "POST",
			headers: {
				"content-type": "application/json",
				origin: baseURL,
				"x-test-user": "user-1",
			},
			body: "{}",
		});
		assert.equal(created.status, 201);
		const payload = await created.json();
		const childSession = sessions.create({
			channel: "pibo.chat-web",
			kind: "subagent",
			profile: "codex-compat-openai-web",
			parentId: payload.session.id,
		});

		const deleteBeforeArchive = await fetch(`${baseURL}/api/chat/sessions/${encodeURIComponent(payload.session.id)}`, {
			method: "DELETE",
			headers: {
				"content-type": "application/json",
				origin: baseURL,
				"x-test-user": "user-1",
			},
			body: JSON.stringify({ confirmText: "Delete this session" }),
		});
		assert.equal(deleteBeforeArchive.status, 400);
		assert.deepEqual(await deleteBeforeArchive.json(), { error: "Archive the session before permanently deleting it." });

		const archived = await fetch(`${baseURL}/api/chat/sessions/${encodeURIComponent(payload.session.id)}`, {
			method: "PATCH",
			headers: {
				"content-type": "application/json",
				origin: baseURL,
				"x-test-user": "user-1",
			},
			body: JSON.stringify({ archived: true }),
		});
		assert.equal(archived.status, 200);

		const wrongConfirm = await fetch(`${baseURL}/api/chat/sessions/${encodeURIComponent(payload.session.id)}`, {
			method: "DELETE",
			headers: {
				"content-type": "application/json",
				origin: baseURL,
				"x-test-user": "user-1",
			},
			body: JSON.stringify({ confirmText: "delete" }),
		});
		assert.equal(wrongConfirm.status, 400);
		assert.deepEqual(await wrongConfirm.json(), {
			error: 'Type "Delete this session" to permanently delete this session.',
		});

		const deleted = await fetch(`${baseURL}/api/chat/sessions/${encodeURIComponent(payload.session.id)}`, {
			method: "DELETE",
			headers: {
				"content-type": "application/json",
				origin: baseURL,
				"x-test-user": "user-1",
			},
			body: JSON.stringify({ confirmText: "Delete this session" }),
		});
		assert.equal(deleted.status, 200);
		const deletedPayload = await deleted.json();
		assert.deepEqual(new Set(deletedPayload.deletedSessionIds), new Set([payload.session.id, childSession.id]));
		assert.equal(sessions.get(payload.session.id), undefined);
		assert.equal(sessions.get(childSession.id), undefined);
	} finally {
		await channel.stop?.();
	}
});

test("chat web app renders origin sessions as top-level sessions", async () => {
	const { channel, baseURL, sessions } = await startWebHostChannel({
		auth: createFakeAuthService(),
	});

	try {
		const root = await fetch(`${baseURL}/api/chat/session`, {
			headers: { "x-test-user": "user-1" },
		});
		assert.equal(root.status, 200);
		const rootPayload = await root.json();

		const origin = sessions.create({
			channel: "pibo.chat-web",
			kind: "branch",
			profile: "codex-compat-openai-web",
			originId: rootPayload.session.id,
		});

		const bootstrap = await fetch(`${baseURL}/api/chat/bootstrap`, {
			headers: { "x-test-user": "user-1" },
		});
		assert.equal(bootstrap.status, 200);
		const data = await bootstrap.json();
		const originNode = data.sessions.find((session) => session.piboSessionId === origin.id);
		const rootNode = data.sessions.find((session) => session.piboSessionId === rootPayload.session.id);
		assert.ok(originNode);
		assert.ok(rootNode);
		assert.equal(originNode.parentId, undefined);
		assert.equal(rootNode.children.some((session) => session.piboSessionId === origin.id), false);
	} finally {
		await channel.stop?.();
	}
});

test("chat web app rejects authenticated users that auth marks forbidden", async () => {
	const { channel, baseURL } = await startWebHostChannel({
		auth: {
			name: "forbidden-auth",
			async getSession() {
				throw new PiboAuthError("Forbidden", 403);
			},
			async requireSession() {
				throw new PiboAuthError("Forbidden", 403);
			},
		},
	});

	try {
		const response = await fetch(`${baseURL}/api/chat/session`, {
			headers: { "x-test-user": "user-1" },
		});
		assert.equal(response.status, 403);
		assert.deepEqual(await response.json(), { error: "Forbidden" });
	} finally {
		await channel.stop?.();
	}
});

test("chat web app rejects cross-origin mutation requests", async () => {
	const { channel, baseURL, emitted } = await startWebHostChannel({
		auth: createFakeAuthService(),
	});

	try {
		const response = await fetch(`${baseURL}/api/chat/message`, {
			method: "POST",
			headers: {
				"content-type": "application/json",
				origin: "https://attacker.example",
				"x-test-user": "user-1",
			},
			body: JSON.stringify({ text: "hello" }),
		});
		assert.equal(response.status, 403);
		assert.deepEqual(await response.json(), { error: "Origin is not allowed" });
		assert.equal(emitted.length, 0);
	} finally {
		await channel.stop?.();
	}
});

test("chat web status refresh returns a snapshot without emitting a new execution result", async () => {
	const snapshotCalls = [];
	const { channel, baseURL, emitted, sessions } = await startWebHostChannel({
		auth: createFakeAuthService(),
		async getSessionStatusSnapshot(piboSessionId) {
			snapshotCalls.push(piboSessionId);
			return {
				piboSessionId,
				activeModel: { provider: "openai", id: "gpt-test" },
				queuedMessages: 0,
				processing: false,
				streaming: false,
				activeTools: ["read"],
				enabledTools: ["read"],
				cwd: "/workspace",
				disposed: false,
				contextUsage: { tokens: 250, contextWindow: 1000, percent: 25 },
				pendingApprovals: [{
					requestId: "approval-product-id",
					requestType: "command_execution",
					title: "Run command",
				}],
				pendingUserInputs: [{
					requestId: "input-product-id",
					questions: [{ id: "approach", question: "Which approach?" }],
					blocking: true,
				}],
			};
		},
	});
	const session = sessions.create({
		channel: "pibo.chat-web",
		kind: "chat",
		profile: "base",
		title: "Status refresh fixture",
	});

	try {
		const response = await fetch(`${baseURL}/api/chat/status?piboSessionId=${encodeURIComponent(session.id)}`, {
			headers: { "x-test-user": "user-1" },
		});
		assert.equal(response.status, 200);
		assert.equal(response.headers.get("cache-control"), "no-store");
		const payload = await response.json();
		assert.equal(payload.piboSessionId, session.id);
		assert.equal(payload.contextUsage.percent, 25);
		assert.deepEqual(payload.pendingApprovals.map((request) => request.requestId), ["approval-product-id"]);
		assert.deepEqual(payload.pendingUserInputs.map((request) => request.requestId), ["input-product-id"]);
		assert.deepEqual(snapshotCalls, [session.id]);
		assert.equal(emitted.length, 0, "refreshing status must not append a trace event");
	} finally {
		await channel.stop?.();
	}
});

test("chat web forwards runtime approval and structured-input response actions generically", async () => {
	const { channel, baseURL, emitted, sessions } = await startWebHostChannel({
		auth: createFakeAuthService(),
	});
	const session = sessions.create({
		channel: "pibo.chat-web",
		kind: "chat",
		profile: "base",
		title: "Runtime request response fixture",
	});

	try {
		const approvalResponse = await fetch(`${baseURL}/api/chat/action`, {
			method: "POST",
			headers: {
				"content-type": "application/json",
				origin: baseURL,
				"x-test-user": "user-1",
			},
			body: JSON.stringify({
				piboSessionId: session.id,
				action: "runtime.approval.respond",
				params: { requestId: "approval-product-id", decision: "accept" },
			}),
		});
		assert.equal(approvalResponse.status, 200);
		assert.equal((await approvalResponse.json()).action, "runtime.approval.respond");

		const userInputResponse = await fetch(`${baseURL}/api/chat/action`, {
			method: "POST",
			headers: {
				"content-type": "application/json",
				origin: baseURL,
				"x-test-user": "user-1",
			},
			body: JSON.stringify({
				piboSessionId: session.id,
				action: "runtime.user_input.respond",
				params: { requestId: "input-product-id", answers: { approach: "Safe" } },
			}),
		});
		assert.equal(userInputResponse.status, 200);
		assert.equal((await userInputResponse.json()).action, "runtime.user_input.respond");
		assert.deepEqual(emitted.map((event) => ({ action: event.action, params: event.params })), [
			{ action: "runtime.approval.respond", params: { requestId: "approval-product-id", decision: "accept" } },
			{ action: "runtime.user_input.respond", params: { requestId: "input-product-id", answers: { approach: "Safe" } } },
		]);
	} finally {
		await channel.stop?.();
	}
});

test("chat web provider auth compatibility rejects an arbitrary missing session instead of bypassing runtime targeting", async () => {
	const { channel, baseURL, emitted } = await startWebHostChannel({
		auth: createFakeAuthService(),
	});

	try {
		const response = await fetch(`${baseURL}/api/chat/action`, {
			method: "POST",
			headers: {
				"content-type": "application/json",
				origin: baseURL,
				"x-test-user": "user-1",
			},
			body: JSON.stringify({ piboSessionId: "ps_missing_auth", action: "login.status", params: {} }),
		});
		assert.equal(response.status, 404);
		assert.deepEqual(await response.json(), { error: "Session not found" });
		assert.equal(emitted.length, 0);
	} finally {
		await channel.stop?.();
	}
});

test("chat web provider auth API aggregates per-runtime state and routes pending, retry, completion, and logout explicitly", async () => {
	const piCapabilities = fakeRuntimeCapabilities();
	piCapabilities.auth = {
		status: true,
		methods: [
			{ id: "device_code", completion: "explicit" },
			{ id: "api_key", completion: "immediate" },
		],
		cancel: true,
		logout: true,
		credentialScope: "adapter-shared",
	};
	const codexCapabilities = fakeRuntimeCapabilities();
	codexCapabilities.auth = {
		status: true,
		methods: [
			{ id: "device_code", completion: "notification" },
			{ id: "api_key", completion: "immediate" },
		],
		cancel: true,
		logout: true,
		credentialScope: "runtime-instance",
	};
	const methods = codexCapabilities.auth.methods;
	const statuses = new Map([
		["pi", [
			{ id: "openai-codex", displayName: "OpenAI", state: "connected", configured: true, methods: piCapabilities.auth.methods },
			{ id: "anthropic", displayName: "Anthropic", state: "disconnected", configured: false, methods: [{ id: "api_key", completion: "immediate" }] },
		]],
		["codex-native", [
			{ id: "openai-codex", displayName: "OpenAI for native Codex", state: "disconnected", configured: false, methods },
		]],
	]);
	const calls = [];
	let completionReads = 0;
	const inspections = () => [
		fakeRuntimeInspection("pi", { adapterId: "pi", displayName: "Pi Coding Agent", capabilities: piCapabilities, auth: statuses.get("pi") }),
		fakeRuntimeInspection("codex-native", { adapterId: "codex-native", displayName: "Codex App Server", capabilities: codexCapabilities, auth: statuses.get("codex-native") }),
	];
	const capabilityCatalog = {
		agentRuntimes: inspections(),
		nativeTools: [],
		skills: [],
		subagents: [],
		contextFiles: [],
		packages: [],
		piboTools: [],
		mcpServers: [],
		piPackages: [],
		loopStopConditions: [],
		ralphStopConditions: [],
	};
	const { channel, baseURL, emitted, sessions } = await startWebHostChannel({
		auth: createFakeAuthService(),
		capabilityCatalog,
		inspectAgentRuntimeInstances: async () => inspections(),
		getAgentRuntimeAuthStatus: async (runtimeInstanceId) => structuredClone(statuses.get(runtimeInstanceId) ?? []),
		startAgentRuntimeAuth: async (runtimeInstanceId, input) => {
			calls.push({ operation: "start", runtimeInstanceId, providerId: input.providerId, method: input.method });
			if (input.method === "api_key") {
				return {
					runtimeInstanceId,
					providerId: input.providerId,
					state: "connected",
					configured: true,
					details: { accountType: "api_key" },
				};
			}
			const flow = {
				flowId: "flow-codex-web",
				method: "device_code",
				completion: "notification",
				startedAt: "2026-08-16T00:00:00.000Z",
				verificationUrl: "https://example.invalid/device",
				userCode: "FAKE-CODE",
			};
			statuses.set(runtimeInstanceId, [{
				id: input.providerId,
				displayName: "OpenAI for native Codex",
				state: "pending",
				configured: false,
				methods,
				pending: flow,
			}]);
			return { runtimeInstanceId, providerId: input.providerId, state: "pending", configured: false, flow };
		},
		completeAgentRuntimeAuth: async (runtimeInstanceId, input) => {
			completionReads += 1;
			calls.push({ operation: "complete", runtimeInstanceId, providerId: input.providerId, flowId: input.flowId });
			if (completionReads === 1) {
				return {
					runtimeInstanceId,
					providerId: input.providerId,
					state: "pending",
					configured: false,
					flow: statuses.get(runtimeInstanceId)[0].pending,
				};
			}
			statuses.set(runtimeInstanceId, [{
				id: input.providerId,
				displayName: "OpenAI for native Codex",
				state: "connected",
				configured: true,
				methods,
				details: { accountType: "chatgpt", planType: "plus" },
			}]);
			return { runtimeInstanceId, providerId: input.providerId, state: "connected", configured: true, details: { accountType: "chatgpt", planType: "plus" } };
		},
		cancelAgentRuntimeAuth: async (runtimeInstanceId, input) => ({ runtimeInstanceId, providerId: input.providerId, state: "disconnected", configured: false }),
		logoutAgentRuntimeAuth: async (runtimeInstanceId, input) => {
			calls.push({ operation: "logout", runtimeInstanceId, providerId: input.providerId });
			statuses.set(runtimeInstanceId, [{ id: input.providerId, displayName: "OpenAI for native Codex", state: "disconnected", configured: false, methods }]);
			return { runtimeInstanceId, providerId: input.providerId, state: "disconnected", configured: false };
		},
	});
	const headers = {
		"content-type": "application/json",
		origin: baseURL,
		"x-test-user": "user-1",
	};

	try {
		const catalogResponse = await fetch(`${baseURL}/api/chat/provider-auth`, { headers: { "x-test-user": "user-1" } });
		assert.equal(catalogResponse.status, 200);
		const catalog = await catalogResponse.json();
		assert.equal(catalog.defaultRuntimeInstanceId, "pi");
		assert.deepEqual(catalog.targets.map((target) => ({
			id: target.runtimeInstanceId,
			state: target.state,
			scope: target.credentialScope,
			isDefault: target.isDefault,
		})), [
			{ id: "pi", state: "partial", scope: "adapter-shared", isDefault: true },
			{ id: "codex-native", state: "disconnected", scope: "runtime-instance", isDefault: false },
		]);

		const startedResponse = await fetch(`${baseURL}/api/chat/provider-auth`, {
			method: "POST",
			headers,
			body: JSON.stringify({ action: "start", runtimeInstanceId: "codex-native", providerId: "openai-codex", method: "device_code" }),
		});
		assert.equal(startedResponse.status, 200);
		const started = (await startedResponse.json()).result;
		assert.equal(started.runtimeInstanceId, "codex-native");
		assert.equal(started.state, "pending");
		assert.equal(started.flow.flowId, "flow-codex-web");

		for (const expectedState of ["pending", "connected"]) {
			const completedResponse = await fetch(`${baseURL}/api/chat/provider-auth`, {
				method: "POST",
				headers,
				body: JSON.stringify({ action: "complete", runtimeInstanceId: "codex-native", providerId: "openai-codex", flowId: "flow-codex-web" }),
			});
			assert.equal(completedResponse.status, 200);
			assert.equal((await completedResponse.json()).result.state, expectedState);
		}

		const logoutResponse = await fetch(`${baseURL}/api/chat/provider-auth`, {
			method: "POST",
			headers,
			body: JSON.stringify({ action: "logout", runtimeInstanceId: "codex-native", providerId: "openai-codex" }),
		});
		assert.equal(logoutResponse.status, 200);
		assert.equal((await logoutResponse.json()).result.state, "disconnected");

		const apiKey = "sk-web-fixture-sensitive-value-123456789";
		const apiKeyResponse = await fetch(`${baseURL}/api/chat/provider-auth`, {
			method: "POST",
			headers,
			body: JSON.stringify({ action: "api_key", runtimeInstanceId: "codex-native", providerId: "openai-codex", apiKey }),
		});
		assert.equal(apiKeyResponse.status, 200);
		const apiKeyPayload = await apiKeyResponse.json();
		assert.equal(apiKeyPayload.result.state, "connected");
		assert.doesNotMatch(JSON.stringify(apiKeyPayload), /sk-web-fixture-sensitive-value/);

		const boundSession = sessions.create({
			channel: "pibo.chat-web",
			kind: "chat",
			profile: "codex-native",
			runtimeBinding: { runtimeInstanceId: "codex-native", adapterId: "codex-native", state: "unbound" },
		});
		const compatibilityStatus = await fetch(`${baseURL}/api/chat/action`, {
			method: "POST",
			headers,
			body: JSON.stringify({ piboSessionId: boundSession.id, action: "login.status", params: {} }),
		});
		assert.equal(compatibilityStatus.status, 200);
		assert.equal((await compatibilityStatus.json()).result.runtimeInstanceId, "codex-native");

		const conflict = await fetch(`${baseURL}/api/chat/action`, {
			method: "POST",
			headers,
			body: JSON.stringify({ piboSessionId: boundSession.id, action: "login.status", params: { runtimeInstanceId: "pi" } }),
		});
		assert.equal(conflict.status, 409);
		assert.match((await conflict.json()).error, /conflicts with the selected session runtime/);

		assert.deepEqual(calls.map(({ operation, runtimeInstanceId }) => ({ operation, runtimeInstanceId })), [
			{ operation: "start", runtimeInstanceId: "codex-native" },
			{ operation: "complete", runtimeInstanceId: "codex-native" },
			{ operation: "complete", runtimeInstanceId: "codex-native" },
			{ operation: "logout", runtimeInstanceId: "codex-native" },
			{ operation: "start", runtimeInstanceId: "codex-native" },
		]);
		assert.equal(emitted.length, 0, "product-scoped provider auth must not append session execution events");
	} finally {
		await channel.stop?.();
	}
});

test("chat web app accepts same-origin mutations behind a local reverse proxy", async () => {
	const { channel, baseURL } = await startWebHostChannel({
		auth: createFakeAuthService(),
	});

	try {
		const response = await fetch(`${baseURL}/api/chat/sessions`, {
			method: "POST",
			headers: {
				"content-type": "application/json",
				origin: "http://4788.192.168.0.204.sslip.io",
				"x-forwarded-host": "4788.192.168.0.204.sslip.io",
				"x-forwarded-proto": "http",
				"x-test-user": "user-1",
			},
			body: JSON.stringify({ profile: "base" }),
		});
		assert.equal(response.status, 201);
		const payload = await response.json();
		assert.equal(retiredPartitionField in payload.session, false);
	} finally {
		await channel.stop?.();
	}
});

test("chat web app accepts same-origin mutations through a Docker-published canonical host", async () => {
	const canonicalBaseURL = "https://slot-01.pool.example.test";
	const { channel, baseURL } = await startWebHostChannel({
		auth: createFakeAuthService(),
		web: { canonicalBaseURL },
	});

	try {
		const target = new URL(baseURL);
		const body = JSON.stringify({ profile: "base" });
		const statusCode = await new Promise((resolvePromise, reject) => {
			const request = nodeHttpRequest({
				host: target.hostname,
				port: target.port,
				path: "/api/chat/sessions",
				method: "POST",
				headers: {
					"content-type": "application/json",
					"content-length": Buffer.byteLength(body),
					host: new URL(canonicalBaseURL).host,
					origin: canonicalBaseURL,
					"x-test-user": "user-1",
				},
			}, (response) => {
				response.resume();
				response.once("end", () => resolvePromise(response.statusCode));
			});
			request.once("error", reject);
			request.end(body);
		});
		assert.equal(statusCode, 201);
	} finally {
		await channel.stop?.();
	}
});

test("web host rejects oversized request bodies", async () => {
	const { channel, baseURL } = await startWebHostChannel({
		auth: createFakeAuthService(),
	});

	try {
		const response = await fetch(`${baseURL}/api/chat/message`, {
			method: "POST",
			headers: {
				"content-type": "application/json",
				origin: baseURL,
				"x-test-user": "user-1",
			},
			body: JSON.stringify({ text: "x".repeat(4 * 1024 * 1024) }),
		});
		assert.equal(response.status, 413);
		assert.deepEqual(await response.json(), { error: "Request body too large" });
	} finally {
		await channel.stop?.();
	}
});

test("chat web exposes only session-native workflow routes", async () => {
	const { channel, baseURL } = await startWebHostChannel({ auth: createFakeAuthService() });
	try {
		for (const path of [
			"/api/chat/projects",
			"/api/chat/projects/bootstrap",
			"/api/chat/projects/legacy/workflow-sessions",
			"/api/chat/project-sessions/ps_legacy",
		]) {
			const response = await fetch(`${baseURL}${path}`, { headers: { "x-test-user": "user-1" } });
			assert.equal(response.status, 404, path);
		}
	} finally {
		await channel.stop?.();
	}
});

test("session-native workflow Sessions share definitions, start idempotently, inspect facts, message, archive, and delete", async () => {
	const storageDir = mkdtempSync(join(tmpdir(), "pibo-native-workflow-api-"));
	let runtime = await startWebHostChannel({
		auth: createFakeAuthService(),
		profiles: [{ name: "base", aliases: ["default"] }],
		storageDir,
		persistSessions: true,
	});
	const headers = () => ({ "content-type": "application/json", origin: runtime.baseURL, "x-test-user": "user-1" });
	const post = (path, body) => fetch(`${runtime.baseURL}${path}`, { method: "POST", headers: headers(), body: JSON.stringify(body) });
	try {
		const roomResponse = await post("/api/chat/rooms", { name: "Workflow Room", workspace: storageDir });
		assert.equal(roomResponse.status, 201);
		const room = (await roomResponse.json()).room;
		const create = async (title) => {
			const response = await post("/api/chat/workflow-sessions", {
				roomId: room.id,
				profile: "base",
				workflowId: "standard-workflow",
				workflowVersion: "1.0.0",
				title,
				inputValues: { request: title },
				promptOverrides: { agent: "Handle the configured request" },
			});
			assert.equal(response.status, 201);
			return response.json();
		};
		const first = await create("First native workflow");
		const second = await create("Second native workflow");
		for (const created of [first, second]) {
			assert.equal(created.session.kind, "chat");
			assert.equal(created.session.workspace, storageDir);
			assert.equal(created.session.metadata.chatRoomId, room.id);
			assert.equal(created.session.metadata.workflowSessionKind, "main_workflow");
			assert.equal(created.session.metadata.workflowId, "standard-workflow");
			assert.equal(created.workflowSession.piboSessionId, created.session.id);
			assert.equal(created.workflowSession.state, "configured");
			assert.equal(created.validation.trigger, "before_workflow_session_creation");
			assert.equal(created.snapshot.piboSessionId, created.session.id);
			assert.equal("projectId" in created.snapshot, false);
		}

		const firstStartResponse = await post(`/api/chat/sessions/${encodeURIComponent(first.session.id)}/workflow/start`, {});
		assert.equal(firstStartResponse.status, 202);
		const firstStart = await firstStartResponse.json();
		const secondStartResponse = await post(`/api/chat/sessions/${encodeURIComponent(second.session.id)}/workflow/start`, {});
		assert.equal(secondStartResponse.status, 202);
		const secondStart = await secondStartResponse.json();
		assert.notEqual(firstStart.run.id, secondStart.run.id);
		assert.equal(firstStart.workflowSession.workflowRunId, firstStart.run.id);
		assert.equal(secondStart.workflowSession.workflowRunId, secondStart.run.id);
		const repeatedStartResponse = await post(`/api/chat/sessions/${encodeURIComponent(first.session.id)}/workflow/start`, {});
		assert.equal(repeatedStartResponse.status, 200);
		const repeatedStart = await repeatedStartResponse.json();
		assert.equal(repeatedStart.alreadyStarted, true);
		assert.equal(repeatedStart.run.id, firstStart.run.id);

		const inspectionResponse = await fetch(`${runtime.baseURL}/api/chat/sessions/${encodeURIComponent(first.session.id)}/workflow`, { headers: { "x-test-user": "user-1" } });
		assert.equal(inspectionResponse.status, 200);
		const inspection = await inspectionResponse.json();
		assert.equal(inspection.snapshot.id, first.snapshot.id);
		assert.equal(inspection.run.id, firstStart.run.id);
		assert.deepEqual(inspection.waitTokens, []);
		assert.deepEqual(inspection.humanActions, []);
		assert.deepEqual(inspection.nodeAttempts, []);
		assert.deepEqual(inspection.edgeTransfers, []);
		assert.ok(inspection.lifecycleEvents.some((event) => event.type === "workflow.session.created"));
		assert.ok(inspection.lifecycleEvents.some((event) => event.type === "workflow.start.accepted"));

		const messageResponse = await post("/api/chat/message", { piboSessionId: first.session.id, roomId: room.id, text: "Continue this workflow conversation", clientTxnId: "native-workflow-message" });
		assert.equal(messageResponse.status, 200);
		assert.equal(runtime.emitted.at(-1).piboSessionId, first.session.id);

		const workflowDb = new DatabaseSync(runtime.workflowStorePath, { readOnly: true });
		assert.equal(workflowDb.prepare("SELECT count(*) AS count FROM workflow_session_links").get().count, 2);
		assert.equal(workflowDb.prepare("SELECT count(*) AS count FROM workflow_runs").get().count, 2);
		assert.equal(workflowDb.prepare("SELECT count(*) AS count FROM workflow_definition_snapshots WHERE workflow_id = ? AND workflow_version = ?").get("standard-workflow", "1.0.0").count, 1);
		assert.equal(workflowDb.prepare("SELECT count(*) AS count FROM workflow_session_snapshots").get().count, 2);
		workflowDb.close();

		await runtime.channel.stop?.();
		runtime.sessions.close();
		runtime = await startWebHostChannel({ auth: createFakeAuthService(), profiles: [{ name: "base", aliases: ["default"] }], storageDir, persistSessions: true });
		const restartedInspection = await fetch(`${runtime.baseURL}/api/chat/sessions/${encodeURIComponent(first.session.id)}/workflow`, { headers: { "x-test-user": "user-1" } });
		assert.equal(restartedInspection.status, 200);
		assert.equal((await restartedInspection.json()).run.id, firstStart.run.id);

		const archiveResponse = await fetch(`${runtime.baseURL}/api/chat/sessions/${encodeURIComponent(first.session.id)}`, { method: "PATCH", headers: headers(), body: JSON.stringify({ archived: true }) });
		assert.equal(archiveResponse.status, 200);
		const deleteResponse = await fetch(`${runtime.baseURL}/api/chat/sessions/${encodeURIComponent(first.session.id)}`, { method: "DELETE", headers: headers(), body: JSON.stringify({ confirmText: "Delete this session" }) });
		assert.equal(deleteResponse.status, 200);
		assert.deepEqual((await deleteResponse.json()).deletedSessionIds, [first.session.id]);
	} finally {
		await runtime.channel.stop?.();
		runtime.sessions.close();
		rmSync(storageDir, { recursive: true, force: true });
	}
});

test("session-native workflow human actions are validated, persisted, and inspectable", async () => {
	const runtime = await startWebHostChannel({ auth: createFakeAuthService(), profiles: [{ name: "base", aliases: ["default"] }] });
	const headers = { "content-type": "application/json", origin: runtime.baseURL, "x-test-user": "user-1" };
	const post = (path, body) => fetch(`${runtime.baseURL}${path}`, { method: "POST", headers, body: JSON.stringify(body) });
	try {
		const createdResponse = await post("/api/chat/workflow-sessions", { profile: "base", workflowId: "standard-workflow", workflowVersion: "1.0.0" });
		assert.equal(createdResponse.status, 201);
		const created = await createdResponse.json();
		const started = await (await post(`/api/chat/sessions/${created.session.id}/workflow/start`, {})).json();
		const now = new Date().toISOString();
		const db = new DatabaseSync(runtime.workflowStorePath);
		db.prepare(`INSERT INTO workflow_wait_tokens (id, workflow_run_id, node_attempt_id, human_node_id, kind, available_actions_json, prompt, schema_json, status, resume_payload_json, resume_payload_present, expires_at, created_at, resolved_at) VALUES (?, ?, NULL, ?, ?, ?, ?, NULL, 'pending', NULL, 0, NULL, ?, NULL)`).run(
			"wwt_native_approve", started.run.id, "review", "human", JSON.stringify([{ id: "fixture.humanActions.approve", kind: "approve" }]), "Approve this run", now,
		);
		db.close();
		const actionResponse = await post(`/api/chat/sessions/${created.session.id}/workflow/human-actions`, { waitTokenId: "wwt_native_approve", actionId: "fixture.humanActions.approve" });
		assert.equal(actionResponse.status, 202);
		const action = await actionResponse.json();
		assert.equal(action.workflowSession.piboSessionId, created.session.id);
		assert.equal(action.waitToken.status, "resumed");
		assert.equal(action.action.kind, "approve");
		const inspection = await (await fetch(`${runtime.baseURL}/api/chat/sessions/${created.session.id}/workflow`, { headers: { "x-test-user": "user-1" } })).json();
		assert.equal(inspection.waitTokens[0].status, "resumed");
		assert.equal(inspection.humanActions[0].waitTokenId, "wwt_native_approve");
	} finally {
		await runtime.channel.stop?.();
	}
});

test("manual editor runs target normal Rooms and persist canonical inspection facts", async () => {
	let host;
	host = await startWebHostChannel({
		auth: createFakeAuthService(), profiles: [{ name: "base", aliases: ["default"] }],
		emit(event) {
			if (event.type === "message") queueMicrotask(() => {
				host.emitOutput({ type: "assistant_message", piboSessionId: event.piboSessionId, eventId: event.id, text: "native manual output" });
				host.emitOutput({ type: "message_finished", piboSessionId: event.piboSessionId, eventId: event.id });
			});
			return Promise.resolve({ type: "message_queued", piboSessionId: event.piboSessionId });
		},
	});
	const headers = { "content-type": "application/json", origin: host.baseURL, "x-test-user": "user-1" };
	const post = (path, body) => fetch(`${host.baseURL}${path}`, { method: "POST", headers, body: JSON.stringify(body) });
	try {
		const workspace = mkdtempSync(join(tmpdir(), "pibo-manual-room-"));
		const roomResponse = await post("/api/chat/rooms", { name: "Manual Room", workspace });
		assert.equal(roomResponse.status, 201);
		const { room } = await roomResponse.json();
		const definition = {
			id: "workflow.manual-room", version: "1.0.0", initial: "trigger", input: { kind: "text" }, output: { kind: "text" },
			nodes: {
				trigger: { kind: "trigger", trigger: { kind: "manual" }, output: { kind: "text" } },
				agent: { kind: "agent", runtime: "pibo", profile: { kind: "fixed", id: "base" }, input: { kind: "text" }, output: { kind: "text" }, promptTemplate: "{{input}}" },
			},
			edges: { toAgent: { from: { nodeId: "trigger" }, to: { nodeId: "agent" } } },
		};
		const created = await post("/api/chat/workflows", { title: "Manual Room Workflow", workflowId: definition.id, definition });
		assert.equal(created.status, 201);
		const { draft } = await created.json();
		const runPath = `/api/chat/workflows/drafts/${draft.draftId}/manual-trigger-runs`;
		assert.equal((await post(runPath, { triggerNodeId: "trigger", input: "test", roomId: "room_missing" })).status, 404);
		assert.equal((await post(runPath, { triggerNodeId: "trigger", input: "test", roomId: room.id, workspace: "relative" })).status, 400);
		const result = await post(runPath, { triggerNodeId: "trigger", input: "test", roomId: room.id });
		assert.equal(result.status, 202);
		const payload = await result.json();
		assert.equal(payload.ok, true);
		assert.equal(payload.output, "native manual output");
		const attempt = payload.nodeAttempts.find((entry) => entry.kind === "agent");
		const session = host.sessions.get(attempt.piboSessionId);
		assert.equal(session.kind, "chat");
		assert.equal(session.workspace, workspace);
		assert.equal(session.metadata.chatRoomId, room.id);
		assert.equal(session.metadata.workflowSessionKind, "agent_node");
		const inspected = await (await fetch(`${host.baseURL}/api/chat/sessions/${session.id}/workflow`, { headers })).json();
		assert.equal(inspected.run.status, "completed");
		assert.equal(inspected.run.output, "native manual output");
		assert.equal(inspected.nodeAttempts.length, 2);
		assert.equal(inspected.edgeTransfers.length, 1);
		assert.equal(inspected.definitionSnapshot.definition.nodes.trigger.kind, "trigger");
		assert.equal(inspected.snapshot, undefined);
		assert.ok(inspected.lifecycleEvents.some((event) => event.type === "workflow.editor_test_run.completed"));
	} finally { await host.channel.stop?.(); }
});

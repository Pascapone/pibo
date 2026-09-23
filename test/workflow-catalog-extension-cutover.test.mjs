import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { PIBO_APP_CONTEXT } from "../dist/app-context.js";
import { createChatWebApp } from "../dist/apps/chat/web-app.js";
import { handleWorkflowCatalogReadApiRequest } from "../dist/apps/chat/workflow-catalog-api.js";
import { PiboDataStore } from "../dist/data/pibo-store.js";
import { provideCoreWebProduct } from "../dist/core/web-product.js";
import { PluginHost } from "../dist/plugins/host.js";
import { startPluginProductRuntime } from "../dist/plugins/product-runtime.js";
import { PIBO_CHAT_EXTENSION_SERVICE, PIBO_WORKFLOW_CATALOG_QUERY_SERVICE } from "../dist/plugins/product-services.js";

async function fixture(t, { withCatalog }) {
	const root = mkdtempSync(join(tmpdir(), "pibo-workflow-catalog-extension-"));
	const app = createChatWebApp({
		dataStorePath: join(root, "chat.sqlite"),
		dataPayloadRootDir: join(root, "payloads"),
		agentStorePath: join(root, "agents.sqlite"),
		workflowStorePath: join(root, "pibo-workflows.sqlite"),
	});
	const data = new PiboDataStore(join(root, "pibo.sqlite"), { payloadRootDir: join(root, "store-payloads") });
	const host = new PluginHost();
	const disposeCatalog = withCatalog ? host.provideCoreService({
		id: PIBO_WORKFLOW_CATALOG_QUERY_SERVICE, version: "1.0.0", value: app.workflowCatalogQuery(),
	}) : undefined;
	let product;
	t.after(async () => {
		try {
			await product?.dispose();
		} finally {
			disposeCatalog?.();
			await app.dispose();
			data.close();
			rmSync(root, { recursive: true, force: true });
		}
	});
	product = await startPluginProductRuntime({
		host, data, artifactRoot: join(root, "artifacts"), collectConsumers: async () => [],
		bootstrapPluginSources: [{ kind: "local", path: join(process.cwd(), "dist/pibo4-artifacts/workflows") }],
		installDefaultPlugins: false, includeWebProduct: false,
	});
	return { host, product, app, async request(path, options = {}) {
		const headers = new Headers({ "x-test-user": "fixture", ...options.headers });
		const request = new Request(`http://chat.test${path}`, { ...options, headers });
		return app.handleRequest(request, {
			async requireSession() {
				return { authSession: { identity: { userId: "fixture", email: "fixture@example.test", provider: "test" } }, appContext: PIBO_APP_CONTEXT };
			},
			channelContext: {
				subscribe: () => () => {},
				getService: (id) => host.services.get(id),
				getProfiles: () => [{ name: "base", aliases: [], nativeTools: [], mcpServers: [] }],
			},
		});
	} };
}

test("Core Web product provides the narrow workflow query before plugin setup and disposes it", async (t) => {
	const root = mkdtempSync(join(tmpdir(), "pibo-workflow-catalog-product-"));
	const host = new PluginHost();
	const dispose = provideCoreWebProduct(host, {
		authMode: "dev-auth",
		chat: {
			dataStorePath: join(root, "chat.sqlite"),
			dataPayloadRootDir: join(root, "payloads"),
			agentStorePath: join(root, "agents.sqlite"),
			workflowStorePath: join(root, "pibo-workflows.sqlite"),
		},
	});
	t.after(async () => { await dispose(); rmSync(root, { recursive: true, force: true }); });
	const query = host.services.get(PIBO_WORKFLOW_CATALOG_QUERY_SERVICE);
	assert.ok(query);
	assert.deepEqual(Object.keys(query.state).sort(), ["workflowArchiveStore", "workflowDraftStore", "workflowPublishedVersionStore", "workflowTombstoneStore"]);
	assert.equal("agentStore" in query.state, false);
	await dispose();
	assert.equal(host.services.get(PIBO_WORKFLOW_CATALOG_QUERY_SERVICE), undefined);
});

test("workflow catalog and version-list GETs are plugin-served with byte-identical Core fallback", async (t) => {
	const f = await fixture(t, { withCatalog: true });
	assert.ok(f.host.inspect().plugins.some((plugin) => plugin.pluginId === "pibo.workflows"));
	const extensions = f.host.services.get(PIBO_CHAT_EXTENSION_SERVICE);
	let probeCalls = 0;
	const unprobe = extensions.registerApiRoute(() => { probeCalls += 1; return undefined; });
	t.after(unprobe);
	const paths = [
		"/api/chat/workflows?includeArchived=true",
		"/api/chat/workflows/standard-workflow/versions",
	];
	const active = [];
	for (const path of paths) {
		const response = await f.request(path);
		assert.equal(response.status, 200, path);
		active.push(await response.text());
	}
	assert.equal(probeCalls, 0, "the first registered plugin route must short-circuit the public probe");
	const inspect = await f.request("/api/chat/workflows/standard-workflow/versions/1.0.0");
	assert.equal(inspect.status, 200);
	assert.equal(probeCalls, 1, "validation-timestamped version inspection stays on the Core fallback");
	await f.host.remove("pibo.workflows");
	for (const [index, path] of paths.entries()) {
		const response = await f.request(path);
		assert.equal(response.status, 200, path);
		assert.equal(await response.text(), active[index], `${path} must retain its exact JSON body after deactivation`);
	}
	assert.equal(probeCalls, paths.length + 1, "without the plugin, each request must fall through to Core");
});

test("workflow catalog read handler leaves mutations and unrelated routes to their original owner", () => {
	const routes = [
		["POST", "/api/chat/workflows"],
		["DELETE", "/api/chat/workflows/standard-workflow"],
		["GET", "/api/chat/workflows/standard-workflow/versions/1.0.0"],
		["GET", "/api/chat/workflows/standard-workflow"],
		["GET", "/api/chat/workflows/pickers/profiles"],
		["GET", "/api/chat/cron"],
	];
	for (const [method, path] of routes) {
		assert.equal(handleWorkflowCatalogReadApiRequest({ request: new Request(`http://chat.test${path}`, { method }) }, {}), undefined, `${method} ${path}`);
	}
});

test("headless workflows installation remains active without the optional catalog query", async (t) => {
	const f = await fixture(t, { withCatalog: false });
	assert.ok(f.host.inspect().plugins.some((plugin) => plugin.pluginId === "pibo.workflows"));
	assert.equal(f.host.services.get(PIBO_WORKFLOW_CATALOG_QUERY_SERVICE), undefined);
	const view = f.host.contributions.get("contribution", "pibo.workflows/view");
	assert.equal(view.contribution.kind, "view");
});

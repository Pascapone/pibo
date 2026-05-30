import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { promisify } from "node:util";
import test from "node:test";
import { handleChatRalphApiRequest } from "../dist/apps/chat/ralph-api.js";
import { PiboRalphStore } from "../dist/ralph/store.js";

const execFileAsync = promisify(execFile);
const cliPath = resolve("dist/bin/pibo.js");

function createApiOptions({ request, store, ownerScope = "user:a" }) {
	return {
		request,
		ralphStore: store,
		webSession: { ownerScope },
		defaultProfile: "codex",
		context: { channelContext: { getProfiles: () => [{ name: "codex", aliases: [] }] } },
		roomService: {
			getRoom: () => undefined,
			listRoomTree: () => [],
			requireRoomAccess: () => { throw new Error("unused"); },
			ensureDefaultRoom: () => ({ id: "room", ownerScope, name: "room", members: [] }),
			ensureMember: () => ({ roomId: "room", principalId: ownerScope, role: "owner" }),
		},
	};
}

async function responseJson(response) {
	assert.ok(response);
	return response.json();
}

test("Ralph CLI text and JSON expose concise retained and dirty resource state", async () => {
	const dir = await mkdtemp(join(tmpdir(), "pibo-ralph-resource-visibility-"));
	const dbPath = join(dir, "ralph.sqlite");
	const store = new PiboRalphStore({ path: dbPath });
	try {
		const retainedUntil = "2026-05-18T00:00:00.000Z";
		const retained = store.createJob({
			ownerScope: "user:a",
			target: { kind: "personal", principalId: "user:a" },
			profile: "codex",
			prompt: "retained work",
			enabled: false,
			resources: { workerId: "worker-retained", cleanupState: "retained", retainedUntil },
		});
		const dirty = store.createJob({
			ownerScope: "user:a",
			target: { kind: "personal", principalId: "user:a" },
			profile: "codex",
			prompt: "dirty work",
			enabled: true,
			resources: { workerId: "worker-dirty", browserLeaseIds: ["lease-a"], cleanupState: "active" },
		});
		const reserved = store.reserveRun("user:a", dirty.id);
		store.updateRunResources({ ownerScope: "user:a", runId: reserved.run.id, resources: { workerId: "worker-dirty", browserLeaseIds: ["lease-a"], cleanupState: "dirty", dirtyReason: "CDP cleanup failed after release" } });
		store.createJob({ ownerScope: "user:a", target: { kind: "personal", principalId: "user:a" }, profile: "codex", prompt: "legacy no resource", enabled: false });
		store.createJob({ ownerScope: "user:b", target: { kind: "personal", principalId: "user:b" }, profile: "codex", prompt: "other", enabled: false, resources: { workerId: "worker-other", cleanupState: "retained" } });
	} finally { store.close(); }

	try {
		const env = { ...process.env };
		const list = await execFileAsync("node", [cliPath, "ralph", "--store", dbPath, "list", "--all"], { env });
		assert.match(list.stdout, /worker=worker-retained/);
		assert.match(list.stdout, /state=retained/);
		assert.match(list.stdout, /retainedUntil=2026-05-18T00:00:00\.000Z/);
		assert.match(list.stdout, /next=pibo compute reap --dry-run --include-dev/);
		assert.match(list.stdout, /resources=-\tlegacy no resource/);
		assert.match(list.stdout, /worker-other/);

		const runs = await execFileAsync("node", [cliPath, "ralph", "--store", dbPath, "runs"], { env });
		assert.match(runs.stdout, /worker=worker-dirty/);
		assert.match(runs.stdout, /state=dirty/);
		assert.match(runs.stdout, /dirty=CDP cleanup failed after release/);
		assert.match(runs.stdout, /next=pibo tools browser-use pool reap --worker-id worker-dirty --json/);

		const json = await execFileAsync("node", [cliPath, "ralph", "--store", dbPath, "--owner-scope", "user:a", "list", "--all", "--json"], { env });
		assert.match(json.stderr, /deprecated/);
		const jobs = JSON.parse(json.stdout);
		assert.equal(jobs.some((job) => job.resources?.cleanupState === "retained" && job.resources.workerId === "worker-retained"), true);
	} finally { await rm(dir, { recursive: true, force: true }); }
});

test("Chat Ralph API returns app-global Ralph jobs and resource metadata", async () => {
	const store = new PiboRalphStore({ path: ":memory:" });
	try {
		const job = store.createJob({
			ownerScope: "user:a",
			target: { kind: "personal", principalId: "user:a" },
			profile: "codex",
			prompt: "api work",
			enabled: false,
			resources: { workerId: "worker-api", cleanupState: "dirty", dirtyReason: "manual cleanup required" },
		});
		store.createJob({ ownerScope: "user:a", target: { kind: "personal", principalId: "user:a" }, profile: "codex", prompt: "api legacy", enabled: false });
		store.createJob({ ownerScope: "user:b", target: { kind: "personal", principalId: "user:b" }, profile: "codex", prompt: "other", enabled: false, resources: { workerId: "worker-other", cleanupState: "retained" } });

		const listResponse = await handleChatRalphApiRequest(createApiOptions({ request: new Request("http://localhost/api/chat/ralph/jobs?includeDisabled=true"), store, ownerScope: "user:a" }));
		const listPayload = await responseJson(listResponse);
		assert.equal(listPayload.jobs.length, 3);
		assert.equal(listPayload.jobs.some((item) => item.resources === undefined), true);
		assert.equal(listPayload.jobs.some((item) => item.resources?.workerId === "worker-api" && item.resources.cleanupState === "dirty"), true);

		const getResponse = await handleChatRalphApiRequest(createApiOptions({ request: new Request(`http://localhost/api/chat/ralph/jobs/${job.id}`), store, ownerScope: "user:a" }));
		const getPayload = await responseJson(getResponse);
		assert.equal(getPayload.job.resources.workerId, "worker-api");

		const crossOwnerList = await handleChatRalphApiRequest(createApiOptions({ request: new Request("http://localhost/api/chat/ralph/jobs?includeDisabled=true"), store, ownerScope: "user:b" }));
		const crossOwnerPayload = await responseJson(crossOwnerList);
		assert.equal(crossOwnerPayload.jobs.length, 3);
		assert.equal(crossOwnerPayload.jobs.some((item) => item.resources?.workerId === "worker-api"), true);
		const crossGetResponse = await handleChatRalphApiRequest(createApiOptions({ request: new Request(`http://localhost/api/chat/ralph/jobs/${job.id}`), store, ownerScope: "user:b" }));
		const crossGetPayload = await responseJson(crossGetResponse);
		assert.equal(crossGetPayload.job.id, job.id);

		const createResponse = await handleChatRalphApiRequest(createApiOptions({
			request: new Request("http://localhost/api/chat/ralph/jobs", { method: "POST", headers: { "content-type": "application/json", origin: "http://localhost" }, body: JSON.stringify({ profile: "codex", prompt: "created by A", target: { kind: "personal", principalId: "user:a" } }) }),
			store,
			ownerScope: "user:a",
		}));
		const createdPayload = await responseJson(createResponse);
		assert.equal("ownerScope" in createdPayload.job, false);
		assert.deepEqual(createdPayload.job.target, { kind: "personal" });
		const patchResponse = await handleChatRalphApiRequest(createApiOptions({
			request: new Request(`http://localhost/api/chat/ralph/jobs/${createdPayload.job.id}`, { method: "PATCH", headers: { "content-type": "application/json", origin: "http://localhost" }, body: JSON.stringify({ name: "updated by B" }) }),
			store,
			ownerScope: "user:b",
		}));
		const patchedPayload = await responseJson(patchResponse);
		assert.equal(patchedPayload.job.name, "updated by B");
		const deleteResponse = await handleChatRalphApiRequest(createApiOptions({
			request: new Request(`http://localhost/api/chat/ralph/jobs/${createdPayload.job.id}`, { method: "DELETE", headers: { "content-type": "application/json", origin: "http://localhost" }, body: JSON.stringify({}) }),
			store,
			ownerScope: "user:a",
		}));
		assert.deepEqual(await responseJson(deleteResponse), { removed: true });
	} finally { store.close(); }
});

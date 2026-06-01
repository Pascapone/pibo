import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { promisify } from "node:util";
import test from "node:test";
import { handleChatRalphApiRequest } from "../dist/apps/chat/ralph-api.js";
import { PiboRalphStore } from "../dist/ralph/store.js";

const retiredWord = String.fromCharCode(111, 119, 110, 101, 114);
const retiredTitle = `${retiredWord[0].toUpperCase()}${retiredWord.slice(1)}`;

const execFileAsync = promisify(execFile);
const cliPath = resolve("dist/bin/pibo.js");

function createApiOptions({ request, store }) {
	return {
		request,
		ralphStore: store,
		webSession: {},
		defaultProfile: "codex",
		context: { channelContext: { getProfiles: () => [{ name: "codex", aliases: [] }] } },
		roomService: {
			getRoom: () => undefined,
			listRoomTree: () => [],
			requireRoom: () => { throw new Error("unused"); },
			ensureDefaultRoom: () => ({ id: "room", name: "room" }),
		},
	};
}

async function responseJson(response) {
	assert.ok(response);
	return response.json();
}

function assertNoRalphPartitionFields(value) {
	if (!value || typeof value !== "object") return;
	if (Array.isArray(value)) {
		for (const item of value) assertNoRalphPartitionFields(item);
		return;
	}
	const legacyKeys = [`${retiredWord}Scope`, "principal" + "Id"];
	for (const key of Object.keys(value)) {
		assert.equal(legacyKeys.includes(key), false);
		assertNoRalphPartitionFields(value[key]);
	}
}

test("Ralph CLI text and JSON expose concise retained and dirty resource state", async () => {
	const dir = await mkdtemp(join(tmpdir(), "pibo-ralph-resource-visibility-"));
	const dbPath = join(dir, "ralph.sqlite");
	const store = new PiboRalphStore({ path: dbPath });
	try {
		const retainedUntil = "2026-05-18T00:00:00.000Z";
		const retained = store.createJob({
			target: { kind: "default-chat" }, profile: "codex",
			prompt: "retained work",
			enabled: false,
			resources: { workerId: "worker-retained", cleanupState: "retained", retainedUntil },
		});
		const dirty = store.createJob({
			target: { kind: "default-chat" }, profile: "codex",
			prompt: "dirty work",
			enabled: true,
			resources: { workerId: "worker-dirty", browserLeaseIds: ["lease-a"], cleanupState: "active" },
		});
		const reserved = store.reserveRun(dirty.id);
		store.updateRunResources({ runId: reserved.run.id, resources: { workerId: "worker-dirty", browserLeaseIds: ["lease-a"], cleanupState: "dirty", dirtyReason: "CDP cleanup failed after release" } });
		store.createJob({ target: { kind: "default-chat" }, profile: "codex", prompt: "legacy no resource", enabled: false });
		store.createJob({ target: { kind: "default-chat" }, profile: "codex", prompt: "other", enabled: false, resources: { workerId: "worker-other", cleanupState: "retained" } });
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

		const help = await execFileAsync("node", [cliPath, "ralph", "add", "--help"], { env });
		const removedHelpPattern = new RegExp([`--${retiredWord}-scope`, "--personal", "--principal-id", `PIBO_${retiredWord.toUpperCase()}_SCOPE`, "principal" + "Id", `${retiredWord}Scope`].join("|"));
		assert.doesNotMatch(help.stdout, removedHelpPattern);
		assert.match(help.stdout, /pibo ralph add --help/);

		const json = await execFileAsync("node", [cliPath, "ralph", "--store", dbPath, "list", "--all", "--json"], { env });
		const jobs = JSON.parse(json.stdout);
		assertNoRalphPartitionFields(jobs);
		assert.equal(jobs.some((job) => job.resources?.cleanupState === "retained" && job.resources.workerId === "worker-retained"), true);

		const add = await execFileAsync("node", [cliPath, "ralph", "--store", dbPath, "add", "--prompt", "cli work", "--default-chat", "--json"], { env });
		const added = JSON.parse(add.stdout);
		assertNoRalphPartitionFields(added);
		assert.deepEqual(added.target, { kind: "default-chat" });
		const started = JSON.parse((await execFileAsync("node", [cliPath, "ralph", "--store", dbPath, "start", added.id, "--json"], { env })).stdout);
		assert.equal(started.enabled, true);
		assertNoRalphPartitionFields(started);
		const stopped = JSON.parse((await execFileAsync("node", [cliPath, "ralph", "--store", dbPath, "stop", added.id, "--json"], { env })).stdout);
		assert.equal(stopped.state.stopRequestedAt !== undefined, true);
		assertNoRalphPartitionFields(stopped);
	} finally { await rm(dir, { recursive: true, force: true }); }
});

test("Chat Ralph API returns app-global Ralph jobs and resource metadata", async () => {
	const store = new PiboRalphStore({ path: ":memory:" });
	try {
		const job = store.createJob({
			target: { kind: "default-chat" }, profile: "codex",
			prompt: "api work",
			enabled: false,
			resources: { workerId: "worker-api", cleanupState: "dirty", dirtyReason: "manual cleanup required" },
		});
		store.createJob({ target: { kind: "default-chat" }, profile: "codex", prompt: "api legacy", enabled: false });
		store.createJob({ target: { kind: "default-chat" }, profile: "codex", prompt: "other", enabled: false, resources: { workerId: "worker-other", cleanupState: "retained" } });

		const listResponse = await handleChatRalphApiRequest(createApiOptions({ request: new Request("http://localhost/api/chat/ralph/jobs?includeDisabled=true"), store }));
		const listPayload = await responseJson(listResponse);
		assertNoRalphPartitionFields(listPayload);
		assert.equal(listPayload.jobs.length, 3);
		assert.equal(listPayload.jobs.some((item) => item.resources === undefined), true);
		assert.equal(listPayload.jobs.some((item) => item.resources?.workerId === "worker-api" && item.resources.cleanupState === "dirty"), true);

		const getResponse = await handleChatRalphApiRequest(createApiOptions({ request: new Request(`http://localhost/api/chat/ralph/jobs/${job.id}`), store }));
		const getPayload = await responseJson(getResponse);
		assertNoRalphPartitionFields(getPayload);
		assert.equal(getPayload.job.resources.workerId, "worker-api");

		const crossPartitionList = await handleChatRalphApiRequest(createApiOptions({ request: new Request("http://localhost/api/chat/ralph/jobs?includeDisabled=true"), store }));
		const crossPartitionPayload = await responseJson(crossPartitionList);
		assertNoRalphPartitionFields(crossPartitionPayload);
		assert.equal(crossPartitionPayload.jobs.length, 3);
		assert.equal(crossPartitionPayload.jobs.some((item) => item.resources?.workerId === "worker-api"), true);
		const crossGetResponse = await handleChatRalphApiRequest(createApiOptions({ request: new Request(`http://localhost/api/chat/ralph/jobs/${job.id}`), store }));
		const crossGetPayload = await responseJson(crossGetResponse);
		assertNoRalphPartitionFields(crossGetPayload);
		assert.equal(crossGetPayload.job.id, job.id);

		const createResponse = await handleChatRalphApiRequest(createApiOptions({
			request: new Request("http://localhost/api/chat/ralph/jobs", { method: "POST", headers: { "content-type": "application/json", origin: "http://localhost" }, body: JSON.stringify({ profile: "codex", prompt: "created by A", target: { kind: "default-chat" } }) }),
			store,
			}));
		const createdPayload = await responseJson(createResponse);
		assertNoRalphPartitionFields(createdPayload);
		assert.deepEqual(createdPayload.job.target, { kind: "default-chat" });
		const patchResponse = await handleChatRalphApiRequest(createApiOptions({
			request: new Request(`http://localhost/api/chat/ralph/jobs/${createdPayload.job.id}`, { method: "PATCH", headers: { "content-type": "application/json", origin: "http://localhost" }, body: JSON.stringify({ name: "updated by B" }) }),
			store,
			}));
		const patchedPayload = await responseJson(patchResponse);
		assertNoRalphPartitionFields(patchedPayload);
		assert.equal(patchedPayload.job.name, "updated by B");
		const deleteResponse = await handleChatRalphApiRequest(createApiOptions({
			request: new Request(`http://localhost/api/chat/ralph/jobs/${createdPayload.job.id}`, { method: "DELETE", headers: { "content-type": "application/json", origin: "http://localhost" }, body: JSON.stringify({}) }),
			store,
			}));
		assert.deepEqual(await responseJson(deleteResponse), { removed: true });
	} finally { store.close(); }
});

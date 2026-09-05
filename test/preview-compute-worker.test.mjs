import assert from "node:assert/strict";
import test from "node:test";
import { selectPreviewComputeWorkerTarget } from "../dist/previews/compute-worker.js";

function worker(overrides = {}) {
	return {
		id: overrides.id ?? "worker-id",
		name: overrides.name ?? "pibo-dev-feature",
		role: overrides.role ?? "dev",
		state: overrides.state ?? "running",
		status: overrides.status ?? "running",
		ports: overrides.ports ?? "",
		portMap: overrides.portMap ?? { web: "4822", "4788/tcp": "127.0.0.1:4822" },
		createdAt: overrides.createdAt ?? "2026-09-05T00:00:00.000Z",
		worktreePath: overrides.worktreePath ?? "/workspace/feature",
		cleanupEligibility: { eligible: false, reasons: ["running-or-retained"], nextCommands: [] },
	};
}

test("Preview worker selection resolves only a running labeled compute Web port", () => {
	const selected = selectPreviewComputeWorkerTarget([worker()], "pibo-dev-feature");
	assert.deepEqual(selected, {
		id: "worker-id",
		name: "pibo-dev-feature",
		webPort: 4822,
		worktreePath: "/workspace/feature",
	});
	assert.equal(selectPreviewComputeWorkerTarget([worker()], "worker-id").webPort, 4822);
	assert.throws(() => selectPreviewComputeWorkerTarget([worker()], "missing"), /was not found/);
	assert.throws(() => selectPreviewComputeWorkerTarget([worker({ state: "exited" })], "pibo-dev-feature"), /is not running/);
	assert.throws(() => selectPreviewComputeWorkerTarget([worker({ role: "unknown" })], "pibo-dev-feature"), /not a managed worker/);
	assert.throws(() => selectPreviewComputeWorkerTarget([worker({ portMap: {} })], "pibo-dev-feature"), /labeled Web port/);
	assert.throws(() => selectPreviewComputeWorkerTarget([worker({ portMap: { web: "4822", "4788/tcp": "0.0.0.0:4822" } })], "pibo-dev-feature"), /not published on host loopback/);
	assert.throws(() => selectPreviewComputeWorkerTarget([worker({ portMap: { web: "4788", "4788/tcp": "127.0.0.1:4788" } })], "pibo-dev-feature"), /reserved/);
});

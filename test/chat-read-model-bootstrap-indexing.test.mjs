import assert from "node:assert/strict";
import test from "node:test";
import { ChatWebReadModel } from "../dist/apps/chat/read-model.js";

function makeSession(overrides = {}) {
	return {
		id: "session-1",
		piSessionId: "pi-1",
		channel: "web-host",
		kind: "chat",
		profile: "default",
		createdAt: "2026-05-07T10:00:00.000Z",
		updatedAt: "2026-05-07T10:00:00.000Z",
		metadata: {},
		...overrides,
	};
}

function withReadModel(fn) {
	const readModel = new ChatWebReadModel(":memory:");
	try {
		return fn(readModel);
	} finally {
		readModel.close();
	}
}

test("bootstrap indexing skips unchanged sessions", () => {
	withReadModel((readModel) => {
		const session = makeSession();
		assert.deepEqual(readModel.upsertSessionsIfChanged([session]), { checked: 1, written: 1, skipped: 0 });

		const before = readModel.listSessions();
		assert.deepEqual(readModel.upsertSessionsIfChanged([session]), { checked: 1, written: 0, skipped: 1 });
		assert.deepEqual(readModel.listSessions(), before);
	});
});

test("bootstrap indexing writes missing rows", () => {
	withReadModel((readModel) => {
		const session = makeSession({ id: "missing-session" });
		assert.deepEqual(readModel.upsertSessionsIfChanged([session]), { checked: 1, written: 1, skipped: 0 });
		assert.equal(readModel.getSession(session.id)?.piSessionId, session.piSessionId);
	});
});

const changedFields = [
	["updatedAt", { updatedAt: "2026-05-07T10:01:00.000Z" }],
	["parentId", { parentId: "parent-1" }],
	["profile", { profile: "other-profile" }],
	["kind", { kind: "task" }],
	["channel", { channel: "remote-agent" }],
	["piSessionId", { piSessionId: "pi-2" }],
	["createdAt", { createdAt: "2026-05-07T09:59:00.000Z" }],
];

for (const [fieldName, override] of changedFields) {
	test(`bootstrap indexing writes changed ${fieldName}`, () => {
		withReadModel((readModel) => {
			const session = makeSession();
			readModel.upsertSessionsIfChanged([session]);

			const changed = makeSession(override);
			assert.deepEqual(readModel.upsertSessionsIfChanged([changed]), { checked: 1, written: 1, skipped: 0 });

			const indexed = readModel.getSession(changed.id);
			assert.equal(indexed?.piSessionId, changed.piSessionId);
			assert.equal(indexed?.parentId, changed.parentId);
			assert.equal(indexed?.profile, changed.profile);
			assert.equal(indexed?.kind, changed.kind);
			assert.equal(indexed?.channel, changed.channel);
			assert.equal(indexed?.createdAt, changed.createdAt);
			assert.equal(indexed?.updatedAt, changed.updatedAt);
		});
	});
}

test("bootstrap indexing does not overwrite live status without a status override", () => {
	withReadModel((readModel) => {
		const session = makeSession();
		readModel.upsertSession(session, "running");

		assert.deepEqual(readModel.upsertSessionsIfChanged([session]), { checked: 1, written: 0, skipped: 1 });
		assert.equal(readModel.getSession(session.id)?.status, "running");
	});
});

test("bootstrap indexing preserves session ordering", () => {
	withReadModel((readModel) => {
		const older = makeSession({
			id: "older",
			piSessionId: "pi-older",
			createdAt: "2026-05-07T09:00:00.000Z",
			updatedAt: "2026-05-07T09:00:00.000Z",
		});
		const newer = makeSession({
			id: "newer",
			piSessionId: "pi-newer",
			createdAt: "2026-05-07T11:00:00.000Z",
			updatedAt: "2026-05-07T11:00:00.000Z",
		});

		readModel.upsertSessionsIfChanged([older, newer]);
		const before = readModel.listSessions().map((session) => session.piboSessionId);

		assert.deepEqual(readModel.upsertSessionsIfChanged([older, newer]), { checked: 2, written: 0, skipped: 2 });
		assert.deepEqual(readModel.listSessions().map((session) => session.piboSessionId), before);
	});
});

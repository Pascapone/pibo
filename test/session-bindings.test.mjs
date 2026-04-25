import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { SqliteSessionBindingStore } from "../dist/sessions/sqlite-store.js";

test("sqlite session binding store creates and reuses channel bindings", async () => {
	const dir = await mkdtemp(join(tmpdir(), "pibo-bindings-"));
	const dbPath = join(dir, "bindings.sqlite");
	const store = new SqliteSessionBindingStore(dbPath);

	try {
		const first = store.resolve({
			channel: "web",
			externalId: "user-1",
			defaultProfile: "pibo-minimal",
		});
		const second = store.resolve({
			channel: "web",
			externalId: "user-1",
			defaultProfile: "pibo-example-plugin",
		});

		assert.equal(first.sessionKey, "web:user-1");
		assert.equal(second.sessionKey, first.sessionKey);
		assert.equal(second.originalProfile, "pibo-minimal");
		assert.deepEqual(store.get(first.sessionKey), second);
	} finally {
		store.close();
		await rm(dir, { recursive: true, force: true });
	}
});

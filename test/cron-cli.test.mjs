import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { runCronCli } from "../dist/cron/cli.js";
import { createDefaultPiboCronStore } from "../dist/cron/store.js";

async function quietly(run) {
	const originalLog = console.log;
	console.log = () => {};
	try {
		return await run();
	} finally {
		console.log = originalLog;
	}
}

test("cron edit updates an existing wall-clock schedule timezone", async () => {
	const dir = mkdtempSync(join(tmpdir(), "pibo-cron-cli-"));
	const storePath = join(dir, "cron.sqlite");
	try {
		await quietly(() => runCronCli([
			"node", "pibo", "--store", storePath, "add",
			"--default-chat", "--daily", "09:10", "--tz", "UTC",
			"--prompt", "Timezone fixture", "--name", "before", "--json",
		]));
		let store = createDefaultPiboCronStore({ path: storePath });
		const before = store.listJobs({ includeDisabled: true })[0];
		store.close();
		assert.equal(before.schedule.kind, "cron");
		assert.equal(before.schedule.tz, "UTC");
		assert.equal(before.scheduleUi?.tz, "UTC");

		await quietly(() => runCronCli([
			"node", "pibo", "--store", storePath, "edit", before.id,
			"--name", "after", "--tz", "America/New_York", "--json",
		]));
		store = createDefaultPiboCronStore({ path: storePath });
		const after = store.getJob(before.id);
		store.close();
		assert.equal(after?.name, "after");
		assert.equal(after?.schedule.kind, "cron");
		assert.equal(after?.schedule.tz, "America/New_York");
		assert.equal(after?.scheduleUi?.tz, "America/New_York");
		assert.notEqual(after?.state.nextRunAt, before.state.nextRunAt);

		await quietly(() => runCronCli([
			"node", "pibo", "--store", storePath, "edit", before.id,
			"--tz", "Asia/Tokyo", "--json",
		]));
		store = createDefaultPiboCronStore({ path: storePath });
		const timezoneOnly = store.getJob(before.id);
		store.close();
		assert.equal(timezoneOnly?.schedule.kind, "cron");
		assert.equal(timezoneOnly?.schedule.tz, "Asia/Tokyo");
		assert.equal(timezoneOnly?.scheduleUi?.tz, "Asia/Tokyo");
	} finally {
		rmSync(dir, { recursive: true, force: true });
	}
});

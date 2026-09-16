import assert from "node:assert/strict";
import test from "node:test";
import { parseWindowsProcessTreeSnapshot } from "../dist/runs/windows-process-tree.js";

test("Windows process snapshots select descendants and group members in stable deepest-first order", () => {
	const snapshot = [
		"PID PPID PGID WINPID TTY UID STIME COMMAND",
		"13 11 90 113 ? 1000 12:00 /usr/bin/node",
		"41 40 90 141 ? 1000 12:00 /usr/bin/node",
		"11 10 10 111 ? 1000 12:00 /usr/bin/bash",
		"12 10 10 112 ? 1000 12:00 /usr/bin/bash",
		"10 1 10 110 ? 1000 12:00 /usr/bin/bash",
		"40 999 10 140 ? 1000 12:00 /usr/bin/bash",
		"50 1 50 150 ? 1000 12:00 /usr/bin/bash",
		"60 10 10 0 ? 1000 12:00 /usr/bin/bash",
		"61 10 10 invalid",
		"62 10 10",
		"-63 10 10 163",
		"",
	].join("\r\n");

	const rows = parseWindowsProcessTreeSnapshot(snapshot, 10);
	assert.deepEqual(rows.map((row) => row.windowsPid), [113, 141, 111, 112, 110, 140]);
	assert.deepEqual(rows[0], { msysPid: 13, parentMsysPid: 11, processGroupId: 90, windowsPid: 113 });
});

test("Windows process snapshots bound cyclic ancestry and keep group members after the root exits", () => {
	const snapshot = [
		"21 22 10 121",
		"22 21 90 122",
		"23 21 90 123",
		"30 999 10 130",
		"40 999 40 140",
	].join("\n");

	const rows = parseWindowsProcessTreeSnapshot(snapshot, 10);
	assert.deepEqual(rows.map((row) => row.windowsPid), [123, 121, 122, 130]);
	assert.deepEqual(parseWindowsProcessTreeSnapshot(snapshot, 99), []);
});

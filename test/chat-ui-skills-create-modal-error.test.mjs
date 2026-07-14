import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

test("canceling Create Skill clears its transient validation error", async () => {
	const source = await readFile("src/apps/chat-ui/src/settings/SettingsView.tsx", "utf8");
	const createModal = source.slice(source.indexOf('{createOpen ? ('), source.indexOf('{installOpen ? ('));

	assert.match(createModal, /title="Create Skill"/);
	assert.match(createModal, /onClose=\{\(\) => \{\s*setCreateOpen\(false\);\s*setError\(null\);\s*\}\}/);
});

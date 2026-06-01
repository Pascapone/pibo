import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import fs from "node:fs";
import { promisify } from "node:util";
import test from "node:test";

const execFileAsync = promisify(execFile);
const script = "scripts/ink-cli-v2-pty-smoke.mjs";

test("Ink CLI V2 PTY smoke runner lists required reusable scenarios", async () => {
	const result = await execFileAsync("node", [script, "--list"]);
	assert.match(result.stdout, /room-session-message\t.*Room picker/);
	assert.match(result.stdout, /slash-suggestions-status-thinking\t.*Slash suggestions/);
	assert.match(result.stdout, /overlay-keyboard-model-login\t.*Picker overlays/);
	assert.match(result.stdout, /existing-session-hydration\t.*--session/);
});

test("Ink CLI V2 PTY smoke runner dry-run emits bounded pibo debug pty commands", async () => {
	const result = await execFileAsync("node", [script, "--scenario", "slash-suggestions-status-thinking", "--artifact-root", ".tmp/test-pty-smoke", "--dry-run"]);
	assert.match(result.stdout, /# slash-suggestions-status-thinking/);
	assert.match(result.stdout, /dist\/bin\/pibo\.js debug pty run/);
	assert.match(result.stdout, /--artifact-dir .*slash-suggestions-status-thinking/);
	assert.match(result.stdout, /--timeout-ms 80000/);
	assert.match(result.stdout, /--idle-timeout-ms 15000/);
	assert.match(result.stdout, /--wait-for slash commands/);
	assert.match(result.stdout, /--wait-for ▣ Status — status · done/);
	assert.match(result.stdout, /--wait-for select thinking level/);
});

test("Ink CLI V2 PTY smoke documentation records artifact evidence rules", () => {
	const doc = fs.readFileSync("docs/reports/ink-cli-v2-pty-smoke-scenarios.md", "utf8");
	assert.match(doc, /room-session-message/);
	assert.match(doc, /slash-suggestions-status-thinking/);
	assert.match(doc, /existing-session-hydration/);
	assert.match(doc, /raw artifact path and clean artifact path/);
	assert.match(doc, /bounded timeouts/);
});

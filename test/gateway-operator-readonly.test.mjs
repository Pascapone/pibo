import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

test("installed operator restriction also rejects direct gateway CLI mutation before touching state", () => {
	const home = mkdtempSync(join(tmpdir(), "pibo-operator-guard-"));
	try {
		const state = join(home, "pibo-must-not-exist");
		const script = `
		import assert from "node:assert/strict";
		import { runGatewayCli } from "./src/gateway/cli.ts";
		for (const args of [
		  ["gateway", "web", "restart"],
		  ["gateway", "dev", "start"],
		  ["gateway", "web", "stop", "--force"],
		  ["gateway", "web", "status", "--force"],
		  ["gateway", "backup", "install"],
		]) await assert.rejects(runGatewayCli(["node", "pibo", ...args], {readOnly: true}), /read-only/);
		`;
		execFileSync(process.execPath, ["--import", "tsx", "--input-type=module", "--eval", script], {
			cwd: process.cwd(),
			env: { ...process.env, HOME: home, PIBO_HOME: state },
			encoding: "utf8",
			timeout: 15_000,
		});
		assert.equal(existsSync(state), false);
	} finally {
		rmSync(home, { recursive: true, force: true });
	}
});

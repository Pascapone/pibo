import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { resolve } from "node:path";
import test from "node:test";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);
const releaseScript = resolve("scripts/release.mjs");

const validVersions = [
	"0.0.0",
	"1.2.3",
	"1.2.3-0",
	"1.2.3-foo.bar",
	"1.2.3-alpha.1+build.5",
	"1.2.3+build.01",
];

const invalidVersions = [
	"01.2.3",
	"1.02.3",
	"1.2.03",
	"1.2.3-01",
	"1.2.3-foo..bar",
	"1.2.3+foo..bar",
	"1.2.3+",
	"v1.2.3",
];

test("release dry-run accepts valid SemVer versions", async () => {
	for (const version of validVersions) {
		const { stdout } = await execFileAsync(process.execPath, [releaseScript, "--version", version, "--dry-run"]);
		assert.match(stdout, new RegExp(` -> ${version.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}`));
	}
});

test("release rejects invalid SemVer before release work", async () => {
	for (const version of invalidVersions) {
		await assert.rejects(
			execFileAsync(process.execPath, [releaseScript, "--version", version, "--dry-run"]),
			(error) => {
				assert.equal(error.code, 1);
				assert.match(error.stderr, /is not a valid semver string/);
				assert.doesNotMatch(error.stdout, /\[release\] root/);
				return true;
			},
		);
	}
});

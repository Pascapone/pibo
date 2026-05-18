import test from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, statSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

function pibo(args) {
	return execFileSync(process.execPath, ["dist/bin/pibo.js", ...args], { encoding: "utf8" });
}

test("root discovery lists setup command", () => {
	const output = pibo(["--help"]);
	assert.match(output, /setup\s+Plan user-host installs and developer-host upgrades/);
});

test("doctor reports host checks", () => {
	const status = JSON.parse(pibo(["setup", "doctor", "--json"]));
	assert.equal(status.nodeMajorOk, true);
	assert.ok(Array.isArray(status.checks));
	assert.ok(status.checks.some((check) => check.name === "node"));
});

test("doctor gives a clear auth blocker before gateway start", () => {
	const dir = mkdtempSync(join(tmpdir(), "pibo-home-"));
	try {
		const status = JSON.parse(pibo(["setup", "doctor", "--pibo-home", dir, "--json"]));
		const authReady = status.checks.find((check) => check.name === "auth.ready");
		assert.equal(authReady.status, "fail");
		assert.match(authReady.detail, /Pibo web will not start until Better Auth is configured/);
	} finally {
		rmSync(dir, { recursive: true, force: true });
	}
});

test("doctor can enforce a minimum swap recommendation", () => {
	const status = JSON.parse(pibo(["setup", "doctor", "--min-swap-gb", "999999", "--json"]));
	const swap = status.checks.find((check) => check.name === "swap");
	assert.ok(swap);
	assert.equal(swap.status, "fail");
});

test("user-host setup plan is minimal and has one service", () => {
	const plan = JSON.parse(pibo(["setup", "user-host", "--domain", "pibo.example.com", "--json"]));
	assert.equal(plan.mode, "user-host");
	assert.deepEqual(Object.keys(plan.services), ["pibo-web"]);
	assert.equal(plan.services["pibo-web"].port, 4788);
	assert.equal(plan.services["pibo-web"].home, "/root/.pibo");
	assert.ok(plan.optionalHostPackages.some((item) => /docker/i.test(item)));
	assert.ok(!plan.requiredHostPackages.some((item) => /docker/i.test(item)));
	assert.ok(!plan.requiredHostPackages.some((item) => /git/i.test(item)));
});

test("developer-host setup plan isolates prod and dev gateways", () => {
	const plan = JSON.parse(pibo([
		"setup",
		"developer-host",
		"--origin",
		"git@github.com:piboschott/pibo.git",
		"--prod-domain",
		"pibo.example.com",
		"--dev-domain",
		"dev.pibo.example.com",
		"--json",
	]));
	assert.equal(plan.mode, "developer-host");
	assert.equal(plan.services["pibo-web"].port, 4788);
	assert.equal(plan.services["pibo-web"].gatewayPort, 4789);
	assert.equal(plan.services["pibo-web"].home, "/root/.pibo");
	assert.equal(plan.services["pibo-web-dev"].port, 4808);
	assert.equal(plan.services["pibo-web-dev"].gatewayPort, 4809);
	assert.equal(plan.services["pibo-web-dev"].home, "/root/.pibo-dev");
	assert.equal(plan.remotes.origin, "git@github.com:piboschott/pibo.git");
	assert.ok(plan.requiredHostPackages.some((item) => /docker/i.test(item)));
});

test("developer-host generated files pin prod and dev to branch-specific entrypoints", () => {
	const plan = JSON.parse(pibo(["setup", "developer-host", "--json"]));
	const prodService = plan.generatedFiles.find((file) => file.path === "/etc/systemd/system/pibo-web.service");
	const wrapper = plan.generatedFiles.find((file) => file.path === "/usr/local/bin/pibo-web-dev-start.mjs");
	assert.ok(prodService);
	assert.ok(wrapper);
	assert.match(prodService.content, /ExecStart=\/usr\/bin\/node \/root\/code\/pibo\/dist\/bin\/pibo\.js gateway:web/);
	assert.doesNotMatch(prodService.content, /ExecStart=\/usr\/bin\/pibo/);
	assert.match(wrapper.content, /port: 4809/);
	assert.match(wrapper.content, /port: 4808/);
	assert.equal(wrapper.mode, 0o755);
});

test("setup plan can write generated files to a staging directory", () => {
	const dir = mkdtempSync(join(tmpdir(), "pibo-setup-"));
	try {
		const output = pibo(["setup", "developer-host", "--write-to", dir]);
		assert.match(output, /Wrote files:/);
		const servicePath = join(dir, "etc/systemd/system/pibo-web.service");
		const wrapperPath = join(dir, "usr/local/bin/pibo-web-dev-start.mjs");
		assert.match(readFileSync(servicePath, "utf8"), /\/root\/code\/pibo\/dist\/bin\/pibo\.js gateway:web/);
		assert.match(readFileSync(wrapperPath, "utf8"), /port: 4809/);
		assert.equal(statSync(wrapperPath).mode & 0o777, 0o755);
	} finally {
		rmSync(dir, { recursive: true, force: true });
	}
});

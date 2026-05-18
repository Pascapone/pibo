import test from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";

function pibo(args) {
	return execFileSync(process.execPath, ["dist/bin/pibo.js", ...args], { encoding: "utf8" });
}

test("root discovery lists setup command", () => {
	const output = pibo(["--help"]);
	assert.match(output, /setup\s+Plan user-host installs and developer-host upgrades/);
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

test("developer-host generated files include dev gateway wrapper", () => {
	const plan = JSON.parse(pibo(["setup", "developer-host", "--json"]));
	const wrapper = plan.generatedFiles.find((file) => file.path === "/usr/local/bin/pibo-web-dev-start.mjs");
	assert.ok(wrapper);
	assert.match(wrapper.content, /port: 4809/);
	assert.match(wrapper.content, /port: 4808/);
});

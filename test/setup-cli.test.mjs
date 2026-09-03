import test from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { createInstallationPlan, materializeInstallationPlan, readInstallationManifest, runPendingInstallationActions } from "../dist/setup/installation-profiles.js";

const packageVersion = JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8")).version;

function pibo(args) {
	return execFileSync(process.execPath, ["dist/bin/pibo.js", ...args], { encoding: "utf8" });
}

test("root discovery lists setup command", () => {
	const output = pibo(["--help"]);
	assert.match(output, /setup\s+Plan and manage supported host installation profiles/);
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
	assert.equal(swap.status, process.platform === "win32" ? "warn" : "fail");
});

test("doctor reports WSL info in the JSON output", () => {
	const status = JSON.parse(pibo(["setup", "doctor", "--json"]));
	assert.ok(status.wsl, "doctor JSON should include a wsl field");
	assert.equal(typeof status.wsl.isWsl, "boolean");
	assert.equal(typeof status.wsl.hasWindowsMount, "boolean");
	assert.ok([undefined, 1, 2].includes(status.wsl.version));
	const wslCheck = status.checks.find((check) => check.name === "platform.wsl");
	// The platform.wsl check exists only when the host is WSL or native Windows.
	// Plain Linux and macOS are POSIX targets and need no extra signal.
	if (status.wsl.isWsl) {
		assert.equal(wslCheck?.status, "ok");
	} else if (status.platform === "win32") {
		assert.equal(wslCheck?.status, "fail");
	} else {
		assert.equal(wslCheck, undefined);
	}
});

test("user-host setup plan flags native Windows", () => {
	const plan = JSON.parse(pibo(["setup", "user-host", "--domain", "pibo.example.com", "--json"]));
	if (process.platform === "win32") {
		assert.ok(plan.warnings.some((line) => /Native Windows is not supported/.test(line)));
	} else {
		assert.ok(!plan.warnings.some((line) => /Native Windows is not supported/.test(line)));
	}
});

test("developer-host setup plan flags native Windows", () => {
	const plan = JSON.parse(pibo(["setup", "developer-host", "--json"]));
	if (process.platform === "win32") {
		assert.ok(plan.warnings.some((line) => /Native Windows is not supported/.test(line)));
	} else {
		assert.ok(!plan.warnings.some((line) => /Native Windows is not supported/.test(line)));
	}
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

test("user-host setup omits Caddy output when no production domain is provided", () => {
	const plan = JSON.parse(pibo(["setup", "user-host", "--json"]));
	assert.equal(plan.generatedFiles.some((file) => file.path === "/etc/caddy/Caddyfile"), false);
	assert.ok(plan.warnings.some((warning) => /Caddyfile is omitted/.test(warning)));

	const dir = mkdtempSync(join(tmpdir(), "pibo-user-host-no-domain-"));
	try {
		const output = pibo(["setup", "user-host", "--write-to", dir]);
		assert.match(output, /Caddyfile is omitted/);
		assert.equal(existsSync(join(dir, "etc/caddy/Caddyfile")), false);
	} finally {
		rmSync(dir, { recursive: true, force: true });
	}
});

test("user-host setup persists a custom managed gateway service identity", () => {
	const piboHome = "/srv/pibo-custom";
	const plan = JSON.parse(pibo([
		"setup",
		"user-host",
		"--domain",
		"pibo.example.com",
		"--pibo-home",
		piboHome,
		"--service-name",
		"pibo-web-custom",
		"--json",
	]));
	const identity = plan.generatedFiles.find((file) => file.path === `${piboHome}/gateway-web-service`);
	assert.ok(identity);
	assert.equal(identity.content, "pibo-web-custom\n");
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
	const plan = JSON.parse(pibo([
		"setup",
		"developer-host",
		"--prod-web-port",
		"5510",
		"--prod-gateway-port",
		"6510",
		"--json",
	]));
	const prodService = plan.generatedFiles.find((file) => file.path === "/etc/systemd/system/pibo-web.service");
	const wrapper = plan.generatedFiles.find((file) => file.path === "/usr/local/bin/pibo-web-dev-start.mjs");
	assert.ok(prodService);
	assert.ok(wrapper);
	assert.match(prodService.content, /ExecStart=\/usr\/bin\/node \/root\/code\/pibo\/dist\/bin\/pibo\.js gateway:web/);
	assert.match(prodService.content, /--web-port 5510 --gateway-port 6510/);
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
		if (process.platform !== "win32") assert.equal(statSync(wrapperPath).mode & 0o777, 0o755);
	} finally {
		rmSync(dir, { recursive: true, force: true });
	}
});

test("Batteries Included is the default complete profile with a loopback authenticated IDE route", () => {
	const plan = JSON.parse(pibo(["setup", "plan", "--domain", "pibo.example.com", "--json"]));
	assert.equal(plan.profile, "batteries-included");
	assert.deepEqual(plan.components.map((component) => component.name), [
		"core",
		"vscode-web",
		"browser-tools",
		"managed-browser",
		"web-annotations",
		"mcp-defaults",
	]);
	assert.ok(plan.services.every((service) => service.public === false));
	assert.deepEqual(plan.ports.find((port) => port.name === "vscode-web"), {
		name: "vscode-web",
		host: "127.0.0.1",
		port: 4790,
		exposure: "public-via-proxy",
	});
	const caddy = plan.files.find((file) => file.path === "/etc/caddy/Caddyfile").content;
	assert.match(caddy, /forward_auth 127\.0\.0\.1:4788/);
	assert.match(caddy, /uri \/api\/chat\/bootstrap/);
	assert.match(caddy, /reverse_proxy 127\.0\.0\.1:4790/);
	assert.match(caddy, /frame-ancestors 'self'/);
	const gateway = plan.files.find((file) => file.path === "/etc/systemd/system/pibo-web.service").content;
	assert.match(gateway, /PIBO_VSCODE_WEB_URL=\/apps\/vscode\//);
	assert.ok(plan.actions.some((action) => / gateway web restart$/.test(action.command)));
	assert.ok(plan.actions.some((action) => /sha256sum -c/.test(action.command)));
	const browserProfiles = plan.actions.find((action) => action.id === "browser-profiles");
	assert.match(browserProfiles.command, /install -d -m 700/);
	assert.match(browserProfiles.command, /browser-use\/home\/chrome-profiles/);
	assert.match(browserProfiles.command, /browser-use\/home\/auth-pool/);
	assert.match(browserProfiles.command, /agent-browser\/home\/profiles\/leases/);
	assert.ok(plan.actions.some((action) => action.id === "health" && /Connection: Upgrade/.test(action.command)));
	assert.equal(plan.components.find((component) => component.name === "core").version, packageVersion);
	assert.equal(plan.components.find((component) => component.name === "vscode-web").sha256["linux-amd64"], plan.downloads[0].sha256["linux-amd64"]);
	const codeService = plan.files.find((file) => file.path === "/etc/systemd/system/pibo-code-server.service").content;
	assert.match(codeService, /User=pibo-code/);
	assert.match(codeService, /--bind-addr 127\.0\.0\.1:4790 --auth none/);
	assert.match(codeService, /ProtectSystem=strict/);
	const settings = JSON.parse(plan.files.find((file) => file.path === "/etc/pibo/code-server-default-settings.json").content);
	assert.equal(settings["workbench.colorTheme"], "Default Dark Modern");
	const mcpFile = plan.files.find((file) => file.path.endsWith("/setup/mcp-defaults.json"));
	assert.equal(mcpFile.mode, 0o600);
	const mcp = JSON.parse(mcpFile.content);
	assert.match(mcp.mcpServers["chrome-devtools"].command, /setup\/bin\/chrome-devtools-mcp$/);
	const mcpWrapper = plan.files.find((file) => file.path.endsWith("/setup/bin/chrome-devtools-mcp"));
	assert.equal(mcpWrapper.mode, 0o755);
	assert.match(mcpWrapper.content, /browser-use --pibo-ensure-chrome/);
	assert.match(mcpWrapper.content, /--no-usage-statistics --no-performance-crux/);
	assert.ok(!mcp.mcpServers.filesystem.allowedTools.some((name) => /write|move|create|edit/i.test(name)));
});

test("installation profile domain rejects config and shell injection", () => {
	assert.throws(() => pibo(["setup", "plan", "--domain", "pibo.example.com\\nExecStart=/bin/sh", "--json"]), /Domain must be a DNS hostname/);
});

test("public apply refuses missing or local-only auth before host mutation", () => {
	const piboHome = mkdtempSync(join(tmpdir(), "pibo-public-auth-"));
	try {
		assert.throws(() => pibo(["setup", "install", "--profile", "batteries-included", "--domain", "pibo.example.com", "--pibo-home", piboHome, "--apply", "--yes"]), /requires Better Auth configuration/);
		writeFileSync(join(piboHome, "config.json"), `${JSON.stringify({ auth: { mode: "local" } }, null, 2)}\n`);
		assert.throws(() => pibo(["setup", "install", "--profile", "batteries-included", "--domain", "pibo.example.com", "--pibo-home", piboHome, "--apply", "--yes"]), /Refusing to expose a local-auth gateway/);
	} finally {
		rmSync(piboHome, { recursive: true, force: true });
	}
});

test("public apply requires auth.baseURL to match the installation domain", () => {
	const piboHome = mkdtempSync(join(tmpdir(), "pibo-public-base-url-"));
	try {
		writeFileSync(join(piboHome, "config.json"), `${JSON.stringify({ auth: { mode: "better-auth", baseURL: "https://other.example.com", secret: "x".repeat(32), googleClientId: "client", googleClientSecret: "secret", allowedEmails: ["operator@example.com"] } }, null, 2)}\n`);
		assert.throws(() => pibo(["setup", "install", "--profile", "batteries-included", "--domain", "pibo.example.com", "--pibo-home", piboHome, "--apply", "--yes"]), /must match the HTTPS auth\.baseURL hostname/);
	} finally {
		rmSync(piboHome, { recursive: true, force: true });
	}
});

test("Vanilla contains only core gateway and Chat Web resources", () => {
	const plan = JSON.parse(pibo(["setup", "plan", "--profile", "vanilla", "--json"]));
	assert.deepEqual(plan.components.map((component) => component.name), ["core"]);
	assert.deepEqual(plan.services.map((service) => service.name), ["pibo-web"]);
	assert.ok(!plan.hostPackages.includes("chromium"));
	assert.ok(!plan.files.some((file) => /code-server|mcp-defaults/.test(file.path)));
	assert.ok(!plan.actions.some((action) => /browser-use|agent-browser|chromium|code-server/.test(`${action.id} ${action.command}`)));
	const caddy = plan.files.find((file) => file.path === "/etc/caddy/Caddyfile").content;
	assert.doesNotMatch(caddy, /apps\/vscode/);
	assert.match(caddy, /^http:\/\/127\.0\.0\.1:8080 \{/);
	assert.ok(plan.ports.every((port) => port.exposure === "loopback"));
});

test("generated systemd units quote configurable paths with spaces", () => {
	const piboHome = "/var/lib/pibo home test";
	const workspaceRoot = "/srv/pibo workspace test";
	const plan = createInstallationPlan({ profile: "batteries-included", piboHome, workspaceRoot });
	const gateway = plan.files.find((file) => file.path === "/etc/systemd/system/pibo-web.service").content;
	const codeServer = plan.files.find((file) => file.path === "/etc/systemd/system/pibo-code-server.service").content;

	assert.match(gateway, /Environment="PIBO_HOME=\/var\/lib\/pibo home test"/);
	assert.match(gateway, /Environment="PIBO_VSCODE_WORKSPACE_ROOT=\/srv\/pibo workspace test"/);
	assert.match(gateway, /Environment="MCP_CONFIG_PATH=\/var\/lib\/pibo home test\/setup\/mcp-defaults\.json"/);
	assert.match(codeServer, /WorkingDirectory=\/srv\/pibo workspace test/);
	assert.match(codeServer, /--disable-workspace-trust "\/srv\/pibo workspace test"/);
	assert.match(codeServer, /ReadWritePaths="\/srv\/pibo workspace test" \/var\/lib\/pibo-code/);
});

test("setup preflights every target before writing and preserves unmanaged files", () => {
	const dir = mkdtempSync(join(tmpdir(), "pibo-profile-preflight-"));
	try {
		const caddyDir = join(dir, "etc/caddy");
		mkdirSync(caddyDir, { recursive: true });
		const caddyPath = join(caddyDir, "Caddyfile");
		writeFileSync(caddyPath, "existing operator config\n");
		assert.throws(() => pibo(["setup", "install", "--profile", "vanilla", "--write-to", dir]), /Refusing to overwrite unmanaged or modified file/);
		assert.equal(readFileSync(caddyPath, "utf8"), "existing operator config\n");
		assert.equal(existsSync(join(dir, "etc/systemd/system/pibo-web.service")), false);
		assert.equal(existsSync(join(dir, "root/.pibo/setup/installation.json")), false);
	} finally {
		rmSync(dir, { recursive: true, force: true });
	}
});

test("staged setup rejects relative Pibo Home paths that escape the root", () => {
	const dir = mkdtempSync(join(tmpdir(), "pibo-profile-containment-"));
	const root = join(dir, "stage");
	const escapedHome = join(dir, "escaped-home");
	mkdirSync(root);
	try {
		assert.throws(
			() => pibo(["setup", "install", "--profile", "batteries-included", "--pibo-home", "../escaped-home", "--write-to", root]),
			/Refusing staged path outside root: \.\.\/escaped-home\/setup\/installation\.json/,
		);
		assert.equal(existsSync(escapedHome), false);
		assert.throws(
			() => pibo(["setup", "status", "--pibo-home", "../escaped-home", "--root", root, "--json"]),
			/Refusing staged path outside root/,
		);
		assert.throws(
			() => pibo(["setup", "uninstall", "--pibo-home", "../escaped-home", "--root", root, "--yes", "--json"]),
			/Refusing staged path outside root/,
		);
		assert.equal(existsSync(escapedHome), false);

		pibo(["setup", "install", "--profile", "vanilla", "--pibo-home", "contained-home", "--write-to", root]);
		assert.equal(existsSync(join(root, "contained-home/setup/installation.json")), true);
	} finally {
		rmSync(dir, { recursive: true, force: true });
	}
});

test("profile staging is idempotent and status reports pinned component versions", () => {
	const dir = mkdtempSync(join(tmpdir(), "pibo-profile-"));
	const piboHome = "/var/lib/pibo-test";
	try {
		const first = pibo(["setup", "install", "--profile", "batteries-included", "--pibo-home", piboHome, "--domain", "pibo.example.com", "--write-to", dir]);
		assert.match(first, /Written: 8; unchanged: 0/);
		const manifestPath = join(dir, "var/lib/pibo-test/setup/installation.json");
		const before = readFileSync(manifestPath, "utf8");
		const second = pibo(["setup", "install", "--profile", "batteries-included", "--pibo-home", piboHome, "--domain", "pibo.example.com", "--write-to", dir]);
		assert.match(second, /Written: 0; unchanged: 8/);
		assert.equal(readFileSync(manifestPath, "utf8"), before);
		const status = JSON.parse(pibo(["setup", "status", "--pibo-home", piboHome, "--root", dir, "--json"]));
		assert.equal(status.installed, true);
		assert.equal(status.profile, "batteries-included");
		assert.equal(status.checks.every((check) => check.status === "ok"), true);
		assert.equal(status.components.find((component) => component.name === "vscode-web").version, "4.135.0");
	} finally {
		rmSync(dir, { recursive: true, force: true });
	}
});

test("setup doctor status detects and setup repairs private file permission drift", () => {
	const dir = mkdtempSync(join(tmpdir(), "pibo-profile-mode-"));
	const piboHome = "/var/lib/pibo-test";
	try {
		pibo(["setup", "install", "--profile", "batteries-included", "--pibo-home", piboHome, "--write-to", dir]);
		const mcpPath = join(dir, "var/lib/pibo-test/setup/mcp-defaults.json");
		const manifestPath = join(dir, "var/lib/pibo-test/setup/installation.json");
		if (process.platform !== "win32") {
			chmodSync(mcpPath, 0o644);
			chmodSync(manifestPath, 0o644);
		}
		const drifted = JSON.parse(pibo(["setup", "status", "--pibo-home", piboHome, "--root", dir, "--json"]));
		if (process.platform !== "win32") {
			assert.equal(drifted.checks.find((check) => check.name === "manifest").status, "fail");
			assert.equal(drifted.checks.find((check) => check.name.endsWith("mcp-defaults.json")).status, "fail");
		}
		pibo(["setup", "install", "--profile", "batteries-included", "--pibo-home", piboHome, "--write-to", dir]);
		if (process.platform !== "win32") {
			assert.equal(statSync(mcpPath).mode & 0o777, 0o600);
			assert.equal(statSync(manifestPath).mode & 0o777, 0o600);
		}
	} finally {
		rmSync(dir, { recursive: true, force: true });
	}
});

test("component add upgrades a staged Vanilla install without changing its profile identity", () => {
	const dir = mkdtempSync(join(tmpdir(), "pibo-profile-component-"));
	const piboHome = "/var/lib/pibo-test";
	try {
		pibo(["setup", "install", "--profile", "vanilla", "--pibo-home", piboHome, "--write-to", dir]);
		pibo(["setup", "component", "add", "vscode-web", "--pibo-home", piboHome, "--root", dir]);
		const status = JSON.parse(pibo(["setup", "status", "--pibo-home", piboHome, "--root", dir, "--json"]));
		assert.equal(status.profile, "vanilla");
		assert.ok(status.components.some((component) => component.name === "vscode-web"));
		assert.ok(existsSync(join(dir, "etc/systemd/system/pibo-code-server.service")));
	} finally {
		rmSync(dir, { recursive: true, force: true });
	}
});

test("browser-tools component adds managed Chromium without enabling unrelated IDE or MCP resources", () => {
	const plan = createInstallationPlan({ profile: "vanilla", additionalComponents: ["browser-tools"] });
	assert.deepEqual(plan.components.map((component) => component.name), ["core", "browser-tools", "managed-browser"]);
	assert.ok(plan.actions.some((action) => action.id === "chromium"));
	assert.ok(plan.actions.some((action) => action.id === "browser-use"));
	assert.ok(plan.actions.some((action) => action.id === "agent-browser"));
	assert.ok(!plan.actions.some((action) => action.id === "code-server" || action.id === "mcp-defaults"));
	assert.ok(!plan.files.some((file) => /code-server|mcp-defaults/.test(file.path)));
	assert.doesNotMatch(plan.files.find((file) => file.path === "/etc/systemd/system/pibo-web.service").content, /PIBO_VSCODE_WEB_URL|MCP_CONFIG_PATH/);
});

test("profile transition removes obsolete owned resources while preserving workspace data", () => {
	const dir = mkdtempSync(join(tmpdir(), "pibo-profile-transition-"));
	const piboHome = "/var/lib/pibo-test";
	try {
		pibo(["setup", "install", "--profile", "batteries-included", "--pibo-home", piboHome, "--write-to", dir]);
		const workspaceData = join(dir, "srv/pibo-workspaces/user.txt");
		mkdirSync(join(dir, "srv/pibo-workspaces"), { recursive: true });
		writeFileSync(workspaceData, "preserve transition data\n");
		pibo(["setup", "install", "--profile", "vanilla", "--pibo-home", piboHome, "--write-to", dir]);
		const manifest = JSON.parse(readFileSync(join(dir, "var/lib/pibo-test/setup/installation.json"), "utf8"));
		assert.equal(manifest.profile, "vanilla");
		assert.deepEqual(manifest.components.map((component) => component.name), ["core"]);
		assert.equal(existsSync(join(dir, "etc/systemd/system/pibo-code-server.service")), false);
		assert.equal(existsSync(join(dir, "opt/pibo/code-server/4.135.0")), false);
		assert.equal(existsSync(join(dir, "var/lib/pibo-test/setup/mcp-runtime")), false);
		assert.equal(readFileSync(workspaceData, "utf8"), "preserve transition data\n");
	} finally {
		rmSync(dir, { recursive: true, force: true });
	}
});

test("MCP defaults pull in the managed browser tools required by Chrome DevTools", () => {
	const plan = createInstallationPlan({ profile: "vanilla", additionalComponents: ["mcp-defaults"] });
	assert.deepEqual(plan.components.map((component) => component.name), ["core", "mcp-defaults", "browser-tools", "managed-browser"]);
	for (const action of ["chromium", "browser-use", "agent-browser", "mcp-defaults", "mcp-health"]) assert.ok(plan.actions.some((entry) => entry.id === action));
});

test("staged upgrade refreshes component metadata while preserving user data", () => {
	const dir = mkdtempSync(join(tmpdir(), "pibo-profile-upgrade-"));
	const piboHome = "/var/lib/pibo-test";
	try {
		pibo(["setup", "install", "--profile", "vanilla", "--pibo-home", piboHome, "--write-to", dir]);
		const dataPath = join(dir, "var/lib/pibo-test/user-data.txt");
		writeFileSync(dataPath, "preserve across upgrade\n");
		const manifestPath = join(dir, "var/lib/pibo-test/setup/installation.json");
		const manifest = JSON.parse(readFileSync(manifestPath, "utf8"));
		manifest.components.find((component) => component.name === "core").version = "0.0.0";
		writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);

		pibo(["setup", "upgrade", "--pibo-home", piboHome, "--root", dir]);
		const upgraded = JSON.parse(readFileSync(manifestPath, "utf8"));
		assert.equal(upgraded.components.find((component) => component.name === "core").version, packageVersion);
		assert.equal(readFileSync(dataPath, "utf8"), "preserve across upgrade\n");
	} finally {
		rmSync(dir, { recursive: true, force: true });
	}
});

test("non-interactive installation requires an explicit profile", () => {
	assert.throws(() => pibo(["setup", "install", "--json"]), /Non-interactive setup requires an explicit --profile/);
});

test("completed setup actions survive a partial failure and are skipped during recovery", () => {
	const dir = mkdtempSync(join(tmpdir(), "pibo-profile-recovery-"));
	try {
		const plan = createInstallationPlan({ profile: "vanilla", piboHome: "/var/lib/pibo-test" });
		const first = materializeInstallationPlan(plan, { root: dir, now: "2026-08-28T00:00:00.000Z" });
		const attempted = [];
		assert.throws(() => runPendingInstallationActions(plan, first.manifestPath, (action) => {
			attempted.push(action.id);
			if (action.id === "gateway") throw new Error("simulated gateway failure");
		}, { now: () => "2026-08-28T00:01:00.000Z" }), /simulated gateway failure/);
		assert.deepEqual(readInstallationManifest(first.manifestPath).completedActions.map((entry) => entry.id), ["host-packages", "systemd"]);

		const second = materializeInstallationPlan(plan, { root: dir, now: "2026-08-28T00:02:00.000Z" });
		assert.deepEqual(readInstallationManifest(second.manifestPath).completedActions.map((entry) => entry.id), ["host-packages", "systemd"]);
		const recoveryAttempts = [];
		const recovered = runPendingInstallationActions(plan, second.manifestPath, (action) => recoveryAttempts.push(action.id), { now: () => "2026-08-28T00:03:00.000Z" });
		assert.deepEqual(recovered.skipped, ["host-packages", "systemd"]);
		assert.deepEqual(recoveryAttempts, ["gateway", "caddy", "health"]);
		const final = runPendingInstallationActions(plan, second.manifestPath, () => assert.fail("a completed action ran again"));
		assert.equal(final.completed.length, 0);
		assert.deepEqual(final.skipped, plan.actions.map((action) => action.id));
	} finally {
		rmSync(dir, { recursive: true, force: true });
	}
});

test("reapplying a completed plan reruns only actions whose health check is stale", () => {
	const dir = mkdtempSync(join(tmpdir(), "pibo-profile-repair-"));
	try {
		const plan = createInstallationPlan({ profile: "vanilla", piboHome: "/var/lib/pibo-test" });
		const materialized = materializeInstallationPlan(plan, { root: dir, now: "2026-08-28T00:00:00.000Z" });
		runPendingInstallationActions(plan, materialized.manifestPath, () => undefined, { now: () => "2026-08-28T00:01:00.000Z" });
		const repaired = [];
		const result = runPendingInstallationActions(plan, materialized.manifestPath, (action) => repaired.push(action.id), {
			now: () => "2026-08-28T00:02:00.000Z",
			isComplete: (action) => action.id !== "gateway",
		});
		assert.deepEqual(repaired, ["gateway"]);
		assert.deepEqual(result.completed, ["gateway"]);
		assert.deepEqual(result.skipped, plan.actions.map((action) => action.id).filter((id) => id !== "gateway"));
	} finally {
		rmSync(dir, { recursive: true, force: true });
	}
});

test("upgrade, component-add, and uninstall discovery support JSON without mutation", () => {
	const dir = mkdtempSync(join(tmpdir(), "pibo-profile-json-"));
	const piboHome = "/var/lib/pibo-test";
	try {
		pibo(["setup", "install", "--profile", "vanilla", "--pibo-home", piboHome, "--write-to", dir]);
		const upgrade = JSON.parse(pibo(["setup", "upgrade", "--pibo-home", piboHome, "--root", dir, "--json"]));
		assert.equal(upgrade.profile, "vanilla");
		const component = JSON.parse(pibo(["setup", "component", "add", "vscode-web", "--pibo-home", piboHome, "--root", dir, "--json"]));
		assert.ok(component.components.some((entry) => entry.name === "vscode-web"));
		assert.equal(existsSync(join(dir, "etc/systemd/system/pibo-code-server.service")), false);
		const uninstall = JSON.parse(pibo(["setup", "uninstall", "--pibo-home", piboHome, "--root", dir, "--json"]));
		assert.equal(uninstall.profile, "vanilla");
		assert.ok(uninstall.preserves.includes(piboHome));
		assert.equal(existsSync(join(dir, "var/lib/pibo-test/setup/installation.json")), true);
	} finally {
		rmSync(dir, { recursive: true, force: true });
	}
});

test("uninstall removes only unchanged owned files and preserves data and modified files", () => {
	const dir = mkdtempSync(join(tmpdir(), "pibo-profile-uninstall-"));
	const piboHome = "/var/lib/pibo-test";
	try {
		pibo(["setup", "install", "--profile", "batteries-included", "--pibo-home", piboHome, "--write-to", dir]);
		const workspaceData = join(dir, "srv/pibo-workspaces/user.txt");
		mkdirSync(join(dir, "srv/pibo-workspaces"), { recursive: true });
		writeFileSync(workspaceData, "preserve me\n");
		const caddyPath = join(dir, "etc/caddy/Caddyfile");
		writeFileSync(caddyPath, `${readFileSync(caddyPath, "utf8")}# local edit\n`);
		const result = JSON.parse(pibo(["setup", "uninstall", "--pibo-home", piboHome, "--root", dir, "--yes", "--json"]));
		assert.ok(result.preserved.includes(caddyPath));
		assert.equal(existsSync(caddyPath), true);
		assert.equal(readFileSync(workspaceData, "utf8"), "preserve me\n");
		assert.equal(existsSync(join(dir, "etc/systemd/system/pibo-web.service")), false);
		assert.equal(existsSync(join(dir, "var/lib/pibo-test/setup/installation.json")), false);
	} finally {
		rmSync(dir, { recursive: true, force: true });
	}
});

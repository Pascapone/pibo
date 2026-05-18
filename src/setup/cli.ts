import { execFileSync } from "node:child_process";
import { resolve4 } from "node:dns/promises";
import { chmodSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, isAbsolute, join } from "node:path";
import { Command } from "commander";
import { getPiboConfigValue, loadPiboConfig } from "../config/config.js";
import { getPiboHome } from "../core/pibo-home.js";

type SetupMode = "user-host" | "developer-host";

type GeneratedFile = {
	path: string;
	purpose: string;
	content: string;
	mode?: number;
};

type SetupPlan = {
	mode: SetupMode;
	summary: string;
	principles: string[];
	domains: Record<string, string | undefined>;
	branches?: Record<string, string>;
	remotes?: Record<string, string | undefined>;
	directories: Record<string, string>;
	services: Record<string, { port: number; gatewayPort?: number; home: string; branch?: string }>;
	requiredHostPackages: string[];
	optionalHostPackages: string[];
	warnings: string[];
	nextSteps: string[];
	generatedFiles: GeneratedFile[];
};

function parsePort(value: string): number {
	const port = Number(value);
	if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error("Port must be an integer between 1 and 65535");
	return port;
}

function parseNonNegativeNumber(value: string): number {
	const parsed = Number(value);
	if (!Number.isFinite(parsed) || parsed < 0) throw new Error("Value must be a non-negative number");
	return parsed;
}

function shellQuote(value: string): string {
	return `'${value.replace(/'/g, `'\\''`)}'`;
}

function serviceUnit(options: {
	description: string;
	workingDirectory: string;
	piboHome: string;
	serviceKind: "prod" | "dev";
	webPort: number;
	execStart: string;
}): string {
	const gatewayPortEnv = options.serviceKind === "dev" ? `Environment=PIBO_GATEWAY_DEV_PORT=${options.webPort}\n` : `Environment=PIBO_GATEWAY_WEB_PORT=${options.webPort}\n`;
	return `[Unit]
Description=${options.description}
After=network-online.target
Wants=network-online.target

[Service]
Type=simple
WorkingDirectory=${options.workingDirectory}
Environment=HOME=/root
Environment=PIBO_HOME=${options.piboHome}
Environment=NODE_ENV=production
${gatewayPortEnv}ExecStart=${options.execStart}
Restart=always
RestartSec=5
KillSignal=SIGTERM
TimeoutStopSec=30

[Install]
WantedBy=multi-user.target
`;
}

function devStartWrapper(options: { repoDir: string; webPort: number; gatewayPort: number }): string {
	return `#!/usr/bin/env node
import { runWebGatewayServer } from ${JSON.stringify(`${options.repoDir}/dist/gateway/web.js`)};

await runWebGatewayServer({
  host: "127.0.0.1",
  port: ${options.gatewayPort},
  web: {
    host: "127.0.0.1",
    port: ${options.webPort},
  },
});
`;
}

function caddyfile(options: { prodDomain?: string; prodWwwDomain?: string; devDomain?: string; devWwwDomain?: string; prodPort: number; devPort?: number }): string {
	const blocks: string[] = [];
	if (options.prodDomain) {
		blocks.push(`${options.prodDomain} {
	encode zstd gzip
	reverse_proxy 127.0.0.1:${options.prodPort}
}`);
	}
	if (options.prodWwwDomain && options.prodDomain) {
		blocks.push(`${options.prodWwwDomain} {
	redir https://${options.prodDomain}{uri} permanent
}`);
	}
	if (options.devDomain && options.devPort) {
		blocks.push(`${options.devDomain} {
	encode zstd gzip
	reverse_proxy 127.0.0.1:${options.devPort}
}`);
	}
	if (options.devWwwDomain && options.devDomain) {
		blocks.push(`${options.devWwwDomain} {
	redir https://${options.devDomain}{uri} permanent
}`);
	}
	return `${blocks.join("\n\n")}\n`;
}

function userEnvTemplate(options: { domain?: string; piboHome: string }): string {
	return `# Pibo user-host setup
PIBO_HOME=${options.piboHome}
PIBO_AUTH_BASE_URL=${options.domain ? `https://${options.domain}` : "https://pibo.example.com"}
# Set through \`pibo config set\` or your secret manager:
# PIBO_AUTH_SECRET=<at-least-32-characters>
# PIBO_GOOGLE_CLIENT_ID=<google-client-id>
# PIBO_GOOGLE_CLIENT_SECRET=<google-client-secret>
# PIBO_ALLOWED_EMAILS=you@example.com
`;
}

function developerEnvTemplate(options: { origin?: string; upstream?: string; prodDomain?: string; devDomain?: string; repoDir: string; prodHome: string; devHome: string }): string {
	return `# Pibo developer-host setup
PIBO_ORIGIN=${options.origin ?? "git@github.com:<your-fork>/pibo.git"}
PIBO_UPSTREAM=${options.upstream ?? "git@github.com:Pascapone/pibo.git"}
PIBO_REPO_DIR=${options.repoDir}
PIBO_PROD_HOME=${options.prodHome}
PIBO_DEV_HOME=${options.devHome}
PIBO_PROD_BASE_URL=${options.prodDomain ? `https://${options.prodDomain}` : "https://pibo.example.com"}
PIBO_DEV_BASE_URL=${options.devDomain ? `https://${options.devDomain}` : "https://dev.pibo.example.com"}
`;
}

export function createUserHostSetupPlan(options: {
	domain?: string;
	wwwDomain?: string;
	piboHome?: string;
	workingDirectory?: string;
	webPort?: number;
	serviceName?: string;
	piboCommand?: string;
	includeCaddy?: boolean;
} = {}): SetupPlan {
	const piboHome = options.piboHome ?? "/root/.pibo";
	const workingDirectory = options.workingDirectory ?? "/root";
	const webPort = options.webPort ?? 4788;
	const serviceName = options.serviceName ?? "pibo-web";
	const piboCommand = options.piboCommand ?? "/usr/bin/pibo";
	const wwwDomain = options.wwwDomain ?? (options.domain ? `www.${options.domain}` : undefined);
	const warnings: string[] = [];
	if (!options.domain) warnings.push("No production domain was provided; generated Caddy/Auth examples use placeholders.");
	const generatedFiles: GeneratedFile[] = [
		{
			path: `/etc/systemd/system/${serviceName}.service`,
			purpose: "Production web gateway systemd service",
			content: serviceUnit({
				description: "Pibo web gateway",
				workingDirectory,
				piboHome,
				serviceKind: "prod",
				webPort,
				execStart: `${piboCommand} gateway:web --web-host 127.0.0.1 --web-port ${webPort}`,
			}),
		},
		{
			path: `${piboHome}/setup.env.example`,
			purpose: "User-host environment template",
			content: userEnvTemplate({ domain: options.domain, piboHome }),
		},
	];
	if (options.includeCaddy !== false) {
		generatedFiles.push({
			path: "/etc/caddy/Caddyfile",
			purpose: "HTTPS reverse proxy for the production gateway",
			content: caddyfile({ prodDomain: options.domain, prodWwwDomain: wwwDomain, prodPort: webPort }),
		});
	}
	return {
		mode: "user-host",
		summary: "Install one stable Pibo gateway for normal use. No developer gateway, Docker, GitHub App, or worktree setup is required.",
		principles: [
			"Keep first-run setup small enough that new users can succeed quickly.",
			"Use one PIBO_HOME and one systemd service by default.",
			"Make Docker and developer workflows explicit opt-ins.",
		],
		domains: { production: options.domain, productionWww: wwwDomain },
		directories: { workingDirectory, piboHome },
		services: { [serviceName]: { port: webPort, gatewayPort: 4789, home: piboHome } },
		requiredHostPackages: ["node >=24", "npm"],
		optionalHostPackages: ["caddy for HTTPS", "docker for compute workers only if the user opts in"],
		warnings,
		nextSteps: [
			"Install Pibo through npm or build it from source.",
			"Set auth.baseURL, auth.secret, OAuth client values, and allowed emails with `pibo config set`.",
			`Install ${serviceName}.service, then run \`systemctl enable --now ${serviceName}\`.`, 
			"If Caddy is used, point DNS at the host before expecting Let's Encrypt certificates.",
			"Run `pibo gateway web status` and open `/apps/chat` on the configured domain.",
		],
		generatedFiles,
	};
}

export function createDeveloperHostSetupPlan(options: {
	prodDomain?: string;
	prodWwwDomain?: string;
	devDomain?: string;
	devWwwDomain?: string;
	origin?: string;
	upstream?: string;
	repoDir?: string;
	devWorktree?: string;
	prodBranch?: string;
	devBranch?: string;
	prodHome?: string;
	devHome?: string;
	prodWebPort?: number;
	prodGatewayPort?: number;
	devWebPort?: number;
	devGatewayPort?: number;
	nodeCommand?: string;
	includeCaddy?: boolean;
} = {}): SetupPlan {
	const repoDir = options.repoDir ?? "/root/code/pibo";
	const prodBranch = options.prodBranch ?? "main";
	const devBranch = options.devBranch ?? "dev";
	const devWorktree = options.devWorktree ?? `${repoDir}/.worktrees/${devBranch}`;
	const prodHome = options.prodHome ?? "/root/.pibo";
	const devHome = options.devHome ?? "/root/.pibo-dev";
	const prodWebPort = options.prodWebPort ?? 4788;
	const prodGatewayPort = options.prodGatewayPort ?? 4789;
	const devWebPort = options.devWebPort ?? 4808;
	const devGatewayPort = options.devGatewayPort ?? 4809;
	const nodeCommand = options.nodeCommand ?? "/usr/bin/node";
	const prodEntrypoint = `${nodeCommand} ${repoDir}/dist/bin/pibo.js`;
	const prodWwwDomain = options.prodWwwDomain ?? (options.prodDomain ? `www.${options.prodDomain}` : undefined);
	const devWwwDomain = options.devWwwDomain ?? (options.devDomain ? `www.${options.devDomain}` : undefined);
	const warnings: string[] = [];
	if (!options.origin) warnings.push("No origin fork was provided. Developer hosts should use a server-specific fork as origin.");
	if (!options.prodDomain || !options.devDomain) warnings.push("Production and dev domains should both be configured before requesting HTTPS certificates.");
	const generatedFiles: GeneratedFile[] = [
		{
			path: "/etc/systemd/system/pibo-web.service",
			purpose: "Production gateway pinned to the stable branch/home",
			content: serviceUnit({
				description: "Pibo production web gateway",
				workingDirectory: repoDir,
				piboHome: prodHome,
				serviceKind: "prod",
				webPort: prodWebPort,
				execStart: `${prodEntrypoint} gateway:web --web-host 127.0.0.1 --web-port ${prodWebPort}`,
			}),
		},
		{
			path: "/usr/local/bin/pibo-web-dev-start.mjs",
			purpose: "Dev gateway start wrapper; required so dev can use gateway port 4809 without colliding with production port 4789",
			content: devStartWrapper({ repoDir: devWorktree, webPort: devWebPort, gatewayPort: devGatewayPort }),
			mode: 0o755,
		},
		{
			path: "/etc/systemd/system/pibo-web-dev.service",
			purpose: "Development gateway pinned to the dev worktree and isolated PIBO_HOME",
			content: serviceUnit({
				description: "Pibo development web gateway",
				workingDirectory: devWorktree,
				piboHome: devHome,
				serviceKind: "dev",
				webPort: devWebPort,
				execStart: `${nodeCommand} /usr/local/bin/pibo-web-dev-start.mjs`,
			}),
		},
		{
			path: `${repoDir}/.env.developer-host.example`,
			purpose: "Developer-host environment template",
			content: developerEnvTemplate({ origin: options.origin, upstream: options.upstream, prodDomain: options.prodDomain, devDomain: options.devDomain, repoDir, prodHome, devHome }),
		},
	];
	if (options.includeCaddy !== false) {
		generatedFiles.push({
			path: "/etc/caddy/Caddyfile",
			purpose: "HTTPS reverse proxy for production/dev gateways and www redirects",
			content: caddyfile({ prodDomain: options.prodDomain, prodWwwDomain, devDomain: options.devDomain, devWwwDomain, prodPort: prodWebPort, devPort: devWebPort }),
		});
	}
	return {
		mode: "developer-host",
		summary: "Upgrade or install a Pibo host for core development with isolated production and dev gateways plus Docker compute workers.",
		principles: [
			"Production and development gateways must not share ports, PID files, service names, or PIBO_HOME directories.",
			"Production follows the stable branch; development follows the dev branch in a separate worktree.",
			"Docker compute workers are part of developer setup because each agent needs an isolated restartable gateway.",
			"GitHub remotes stay explicit: origin is the server-specific fork, upstream is the canonical project.",
		],
		domains: { production: options.prodDomain, productionWww: prodWwwDomain, development: options.devDomain, developmentWww: devWwwDomain },
		branches: { production: prodBranch, development: devBranch },
		remotes: { origin: options.origin, upstream: options.upstream ?? "git@github.com:Pascapone/pibo.git" },
		directories: { repoDir, devWorktree, prodHome, devHome },
		services: {
			"pibo-web": { port: prodWebPort, gatewayPort: prodGatewayPort, home: prodHome, branch: prodBranch },
			"pibo-web-dev": { port: devWebPort, gatewayPort: devGatewayPort, home: devHome, branch: devBranch },
		},
		requiredHostPackages: ["node >=24", "npm", "git", "docker", "docker compose", "build-essential"],
		optionalHostPackages: ["caddy for HTTPS", "ufw for explicit firewall rules"],
		warnings,
		nextSteps: [
			`Clone ${options.origin ? shellQuote(options.origin) : "the server-specific fork"} into ${repoDir} and set upstream to ${options.upstream ?? "git@github.com:Pascapone/pibo.git"}.`,
			`Check out ${prodBranch} in ${repoDir} and create ${devBranch} worktree at ${devWorktree}.`,
			"Run `npm ci && npm run build` in each branch/worktree that has a service; do not globally install the dev worktree over production.",
			"Restore or create production secrets under /root/.pibo; copy only non-production-safe config into /root/.pibo-dev.",
			"Install the generated systemd units and dev start wrapper, then start pibo-web and pibo-web-dev.",
			"Install Docker and validate `pibo compute spawn` so agent workers can restart their own gateways safely.",
			"Point DNS at the host before expecting Caddy/Let's Encrypt to issue certificates.",
			"Run `pibo gateway web status`, `PIBO_GATEWAY_DEV_PORT=4808 pibo gateway dev status`, and browser checks for both domains.",
		],
		generatedFiles,
	};
}

type MaterializeOptions = { apply?: boolean; writeTo?: string; yes?: boolean };

type WrittenFile = { sourcePath: string; destinationPath: string; mode?: number };

function materializedPath(filePath: string, writeTo?: string): string {
	if (!writeTo) return filePath;
	return isAbsolute(filePath) ? join(writeTo, filePath.replace(/^\/+/, "")) : join(writeTo, filePath);
}

function writeGeneratedFiles(plan: SetupPlan, options: MaterializeOptions): WrittenFile[] {
	if (options.apply && options.writeTo) throw new Error("Use either --apply or --write-to, not both");
	if (options.apply && options.yes !== true) throw new Error("Refusing to write system files without --yes");
	if (!options.apply && !options.writeTo) return [];
	const written: WrittenFile[] = [];
	for (const file of plan.generatedFiles) {
		const destinationPath = materializedPath(file.path, options.writeTo);
		mkdirSync(dirname(destinationPath), { recursive: true });
		writeFileSync(destinationPath, file.content.endsWith("\n") ? file.content : `${file.content}\n`);
		if (file.mode !== undefined) chmodSync(destinationPath, file.mode);
		written.push({ sourcePath: file.path, destinationPath, mode: file.mode });
	}
	return written;
}

function printWrittenFiles(written: WrittenFile[]): void {
	if (written.length === 0) return;
	console.log("\nWrote files:");
	for (const file of written) {
		const mode = file.mode !== undefined ? ` mode=${file.mode.toString(8)}` : "";
		console.log(`- ${file.destinationPath} (from ${file.sourcePath})${mode}`);
	}
}

function emitPlan(plan: SetupPlan, options: { json?: boolean; printFiles?: boolean; apply?: boolean; writeTo?: string; yes?: boolean }): void {
	if (options.json && (options.apply || options.writeTo)) throw new Error("--json cannot be combined with --apply or --write-to");
	if (options.json) {
		printJson(plan);
		return;
	}
	printPlan(plan, options.printFiles === true);
	printWrittenFiles(writeGeneratedFiles(plan, options));
}

function printPlan(plan: SetupPlan, printFiles: boolean): void {
	console.log(`${plan.mode}: ${plan.summary}`);
	console.log("\nPrinciples:");
	for (const item of plan.principles) console.log(`- ${item}`);
	console.log("\nServices:");
	for (const [name, service] of Object.entries(plan.services)) {
		const gateway = service.gatewayPort ? ` gateway=${service.gatewayPort}` : "";
		const branch = service.branch ? ` branch=${service.branch}` : "";
		console.log(`- ${name}: web=${service.port}${gateway} home=${service.home}${branch}`);
	}
	if (plan.warnings.length > 0) {
		console.log("\nWarnings:");
		for (const warning of plan.warnings) console.log(`- ${warning}`);
	}
	console.log("\nNext steps:");
	for (const [index, step] of plan.nextSteps.entries()) console.log(`${index + 1}. ${step}`);
	console.log("\nGenerated files:");
	for (const file of plan.generatedFiles) console.log(`- ${file.path}: ${file.purpose}`);
	if (printFiles) {
		for (const file of plan.generatedFiles) {
			console.log(`\n--- ${file.path} ---`);
			console.log(file.content.trimEnd());
		}
	}
}

function printJson(value: unknown): void {
	console.log(JSON.stringify(value, null, 2));
}

type DoctorCheck = { name: string; status: "ok" | "warn" | "fail"; detail: string };

type DoctorStatus = {
	node: string;
	nodeMajorOk: boolean;
	platform: string;
	uid?: number;
	piboHome: string;
	checks: DoctorCheck[];
	recommendations: string[];
};

function commandExists(command: string): boolean {
	try {
		execFileSync("sh", ["-lc", `command -v ${shellQuote(command)} >/dev/null 2>&1`], { stdio: "ignore" });
		return true;
	} catch {
		return false;
	}
}

function commandOutput(command: string, args: string[]): string | undefined {
	try {
		return execFileSync(command, args, { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).trim();
	} catch {
		return undefined;
	}
}

function addCommandCheck(checks: DoctorCheck[], command: string, required: boolean): void {
	const installed = commandExists(command);
	checks.push({
		name: `command:${command}`,
		status: installed ? "ok" : required ? "fail" : "warn",
		detail: installed ? `${command} is installed` : `${command} is not installed`,
	});
}

function authConfigChecks(piboHome: string): DoctorCheck[] {
	const configPath = join(piboHome, "config.json");
	const notReady = "Pibo web will not start until Better Auth is configured. Set auth.baseURL, auth.secret, auth.googleClientId, auth.googleClientSecret, and auth.allowedEmails.";
	if (!existsSync(configPath)) return [
		{ name: "auth.ready", status: "fail", detail: notReady },
		{ name: "auth.config", status: "fail", detail: `${configPath} does not exist yet` },
	];
	try {
		const config = loadPiboConfig(configPath);
		const checks: DoctorCheck[] = [];
		const missing: string[] = [];
		const requiredStrings = [
			{ key: "auth.baseURL", detail: "Set with `pibo config set auth.baseURL https://your-domain.example`." },
			{ key: "auth.secret", detail: "Set a random value with at least 32 characters." },
			{ key: "auth.googleClientId", detail: "Create a Google OAuth web client and set its client id." },
			{ key: "auth.googleClientSecret", detail: "Set the Google OAuth client secret." },
		];
		for (const item of requiredStrings) {
			const value = getPiboConfigValue(config, item.key);
			const ok = typeof value === "string" && value.length > 0 && (item.key !== "auth.secret" || value.length >= 32);
			if (!ok) missing.push(item.key);
			checks.push({ name: item.key, status: ok ? "ok" : "fail", detail: ok ? `${item.key} is configured` : `${item.key} is missing or invalid. ${item.detail}` });
		}
		const allowedEmails = getPiboConfigValue(config, "auth.allowedEmails");
		const allowedEmailsOk = Array.isArray(allowedEmails) && allowedEmails.length > 0;
		if (!allowedEmailsOk) missing.push("auth.allowedEmails");
		checks.push({
			name: "auth.allowedEmails",
			status: allowedEmailsOk ? "ok" : "fail",
			detail: allowedEmailsOk ? "auth.allowedEmails is configured" : "auth.allowedEmails is missing or empty. Set with `pibo config set auth.allowedEmails you@example.com`.",
		});
		checks.unshift({ name: "auth.ready", status: missing.length === 0 ? "ok" : "fail", detail: missing.length === 0 ? "Better Auth is configured" : `${notReady} Missing: ${missing.join(", ")}` });
		return checks;
	} catch (error) {
		return [{ name: "auth.config", status: "fail", detail: error instanceof Error ? error.message : String(error) }];
	}
}

function swapTotalGb(): number | undefined {
	try {
		const match = readFileSync("/proc/meminfo", "utf8").match(/^SwapTotal:\s+(\d+)\s+kB/m);
		if (!match) return undefined;
		return Number(match[1]) / 1024 / 1024;
	} catch {
		return undefined;
	}
}

function swapCheck(minSwapGb: number | undefined): DoctorCheck[] {
	if (!minSwapGb || minSwapGb <= 0) return [];
	const total = swapTotalGb();
	if (total === undefined) return [{ name: "swap", status: "warn", detail: "Could not inspect swap from /proc/meminfo" }];
	const ok = total + 0.05 >= minSwapGb;
	return [{
		name: "swap",
		status: ok ? "ok" : "fail",
		detail: `Swap ${total.toFixed(1)} GiB; expected at least ${minSwapGb} GiB for this host profile`,
	}];
}

async function dnsChecks(domain: string | undefined, expectedIp: string | undefined, label: string): Promise<DoctorCheck[]> {
	if (!domain) return [];
	try {
		const addresses = await resolve4(domain);
		const matches = expectedIp ? addresses.includes(expectedIp) : true;
		return [{
			name: `dns:${label}`,
			status: matches ? "ok" : "fail",
			detail: expectedIp ? `${domain} A=${addresses.join(", ") || "<none>"}; expected ${expectedIp}` : `${domain} A=${addresses.join(", ") || "<none>"}`,
		}];
	} catch (error) {
		return [{ name: `dns:${label}`, status: "fail", detail: error instanceof Error ? error.message : String(error) }];
	}
}

async function createDoctorStatus(options: { piboHome?: string; domain?: string; devDomain?: string; expectedIp?: string; requireDocker?: boolean; minSwapGb?: number }): Promise<DoctorStatus> {
	const piboHome = options.piboHome ?? getPiboHome();
	const checks: DoctorCheck[] = [];
	const nodeMajorOk = Number(process.versions.node.split(".")[0]) >= 24;
	checks.push({ name: "node", status: nodeMajorOk ? "ok" : "fail", detail: `Node ${process.versions.node}${nodeMajorOk ? "" : " requires >=24"}` });
	addCommandCheck(checks, "npm", true);
	addCommandCheck(checks, "git", false);
	addCommandCheck(checks, "systemctl", false);
	addCommandCheck(checks, "caddy", false);
	addCommandCheck(checks, "docker", options.requireDocker === true);
	if (commandExists("docker")) {
		const dockerInfo = commandOutput("docker", ["info", "--format", "{{.ServerVersion}}"]);
		checks.push({ name: "docker.daemon", status: dockerInfo ? "ok" : options.requireDocker ? "fail" : "warn", detail: dockerInfo ? `Docker daemon ${dockerInfo}` : "Docker daemon is not reachable" });
	}
	checks.push(...swapCheck(options.minSwapGb));
	checks.push(...authConfigChecks(piboHome));
	checks.push(...await dnsChecks(options.domain, options.expectedIp, "production"));
	checks.push(...await dnsChecks(options.devDomain, options.expectedIp, "development"));
	return {
		node: process.versions.node,
		nodeMajorOk,
		platform: process.platform,
		uid: typeof process.getuid === "function" ? process.getuid() : undefined,
		piboHome,
		checks,
		recommendations: [
			"Use user-host setup for normal npm installs.",
			"Use developer-host setup only when you need prod/dev gateways, Docker compute workers, GitHub App PR flow, and branch worktrees.",
			"Configure auth before starting pibo-web; Better Auth requires baseURL, secret, Google OAuth values, and allowed emails.",
			"Docker is only required for developer-host compute workers; user-host installs can ignore Docker warnings.",
			"Swap is not created automatically; for developer hosts, provision swap at the OS level and verify it with `--min-swap-gb`."
		],
	};
}

function printDoctorStatus(status: DoctorStatus): void {
	console.log(`Node: ${status.node} (${status.nodeMajorOk ? "ok" : "requires >=24"})`);
	console.log(`Platform: ${status.platform}`);
	console.log(`PIBO_HOME: ${status.piboHome}`);
	console.log("Checks:");
	for (const check of status.checks) console.log(`- ${check.status.toUpperCase()} ${check.name}: ${check.detail}`);
	console.log("Recommendations:");
	for (const item of status.recommendations) console.log(`- ${item}`);
}

export async function runSetupCli(argv = process.argv): Promise<void> {
	const program = new Command();
	program.name("pibo setup").description("Plan Pibo host installation and developer upgrades").helpOption("-h, --help", "Display help for command").showHelpAfterError();

	program
		.command("user-host")
		.description("Plan a simple one-gateway Pibo host for normal users")
		.option("--domain <domain>", "Production domain, for example pibo.example.com")
		.option("--www-domain <domain>", "Optional www redirect domain")
		.option("--pibo-home <path>", "PIBO_HOME for the user host", "/root/.pibo")
		.option("--working-dir <path>", "systemd WorkingDirectory for npm-based installs", "/root")
		.option("--web-port <port>", "Loopback web port", parsePort, 4788)
		.option("--service-name <name>", "systemd service name", "pibo-web")
		.option("--pibo-command <command>", "Command used by systemd to start pibo", "/usr/bin/pibo")
		.option("--no-caddy", "Do not include a Caddyfile")
		.option("--json", "Print JSON")
		.option("--print-files", "Print generated file contents")
		.option("--write-to <dir>", "Write generated files under a staging directory instead of system paths")
		.option("--apply", "Write generated files to their target system paths")
		.option("--yes", "Confirm --apply writes")
		.action((options: { domain?: string; wwwDomain?: string; piboHome: string; workingDir: string; webPort: number; serviceName: string; piboCommand: string; caddy: boolean; json?: boolean; printFiles?: boolean; writeTo?: string; apply?: boolean; yes?: boolean }) => {
			const plan = createUserHostSetupPlan({ ...options, workingDirectory: options.workingDir, includeCaddy: options.caddy });
			emitPlan(plan, options);
		});

	program
		.command("developer-host")
		.description("Plan a two-gateway developer host with prod/dev separation and Docker compute workers")
		.option("--prod-domain <domain>", "Production domain")
		.option("--prod-www-domain <domain>", "Production www redirect domain")
		.option("--dev-domain <domain>", "Development domain")
		.option("--dev-www-domain <domain>", "Development www redirect domain")
		.option("--origin <url>", "Server-specific fork remote")
		.option("--upstream <url>", "Canonical upstream remote", "git@github.com:Pascapone/pibo.git")
		.option("--repo-dir <path>", "Production source checkout", "/root/code/pibo")
		.option("--dev-worktree <path>", "Development worktree path")
		.option("--prod-branch <name>", "Production branch", "main")
		.option("--dev-branch <name>", "Development branch", "dev")
		.option("--prod-home <path>", "Production PIBO_HOME", "/root/.pibo")
		.option("--dev-home <path>", "Development PIBO_HOME", "/root/.pibo-dev")
		.option("--prod-web-port <port>", "Production web port", parsePort, 4788)
		.option("--prod-gateway-port <port>", "Production internal gateway port", parsePort, 4789)
		.option("--dev-web-port <port>", "Development web port", parsePort, 4808)
		.option("--dev-gateway-port <port>", "Development internal gateway port", parsePort, 4809)
		.option("--node-command <command>", "Node command used by generated source-pinned services", "/usr/bin/node")
		.option("--no-caddy", "Do not include a Caddyfile")
		.option("--json", "Print JSON")
		.option("--print-files", "Print generated file contents")
		.option("--write-to <dir>", "Write generated files under a staging directory instead of system paths")
		.option("--apply", "Write generated files to their target system paths")
		.option("--yes", "Confirm --apply writes")
		.action((options: { prodDomain?: string; prodWwwDomain?: string; devDomain?: string; devWwwDomain?: string; origin?: string; upstream?: string; repoDir: string; devWorktree?: string; prodBranch: string; devBranch: string; prodHome: string; devHome: string; prodWebPort: number; prodGatewayPort: number; devWebPort: number; devGatewayPort: number; nodeCommand: string; caddy: boolean; json?: boolean; printFiles?: boolean; writeTo?: string; apply?: boolean; yes?: boolean }) => {
			const plan = createDeveloperHostSetupPlan({ ...options, includeCaddy: options.caddy });
			emitPlan(plan, options);
		});

	program
		.command("doctor")
		.description("Inspect local host prerequisites without changing the system")
		.option("--pibo-home <path>", "PIBO_HOME to inspect", getPiboHome())
		.option("--domain <domain>", "Production domain to resolve")
		.option("--dev-domain <domain>", "Development domain to resolve")
		.option("--expected-ip <ip>", "Expected A record target for domain checks")
		.option("--require-docker", "Treat missing Docker as a failure")
		.option("--min-swap-gb <gb>", "Require at least this much configured swap", parseNonNegativeNumber)
		.option("--json", "Print JSON")
		.action(async (options: { piboHome?: string; domain?: string; devDomain?: string; expectedIp?: string; requireDocker?: boolean; minSwapGb?: number; json?: boolean }) => {
			const status = await createDoctorStatus(options);
			if (options.json) printJson(status);
			else printDoctorStatus(status);
		});

	if (argv.length <= 2 || argv[2] === "--help" || argv[2] === "-h") {
		program.outputHelp();
		return;
	}
	await program.parseAsync(argv);
}

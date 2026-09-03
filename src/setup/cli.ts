import { execFileSync } from "node:child_process";
import { resolve4 } from "node:dns/promises";
import { chmodSync, existsSync, mkdirSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { dirname, isAbsolute, join, resolve } from "node:path";
import { createInterface } from "node:readline/promises";
import { Command } from "commander";
import { getPiboConfigValue, loadPiboConfig } from "../config/config.js";
import { getPiboHome } from "../core/pibo-home.js";
import { getWslInfo, isWsl, type WslInfo } from "../core/wsl.js";
import {
	createInstallationPlan,
	inspectInstallation,
	installationManifestPath,
	materializeInstallationPlan,
	parseInstallationComponent,
	parseInstallationProfile,
	readInstallationManifest,
	runPendingInstallationActions,
	uninstallInstallation,
	validateInstallationPlanTargets,
	type InstallationAction,
	type InstallationComponentName,
	type InstallationManifest,
	type InstallationPlan,
	type InstallationProfileName,
} from "./installation-profiles.js";

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

function parseInstallationDomain(value: string): string {
	const domain = value.trim().toLowerCase();
	if (domain.length > 253 || !/^(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z](?:[a-z0-9-]{0,61}[a-z0-9])?$/.test(domain)) {
		throw new Error("Domain must be a DNS hostname such as pibo.example.com");
	}
	return domain;
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
# Optional: override the dev deploy reachability probe. If omitted, deploy uses PIBO_DEV_BASE_URL/apps/chat.
# PIBO_DEV_PUBLIC_URL=${options.devDomain ? `https://${options.devDomain}/apps/chat` : "https://dev.pibo.example.com/apps/chat"}
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
	if (!options.domain) warnings.push("No production domain was provided; the Caddyfile is omitted and Auth examples use placeholders.");
	if (process.platform === "win32" && !isWsl()) {
		warnings.push("Pibo host setup targets Linux. Native Windows is not supported. Install WSL2 (https://aka.ms/wsl) and run setup inside the WSL distribution. See docs/project/guides/pibo-on-windows-via-wsl.md.");
	}
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
	if (options.includeCaddy !== false && options.domain) {
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
	if (process.platform === "win32" && !isWsl()) {
		warnings.push("Pibo developer-host setup targets Linux. Native Windows is not supported. Install WSL2 (https://aka.ms/wsl) and run setup inside the WSL distribution. See docs/project/guides/pibo-on-windows-via-wsl.md.");
	}
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
	wsl: WslInfo;
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
		return execFileSync(command, args, { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"], timeout: 5_000 }).trim();
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
	const notReady = "Pibo web will not start until Better Auth is configured. Set auth.baseURL, auth.secret, auth.googleClientId, auth.googleClientSecret, and auth.allowedEmails. For local-only development, use `pibo config set auth.mode local` and run `pibo gateway:web --auth=local`.";
	if (!existsSync(configPath)) return [
		{ name: "auth.ready", status: "fail", detail: notReady },
		{ name: "auth.config", status: "fail", detail: `${configPath} does not exist yet` },
	];
	try {
		const config = loadPiboConfig(configPath);
		const checks: DoctorCheck[] = [];
		const missing: string[] = [];
		const authModeValue = getPiboConfigValue(config, "auth.mode");
		const isLocalMode = authModeValue === "local";
		const isBetterAuthMode = authModeValue === "better-auth" || authModeValue === undefined;

		checks.push({
			name: "auth.mode",
			status: isLocalMode || isBetterAuthMode ? "ok" : "fail",
			detail: isLocalMode
				? "auth.mode is 'local' — Google OAuth is not required; gateway must be bound to loopback."
				: isBetterAuthMode
					? "auth.mode is unset (defaults to 'better-auth')."
					: `auth.mode is '${String(authModeValue)}' — must be 'better-auth' or 'local'.`,
		});

		if (isLocalMode) {
			// Local mode does not require any of the Better Auth keys. We still
			// surface what is configured for operator awareness.
			checks.unshift({ name: "auth.ready", status: "ok", detail: "Auth is in local mode. No Google OAuth required. Bind the gateway to a loopback address." });
			return checks;
		}

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
	const wslInfo = getWslInfo();
	if (wslInfo.isWsl) {
		const versionLabel = wslInfo.version ? `WSL${wslInfo.version}` : "WSL";
		const distroLabel = wslInfo.distro ? ` (${wslInfo.distro})` : "";
		checks.push({ name: "platform.wsl", status: "ok", detail: `Running inside ${versionLabel}${distroLabel}; Pibo is fully supported here. See docs/project/guides/pibo-on-windows-via-wsl.md.` });
	} else if (process.platform === "win32") {
		checks.push({
			name: "platform.wsl",
			status: "fail",
			detail: "Native Windows is not supported. Install WSL2 (https://aka.ms/wsl) and run Pibo inside the WSL distribution. See docs/project/guides/pibo-on-windows-via-wsl.md.",
		});
	}
	checks.push(...swapCheck(options.minSwapGb));
	checks.push(...authConfigChecks(piboHome));
	const installation = inspectInstallation({ piboHome });
	if (installation.installed) {
		const installationManifest = readInstallationManifest(installation.manifestPath);
		if (installationManifest?.domain && existsSync(join(piboHome, "config.json"))) {
			const config = loadPiboConfig(join(piboHome, "config.json"));
			if (getPiboConfigValue(config, "auth.mode") === "local") checks.push({ name: "setup.auth-boundary", status: "fail", detail: "A public installation domain cannot use local auth; configure Better Auth and rerun setup upgrade" });
		}
		for (const check of installation.checks) checks.push({ ...check, name: `setup.${check.name}` });
		const componentNames = new Set(installation.components.map((component) => component.name));
		for (const service of componentNames.has("vscode-web") ? ["pibo-web", "pibo-code-server", "caddy"] : ["pibo-web", "caddy"]) {
			const active = commandOutput("systemctl", ["is-active", service]) === "active";
			checks.push({ name: `service:${service}`, status: active ? "ok" : "fail", detail: active ? `${service} is active` : `${service} is not active; repair with ${installation.repairCommand}` });
		}
		if (componentNames.has("browser-tools")) {
			for (const name of ["browser-use", "agent-browser"]) {
				const executable = name === "browser-use" ? join(piboHome, "tools", name, ".venv", "bin", name) : join(piboHome, "tools", name, "node", "node_modules", ".bin", name);
				const installed = existsSync(executable);
				checks.push({ name: `tool:${name}`, status: installed ? "ok" : "fail", detail: installed ? `${name} is installed through the curated tool registry` : `${name} is missing; repair with \`pibo setup component add browser-tools --apply --yes\`` });
				const profileRoots = name === "browser-use"
					? [join(piboHome, "tools", name, "home", "chrome-profiles"), join(piboHome, "tools", name, "home", "auth-pool"), join(piboHome, "tools", name, "home", "pibo-browser-pool")]
					: [join(piboHome, "tools", name, "home", "profiles"), join(piboHome, "tools", name, "home", "profiles", "auth-template"), join(piboHome, "tools", name, "home", "profiles", "leases")];
				for (const profileRoot of profileRoots) {
					const privateDirectory = existsSync(profileRoot) && (statSync(profileRoot).mode & 0o077) === 0;
					checks.push({ name: `browser-profiles:${name}:${profileRoot.split("/").at(-1)}`, status: privateDirectory ? "ok" : "fail", detail: privateDirectory ? `${profileRoot} is present with private permissions` : `${profileRoot} is missing or accessible to group/other users` });
				}
			}
		}
		if (componentNames.has("mcp-defaults")) {
			const binDir = join(piboHome, "setup", "mcp-runtime", "node_modules", ".bin");
			for (const binary of ["chrome-devtools-mcp", "mcp-server-filesystem"]) {
				const path = join(binDir, binary);
				checks.push({ name: `mcp:${binary}`, status: existsSync(path) ? "ok" : "fail", detail: existsSync(path) ? `${path} is installed from the pinned setup manifest` : `${path} is missing; repair with ${installation.repairCommand}` });
			}
			const chromeDevtoolsPath = join(binDir, "chrome-devtools-mcp");
			if (existsSync(chromeDevtoolsPath)) {
				const starts = commandOutput(chromeDevtoolsPath, ["--help"]) !== undefined;
				checks.push({ name: "mcp:chrome-devtools-startup", status: starts ? "ok" : "fail", detail: starts ? "Chrome DevTools MCP starts and parses its command line" : `Chrome DevTools MCP failed its startup probe; repair with ${installation.repairCommand}` });
			}
		}
		if (componentNames.has("web-annotations")) {
			try {
				const response = await fetch("http://127.0.0.1:4788/apps/web-annotations/overlay.js?pibo-setup-doctor=1", { redirect: "manual", signal: AbortSignal.timeout(3_000) });
				const available = [200, 204, 302, 303, 307, 308, 401, 403].includes(response.status);
				checks.push({ name: "http:web-annotations", status: available ? "ok" : "fail", detail: available ? `Web Annotations route is available (HTTP ${response.status})` : `Web Annotations route returned unexpected HTTP ${response.status}` });
			} catch (error) {
				checks.push({ name: "http:web-annotations", status: "fail", detail: `Web Annotations route probe failed: ${error instanceof Error ? error.message : String(error)}` });
			}
		}
		if (componentNames.has("vscode-web")) {
			const listeners = commandOutput("ss", ["-ltnH"]);
			if (!listeners) checks.push({ name: "listener:vscode-web", status: "warn", detail: "Could not inspect TCP listeners with ss" });
			else {
				const lines = listeners.split("\n").filter((line) => /:4790\b/.test(line));
				const unsafe = lines.some((line) => /(?:0\.0\.0\.0|\[::\]|\*):4790\b/.test(line));
				const loopback = lines.some((line) => /127\.0\.0\.1:4790\b/.test(line));
				checks.push({ name: "listener:vscode-web", status: unsafe || !loopback ? "fail" : "ok", detail: unsafe ? "VS Code Web is exposed beyond loopback" : loopback ? "VS Code Web listens only on 127.0.0.1:4790" : "VS Code Web is not listening on 127.0.0.1:4790" });
			}
			try {
				const response = await fetch("http://127.0.0.1:4790/healthz", { signal: AbortSignal.timeout(3_000) });
				checks.push({ name: "http:vscode-web-internal", status: response.ok ? "ok" : "fail", detail: response.ok ? "VS Code Web internal health endpoint is reachable" : `VS Code Web internal health returned HTTP ${response.status}` });
			} catch (error) {
				checks.push({ name: "http:vscode-web-internal", status: "fail", detail: `VS Code Web internal health failed: ${error instanceof Error ? error.message : String(error)}` });
			}
			const publicDomain = options.domain ?? installationManifest?.domain;
			if (publicDomain) {
				try {
					const response = await fetch(`https://${publicDomain}/apps/vscode/`, { redirect: "manual", signal: AbortSignal.timeout(5_000) });
					const protectedStatus = [302, 303, 307, 308, 401, 403].includes(response.status);
					checks.push({ name: "proxy:vscode-auth", status: protectedStatus ? "ok" : "fail", detail: protectedStatus ? `Unauthenticated VS Code Web request was blocked with HTTP ${response.status}` : response.status === 200 ? "VS Code Web returned HTTP 200 without authentication" : `VS Code Web proxy returned unexpected HTTP ${response.status}` });
				} catch (error) {
					checks.push({ name: "proxy:vscode-auth", status: "fail", detail: `VS Code Web public auth-gate probe failed: ${error instanceof Error ? error.message : String(error)}` });
				}
				const websocketStatus = commandOutput("curl", ["-sS", "-o", "/dev/null", "-w", "%{http_code}", "--max-time", "5", "--http1.1", "-H", "Connection: Upgrade", "-H", "Upgrade: websocket", "-H", "Sec-WebSocket-Version: 13", "-H", "Sec-WebSocket-Key: cGliby1zZXR1cC1wcm9iZQ==", `https://${publicDomain}/apps/vscode/ws?pibo-setup-doctor=1`]);
				const websocketProtected = websocketStatus !== undefined && [302, 303, 307, 308, 401, 403].includes(Number(websocketStatus));
				checks.push({ name: "proxy:vscode-websocket-auth", status: websocketProtected ? "ok" : "fail", detail: websocketProtected ? `Unauthenticated VS Code WebSocket upgrade was blocked with HTTP ${websocketStatus}` : `VS Code WebSocket auth-gate probe failed${websocketStatus ? ` with HTTP ${websocketStatus}` : ""}` });
			} else checks.push({ name: "proxy:vscode-auth", status: "warn", detail: "No installation domain is recorded; pass --domain to verify the public auth gate" });
		}
	} else {
		checks.push({ name: "setup.manifest", status: "warn", detail: "No setup-managed installation profile is recorded. Inspect one with `pibo setup plan --profile batteries-included`." });
	}
	checks.push(...await dnsChecks(options.domain, options.expectedIp, "production"));
	checks.push(...await dnsChecks(options.devDomain, options.expectedIp, "development"));
	const recommendations: string[] = [
		"Use the Batteries Included profile for the recommended complete self-hosted workstation, or Vanilla for a minimal controlled base.",
		"Use developer-host topology only when you need prod/dev gateways, Docker compute workers, GitHub App PR flow, and branch worktrees.",
		"Configure auth before starting pibo-web; Better Auth requires baseURL, secret, Google OAuth values, and allowed emails.",
		"Docker is only required for developer-host compute workers; user-host installs can ignore Docker warnings.",
		"Swap is not created automatically; for developer hosts, provision swap at the OS level and verify it with `--min-swap-gb`.",
	];
	if (wslInfo.isWsl) {
		recommendations.push("You are inside WSL: install pibo with `npm install -g @pasko70/pibo` in the WSL shell, then open this folder in VSCode via the WSL extension so the editor talks to the WSL gateway.");
		recommendations.push("Browser-Use and Agent-Browser work directly under WSLg on Windows 11. On Windows 10, install an X server (e.g. VcXsrv) and export DISPLAY=:0 inside WSL.");
	} else if (process.platform === "win32") {
		recommendations.push("Pibo does not run natively on Windows. Install WSL2 with `wsl --install` and follow docs/project/guides/pibo-on-windows-via-wsl.md.");
	}
	return {
		node: process.versions.node,
		nodeMajorOk,
		platform: process.platform,
		uid: typeof process.getuid === "function" ? process.getuid() : undefined,
		piboHome,
		wsl: wslInfo,
		checks,
		recommendations,
	};
}

function printDoctorStatus(status: DoctorStatus): void {
	console.log(`Node: ${status.node} (${status.nodeMajorOk ? "ok" : "requires >=24"})`);
	console.log(`Platform: ${status.platform}`);
	if (status.wsl.isWsl) {
		const versionLabel = status.wsl.version ? `WSL${status.wsl.version}` : "WSL";
		const distroLabel = status.wsl.distro ? ` (${status.wsl.distro})` : "";
		console.log(`WSL: ${versionLabel}${distroLabel}`);
	}
	console.log(`PIBO_HOME: ${status.piboHome}`);
	console.log("Checks:");
	for (const check of status.checks) console.log(`- ${check.status.toUpperCase()} ${check.name}: ${check.detail}`);
	console.log("Recommendations:");
	for (const item of status.recommendations) console.log(`- ${item}`);
}

function printInstallationPlan(plan: InstallationPlan): void {
	console.log(`${plan.profile} (profile version ${plan.profileVersion}): ${plan.summary}`);
	console.log("\nComponents:");
	for (const component of plan.components) console.log(`- ${component.name}: ${component.version} — ${component.description}`);
	console.log("\nHost packages:");
	for (const packageName of plan.hostPackages) console.log(`- ${packageName}`);
	console.log("\nDownloads:");
	if (plan.downloads.length === 0) console.log("- none");
	for (const download of plan.downloads) console.log(`- ${download.name} ${download.version}: ${Object.keys(download.urls).join(", ")} (SHA-256 pinned)`);
	console.log("\nServices and listeners:");
	for (const service of plan.services) console.log(`- ${service.name}: ${service.bind}, user=${service.user}, public=${service.public ? "yes" : "no"}`);
	console.log("\nOwned files:");
	for (const file of plan.files) console.log(`- ${file.path}: ${file.purpose}`);
	console.log("\nApply actions:");
	for (const action of plan.actions) console.log(`- ${action.id}: ${action.description}${action.restartEffect ? ` (${action.restartEffect})` : ""}`);
	console.log("\nSecurity boundaries:");
	for (const item of plan.securityBoundaries) console.log(`- ${item}`);
	if (plan.warnings.length > 0) {
		console.log("\nWarnings:");
		for (const warning of plan.warnings) console.log(`- ${warning}`);
	}
	console.log(`\nRepair: ${plan.repairCommand}`);
}

function runInstallationAction(action: InstallationAction): void {
	console.log(`[pibo setup] ${action.id}: ${action.description}`);
	execFileSync("sh", ["-lc", action.command], { stdio: "inherit" });
}

function installationActionIsComplete(action: InstallationAction): boolean {
	if (!action.checkCommand) return true;
	try {
		execFileSync("sh", ["-lc", action.checkCommand], { stdio: "ignore" });
		return true;
	} catch {
		return false;
	}
}

function removeComponentsNoLongerPlanned(manifest: InstallationManifest, plan: InstallationPlan): void {
	const installed = new Set(manifest.components.map((component) => component.name));
	const planned = new Set(plan.components.map((component) => component.name));
	if (installed.has("vscode-web") && !planned.has("vscode-web")) execFileSync("systemctl", ["disable", "--now", "pibo-code-server"], { stdio: "inherit" });
	if (installed.has("browser-tools") && !planned.has("browser-tools")) {
		for (const path of [join(manifest.piboHome, "tools/browser-use/.venv"), join(manifest.piboHome, "tools/agent-browser/node")]) rmSync(path, { recursive: true, force: true });
	}
}

function stopInstalledServices(manifest: InstallationManifest): void {
	const componentNames = new Set(manifest.components.map((component) => component.name));
	if (componentNames.has("vscode-web")) execFileSync("systemctl", ["disable", "--now", "pibo-code-server"], { stdio: "inherit" });
	execFileSync("systemctl", ["disable", "--now", "pibo-web"], { stdio: "inherit" });
	if (componentNames.has("browser-tools")) {
		for (const path of [join(manifest.piboHome, "tools/browser-use/.venv"), join(manifest.piboHome, "tools/agent-browser/node")]) rmSync(path, { recursive: true, force: true });
	}
}

function requireConfirmedApply(options: { apply?: boolean; yes?: boolean }): void {
	if (!options.apply) return;
	if (options.yes !== true) throw new Error("Refusing to modify the host without --yes");
	if (typeof process.getuid === "function" && process.getuid() !== 0) throw new Error("Host installation requires root; rerun with sudo");
	if (process.platform !== "linux") throw new Error("Host installation apply mode currently supports Linux only");
}

function validatePublicAuthBoundary(plan: InstallationPlan): void {
	if (!plan.domain) return;
	const configPath = join(plan.piboHome, "config.json");
	if (!existsSync(configPath)) throw new Error(`Public setup requires Better Auth configuration at ${configPath}; run pibo config set before --apply`);
	const config = loadPiboConfig(configPath);
	if (getPiboConfigValue(config, "auth.mode") === "local") throw new Error("Refusing to expose a local-auth gateway through a public installation domain; configure Better Auth first");
	const failures = authConfigChecks(plan.piboHome).filter((check) => check.status === "fail");
	if (failures.length > 0) throw new Error(`Public setup requires complete Better Auth configuration: ${failures.map((check) => check.name).join(", ")}`);
	const baseUrlValue = getPiboConfigValue(config, "auth.baseURL");
	let baseUrl: URL;
	try {
		baseUrl = new URL(String(baseUrlValue));
	} catch {
		throw new Error("Public setup requires auth.baseURL to be a valid HTTPS URL");
	}
	if (baseUrl.protocol !== "https:" || baseUrl.hostname !== plan.domain) throw new Error(`Public setup domain ${plan.domain} must match the HTTPS auth.baseURL hostname`);
}

function emitInstallationPlan(plan: InstallationPlan, options: { json?: boolean }): void {
	if (options.json) printJson(plan);
	else printInstallationPlan(plan);
}

function applyOrStageInstallation(plan: InstallationPlan, options: { apply?: boolean; yes?: boolean; writeTo?: string; json?: boolean }): void {
	if (options.apply && options.writeTo) throw new Error("Use either --apply or --write-to, not both");
	if (!options.apply && !options.writeTo) {
		emitInstallationPlan(plan, options);
		return;
	}
	if (options.json) throw new Error("--json cannot be combined with --apply or --write-to");
	requireConfirmedApply(options);
	if (options.apply) validatePublicAuthBoundary(plan);
	validateInstallationPlanTargets(plan, { root: options.writeTo });
	const previousManifest = options.apply ? readInstallationManifest(installationManifestPath(plan.piboHome)) : undefined;
	if (previousManifest) removeComponentsNoLongerPlanned(previousManifest, plan);
	const bootstrapActions = plan.actions.filter((action) => action.id === "host-packages");
	const bootstrapCompleted: string[] = [];
	if (options.apply && !existsSync(installationManifestPath(plan.piboHome))) {
		for (const action of bootstrapActions) {
			runInstallationAction(action);
			bootstrapCompleted.push(action.id);
		}
	}
	const result = materializeInstallationPlan(plan, { root: options.writeTo });
	if (options.apply && bootstrapCompleted.length > 0) {
		runPendingInstallationActions({ ...plan, actions: bootstrapActions }, result.manifestPath, () => undefined);
	}
	const actions = options.apply ? runPendingInstallationActions(plan, result.manifestPath, runInstallationAction, { isComplete: installationActionIsComplete }) : undefined;
	console.log(`${options.apply ? "Installed" : "Staged"} ${plan.profile} profile.`);
	console.log(`Manifest: ${result.manifestPath}`);
	console.log(`Written: ${result.written.length}; unchanged: ${result.unchanged.length}; removed obsolete: ${result.removed.length}; preserved modified: ${result.preserved.length}`);
	if (actions) console.log(`Actions completed: ${bootstrapCompleted.length + actions.completed.length}; skipped: ${actions.skipped.filter((id) => !bootstrapCompleted.includes(id)).length}`);
}

function currentPiboVersion(): string {
	const packageJson = JSON.parse(readFileSync(new URL("../../package.json", import.meta.url), "utf8")) as { version?: unknown };
	if (typeof packageJson.version !== "string" || packageJson.version.length === 0) throw new Error("Unable to read Pibo package version");
	return packageJson.version;
}

function installationPlanOptions(options: { profile: InstallationProfileName; piboHome: string; workspaceRoot: string; piboCommand?: string; domain?: string; additionalComponents?: InstallationComponentName[] }): InstallationPlan {
	return createInstallationPlan({ ...options, piboVersion: currentPiboVersion() });
}

function currentPiboCommand(): string {
	const entrypoint = process.argv[1] ? resolve(process.argv[1]) : "/usr/bin/pibo";
	return entrypoint === "/usr/bin/pibo" ? entrypoint : `${process.execPath} ${entrypoint}`;
}

async function chooseInteractiveInstallationProfile(profile?: InstallationProfileName): Promise<InstallationProfileName> {
	if (profile) return profile;
	if (!process.stdin.isTTY || !process.stdout.isTTY) throw new Error("Non-interactive setup requires an explicit --profile batteries-included or --profile vanilla");
	console.log("Batteries Included is recommended. It adds a loopback-only IDE, managed browser tooling, and curated MCP defaults behind Pibo authentication.");
	console.log("Vanilla installs only the gateway and Chat Web host requirements.");
	const prompt = createInterface({ input: process.stdin, output: process.stdout });
	try {
		const answer = (await prompt.question("Profile [batteries-included]: ")).trim();
		return answer === "" ? "batteries-included" : parseInstallationProfile(answer);
	} finally {
		prompt.close();
	}
}

export async function runSetupCli(argv = process.argv): Promise<void> {
	const program = new Command();
	program.name("pibo setup").description("Plan, install, inspect, upgrade, and remove supported Pibo host profiles").helpOption("-h, --help", "Display help for command").showHelpAfterError();

	program
		.command("plan")
		.description("Inspect an installation profile without changing the host")
		.option("--profile <profile>", "batteries-included (recommended) or vanilla", parseInstallationProfile, "batteries-included")
		.option("--pibo-home <path>", "PIBO_HOME", "/root/.pibo")
		.option("--workspace-root <path>", "Workspace directory exposed to VS Code Web", "/srv/pibo-workspaces")
		.option("--pibo-command <command>", "Pibo command used by generated services and lifecycle actions", currentPiboCommand())
		.option("--domain <domain>", "Public HTTPS domain", parseInstallationDomain)
		.option("--json", "Print machine-readable JSON")
		.action((options: { profile: InstallationProfileName; piboHome: string; workspaceRoot: string; piboCommand: string; domain?: string; json?: boolean }) => {
			emitInstallationPlan(installationPlanOptions(options), options);
		});

	program
		.command("install")
		.description("Install a supported profile; Batteries Included is the recommended default")
		.option("--profile <profile>", "batteries-included (recommended) or vanilla; required outside an interactive terminal", parseInstallationProfile)
		.option("--pibo-home <path>", "PIBO_HOME", "/root/.pibo")
		.option("--workspace-root <path>", "Workspace directory exposed to VS Code Web", "/srv/pibo-workspaces")
		.option("--pibo-command <command>", "Pibo command used by generated services and lifecycle actions", currentPiboCommand())
		.option("--domain <domain>", "Public HTTPS domain", parseInstallationDomain)
		.option("--json", "Print machine-readable plan JSON without applying")
		.option("--write-to <dir>", "Stage the complete owned filesystem tree under a review directory")
		.option("--apply", "Apply generated files, packages, services, and safe restarts to this Linux host")
		.option("--yes", "Confirm privileged host changes")
		.action(async (options: { profile?: InstallationProfileName; piboHome: string; workspaceRoot: string; piboCommand: string; domain?: string; json?: boolean; writeTo?: string; apply?: boolean; yes?: boolean }) => {
			const profile = await chooseInteractiveInstallationProfile(options.profile);
			applyOrStageInstallation(installationPlanOptions({ ...options, profile }), options);
		});

	program
		.command("status")
		.description("Inspect the installed profile, components, versions, and owned-file drift")
		.option("--pibo-home <path>", "PIBO_HOME", getPiboHome())
		.option("--root <dir>", "Inspect a staged filesystem root")
		.option("--json", "Print machine-readable JSON")
		.action((options: { piboHome: string; root?: string; json?: boolean }) => {
			const status = inspectInstallation(options);
			if (options.json) printJson(status);
			else {
				console.log(status.installed ? `${status.profile} profile version ${status.profileVersion}` : "No setup-managed profile installed");
				for (const component of status.components) console.log(`- ${component.name}: ${component.version}`);
				console.log("Checks:");
				for (const check of status.checks) console.log(`- ${check.status.toUpperCase()} ${check.name}: ${check.detail}`);
				console.log(`Repair: ${status.repairCommand}`);
			}
		});

	program
		.command("upgrade")
		.description("Reconcile the installed profile with the current pinned component catalog")
		.option("--pibo-home <path>", "PIBO_HOME", getPiboHome())
		.option("--root <dir>", "Reconcile a staged filesystem root")
		.option("--apply", "Apply the upgrade to this Linux host")
		.option("--yes", "Confirm privileged host changes")
		.option("--json", "Print the upgrade plan as JSON without applying")
		.action((options: { piboHome: string; root?: string; apply?: boolean; yes?: boolean; json?: boolean }) => {
			if (options.root && options.apply) throw new Error("Use either --root for staging or --apply for the host, not both");
			const manifestPath = options.root ? join(options.root, installationManifestPath(options.piboHome).replace(/^\/+/, "")) : installationManifestPath(options.piboHome);
			const manifest = readInstallationManifest(manifestPath);
			if (!manifest) throw new Error(`No installation manifest found at ${manifestPath}`);
			const plan = createInstallationPlan({ profile: manifest.profile, piboHome: manifest.piboHome, workspaceRoot: manifest.workspaceRoot, piboCommand: manifest.piboCommand, piboVersion: currentPiboVersion(), domain: manifest.domain, additionalComponents: manifest.components.map((component) => component.name) });
			if (options.json) emitInstallationPlan(plan, { json: true });
			else applyOrStageInstallation(plan, { apply: options.apply, yes: options.yes, writeTo: options.root });
		});

	const component = program.command("component").description("Manage optional setup components");
	component
		.command("add <name>")
		.description("Add one component to an installed profile")
		.option("--pibo-home <path>", "PIBO_HOME", getPiboHome())
		.option("--root <dir>", "Update a staged filesystem root")
		.option("--apply", "Apply component installation to this Linux host")
		.option("--yes", "Confirm privileged host changes")
		.option("--json", "Print the component-add plan as JSON without applying")
		.action((name: string, options: { piboHome: string; root?: string; apply?: boolean; yes?: boolean; json?: boolean }) => {
			if (options.root && options.apply) throw new Error("Use either --root for staging or --apply for the host, not both");
			const manifestPath = options.root ? join(options.root, installationManifestPath(options.piboHome).replace(/^\/+/, "")) : installationManifestPath(options.piboHome);
			const manifest = readInstallationManifest(manifestPath);
			if (!manifest) throw new Error(`No installation manifest found at ${manifestPath}`);
			const additionalComponents = [...manifest.components.map((entry) => entry.name), parseInstallationComponent(name)];
			const plan = createInstallationPlan({ profile: manifest.profile, piboHome: manifest.piboHome, workspaceRoot: manifest.workspaceRoot, piboCommand: manifest.piboCommand, piboVersion: currentPiboVersion(), domain: manifest.domain, additionalComponents });
			if (options.json) emitInstallationPlan(plan, { json: true });
			else applyOrStageInstallation(plan, { apply: options.apply, yes: options.yes, writeTo: options.root });
		});

	program
		.command("uninstall")
		.description("Remove unchanged setup-owned files while preserving Pibo data and workspaces")
		.option("--pibo-home <path>", "PIBO_HOME", getPiboHome())
		.option("--root <dir>", "Remove a staged installation")
		.option("--apply", "Remove setup-owned host files")
		.option("--yes", "Confirm removal")
		.option("--json", "Print machine-readable JSON")
		.action((options: { piboHome: string; root?: string; apply?: boolean; yes?: boolean; json?: boolean }) => {
			if (options.root && options.apply) throw new Error("Use either --root for staging or --apply for the host, not both");
			const manifestPath = options.root ? join(options.root, installationManifestPath(options.piboHome).replace(/^\/+/, "")) : installationManifestPath(options.piboHome);
			const manifest = readInstallationManifest(manifestPath);
			if (!manifest) throw new Error(`No installation manifest found at ${manifestPath}`);
			const uninstallPlan = {
				profile: manifest.profile,
				components: manifest.components,
				services: ["pibo-web", ...(manifest.components.some((component) => component.name === "vscode-web") ? ["pibo-code-server"] : []), "caddy"],
				ownedFiles: manifest.ownedFiles.map((file) => file.path),
				preserves: [manifest.piboHome, manifest.workspaceRoot, "VS Code settings", "authenticated browser profiles", "sessions and product data"],
			};
			const execute = options.apply === true || (options.root !== undefined && options.yes === true);
			if (!execute) {
				if (options.json) printJson(uninstallPlan);
				else {
					console.log(`Uninstall plan for ${manifest.profile}:`);
					for (const path of uninstallPlan.ownedFiles) console.log(`- remove owned file: ${path}`);
					for (const path of uninstallPlan.preserves) console.log(`- preserve: ${path}`);
					console.log("Apply with --apply --yes.");
				}
				return;
			}
			requireConfirmedApply({ apply: options.apply, yes: options.yes });
			if (options.apply) stopInstalledServices(manifest);
			const result = uninstallInstallation(options);
			if (options.apply) {
				execFileSync("systemctl", ["daemon-reload"], { stdio: "inherit" });
				if (result.removed.includes("/etc/caddy/Caddyfile")) execFileSync("systemctl", ["stop", "caddy"], { stdio: "inherit" });
				else execFileSync("systemctl", ["reload", "caddy"], { stdio: "inherit" });
			}
			if (options.json) printJson(result);
			else {
				console.log(`Removed ${result.removed.length} setup-owned files.`);
				for (const path of result.preserved) console.log(`Preserved modified file: ${path}`);
				console.log("Pibo Home data and workspaces were preserved.");
			}
		});

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

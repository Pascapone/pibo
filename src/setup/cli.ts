import { Command } from "commander";

type SetupMode = "user-host" | "developer-host";

type GeneratedFile = {
	path: string;
	purpose: string;
	content: string;
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
	includeCaddy?: boolean;
} = {}): SetupPlan {
	const piboHome = options.piboHome ?? "/root/.pibo";
	const workingDirectory = options.workingDirectory ?? "/root";
	const webPort = options.webPort ?? 4788;
	const serviceName = options.serviceName ?? "pibo-web";
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
				execStart: `/usr/bin/pibo gateway:web --web-host 127.0.0.1 --web-port ${webPort}`,
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
				execStart: `/usr/bin/pibo gateway:web --web-host 127.0.0.1 --web-port ${prodWebPort}`,
			}),
		},
		{
			path: "/usr/local/bin/pibo-web-dev-start.mjs",
			purpose: "Dev gateway start wrapper; required so dev can use gateway port 4809 without colliding with production port 4789",
			content: devStartWrapper({ repoDir: devWorktree, webPort: devWebPort, gatewayPort: devGatewayPort }),
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
				execStart: "/usr/bin/node /usr/local/bin/pibo-web-dev-start.mjs",
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
			"Run `npm ci && npm run build && npm install -g .` in each branch/worktree that has a service.",
			"Restore or create production secrets under /root/.pibo; copy only non-production-safe config into /root/.pibo-dev.",
			"Install the generated systemd units and dev start wrapper, then start pibo-web and pibo-web-dev.",
			"Install Docker and validate `pibo compute spawn` so agent workers can restart their own gateways safely.",
			"Point DNS at the host before expecting Caddy/Let's Encrypt to issue certificates.",
			"Run `pibo gateway web status`, `PIBO_GATEWAY_DEV_PORT=4808 pibo gateway dev status`, and browser checks for both domains.",
		],
		generatedFiles,
	};
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
		.option("--no-caddy", "Do not include a Caddyfile")
		.option("--json", "Print JSON")
		.option("--print-files", "Print generated file contents")
		.action((options: { domain?: string; wwwDomain?: string; piboHome: string; workingDir: string; webPort: number; serviceName: string; caddy: boolean; json?: boolean; printFiles?: boolean }) => {
			const plan = createUserHostSetupPlan({ ...options, workingDirectory: options.workingDir, includeCaddy: options.caddy });
			if (options.json) printJson(plan);
			else printPlan(plan, options.printFiles === true);
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
		.option("--no-caddy", "Do not include a Caddyfile")
		.option("--json", "Print JSON")
		.option("--print-files", "Print generated file contents")
		.action((options: { prodDomain?: string; prodWwwDomain?: string; devDomain?: string; devWwwDomain?: string; origin?: string; upstream?: string; repoDir: string; devWorktree?: string; prodBranch: string; devBranch: string; prodHome: string; devHome: string; prodWebPort: number; prodGatewayPort: number; devWebPort: number; devGatewayPort: number; caddy: boolean; json?: boolean; printFiles?: boolean }) => {
			const plan = createDeveloperHostSetupPlan({ ...options, includeCaddy: options.caddy });
			if (options.json) printJson(plan);
			else printPlan(plan, options.printFiles === true);
		});

	program
		.command("doctor")
		.description("Inspect local host prerequisites without changing the system")
		.option("--json", "Print JSON")
		.action((options: { json?: boolean }) => {
			const status = {
				node: process.versions.node,
				nodeMajorOk: Number(process.versions.node.split(".")[0]) >= 24,
				platform: process.platform,
				uid: typeof process.getuid === "function" ? process.getuid() : undefined,
				recommendations: [
					"Use user-host setup for normal npm installs.",
					"Use developer-host setup only when you need prod/dev gateways, Docker compute workers, GitHub App PR flow, and branch worktrees.",
				],
			};
			if (options.json) printJson(status);
			else {
				console.log(`Node: ${status.node} (${status.nodeMajorOk ? "ok" : "requires >=24"})`);
				console.log(`Platform: ${status.platform}`);
				console.log("Recommendations:");
				for (const item of status.recommendations) console.log(`- ${item}`);
			}
		});

	if (argv.length <= 2 || argv[2] === "--help" || argv[2] === "-h") {
		program.outputHelp();
		return;
	}
	await program.parseAsync(argv);
}

import { randomBytes } from "node:crypto";
import { resolve } from "node:path";
import { Command } from "commander";
import { createDefaultPiboDataSessionStore } from "../sessions/pibo-data-store.js";
import { resolvePreviewComputeWorkerTarget } from "./compute-worker.js";
import { DEFAULT_PREVIEW_TTL_MINUTES, loadEffectivePreviewServerSettings, loadPreviewConfig, previewPublicURL, requirePreviewBaseURL } from "./config.js";
import {
	reconcileManagedPreviews,
	startManagedPreview,
	stopManagedPreview,
	validatePreviewStartCommand,
} from "./manager.js";
import {
	findPreviewTargetProcess,
	isPiboControlProcess,
	isPiboYieldedProcess,
	isPreviewTargetProcessCurrent,
	probePreviewTarget,
	validatePreviewPort,
} from "./network.js";
import { createDefaultPreviewStore, previewExposureState, type PreviewStore } from "./store.js";
import {
	DEFAULT_MAX_PREVIEW_PROXY_CONNECTIONS,
	DEFAULT_MAX_PREVIEW_PROXY_CONNECTIONS_PER_PREVIEW,
} from "./proxy.js";
import { createPreviewProductionSetupPlan, inspectPreviewPublicRoute, type PreviewProductionSetupPlan } from "./public-setup.js";
import type { PreviewExposure, PreviewHealthState, PreviewProxyMode } from "./types.js";

function printJson(value: unknown): void {
	console.log(JSON.stringify(value, null, 2));
}

function parsePort(value: string): number {
	return validatePreviewPort(Number(value));
}

function parsePositiveInteger(value: string): number {
	const parsed = Number(value);
	if (!Number.isInteger(parsed) || parsed < 1) throw new Error("Value must be a positive integer");
	return parsed;
}

function parseGatewayPort(value: string): number {
	const parsed = Number(value);
	if (!Number.isInteger(parsed) || parsed < 1 || parsed > 65535) throw new Error("Gateway port must be an integer between 1 and 65535");
	return parsed;
}

function parsePreviewTtlMinutes(value: string): number {
	const parsed = parsePositiveInteger(value);
	if (parsed > 7 * 24 * 60) throw new Error("Preview lifetime cannot exceed 7 days");
	return parsed;
}

function createPreviewId(): string {
	return `pv-${randomBytes(9).toString("hex")}`;
}

async function previewHealth(exposure: PreviewExposure): Promise<PreviewHealthState> {
	const state = previewExposureState(exposure);
	if (state !== "active") return state;
	if (exposure.managementMode === "managed") {
		if (exposure.serverState === "starting") return "starting";
		if (exposure.serverState === "stopping") return "stopping";
		if (exposure.serverState === "stopped") return "stopped";
		if (exposure.serverState === "error") return "error";
	}
	const processCurrent = isPreviewTargetProcessCurrent(exposure, { cacheMs: 0 });
	const target = processCurrent ? await probePreviewTarget(exposure.targetPort) : undefined;
	return target ? "online" : "offline";
}

async function exposureView(exposure: PreviewExposure) {
	const health = await previewHealth(exposure);
	const target = health === "online" ? await probePreviewTarget(exposure.targetPort) : undefined;
	return {
		...exposure,
		managed: exposure.managementMode === "managed",
		state: previewExposureState(exposure),
		health,
		publicUrl: previewPublicURL(exposure.id).toString(),
		...(target ? { latencyMs: target.latencyMs } : {}),
	};
}

type PreviewExposeOptions = {
	session: string;
	name?: string;
	workspace?: string;
	command?: string;
	ttlMinutes: number;
	json?: boolean;
};

async function createPreviewExposure(
	port: number,
	options: PreviewExposeOptions,
	defaults: { label?: string; workspace?: string; proxyMode?: PreviewProxyMode } = {},
) {
	const baseURL = requirePreviewBaseURL();
	const piboSessionId = options.session.trim();
	if (!piboSessionId) throw new Error("--session must contain a Pibo Session ID");

	const sessionStore = createDefaultPiboDataSessionStore();
	let session;
	try {
		session = sessionStore.get(piboSessionId);
	} finally {
		sessionStore.close();
	}
	if (!session) throw new Error(`Pibo Session "${piboSessionId}" was not found`);

	const command = options.command === undefined ? undefined : validatePreviewStartCommand(options.command);
	const target = command ? undefined : await probePreviewTarget(port);
	if (!command && !target) throw new Error(`No development server is reachable on loopback port ${port}`);
	if (command && await probePreviewTarget(port, { timeoutMs: 150 })) throw new Error(`Preview port ${port} is already occupied`);

	const now = new Date();
	const id = createPreviewId();
	const targetProcess = target ? findPreviewTargetProcess(target.host, port) : undefined;
	if (!command && process.platform === "linux" && !targetProcess) {
		throw new Error(`Preview port ${port} is not bound exclusively to the selected loopback address`);
	}
	if (!command && targetProcess && isPiboControlProcess(targetProcess.pid)) {
		throw new Error(`Preview port ${port} belongs to a Pibo control process and cannot be exposed`);
	}
	if (!command && process.env.NODE_ENV !== "test" && targetProcess && isPiboYieldedProcess(targetProcess.pid)) {
		throw new Error("Preview servers cannot run as yielded agent resources; stop that process and use --command so Preview owns its lifecycle");
	}
	const store = createDefaultPreviewStore();
	let exposure: PreviewExposure;
	try {
		exposure = store.createExposure({
			id,
			piboSessionId,
			label: options.name?.trim() || defaults.label || `Preview ${port}`,
			targetHost: target?.host ?? "127.0.0.1",
			targetPort: port,
			targetProcessId: targetProcess?.pid,
			targetProcessStartTicks: targetProcess?.startTicks,
			workspace: resolve(options.workspace ?? defaults.workspace ?? session.workspace ?? process.cwd()),
			managementMode: command ? "managed" : "external",
			proxyMode: defaults.proxyMode,
			startCommand: command,
			serverState: command ? "stopped" : undefined,
			createdAt: now.toISOString(),
			expiresAt: new Date(now.getTime() + options.ttlMinutes * 60_000).toISOString(),
		});
		if (command) exposure = await startManagedPreview(store, id);
	} finally {
		store.close();
	}
	return { ...await exposureView(exposure), publicUrl: previewPublicURL(id, baseURL).toString() };
}

function printCreatedPreview(result: Awaited<ReturnType<typeof createPreviewExposure>>, json = false): void {
	if (json) {
		printJson(result);
		return;
	}
	console.log(`${result.id}\t${result.health}\t${result.label}`);
	console.log(`url\t${result.publicUrl}`);
	console.log(`session\t${result.piboSessionId}`);
	console.log(`managed\t${result.managed}`);
	console.log(`proxyMode\t${result.proxyMode}`);
	if (result.serverStopAt) console.log(`autoStop\t${result.serverStopAt}`);
	console.log(`expires\t${result.expiresAt}`);
}

function printPreviewDiscovery(): void {
	console.log(`pibo preview - Session-linked live development previews

Commands:
  setup               Print production DNS, TLS, proxy, and restart instructions
  expose <port>       Register an external port or start a managed server with --command
  expose-worker <id>  Register a running Pibo compute worker with local dev auth
  list                List preview registrations
  show <preview-id>   Inspect one preview
  start <preview-id>  Start a saved managed Preview server
  stop <preview-id>   Stop a managed Preview server without removing it
  doctor [preview-id] Check local state; add --public to verify DNS, TLS, and routing
  remove <preview-id> Stop and remove a preview definition
  close <preview-id>  Alias for remove

Next:
  pibo preview setup --help
  pibo preview expose --help
  pibo preview expose-worker --help
`);
}

function printProductionSetupPlan(plan: PreviewProductionSetupPlan): void {
	console.log("Preview production setup");
	console.log(`baseURL\t${plan.baseURL}`);
	console.log(`DNS\t${plan.dnsRecord.type} ${plan.dnsRecord.name} -> ${plan.dnsRecord.value}`);
	console.log("\nCaddy global options (merge into an existing global block):");
	console.log(plan.caddy.globalOptions);
	console.log("\nCaddy site block:");
	console.log(plan.caddy.siteBlock);
	console.log("\nCommands:");
	console.log(`configure\t${plan.commands.configure}`);
	console.log(`validate proxy\t${plan.commands.validateCaddy}`);
	console.log(`restart gateway\t${plan.commands.restartGateway}`);
	console.log(`verify\t${plan.commands.verify}`);
	for (const warning of plan.warnings) console.log(`warning\t${warning}`);
}

export async function runPreviewCli(argv = process.argv): Promise<void> {
	if (argv.length <= 2 || argv[2] === "--help" || argv[2] === "-h") {
		printPreviewDiscovery();
		return;
	}

	const program = new Command();
	program.name("pibo preview").description("Manage session-linked live development previews");

	program
		.command("setup")
		.requiredOption("--base-url <url>", "Dedicated HTTPS base URL whose subdomains host Previews")
		.option("--gateway-port <port>", "Loopback Pibo Web Gateway port", parseGatewayPort, 4788)
		.option("--public-ip <address>", "Public IPv4 or IPv6 address for the exact DNS record")
		.option("--json", "Print JSON")
		.action((options: { baseUrl: string; gatewayPort: number; publicIp?: string; json?: boolean }) => {
			const plan = createPreviewProductionSetupPlan({
				baseURL: options.baseUrl,
				gatewayPort: options.gatewayPort,
				publicIp: options.publicIp,
			});
			if (options.json) printJson(plan);
			else printProductionSetupPlan(plan);
		});

	program
		.command("expose")
		.argument("<port>", "Reachable loopback development port", parsePort)
		.requiredOption("--session <pibo-session-id>", "Pibo Session that owns the preview")
		.option("--name <label>", "Preview label")
		.option("--workspace <path>", "Workspace used by the managed command and recorded for diagnostics")
		.option("--command <shell-command>", "Save and start this command as a Preview-managed server")
		.option("--ttl-minutes <minutes>", "Automatic preview-definition lifetime", parsePreviewTtlMinutes, DEFAULT_PREVIEW_TTL_MINUTES)
		.option("--json", "Print JSON")
		.action(async (port: number, options: PreviewExposeOptions) => {
			printCreatedPreview(await createPreviewExposure(port, options), options.json);
		});

	program
		.command("expose-worker")
		.argument("<worker>", "Running Pibo compute worker name or id")
		.requiredOption("--session <pibo-session-id>", "Pibo Session that owns the preview")
		.option("--name <label>", "Preview label")
		.option("--workspace <path>", "Workspace recorded for diagnostics")
		.option("--ttl-minutes <minutes>", "Automatic preview-definition lifetime", parsePreviewTtlMinutes, DEFAULT_PREVIEW_TTL_MINUTES)
		.option("--json", "Print JSON")
		.action(async (workerSelector: string, options: PreviewExposeOptions) => {
			const worker = await resolvePreviewComputeWorkerTarget(workerSelector);
			const result = await createPreviewExposure(worker.webPort, options, {
				label: worker.name,
				workspace: worker.worktreePath,
				proxyMode: "pibo-compute-dev-auth",
			});
			printCreatedPreview(result, options.json);
		});

	program
		.command("list")
		.option("--session <pibo-session-id>", "Filter by Pibo Session")
		.option("--all", "Include expired and closed previews")
		.option("--json", "Print JSON")
		.action(async (options: { session?: string; all?: boolean; json?: boolean }) => {
			requirePreviewBaseURL();
			const store = createDefaultPreviewStore();
			let exposures;
			try {
				await reconcileManagedPreviews(store);
				exposures = store.listExposures({ piboSessionId: options.session, includeInactive: options.all === true });
			} finally {
				store.close();
			}
			const rows = await Promise.all(exposures.map(exposureView));
			if (options.json) printJson(rows);
			else if (rows.length === 0) console.log("No previews.");
			else for (const row of rows) console.log(`${row.id}\t${row.health}\t${row.targetPort}\t${row.piboSessionId}\t${row.label}`);
		});

	program
		.command("show")
		.argument("<preview-id>")
		.option("--json", "Print JSON")
		.action(async (id: string, options: { json?: boolean }) => {
			requirePreviewBaseURL();
			const store = createDefaultPreviewStore();
			let exposure;
			try {
				await reconcileManagedPreviews(store);
				exposure = store.requireExposure(id);
			} finally {
				store.close();
			}
			const row = await exposureView(exposure);
			if (options.json) printJson(row);
			else for (const [key, value] of Object.entries(row)) console.log(`${key}\t${String(value)}`);
		});

	program
		.command("start")
		.argument("<preview-id>")
		.option("--json", "Print JSON")
		.action(async (id: string, options: { json?: boolean }) => {
			requirePreviewBaseURL();
			const store = createDefaultPreviewStore();
			let exposure;
			try {
				exposure = await startManagedPreview(store, id);
			} finally {
				store.close();
			}
			const row = await exposureView(exposure);
			if (options.json) printJson(row);
			else console.log(`${row.id}\t${row.health}\tautoStop=${row.serverStopAt ?? "-"}`);
		});

	program
		.command("stop")
		.argument("<preview-id>")
		.option("--json", "Print JSON")
		.action(async (id: string, options: { json?: boolean }) => {
			const store = createDefaultPreviewStore();
			let exposure;
			try {
				exposure = await stopManagedPreview(store, id);
			} finally {
				store.close();
			}
			const row = await exposureView(exposure);
			if (options.json) printJson(row);
			else console.log(`${row.id}\t${row.health}`);
		});

	program
		.command("doctor")
		.argument("[preview-id]")
		.option("--public", "Verify public DNS, trusted TLS, and Preview-host routing")
		.option("--json", "Print JSON")
		.action(async (id: string | undefined, options: { public?: boolean; json?: boolean }) => {
			const baseURL = requirePreviewBaseURL();
			if (options.public && !id) throw new Error("--public requires a preview id. Create an active Preview, then run `pibo preview doctor <preview-id> --public`.");
			if (!id) {
				const config = loadPreviewConfig();
				const serverLimits = loadEffectivePreviewServerSettings();
				const store = createDefaultPreviewStore();
				let diagnostics;
				try {
					await reconcileManagedPreviews(store);
					store.prune();
					diagnostics = store.diagnostics();
				} finally {
					store.close();
				}
				const result = {
					configured: true,
					baseURL: baseURL.toString(),
					productionSetup: createPreviewProductionSetupPlan({ baseURL: baseURL.toString() }),
					limits: {
						...serverLimits,
						maxProxyConnections: config.maxProxyConnections ?? DEFAULT_MAX_PREVIEW_PROXY_CONNECTIONS,
						maxProxyConnectionsPerPreview: config.maxProxyConnectionsPerPreview ?? DEFAULT_MAX_PREVIEW_PROXY_CONNECTIONS_PER_PREVIEW,
					},
					diagnostics,
					next: "pibo preview list",
				};
				if (options.json) printJson(result);
				else {
					console.log("preview configuration\tok");
					console.log(`baseURL\t${result.baseURL}`);
					console.log(`active\t${diagnostics.activeExposures}`);
					console.log(`managed\t${diagnostics.managedStartingOrRunning}`);
					console.log(`DNS required\t${result.productionSetup.dnsRecord.name}`);
					console.log(`production guide\tpibo preview setup --base-url ${baseURL.origin}`);
				}
				return;
			}
			const store = createDefaultPreviewStore();
			let exposure;
			try {
				await reconcileManagedPreviews(store);
				exposure = store.requireExposure(id);
			} finally {
				store.close();
			}
			const publicChecks = options.public ? await inspectPreviewPublicRoute(baseURL, id) : undefined;
			const result = {
				...await exposureView(exposure),
				...(publicChecks ? { publicChecks } : {}),
			};
			if (options.json) printJson(result);
			else {
				console.log(`${result.id}\t${result.health}`);
				console.log(`target\t${result.targetHost}:${result.targetPort}`);
				console.log(`url\t${result.publicUrl}`);
				if (publicChecks) {
					console.log(`DNS\t${publicChecks.dns.status}\t${publicChecks.dns.detail}`);
					console.log(`TLS and routing\t${publicChecks.tlsAndRouting.status}\t${publicChecks.tlsAndRouting.detail}`);
				}
			}
			if (result.health !== "online" || publicChecks && (
				publicChecks.dns.status !== "ok" || publicChecks.tlsAndRouting.status !== "ok"
			)) process.exitCode = 1;
		});

	const removeAction = async (id: string, options: { json?: boolean }) => {
		const store = createDefaultPreviewStore();
		let exposure;
		try {
			const current = store.requireExposure(id);
			if (current.managementMode === "managed" && ["running", "starting", "stopping", "error"].includes(current.serverState ?? "")) {
				await stopManagedPreview(store, id);
			}
			exposure = store.closeExposure(id);
		} finally {
			store.close();
		}
		if (!exposure) throw new Error(`Preview "${id}" was not found`);
		if (options.json) printJson({ removed: true, preview: exposure });
		else console.log(`${id}\tremoved`);
	};

	program.command("remove").argument("<preview-id>").option("--json", "Print JSON").action(removeAction);
	program.command("close").argument("<preview-id>").option("--json", "Print JSON").action(removeAction);

	await program.parseAsync(argv);
}

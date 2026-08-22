import { randomBytes } from "node:crypto";
import { resolve } from "node:path";
import { Command } from "commander";
import { createDefaultPiboDataSessionStore } from "../sessions/pibo-data-store.js";
import { DEFAULT_PREVIEW_TTL_MINUTES, previewPublicURL, requirePreviewBaseURL } from "./config.js";
import { findPreviewTargetProcess, isPreviewTargetProcessCurrent, probePreviewTarget, validatePreviewPort } from "./network.js";
import { createDefaultPreviewStore, previewExposureState } from "./store.js";
import type { PreviewExposure } from "./types.js";

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

function createPreviewId(): string {
	return `pv-${randomBytes(9).toString("hex")}`;
}

function inferredProjectId(metadata: unknown): string | undefined {
	if (!metadata || typeof metadata !== "object" || Array.isArray(metadata)) return undefined;
	const projectId = (metadata as Record<string, unknown>).projectId;
	return typeof projectId === "string" && projectId.trim() ? projectId.trim() : undefined;
}

async function exposureView(exposure: PreviewExposure) {
	const state = previewExposureState(exposure);
	const processCurrent = state === "active" ? isPreviewTargetProcessCurrent(exposure, { cacheMs: 0 }) : false;
	const target = processCurrent ? await probePreviewTarget(exposure.targetPort) : undefined;
	return {
		...exposure,
		state,
		health: state === "active" ? (target ? "online" : "offline") : state,
		publicUrl: previewPublicURL(exposure.id).toString(),
		...(target ? { latencyMs: target.latencyMs } : {}),
	};
}

function printPreviewDiscovery(): void {
	console.log(`pibo preview - Session-linked live development previews

Commands:
  expose <port>       Expose a reachable loopback development port
  list                List preview registrations
  show <preview-id>   Inspect one preview
  doctor [preview-id] Check preview configuration and reachability
  close <preview-id>  Close a preview and revoke browser access

Next:
  pibo preview expose --help
`);
}

export async function runPreviewCli(argv = process.argv): Promise<void> {
	if (argv.length <= 2 || argv[2] === "--help" || argv[2] === "-h") {
		printPreviewDiscovery();
		return;
	}

	const program = new Command();
	program.name("pibo preview").description("Manage session-linked live development previews");

	program
		.command("expose")
		.argument("<port>", "Reachable loopback development port", parsePort)
		.requiredOption("--session <pibo-session-id>", "Pibo Session that owns the preview")
		.option("--project <project-id>", "Optional Project association")
		.option("--name <label>", "Preview label")
		.option("--workspace <path>", "Workspace recorded for diagnostics")
		.option("--ttl-minutes <minutes>", "Automatic exposure lifetime", parsePositiveInteger, DEFAULT_PREVIEW_TTL_MINUTES)
		.option("--json", "Print JSON")
		.action(async (port: number, options: { session: string; project?: string; name?: string; workspace?: string; ttlMinutes: number; json?: boolean }) => {
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

			const target = await probePreviewTarget(port);
			if (!target) throw new Error(`No development server is reachable on loopback port ${port}`);

			const now = new Date();
			const id = createPreviewId();
			const targetProcess = findPreviewTargetProcess(target.host, port);
			const store = createDefaultPreviewStore();
			let exposure;
			try {
				exposure = store.createExposure({
					id,
					piboSessionId,
					projectId: options.project?.trim() || inferredProjectId(session.metadata),
					label: options.name?.trim() || `Preview ${port}`,
					targetHost: target.host,
					targetPort: port,
					targetProcessId: targetProcess?.pid,
					targetProcessStartTicks: targetProcess?.startTicks,
					workspace: resolve(options.workspace ?? session.workspace ?? process.cwd()),
					createdAt: now.toISOString(),
					expiresAt: new Date(now.getTime() + options.ttlMinutes * 60_000).toISOString(),
				});
			} finally {
				store.close();
			}
			const result = { ...exposure, state: "active", health: "online", publicUrl: previewPublicURL(id, baseURL).toString() };
			if (options.json) printJson(result);
			else {
				console.log(`${result.id}\t${result.health}\t${result.label}`);
				console.log(`url\t${result.publicUrl}`);
				console.log(`session\t${result.piboSessionId}`);
				console.log(`expires\t${result.expiresAt}`);
			}
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
				exposure = store.requireExposure(id);
			} finally {
				store.close();
			}
			const row = await exposureView(exposure);
			if (options.json) printJson(row);
			else for (const [key, value] of Object.entries(row)) console.log(`${key}\t${String(value)}`);
		});

	program
		.command("doctor")
		.argument("[preview-id]")
		.option("--json", "Print JSON")
		.action(async (id: string | undefined, options: { json?: boolean }) => {
			const baseURL = requirePreviewBaseURL();
			if (!id) {
				const result = { configured: true, baseURL: baseURL.toString(), next: "pibo preview list" };
				if (options.json) printJson(result);
				else {
					console.log("preview configuration\tok");
					console.log(`baseURL\t${result.baseURL}`);
				}
				return;
			}
			const store = createDefaultPreviewStore();
			let exposure;
			try {
				exposure = store.requireExposure(id);
			} finally {
				store.close();
			}
			const result = await exposureView(exposure);
			if (options.json) printJson(result);
			else {
				console.log(`${result.id}\t${result.health}`);
				console.log(`target\t${result.targetHost}:${result.targetPort}`);
				console.log(`url\t${result.publicUrl}`);
			}
			if (result.health !== "online") process.exitCode = 1;
		});

	program
		.command("close")
		.argument("<preview-id>")
		.option("--json", "Print JSON")
		.action((id: string, options: { json?: boolean }) => {
			const store = createDefaultPreviewStore();
			let exposure;
			try {
				exposure = store.closeExposure(id);
			} finally {
				store.close();
			}
			if (!exposure) throw new Error(`Preview "${id}" was not found`);
			if (options.json) printJson({ closed: true, preview: exposure });
			else console.log(`${id}\tclosed`);
		});

	await program.parseAsync(argv);
}

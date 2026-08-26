import { execFile, spawn, spawnSync } from "node:child_process";
import { randomBytes } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { basename } from "node:path";
import { promisify } from "node:util";
import { sanitizePreviewServerSettings, type PreviewServerSettings } from "../core/preview-server-settings.js";
import { loadPreviewConfig } from "./config.js";
import {
	findPreviewTargetProcess,
	isPreviewTargetProcessCurrent,
	previewProcessStartTicks,
	probePreviewTarget,
} from "./network.js";
import { PreviewStore, previewExposureState } from "./store.js";
import type { PreviewExposure, PreviewManagerIdentity } from "./types.js";

const execFileAsync = promisify(execFile);
const DEFAULT_STARTUP_TIMEOUT_MS = 15_000;
const DEFAULT_POLL_INTERVAL_MS = 100;

export type PreviewProcessLaunchInput = {
	previewId: string;
	command: string;
	workspace: string;
	port: number;
};

export type PreviewProcessController = {
	launch(input: PreviewProcessLaunchInput): Promise<PreviewManagerIdentity>;
	isRunning(identity: PreviewManagerIdentity): Promise<boolean>;
	ownsTarget(identity: PreviewManagerIdentity, targetPid: number): Promise<boolean>;
	stop(identity: PreviewManagerIdentity): Promise<void>;
};

export type PreviewManagerOptions = {
	controller?: PreviewProcessController;
	settings?: PreviewServerSettings;
	now?: () => Date;
	startupTimeoutMs?: number;
	pollIntervalMs?: number;
};

export function validatePreviewStartCommand(value: string): string {
	const command = value.replace(/\r\n/g, "\n").trim();
	if (!command) throw new Error("Preview start command is required");
	if (command.includes("\0")) throw new Error("Preview start command cannot contain NUL bytes");
	if (command.length > 8_192) throw new Error("Preview start command is too long");
	return command;
}

export async function startManagedPreview(store: PreviewStore, id: string, options: PreviewManagerOptions = {}): Promise<PreviewExposure> {
	const controller = options.controller ?? createDefaultPreviewProcessController();
	const settings = options.settings ?? (() => {
		const previewConfig = loadPreviewConfig();
		return sanitizePreviewServerSettings({
			maxRunningServers: previewConfig.maxRunningServers,
			autoStopMinutes: previewConfig.autoStopMinutes,
		});
	})();
	const now = options.now?.() ?? new Date();
	await reconcileManagedPreviews(store, { ...options, controller, settings, now: () => now });

	let current = store.requireExposure(id);
	if (current.managementMode !== "managed" || !current.startCommand) throw new Error(`Preview "${id}" has no managed start command`);
	const startCommand = current.startCommand;
	if (current.serverState === "running" && await managedPreviewIsOnline(current, controller, now)) return current;
	if (current.serverState === "starting") return current;
	if (current.serverState === "running") {
		await stopManagedPreview(store, id, { ...options, controller, settings });
		current = store.requireExposure(id);
	}

	const stopAt = new Date(Math.min(
		now.getTime() + settings.autoStopMinutes * 60_000,
		Date.parse(current.expiresAt),
	)).toISOString();
	const reservation = store.reserveManagedServerStart(id, settings.maxRunningServers, now.toISOString(), stopAt);
	if (!reservation.reserved) return reservation.exposure;
	const generation = reservation.exposure.serverGeneration;
	if (!generation) throw new Error(`Preview "${id}" did not retain its start generation`);

	let manager: PreviewManagerIdentity | undefined;
	try {
		if (await probePreviewTarget(current.targetPort, { timeoutMs: 150 })) {
			throw new Error(`Preview port ${current.targetPort} is already occupied`);
		}
		manager = await controller.launch({
			previewId: current.id,
			command: startCommand,
			workspace: current.workspace,
			port: current.targetPort,
		});
		const assigned = store.markManagedServerManager(id, generation, manager);
		if (assigned.serverGeneration !== generation || assigned.serverState !== "starting" || assigned.managerId !== manager.id) {
			await controller.stop(manager).catch(() => undefined);
			return assigned;
		}
		const target = await waitForManagedTarget(current, manager, controller, {
			startupTimeoutMs: options.startupTimeoutMs ?? DEFAULT_STARTUP_TIMEOUT_MS,
			pollIntervalMs: options.pollIntervalMs ?? DEFAULT_POLL_INTERVAL_MS,
		});
		const running = store.markManagedServerRunning(id, generation, {
			targetHost: target.host,
			targetProcessId: target.process?.pid,
			targetProcessStartTicks: target.process?.startTicks,
			manager,
		});
		if (running.serverGeneration !== generation || running.serverState !== "running" || running.managerId !== manager.id) {
			await controller.stop(manager).catch(() => undefined);
		}
		return running;
	} catch (error) {
		if (manager) await controller.stop(manager).catch(() => undefined);
		const latest = store.requireExposure(id);
		if (latest.serverGeneration !== generation || latest.serverState !== "starting") return latest;
		store.markManagedServerStopped(id, {
			stoppedAt: (options.now?.() ?? new Date()).toISOString(),
			error: managedPreviewError(error),
			expectedGeneration: generation,
		});
		throw error;
	}
}

export async function stopManagedPreview(store: PreviewStore, id: string, options: PreviewManagerOptions = {}): Promise<PreviewExposure> {
	const controller = options.controller ?? createDefaultPreviewProcessController();
	const exposure = store.requireExposure(id);
	if (exposure.managementMode !== "managed") throw new Error(`Preview "${id}" is not managed by Pibo`);
	if (exposure.serverState !== "starting" && exposure.serverState !== "running") return exposure;
	const identity = managerIdentity(exposure);
	if (identity) await controller.stop(identity);
	return store.markManagedServerStopped(id, { expectedGeneration: exposure.serverGeneration });
}

async function stopManagedPreviewForReconcile(
	controller: PreviewProcessController,
	identity: PreviewManagerIdentity,
	previewId: string,
): Promise<boolean> {
	try {
		await controller.stop(identity);
		return true;
	} catch (error) {
		console.error(
			`Preview server reconciliation could not stop ${previewId}: ${managedPreviewError(error)}`,
		);
		return false;
	}
}

export async function reconcileManagedPreviews(store: PreviewStore, options: PreviewManagerOptions = {}): Promise<void> {
	const controller = options.controller ?? createDefaultPreviewProcessController();
	const now = options.now?.() ?? new Date();
	const startupTimeoutMs = options.startupTimeoutMs ?? DEFAULT_STARTUP_TIMEOUT_MS;
	for (const exposure of store.listManagedServerCandidates()) {
		const identity = managerIdentity(exposure);
		const expired = previewExposureState(exposure, now) !== "active";
		const leaseEnded = Boolean(exposure.serverStopAt && Date.parse(exposure.serverStopAt) <= now.getTime());
		const startupTimedOut = exposure.serverState === "starting" &&
			Boolean(exposure.serverStartedAt) &&
			now.getTime() - Date.parse(exposure.serverStartedAt!) > startupTimeoutMs + 5_000;
		if (expired || leaseEnded || startupTimedOut) {
			if (identity && !await stopManagedPreviewForReconcile(controller, identity, exposure.id)) continue;
			store.markManagedServerStopped(exposure.id, {
				stoppedAt: now.toISOString(),
				error: startupTimedOut ? "Managed Preview server startup timed out" : undefined,
				expectedGeneration: exposure.serverGeneration,
			});
			continue;
		}
		if (!identity) {
			const startedAt = exposure.serverStartedAt ? Date.parse(exposure.serverStartedAt) : 0;
			if (!startedAt) {
				store.markManagedServerStopped(exposure.id, {
					stoppedAt: now.toISOString(),
					error: "Managed Preview server did not retain a process identity",
					expectedGeneration: exposure.serverGeneration,
				});
			}
			continue;
		}
		if (!await controller.isRunning(identity)) {
			store.markManagedServerStopped(exposure.id, {
				stoppedAt: now.toISOString(),
				expectedGeneration: exposure.serverGeneration,
			});
			continue;
		}
		if (exposure.serverState === "running") {
			const targetCurrent = isPreviewTargetProcessCurrent(exposure, { cacheMs: 0 });
			const targetReachable = targetCurrent && Boolean(await probePreviewTarget(exposure.targetPort, { timeoutMs: 500 }));
			if (!targetReachable) {
				if (!await stopManagedPreviewForReconcile(controller, identity, exposure.id)) continue;
				store.markManagedServerStopped(exposure.id, {
					stoppedAt: now.toISOString(),
					error: "Managed Preview listener no longer matches its pinned process",
					expectedGeneration: exposure.serverGeneration,
				});
			}
		}
	}
}

export async function managedPreviewIsOnline(
	exposure: PreviewExposure,
	controller: PreviewProcessController = createDefaultPreviewProcessController(),
	now = new Date(),
): Promise<boolean> {
	if (previewExposureState(exposure, now) !== "active") return false;
	if (exposure.managementMode !== "managed" || exposure.serverState !== "running") return false;
	const identity = managerIdentity(exposure);
	if (!identity || !await controller.isRunning(identity)) return false;
	if (!isPreviewTargetProcessCurrent(exposure, { cacheMs: 0 })) return false;
	return Boolean(await probePreviewTarget(exposure.targetPort, { timeoutMs: 500 }));
}

export function managerIdentity(exposure: PreviewExposure): PreviewManagerIdentity | undefined {
	if (!exposure.managerKind || !exposure.managerId) return undefined;
	return {
		kind: exposure.managerKind,
		id: exposure.managerId,
		pid: exposure.managerPid,
		processStartTicks: exposure.managerProcessStartTicks,
	};
}

export function createDefaultPreviewProcessController(): PreviewProcessController {
	const preferSystemd = systemdAvailable();
	const controllerFor = (identity: PreviewManagerIdentity) => identity.kind === "systemd"
		? systemdPreviewProcessController
		: detachedPreviewProcessController;
	return {
		async launch(input) {
			return preferSystemd
				? systemdPreviewProcessController.launch(input)
				: detachedPreviewProcessController.launch(input);
		},
		isRunning(identity) {
			return controllerFor(identity).isRunning(identity);
		},
		ownsTarget(identity, targetPid) {
			return controllerFor(identity).ownsTarget(identity, targetPid);
		},
		stop(identity) {
			return controllerFor(identity).stop(identity);
		},
	};
}

const systemdPreviewProcessController: PreviewProcessController = {
	async launch(input) {
		const unit = `pibo-preview-${input.previewId.replace(/^pv-/, "").slice(0, 18)}-${randomBytes(3).toString("hex")}.service`;
		const shell = previewShell();
		const args = [
			"--quiet",
			`--unit=${unit}`,
			"--collect",
			"--service-type=exec",
			`--working-directory=${input.workspace}`,
			"--property=KillMode=control-group",
			"--property=TimeoutStopSec=5s",
			...systemdEnvironment(input.port),
			"--",
			shell.command,
			...shell.args(input.command),
		];
		await execFileAsync("systemd-run", args, { timeout: 10_000, windowsHide: true });
		return { kind: "systemd", id: unit };
	},
	async isRunning(identity) {
		try {
			const { stdout } = await execFileAsync("systemctl", ["show", "--property=ActiveState", "--value", identity.id], { timeout: 5_000 });
			return ["active", "activating", "reloading"].includes(stdout.trim());
		} catch {
			return false;
		}
	},
	async ownsTarget(identity, targetPid) {
		try {
			return readFileSync(`/proc/${targetPid}/cgroup`, "utf8").includes(`/${identity.id}`);
		} catch {
			return false;
		}
	},
	async stop(identity) {
		try {
			await execFileAsync("systemctl", ["stop", identity.id], { timeout: 10_000, windowsHide: true });
		} catch (error) {
			if (await this.isRunning(identity)) throw error;
		}
	},
};

const detachedPreviewProcessController: PreviewProcessController = {
	async launch(input) {
		const shell = previewShell();
		const child = spawn(shell.command, shell.args(input.command), {
			cwd: input.workspace,
			env: previewEnvironment(input.port),
			detached: true,
			stdio: "ignore",
			windowsHide: true,
		});
		if (!child.pid) throw new Error("Preview server process did not provide a pid");
		const processStartTicks = previewProcessStartTicks(child.pid);
		if (process.platform === "linux" && !processStartTicks) {
			try { process.kill(-child.pid, "SIGKILL"); } catch {}
			throw new Error("Preview server process could not be pinned");
		}
		child.unref();
		return {
			kind: "process",
			id: String(child.pid),
			pid: child.pid,
			processStartTicks,
		};
	},
	async isRunning(identity) {
		if (!identity.pid || !processIsAlive(identity.pid)) return false;
		return !identity.processStartTicks || process.platform !== "linux" ||
			previewProcessStartTicks(identity.pid) === identity.processStartTicks;
	},
	async ownsTarget(identity, targetPid) {
		if (process.platform === "win32") return true;
		if (!identity.pid) return false;
		return await processGroupId(targetPid) === identity.pid;
	},
	async stop(identity) {
		if (!identity.pid || !await this.isRunning(identity)) return;
		if (process.platform === "win32") {
			try { await execFileAsync("taskkill", ["/PID", String(identity.pid), "/T", "/F"], { timeout: 10_000, windowsHide: true }); } catch {}
			return;
		}
		const ownGroup = await processGroupId(process.pid);
		if (ownGroup === identity.pid) throw new Error("Refusing to stop the current Pibo process group");
		try { process.kill(-identity.pid, "SIGTERM"); } catch (error) { if (!missingProcess(error)) throw error; }
		for (let attempt = 0; attempt < 20 && await this.isRunning(identity); attempt += 1) await delay(100);
		if (await this.isRunning(identity)) {
			try { process.kill(-identity.pid, "SIGKILL"); } catch (error) { if (!missingProcess(error)) throw error; }
		}
	},
};

async function waitForManagedTarget(
	exposure: PreviewExposure,
	manager: PreviewManagerIdentity,
	controller: PreviewProcessController,
	options: { startupTimeoutMs: number; pollIntervalMs: number },
): Promise<{ host: PreviewExposure["targetHost"]; process?: { pid: number; startTicks: string } }> {
	const deadline = Date.now() + options.startupTimeoutMs;
	while (Date.now() < deadline) {
		if (!await controller.isRunning(manager)) throw new Error("Managed Preview command exited before opening its port");
		const target = await probePreviewTarget(exposure.targetPort, { timeoutMs: Math.min(250, options.pollIntervalMs) });
		if (target) {
			const process = findPreviewTargetProcess(target.host, exposure.targetPort);
			if (globalThis.process.platform === "linux" && !process) {
				throw new Error(`Preview port ${exposure.targetPort} is not bound exclusively to ${target.host}`);
			}
			if (process && !await controller.ownsTarget(manager, process.pid)) {
				throw new Error(`Preview port ${exposure.targetPort} is owned by a different process`);
			}
			return { host: target.host, process };
		}
		await delay(options.pollIntervalMs);
	}
	throw new Error(`Managed Preview command did not open loopback port ${exposure.targetPort} within ${options.startupTimeoutMs}ms`);
}

function systemdAvailable(): boolean {
	if (process.env.NODE_ENV === "test" || process.platform !== "linux" || !existsSync("/run/systemd/system")) return false;
	try {
		return spawnSync("systemd-run", ["--version"], { stdio: "ignore", timeout: 2_000 }).status === 0;
	} catch {
		return false;
	}
}

function previewShell(): { command: string; args(command: string): string[] } {
	if (process.platform === "win32") return { command: process.env.ComSpec ?? "cmd.exe", args: (command) => ["/d", "/s", "/c", command] };
	const command = process.env.SHELL && existsSync(process.env.SHELL) ? process.env.SHELL : existsSync("/bin/bash") ? "/bin/bash" : "/bin/sh";
	return { command, args: (value) => basename(command).includes("bash") ? ["-lc", value] : ["-c", value] };
}

function previewEnvironment(port: number): NodeJS.ProcessEnv {
	const environment: NodeJS.ProcessEnv = {};
	for (const key of ["PATH", "HOME", "USER", "LOGNAME", "SHELL", "LANG", "LC_ALL", "TMPDIR", "TEMP", "TMP"] as const) {
		if (process.env[key] !== undefined) environment[key] = process.env[key];
	}
	environment.PIBO_PREVIEW_HOST = "127.0.0.1";
	environment.PIBO_PREVIEW_PORT = String(port);
	environment.HOST = "127.0.0.1";
	environment.PORT = String(port);
	return environment;
}

function systemdEnvironment(port: number): string[] {
	return Object.entries(previewEnvironment(port)).flatMap(([key, value]) => value === undefined ? [] : [`--setenv=${key}=${value}`]);
}

async function processGroupId(pid: number): Promise<number | undefined> {
	try {
		const { stdout } = await execFileAsync("ps", ["-o", "pgid=", "-p", String(pid)], { timeout: 5_000 });
		const value = Number.parseInt(stdout.trim(), 10);
		return Number.isInteger(value) && value > 0 ? value : undefined;
	} catch {
		return undefined;
	}
}

function processIsAlive(pid: number): boolean {
	try {
		process.kill(pid, 0);
		return true;
	} catch {
		return false;
	}
}

function missingProcess(error: unknown): boolean {
	return error instanceof Error && "code" in error && (error as NodeJS.ErrnoException).code === "ESRCH";
}

function managedPreviewError(error: unknown): string {
	const message = error instanceof Error ? error.message : String(error);
	return message.replace(/[\u0000-\u001f\u007f]/g, " ").slice(0, 500);
}

function delay(milliseconds: number): Promise<void> {
	return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

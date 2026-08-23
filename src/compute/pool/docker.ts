import { execFile } from "node:child_process";
import { existsSync } from "node:fs";
import { promisify } from "node:util";
import type { DeploymentPoolConfig } from "./config.js";
import type { DeploymentLeaseRecord, DeploymentSlotRecord } from "./types.js";

const execFileAsync = promisify(execFile);
export const DEPLOYMENT_POOL_LABEL = "pibo.deploymentPool";
export const DEPLOYMENT_LEASE_LABEL = "pibo.deployment.leaseId";
export const DEPLOYMENT_SLOT_LABEL = "pibo.deployment.slotId";
export const DEPLOYMENT_HOLDER_LABEL = "pibo.deployment.holder";
export const DEPLOYMENT_EXPIRES_LABEL = "pibo.deployment.expiresAt";
export const DEPLOYMENT_ARTIFACT_LABEL = "pibo.deployment.artifactSha256";
export const DEPLOYMENT_SEED_LABEL = "pibo.deployment.seedMode";

export function buildDeploymentContainerArgs(input: {
	config: DeploymentPoolConfig;
	slot: DeploymentSlotRecord;
	lease: DeploymentLeaseRecord;
	homePath: string;
	piHomePath: string;
	workspacePath: string;
}): string[] {
	const command = [
		"set -eu",
		"export DISPLAY=:99",
		"if command -v Xvfb >/dev/null 2>&1 && ! pgrep -x Xvfb >/dev/null 2>&1; then Xvfb :99 -screen 0 1920x1080x24 -ac -nolisten tcp >/tmp/xvfb.log 2>&1 & fi",
		"exec node /opt/pibo-runtime/node_modules/@pasko70/pibo/dist/bin/pibo.js gateway:web --web-host 0.0.0.0 --web-port 4788 --gateway-port 4789",
	].join("; ");
	return [
		"run",
		"-d",
		"--name",
		input.lease.containerName,
		"--hostname",
		input.slot.id,
		"--memory",
		"1536m",
		"--memory-swap",
		"1536m",
		"--cpus",
		"1.0",
		"--pids-limit",
		"512",
		"--shm-size",
		"512m",
		"--init",
		"--restart",
		"no",
		"--log-driver",
		"json-file",
		"--log-opt",
		"max-size=10m",
		"--log-opt",
		"max-file=3",
		"-e",
		"NODE_ENV=production",
		"-e",
		"PIBO_HOME=/root/.pibo",
		"-e",
		"HOME=/root",
		"-e",
		"PIBO_COMPUTE_POOL=1",
		"-e",
		`PIBO_COMPUTE_POOL_LEASE_ID=${input.lease.id}`,
		...(input.config.envFile && existsSync(input.config.envFile) ? ["--env-file", input.config.envFile] : []),
		"-p",
		`127.0.0.1:${input.slot.webPort}:4788`,
		"-p",
		`127.0.0.1:${input.slot.gatewayPort}:4789`,
		"-v",
		`${input.lease.artifactRuntimePath}:/opt/pibo-runtime:ro`,
		"-v",
		`${input.homePath}:/root/.pibo`,
		"-v",
		`${input.piHomePath}:/root/.pi`,
		"-v",
		`${input.workspacePath}:/workspace`,
		"-w",
		"/workspace",
		"--label",
		`${DEPLOYMENT_POOL_LABEL}=true`,
		"--label",
		`${DEPLOYMENT_LEASE_LABEL}=${input.lease.id}`,
		"--label",
		`${DEPLOYMENT_SLOT_LABEL}=${input.slot.id}`,
		"--label",
		`${DEPLOYMENT_HOLDER_LABEL}=${safeLabelValue(input.lease.holder)}`,
		"--label",
		`${DEPLOYMENT_EXPIRES_LABEL}=${input.lease.expiresAt}`,
		"--label",
		`${DEPLOYMENT_ARTIFACT_LABEL}=${input.lease.artifactSha256}`,
		"--label",
		`${DEPLOYMENT_SEED_LABEL}=${input.lease.seedMode}`,
		"--entrypoint",
		"/bin/sh",
		input.config.runtimeImage,
		"-lc",
		command,
	];
}

export async function startDeploymentContainer(input: Parameters<typeof buildDeploymentContainerArgs>[0]): Promise<void> {
	await execFileAsync("docker", buildDeploymentContainerArgs(input), { maxBuffer: 10 * 1024 * 1024 });
}

export async function removeDeploymentContainer(containerName: string): Promise<void> {
	try {
		await execFileAsync("docker", ["stop", "-t", "10", containerName]);
	} catch {
		// Container may already be stopped or missing.
	}
	try {
		await execFileAsync("docker", ["rm", "-f", containerName]);
	} catch (error: any) {
		if (!String(error?.stderr ?? error?.message ?? error).includes("No such container")) throw error;
	}
}

export async function deploymentContainerExists(containerName: string): Promise<boolean> {
	try {
		await execFileAsync("docker", ["inspect", "--type=container", containerName]);
		return true;
	} catch {
		return false;
	}
}

export async function listDeploymentContainers(): Promise<Array<{ id: string; name: string; leaseId?: string; slotId?: string; state: string }>> {
	const { stdout } = await execFileAsync("docker", [
		"ps", "--all", "--filter", `label=${DEPLOYMENT_POOL_LABEL}=true`,
		"--format", "{{.ID}}\t{{.Names}}\t{{.State}}\t{{.Label \"pibo.deployment.leaseId\"}}\t{{.Label \"pibo.deployment.slotId\"}}",
	]);
	return stdout.trim().split("\n").filter(Boolean).map((line) => {
		const [id, name, state, leaseId, slotId] = line.split("\t");
		return { id: id!, name: name!, state: state ?? "unknown", leaseId: leaseId || undefined, slotId: slotId || undefined };
	});
}

export async function waitForDeploymentHealth(webPort: number, options: { timeoutMs?: number; intervalMs?: number } = {}): Promise<void> {
	const deadline = Date.now() + (options.timeoutMs ?? 90_000);
	let lastError = "not ready";
	while (Date.now() < deadline) {
		try {
			const response = await fetch(`http://127.0.0.1:${webPort}/health`, { signal: AbortSignal.timeout(2_000) });
			if (response.ok) return;
			lastError = `HTTP ${response.status}`;
		} catch (error) {
			lastError = error instanceof Error ? error.message : String(error);
		}
		await new Promise((resolve) => setTimeout(resolve, options.intervalMs ?? 500));
	}
	throw new Error(`Deployment slot health check timed out on port ${webPort}: ${lastError}`);
}

export async function dockerImageExists(image: string): Promise<boolean> {
	try {
		await execFileAsync("docker", ["inspect", "--type=image", image]);
		return true;
	} catch {
		return false;
	}
}

function safeLabelValue(value: string): string {
	const safe = value.replace(/[^A-Za-z0-9._:@-]/g, "-").slice(0, 128);
	return safe || "unknown";
}

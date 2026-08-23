import { randomBytes } from "node:crypto";
import { existsSync } from "node:fs";
import { mkdir, readFile, readdir, rename, rm, stat, statfs, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { deploymentSlotDefinitions, requireDeploymentPoolBaseURL, resolveDeploymentPoolConfig, type DeploymentPoolConfig } from "./config.js";
import { dockerImageExists, listDeploymentContainers, removeDeploymentContainer, startDeploymentContainer, waitForDeploymentHealth } from "./docker.js";
import { prepareDeploymentSeed } from "./seeds.js";
import { DeploymentPoolStore } from "./store.js";
import type { DeploymentArtifact } from "./artifacts.js";
import type { DeploymentFailureSnapshot, DeploymentLeaseRecord, DeploymentPoolReapPlan, DeploymentPoolReapResult, DeploymentPoolStatus, DeploymentSeedMode } from "./types.js";

export interface AcquireDeploymentOptions {
	holder: string;
	seedMode: DeploymentSeedMode;
	artifact: DeploymentArtifact;
	ttlMinutes?: number;
	commit?: string;
	config?: DeploymentPoolConfig;
}

export async function acquireDeployment(options: AcquireDeploymentOptions): Promise<DeploymentLeaseRecord> {
	const config = options.config ?? resolveDeploymentPoolConfig();
	const baseURL = requireDeploymentPoolBaseURL(config);
	await ensurePoolDirectories(config);
	const expiredPlan = await planDeploymentPoolReap({ config });
	if (expiredPlan.summary.selectedLeases > 0
		|| expiredPlan.summary.selectedOrphanContainers > 0
		|| expiredPlan.summary.selectedDirtySlots > 0
		|| expiredPlan.summary.selectedFailureSnapshots > 0
		|| expiredPlan.summary.selectedArtifacts > 0) {
		await applyDeploymentPoolReapPlan(expiredPlan, config);
	}
	await assertHostCapacity(config);
	if (!(await dockerImageExists(config.runtimeImage))) throw new Error(`Deployment runtime image was not found: ${config.runtimeImage}`);
	const holder = options.holder.trim();
	if (!holder) throw new Error("Deployment holder is required");
	const ttlMinutes = options.ttlMinutes ?? config.defaultTtlMinutes;
	if (!Number.isInteger(ttlMinutes) || ttlMinutes < 1) throw new Error("Deployment TTL must be a positive integer");
	const now = new Date();
	const leaseId = `lease_${randomBytes(9).toString("hex")}`;
	const expiresAt = new Date(now.getTime() + ttlMinutes * 60_000).toISOString();
	const store = openStore(config);
	let lease: DeploymentLeaseRecord | undefined;
	let slotId: string | undefined;
	try {
		const reserved = store.reserveLease({
			id: leaseId,
			holder,
			seedMode: options.seedMode,
			artifactSha256: options.artifact.sha256,
			artifactRuntimePath: options.artifact.runtimePath,
			packageVersion: options.artifact.packageVersion,
			commit: options.commit,
			createdAt: now.toISOString(),
			expiresAt,
			maxActive: config.maxActive,
		});
		lease = reserved.lease;
		slotId = reserved.slot.id;
		const prepared = await prepareDeploymentSeed({
			config,
			slotId: reserved.slot.id,
			mode: options.seedMode,
			publicUrl: reserved.slot.publicUrl ?? new URL(`${reserved.slot.id}.${baseURL.hostname}`, baseURL).toString(),
		});
		await startDeploymentContainer({ config, slot: reserved.slot, lease, homePath: prepared.homePath, piHomePath: prepared.piHomePath, workspacePath: prepared.workspacePath });
		await waitForDeploymentHealth(reserved.slot.webPort);
		return store.markReady(lease.id);
	} catch (error) {
		if (lease && slotId) {
			const message = error instanceof Error ? error.message : String(error);
			let containerClean = true;
			try { await removeDeploymentContainer(lease.containerName); } catch { containerClean = false; }
			let snapshotPath: string | undefined;
			try { snapshotPath = await retainFailedSlot(config, slotId, lease.id, message); } catch { containerClean = false; }
			store.markFailed(lease.id, message, snapshotPath, { slotClean: containerClean });
		}
		throw error;
	} finally {
		store.close();
	}
}

export function getDeploymentPoolStatus(config = resolveDeploymentPoolConfig()): DeploymentPoolStatus {
	const store = openStore(config);
	try {
		const slots = store.listSlots();
		const leases = store.listLeases();
		const leaseById = new Map(leases.map((lease) => [lease.id, lease]));
		const activeLeases = leases.filter((lease) => ["provisioning", "ready", "releasing"].includes(lease.status));
		const nearestExpiry = activeLeases.map((lease) => lease.expiresAt).sort()[0];
		return {
			generatedAt: new Date().toISOString(),
			configured: Boolean(config.baseURL),
			maxActive: config.maxActive,
			active: activeLeases.length,
			free: slots.filter((slot) => slot.state === "free").length,
			nearestExpiry,
			slots: slots.map((slot) => ({ ...slot, lease: slot.activeLeaseId ? leaseById.get(slot.activeLeaseId) : undefined })),
		};
	} finally {
		store.close();
	}
}

export function renewDeploymentLease(input: { leaseId: string; holder: string; ttlMinutes?: number; config?: DeploymentPoolConfig }): DeploymentLeaseRecord {
	const config = input.config ?? resolveDeploymentPoolConfig();
	const ttlMinutes = input.ttlMinutes ?? config.defaultTtlMinutes;
	if (!Number.isInteger(ttlMinutes) || ttlMinutes < 1) throw new Error("Deployment TTL must be a positive integer");
	const now = new Date();
	const store = openStore(config);
	try {
		return store.renewLease(input.leaseId, input.holder.trim(), new Date(now.getTime() + ttlMinutes * 60_000).toISOString(), now.toISOString());
	} finally {
		store.close();
	}
}

export async function releaseDeploymentLease(input: {
	leaseId: string;
	holder?: string;
	force?: boolean;
	expired?: boolean;
	config?: DeploymentPoolConfig;
}): Promise<DeploymentLeaseRecord> {
	const config = input.config ?? resolveDeploymentPoolConfig();
	const store = openStore(config);
	try {
		const lease = store.getLease(input.leaseId);
		if (!lease) throw new Error(`Deployment lease "${input.leaseId}" was not found`);
		if (!input.force && lease.holder !== input.holder?.trim()) throw new Error(`Deployment lease "${input.leaseId}" is held by another holder`);
		if (["released", "expired"].includes(lease.status)) return lease;
		store.markReleasing(lease.id);
		await removeDeploymentContainer(lease.containerName);
		await rm(resolve(config.slotsRoot, lease.slotId, "active"), { recursive: true, force: true });
		return store.markReleased(lease.id, input.expired ? "expired" : "released");
	} catch (error) {
		const lease = store.getLease(input.leaseId);
		if (lease && !["released", "expired", "failed"].includes(lease.status)) {
			store.markFailed(lease.id, error instanceof Error ? error.message : String(error), lease.failureSnapshotPath, { slotClean: false });
		}
		throw error;
	} finally {
		store.close();
	}
}

export async function planDeploymentPoolReap(input: { config?: DeploymentPoolConfig; now?: Date; listContainers?: typeof listDeploymentContainers } = {}): Promise<DeploymentPoolReapPlan> {
	const config = input.config ?? resolveDeploymentPoolConfig();
	const now = input.now ?? new Date();
	const store = openStore(config);
	try {
		const slots = store.listSlots();
		const leases = store.listLeases();
		let containers: Awaited<ReturnType<typeof listDeploymentContainers>> | undefined;
		try { containers = await (input.listContainers ?? listDeploymentContainers)(); } catch { /* Docker unavailable: do not infer missing containers. */ }
		const containerByLease = new Map((containers ?? []).filter((container) => container.leaseId).map((container) => [container.leaseId!, container]));
		const items = leases.map((lease) => {
			const reasons: string[] = [];
			if (Date.parse(lease.expiresAt) <= now.getTime()) reasons.push("expired");
			const container = containerByLease.get(lease.id);
			const provisioningGraceElapsed = lease.status !== "provisioning" || Date.parse(lease.createdAt) + 5 * 60_000 <= now.getTime();
			if (containers && !container && provisioningGraceElapsed) reasons.push("container-missing");
			if (container && container.state !== "running") reasons.push(`container-${container.state}`);
			return { lease, action: reasons.length ? "release" as const : "skip" as const, reasons };
		});
		const activeLeaseById = new Map(leases.map((lease) => [lease.id, lease]));
		const orphanContainers = (containers ?? []).map((container) => {
			const lease = container.leaseId ? activeLeaseById.get(container.leaseId) : undefined;
			const keep = Boolean(lease && lease.containerName === container.name);
			return {
				name: container.name,
				leaseId: container.leaseId,
				slotId: container.slotId,
				action: keep ? "keep" as const : "remove" as const,
				reason: keep ? "active-lease" : "no-active-registry-lease",
			};
		});
		const dirtySlots = slots.filter((slot) => slot.state === "dirty").map((slot) => ({
			slotId: slot.id,
			leaseId: slot.activeLeaseId,
			action: containers ? "clean" as const : "keep" as const,
			reason: containers ? "dirty-slot-reconciled" : "docker-unavailable",
		}));
		const snapshots = await listFailureSnapshots(config);
		const ordered = [...snapshots].sort((a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt));
		const failureSnapshots = ordered.map((snapshot, index) => {
			if (Date.parse(snapshot.expiresAt) <= now.getTime()) return { ...snapshot, action: "remove" as const, reason: "retention-expired" };
			if (index >= config.maxFailedSnapshots) return { ...snapshot, action: "remove" as const, reason: "snapshot-cap-exceeded" };
			return { ...snapshot, action: "keep" as const, reason: "within-retention" };
		});
		const activeArtifactHashes = new Set(leases.map((lease) => lease.artifactSha256));
		const artifactEntries = await listDeploymentArtifactEntries(config, false);
		const unreferenced = artifactEntries.filter((artifact) => !activeArtifactHashes.has(artifact.sha256));
		const artifactExpiry = now.getTime() - config.artifactRetentionHours * 60 * 60_000;
		const artifacts = artifactEntries.map((artifact) => {
			if (activeArtifactHashes.has(artifact.sha256)) return { ...artifact, action: "keep" as const, reason: "active-lease" };
			const unreferencedIndex = unreferenced.findIndex((candidate) => candidate.sha256 === artifact.sha256);
			if (Date.parse(artifact.modifiedAt) <= artifactExpiry) return { ...artifact, action: "remove" as const, reason: "retention-expired" };
			if (unreferencedIndex >= config.maxArtifacts) return { ...artifact, action: "remove" as const, reason: "artifact-cap-exceeded" };
			return { ...artifact, action: "keep" as const, reason: "within-retention" };
		});
		return {
			createdAt: now.toISOString(),
			dryRun: true,
			items,
			orphanContainers,
			dirtySlots,
			failureSnapshots,
			artifacts,
			summary: {
				selectedLeases: items.filter((item) => item.action === "release").length,
				selectedOrphanContainers: orphanContainers.filter((item) => item.action === "remove").length,
				selectedDirtySlots: dirtySlots.filter((item) => item.action === "clean").length,
				selectedFailureSnapshots: failureSnapshots.filter((item) => item.action === "remove").length,
				selectedArtifacts: artifacts.filter((item) => item.action === "remove").length,
			},
		};
	} finally {
		store.close();
	}
}

export async function applyDeploymentPoolReapPlan(_plan: DeploymentPoolReapPlan, config = resolveDeploymentPoolConfig()): Promise<DeploymentPoolReapResult> {
	const confirmed = await planDeploymentPoolReap({ config, now: new Date() });
	const removedOrphanContainers: string[] = [];
	for (const container of confirmed.orphanContainers) {
		if (container.action !== "remove") continue;
		await removeDeploymentContainer(container.name);
		removedOrphanContainers.push(container.name);
	}
	const cleanedDirtySlots: string[] = [];
	const reconcileStore = openStore(config);
	try {
		for (const slot of confirmed.dirtySlots) {
			if (slot.action !== "clean") continue;
			await rm(resolve(config.slotsRoot, slot.slotId, "active"), { recursive: true, force: true });
			reconcileStore.freeDirtySlot(slot.slotId);
			cleanedDirtySlots.push(slot.slotId);
		}
	} finally {
		reconcileStore.close();
	}
	const releasedLeases: string[] = [];
	for (const item of confirmed.items) {
		if (item.action !== "release") continue;
		await releaseDeploymentLease({ leaseId: item.lease.id, force: true, expired: item.reasons.includes("expired"), config });
		releasedLeases.push(item.lease.id);
	}
	const removedFailureSnapshots: string[] = [];
	for (const snapshot of confirmed.failureSnapshots) {
		if (snapshot.action !== "remove") continue;
		await rm(snapshot.path, { recursive: true, force: true });
		removedFailureSnapshots.push(snapshot.path);
	}
	const removedArtifacts: string[] = [];
	for (const artifact of confirmed.artifacts) {
		if (artifact.action !== "remove") continue;
		await rm(artifact.path, { recursive: true, force: true });
		removedArtifacts.push(artifact.path);
	}
	return { applied: true, plan: confirmed, releasedLeases, removedOrphanContainers, cleanedDirtySlots, removedFailureSnapshots, removedArtifacts };
}

export async function getDeploymentPoolDoctor(config = resolveDeploymentPoolConfig()): Promise<Record<string, unknown>> {
	const containers = await listDeploymentContainers().catch(() => []);
	const status = getDeploymentPoolStatus(config);
	const reapPlan = await planDeploymentPoolReap({ config });
	return {
		generatedAt: new Date().toISOString(),
		configured: status.configured,
		baseURL: config.baseURL?.toString(),
		root: config.root,
		runtimeImage: config.runtimeImage,
		runtimeImageAvailable: await dockerImageExists(config.runtimeImage),
		seedSourceHome: config.seedSourceHome,
		seedSourceHomeAvailable: existsSync(config.seedSourceHome),
		envFileConfigured: Boolean(config.envFile),
		envFileAvailable: config.envFile ? existsSync(config.envFile) : undefined,
		maxActive: config.maxActive,
		slotCount: config.slotCount,
		status,
		containers,
		reconciliation: reapPlan.summary,
	};
}

export async function listDeploymentArtifacts(config = resolveDeploymentPoolConfig()): Promise<Array<{ sha256: string; path: string; bytes: number; modifiedAt: string }>> {
	return listDeploymentArtifactEntries(config, true) as Promise<Array<{ sha256: string; path: string; bytes: number; modifiedAt: string }>>;
}

function openStore(config: DeploymentPoolConfig): DeploymentPoolStore {
	return new DeploymentPoolStore(config.databasePath, deploymentSlotDefinitions(config));
}

async function ensurePoolDirectories(config: DeploymentPoolConfig): Promise<void> {
	await Promise.all([
		mkdir(config.root, { recursive: true, mode: 0o700 }),
		mkdir(config.artifactRoot, { recursive: true, mode: 0o700 }),
		mkdir(config.slotsRoot, { recursive: true, mode: 0o700 }),
		mkdir(config.failuresRoot, { recursive: true, mode: 0o700 }),
	]);
}

async function assertHostCapacity(config: DeploymentPoolConfig): Promise<void> {
	let availableBytes: number | undefined;
	try {
		const meminfo = await readFile("/proc/meminfo", "utf8");
		const match = meminfo.match(/^MemAvailable:\s+(\d+)\s+kB$/m);
		if (match) availableBytes = Number(match[1]) * 1024;
	} catch { /* non-Linux tests may not expose meminfo */ }
	const minimumMemoryBytes = config.minMemoryAvailableMb * 1024 * 1024;
	if (availableBytes !== undefined && availableBytes < minimumMemoryBytes) {
		throw new Error(`Deployment pool host memory reserve would be violated: available=${availableBytes} required=${minimumMemoryBytes}`);
	}
	const filesystem = await statfs(config.root);
	const availableDiskBytes = Number(filesystem.bavail) * Number(filesystem.bsize);
	const minimumDiskBytes = config.minDiskAvailableGb * 1024 ** 3;
	if (availableDiskBytes < minimumDiskBytes) {
		throw new Error(`Deployment pool disk reserve would be violated: available=${availableDiskBytes} required=${minimumDiskBytes}`);
	}
}

async function retainFailedSlot(config: DeploymentPoolConfig, slotId: string, leaseId: string, error: string): Promise<string | undefined> {
	const active = resolve(config.slotsRoot, slotId, "active");
	if (!existsSync(active)) return undefined;
	await mkdir(config.failuresRoot, { recursive: true, mode: 0o700 });
	const path = resolve(config.failuresRoot, `${new Date().toISOString().replace(/[:.]/g, "-")}-${leaseId}`);
	await rename(active, path);
	const createdAt = new Date();
	await writeFile(resolve(path, "failure.json"), `${JSON.stringify({ leaseId, slotId, error, createdAt: createdAt.toISOString(), expiresAt: new Date(createdAt.getTime() + config.failedRetentionMinutes * 60_000).toISOString() }, null, 2)}\n`, { mode: 0o600 });
	return path;
}

async function listFailureSnapshots(config: DeploymentPoolConfig): Promise<DeploymentFailureSnapshot[]> {
	let names: string[];
	try { names = await readdir(config.failuresRoot); } catch { return []; }
	const snapshots: DeploymentFailureSnapshot[] = [];
	for (const name of names) {
		const path = resolve(config.failuresRoot, name);
		try {
			const metadata = JSON.parse(await readFile(resolve(path, "failure.json"), "utf8")) as Partial<DeploymentFailureSnapshot>;
			if (typeof metadata.leaseId === "string" && typeof metadata.createdAt === "string" && typeof metadata.expiresAt === "string") {
				snapshots.push({ leaseId: metadata.leaseId, path, createdAt: metadata.createdAt, expiresAt: metadata.expiresAt });
			}
		} catch { /* malformed snapshots are left for operator inspection */ }
	}
	return snapshots;
}

async function listDeploymentArtifactEntries(config: DeploymentPoolConfig, includeSize: boolean): Promise<Array<{ sha256: string; path: string; bytes: number; modifiedAt: string }>> {
	let names: string[];
	try { names = await readdir(config.artifactRoot); } catch { return []; }
	const rows: Array<{ sha256: string; path: string; bytes: number; modifiedAt: string }> = [];
	for (const name of names) {
		if (name.startsWith(".staging-")) continue;
		const path = resolve(config.artifactRoot, name);
		try {
			const info = await stat(path);
			if (info.isDirectory()) rows.push({ sha256: name, path, bytes: includeSize ? await directorySize(path) : 0, modifiedAt: info.mtime.toISOString() });
		} catch { /* disappeared */ }
	}
	return rows.sort((a, b) => b.modifiedAt.localeCompare(a.modifiedAt));
}

async function directorySize(root: string): Promise<number> {
	let total = 0;
	for (const entry of await readdir(root, { withFileTypes: true })) {
		const path = resolve(root, entry.name);
		if (entry.isDirectory()) total += await directorySize(path);
		else if (entry.isFile()) total += (await stat(path)).size;
	}
	return total;
}

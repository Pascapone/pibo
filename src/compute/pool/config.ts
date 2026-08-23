import { resolve } from "node:path";
import { getPiboHome, piboHomePath } from "../../core/pibo-home.js";
import type { DeploymentSlotDefinition } from "./types.js";

export interface DeploymentPoolConfig {
	root: string;
	databasePath: string;
	artifactRoot: string;
	slotsRoot: string;
	failuresRoot: string;
	baseURL?: URL;
	slotCount: number;
	maxActive: number;
	portBase: number;
	portStride: number;
	defaultTtlMinutes: number;
	failedRetentionMinutes: number;
	maxFailedSnapshots: number;
	artifactRetentionHours: number;
	maxArtifacts: number;
	minMemoryAvailableMb: number;
	minDiskAvailableGb: number;
	runtimeImage: string;
	envFile?: string;
	seedSourceHome: string;
	seedSourcePiHome?: string;
	seedSourceWorkspace?: string;
}

export interface ResolveDeploymentPoolConfigOptions {
	env?: NodeJS.ProcessEnv;
	root?: string;
	baseURL?: string;
}

export function resolveDeploymentPoolConfig(options: ResolveDeploymentPoolConfigOptions = {}): DeploymentPoolConfig {
	const env = options.env ?? process.env;
	const root = resolve(options.root ?? env.PIBO_COMPUTE_POOL_ROOT ?? piboHomePath("compute-pool"));
	const baseURL = parseBaseURL(options.baseURL ?? env.PIBO_COMPUTE_POOL_BASE_URL);
	const slotCount = positiveInteger(env.PIBO_COMPUTE_POOL_SLOT_COUNT, 10);
	const maxActive = Math.min(slotCount, positiveInteger(env.PIBO_COMPUTE_POOL_MAX_ACTIVE, 3));
	const portBase = validPort(env.PIBO_COMPUTE_POOL_PORT_BASE, 5000);
	const portStride = positiveInteger(env.PIBO_COMPUTE_POOL_PORT_STRIDE, 10);
	if (portBase + (slotCount - 1) * portStride + 1 > 65535) {
		throw new Error("Deployment pool slot ports exceed 65535");
	}
	return {
		root,
		databasePath: resolve(root, "pool.sqlite"),
		artifactRoot: resolve(root, "artifacts"),
		slotsRoot: resolve(root, "slots"),
		failuresRoot: resolve(root, "failures"),
		baseURL,
		slotCount,
		maxActive,
		portBase,
		portStride,
		defaultTtlMinutes: positiveInteger(env.PIBO_COMPUTE_POOL_TTL_MINUTES, 60),
		failedRetentionMinutes: positiveInteger(env.PIBO_COMPUTE_POOL_FAILED_RETENTION_MINUTES, 120),
		maxFailedSnapshots: positiveInteger(env.PIBO_COMPUTE_POOL_MAX_FAILED_SNAPSHOTS, 3),
		artifactRetentionHours: positiveInteger(env.PIBO_COMPUTE_POOL_ARTIFACT_RETENTION_HOURS, 24),
		maxArtifacts: positiveInteger(env.PIBO_COMPUTE_POOL_MAX_ARTIFACTS, 10),
		minMemoryAvailableMb: positiveInteger(env.PIBO_COMPUTE_POOL_MIN_MEMORY_AVAILABLE_MB, 1536),
		minDiskAvailableGb: positiveInteger(env.PIBO_COMPUTE_POOL_MIN_DISK_AVAILABLE_GB, 10),
		runtimeImage: nonEmpty(env.PIBO_COMPUTE_POOL_RUNTIME_IMAGE, "pibo:latest"),
		envFile: optionalResolved(env.PIBO_COMPUTE_POOL_ENV_FILE),
		seedSourceHome: resolve(env.PIBO_COMPUTE_POOL_SEED_SOURCE_HOME ?? getPiboHome()),
		seedSourcePiHome: optionalResolved(env.PIBO_COMPUTE_POOL_SEED_SOURCE_PI_HOME),
		seedSourceWorkspace: optionalResolved(env.PIBO_COMPUTE_POOL_SEED_SOURCE_WORKSPACE),
	};
}

export function requireDeploymentPoolBaseURL(config: DeploymentPoolConfig): URL {
	if (!config.baseURL) {
		throw new Error("PIBO_COMPUTE_POOL_BASE_URL is required for deployment acquire");
	}
	return config.baseURL;
}

export function deploymentSlotDefinitions(config: DeploymentPoolConfig): DeploymentSlotDefinition[] {
	return Array.from({ length: config.slotCount }, (_, index) => {
		const ordinal = index + 1;
		const id = `slot-${String(ordinal).padStart(2, "0")}`;
		const webPort = config.portBase + index * config.portStride;
		const gatewayPort = webPort + 1;
		return {
			id,
			ordinal,
			webPort,
			gatewayPort,
			publicUrl: config.baseURL ? deploymentSlotURL(id, config.baseURL).toString() : undefined,
		};
	});
}

export function deploymentSlotURL(slotId: string, baseURL: URL): URL {
	if (!/^slot-\d{2}$/.test(slotId)) throw new Error(`Invalid deployment slot id "${slotId}"`);
	const url = new URL(baseURL.toString());
	url.hostname = `${slotId}.${baseURL.hostname}`;
	return url;
}

function parseBaseURL(value: string | undefined): URL | undefined {
	if (!value?.trim()) return undefined;
	let url: URL;
	try {
		url = new URL(value);
	} catch {
		throw new Error("PIBO_COMPUTE_POOL_BASE_URL must be an absolute HTTP or HTTPS URL");
	}
	if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password || url.pathname !== "/" || url.search || url.hash) {
		throw new Error("PIBO_COMPUTE_POOL_BASE_URL must contain only scheme, hostname, and optional port");
	}
	return url;
}

function positiveInteger(value: string | undefined, fallback: number): number {
	if (!value?.trim()) return fallback;
	const parsed = Number(value);
	if (!Number.isInteger(parsed) || parsed < 1) throw new Error(`Expected positive integer, received "${value}"`);
	return parsed;
}

function validPort(value: string | undefined, fallback: number): number {
	const port = positiveInteger(value, fallback);
	if (port > 65535) throw new Error(`Invalid port ${port}`);
	return port;
}

function nonEmpty(value: string | undefined, fallback: string): string {
	return value?.trim() || fallback;
}

function optionalResolved(value: string | undefined): string | undefined {
	return value?.trim() ? resolve(value) : undefined;
}

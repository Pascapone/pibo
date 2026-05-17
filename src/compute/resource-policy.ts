export interface ComputeResourcePolicy {
	memory: string;
	memorySwap: string;
	pidsLimit: number;
	shmSize: string;
	init: boolean;
	restart: "no";
	logDriver: "json-file";
	logMaxSize: string;
	logMaxFile: number;
}

export const DEFAULT_COMPUTE_RESOURCE_POLICY: ComputeResourcePolicy = Object.freeze({
	memory: "2g",
	memorySwap: "2g",
	pidsLimit: 512,
	shmSize: "512m",
	init: true,
	restart: "no",
	logDriver: "json-file",
	logMaxSize: "10m",
	logMaxFile: 3,
});

export const COMPUTE_RESOURCE_POLICY_ENV = Object.freeze({
	memory: "PIBO_COMPUTE_MEMORY",
	memorySwap: "PIBO_COMPUTE_MEMORY_SWAP",
	pidsLimit: "PIBO_COMPUTE_PIDS_LIMIT",
	shmSize: "PIBO_COMPUTE_SHM_SIZE",
	init: "PIBO_COMPUTE_INIT",
	logMaxSize: "PIBO_COMPUTE_LOG_MAX_SIZE",
	logMaxFile: "PIBO_COMPUTE_LOG_MAX_FILE",
});

export const COMPUTE_RESOURCE_POLICY_LABELS = Object.freeze({
	memory: "pibo.compute.resource.memory",
	memorySwap: "pibo.compute.resource.memorySwap",
	pidsLimit: "pibo.compute.resource.pidsLimit",
	shmSize: "pibo.compute.resource.shmSize",
	init: "pibo.compute.resource.init",
	restart: "pibo.compute.resource.restart",
	logDriver: "pibo.compute.resource.logDriver",
	logMaxSize: "pibo.compute.resource.logMaxSize",
	logMaxFile: "pibo.compute.resource.logMaxFile",
});

export function resolveComputeResourcePolicy(env: NodeJS.ProcessEnv = process.env): ComputeResourcePolicy {
	return {
		memory: nonEmpty(env[COMPUTE_RESOURCE_POLICY_ENV.memory], DEFAULT_COMPUTE_RESOURCE_POLICY.memory),
		memorySwap: nonEmpty(env[COMPUTE_RESOURCE_POLICY_ENV.memorySwap], DEFAULT_COMPUTE_RESOURCE_POLICY.memorySwap),
		pidsLimit: positiveInteger(env[COMPUTE_RESOURCE_POLICY_ENV.pidsLimit], DEFAULT_COMPUTE_RESOURCE_POLICY.pidsLimit),
		shmSize: nonEmpty(env[COMPUTE_RESOURCE_POLICY_ENV.shmSize], DEFAULT_COMPUTE_RESOURCE_POLICY.shmSize),
		init: booleanValue(env[COMPUTE_RESOURCE_POLICY_ENV.init], DEFAULT_COMPUTE_RESOURCE_POLICY.init),
		restart: DEFAULT_COMPUTE_RESOURCE_POLICY.restart,
		logDriver: DEFAULT_COMPUTE_RESOURCE_POLICY.logDriver,
		logMaxSize: nonEmpty(env[COMPUTE_RESOURCE_POLICY_ENV.logMaxSize], DEFAULT_COMPUTE_RESOURCE_POLICY.logMaxSize),
		logMaxFile: positiveInteger(env[COMPUTE_RESOURCE_POLICY_ENV.logMaxFile], DEFAULT_COMPUTE_RESOURCE_POLICY.logMaxFile),
	};
}

export function buildDockerResourcePolicyArgs(policy: ComputeResourcePolicy = resolveComputeResourcePolicy()): string[] {
	return [
		"--memory",
		policy.memory,
		"--memory-swap",
		policy.memorySwap,
		"--pids-limit",
		String(policy.pidsLimit),
		"--shm-size",
		policy.shmSize,
		...(policy.init ? ["--init"] : []),
		"--restart",
		policy.restart,
		"--log-driver",
		policy.logDriver,
		"--log-opt",
		`max-size=${policy.logMaxSize}`,
		"--log-opt",
		`max-file=${policy.logMaxFile}`,
	];
}

export function buildComputeResourcePolicyLabels(policy: ComputeResourcePolicy = resolveComputeResourcePolicy()): string[] {
	return [
		`${COMPUTE_RESOURCE_POLICY_LABELS.memory}=${policy.memory}`,
		`${COMPUTE_RESOURCE_POLICY_LABELS.memorySwap}=${policy.memorySwap}`,
		`${COMPUTE_RESOURCE_POLICY_LABELS.pidsLimit}=${policy.pidsLimit}`,
		`${COMPUTE_RESOURCE_POLICY_LABELS.shmSize}=${policy.shmSize}`,
		`${COMPUTE_RESOURCE_POLICY_LABELS.init}=${policy.init}`,
		`${COMPUTE_RESOURCE_POLICY_LABELS.restart}=${policy.restart}`,
		`${COMPUTE_RESOURCE_POLICY_LABELS.logDriver}=${policy.logDriver}`,
		`${COMPUTE_RESOURCE_POLICY_LABELS.logMaxSize}=${policy.logMaxSize}`,
		`${COMPUTE_RESOURCE_POLICY_LABELS.logMaxFile}=${policy.logMaxFile}`,
	];
}

function nonEmpty(value: string | undefined, fallback: string): string {
	const trimmed = value?.trim();
	return trimmed ? trimmed : fallback;
}

function positiveInteger(value: string | undefined, fallback: number): number {
	if (value === undefined || value.trim() === "") return fallback;
	const parsed = Number(value);
	return Number.isInteger(parsed) && parsed > 0 ? parsed : fallback;
}

function booleanValue(value: string | undefined, fallback: boolean): boolean {
	if (value === undefined || value.trim() === "") return fallback;
	const normalized = value.trim().toLowerCase();
	if (["1", "true", "yes", "on"].includes(normalized)) return true;
	if (["0", "false", "no", "off"].includes(normalized)) return false;
	return fallback;
}

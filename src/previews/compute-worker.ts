import { listWorkers, type WorkerInfo } from "../compute/docker.js";
import { validatePreviewPort } from "./network.js";

export type PreviewComputeWorkerTarget = {
	id: string;
	name: string;
	webPort: number;
	worktreePath?: string;
};

export function selectPreviewComputeWorkerTarget(
	workers: WorkerInfo[],
	selector: string,
): PreviewComputeWorkerTarget {
	const normalized = selector.trim();
	if (!normalized) throw new Error("Compute worker name or id is required");
	const worker = workers.find((candidate) => candidate.name === normalized || candidate.id === normalized);
	if (!worker) throw new Error(`Pibo compute worker "${normalized}" was not found`);
	if (worker.role !== "worker" && worker.role !== "dev") throw new Error(`Pibo compute target "${worker.name}" is not a managed worker`);
	if (worker.state !== "running") throw new Error(`Pibo compute worker "${worker.name}" is not running`);
	const webPort = Number(worker.portMap.web);
	if (!Number.isInteger(webPort)) throw new Error(`Pibo compute worker "${worker.name}" does not publish a labeled Web port`);
	const bindings = worker.portMap["4788/tcp"]?.split(",") ?? [];
	if (!bindings.includes(`127.0.0.1:${webPort}`)) {
		throw new Error(`Pibo compute worker "${worker.name}" Web port is not published on host loopback`);
	}
	return {
		id: worker.id,
		name: worker.name,
		webPort: validatePreviewPort(webPort),
		worktreePath: worker.worktreePath,
	};
}

export async function resolvePreviewComputeWorkerTarget(selector: string): Promise<PreviewComputeWorkerTarget> {
	let workers: WorkerInfo[];
	try {
		workers = await listWorkers({ all: true });
	} catch (error) {
		throw new Error(`Unable to inspect Pibo compute workers: ${error instanceof Error ? error.message : String(error)}`);
	}
	return selectPreviewComputeWorkerTarget(workers, selector);
}

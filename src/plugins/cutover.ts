import { createHash, randomUUID } from "node:crypto";
import { mkdir, open, readFile, rename } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import type {
	Pibo4CutoverPlan,
	Pibo4CutoverTarget,
	Pibo4LegacyCutoverSnapshot,
	Pibo4LegacyPackageState,
	Pibo4PackedCoordinate,
} from "./cutover-contract.js";

export * from "./cutover-contract.js";

const AGGREGATE_TARGETS: Record<string, Record<string, string>> = {
	"pibo.standard-shell": { composition: "@pasko70/pibo-standard" },
	"pibo.product-ui": { workflows: "pibo.workflows", cron: "pibo.cron", loops: "pibo.goal-control", "agent-designer": "@pibo/core", settings: "@pibo/core", "user-resources": "@pibo/core" },
	"pibo.web-product": { "preview-app": "pibo.preview", "cron-channel": "pibo.cron" },
	"pibo.user-resources": { resources: "@pibo/core" },
	"pibo.core": { core: "@pibo/core" },
};
const COMPOSITION_TARGETS = new Set(["@pibo/core", "@pasko70/pibo-standard"]);

export function isPibo4LegacyAggregatePluginId(pluginId: string): boolean {
	return Object.hasOwn(AGGREGATE_TARGETS, pluginId);
}
export function pibo4LegacyAggregateOwners(plan: Pibo4CutoverPlan): string[] {
	return [...plan.supersededOwners];
}

function canonical(value: unknown): string {
	if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
	if (value && typeof value === "object") return `{${Object.entries(value as Record<string, unknown>).sort(([a], [b]) => a.localeCompare(b)).map(([key, child]) => `${JSON.stringify(key)}:${canonical(child)}`).join(",")}}`;
	return JSON.stringify(value);
}
function sha256(bytes: Uint8Array | string): string {
	return `sha256:${createHash("sha256").update(bytes).digest("hex")}`;
}
async function fileHash(path: string): Promise<string> {
	return sha256(await readFile(path));
}
async function writePrivateJsonAtomic(path: string, value: unknown): Promise<void> {
	const target = resolve(path);
	const parent = dirname(target);
	await mkdir(parent, { recursive: true, mode: 0o700 });
	const temporary = `${target}.${randomUUID()}.tmp`;
	const file = await open(temporary, "wx", 0o600);
	try { await file.writeFile(`${JSON.stringify(value, null, 2)}\n`); await file.sync(); } finally { await file.close(); }
	await rename(temporary, target);
	const directory = await open(parent, "r");
	try { await directory.sync(); } finally { await directory.close(); }
}
async function withVerifiedHash(coordinate: Pibo4PackedCoordinate): Promise<Pibo4PackedCoordinate & { contentHash: string }> {
	const path = resolve(coordinate.path);
	const contentHash = await fileHash(path);
	if (coordinate.contentHash && coordinate.contentHash !== contentHash) throw new Error(`Packed artifact hash mismatch for ${coordinate.package}@${coordinate.version}; expected ${coordinate.contentHash}, received ${contentHash}`);
	return { ...coordinate, path, contentHash };
}
function isSupportedSourceVersion(version: string): boolean {
	const match = version.match(/^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-([0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*))?(?:\+([0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*))?$/);
	if (!match) return false;
	const [, majorText, minorText, patchText, prerelease] = match;
	if (prerelease?.split(".").some((identifier) => /^\d+$/.test(identifier) && identifier.length > 1 && identifier.startsWith("0"))) return false;
	const major = Number(majorText);
	if ([1, 2, 3].includes(major)) return true;
	return major === 4 && minorText === "0" && patchText === "0" && prerelease !== undefined && ["alpha", "beta", "rc"].includes(prerelease.split(".")[0]!);
}

function targetStates(snapshot: Pibo4LegacyCutoverSnapshot): Map<string, { state: Pibo4LegacyPackageState; owners: Set<string> }> {
	if (snapshot.schemaVersion !== 1 || !Array.isArray(snapshot.plugins)) throw new Error("Pibo 4 cutover requires a schemaVersion 1 legacy package snapshot");
	const targets = new Map<string, { state: Pibo4LegacyPackageState; owners: Set<string> }>();
	const merge = (target: string, state: Pibo4LegacyPackageState, owner: string) => {
		if (COMPOSITION_TARGETS.has(target)) return;
		const previous = targets.get(target);
		if (previous && previous.state !== state) throw new Error(`Legacy selections map ${target} to conflicting ${previous.state}/${state} states; reconcile the legacy snapshot before cutover`);
		const next = previous ?? { state, owners: new Set<string>() };
		next.owners.add(owner);
		targets.set(target, next);
	};
	for (const entry of snapshot.plugins) {
		if (!entry.pluginId || !["active", "disabled", "uninstalled"].includes(entry.state)) throw new Error("Legacy package snapshot contains an invalid package state");
		const aggregate = AGGREGATE_TARGETS[entry.pluginId];
		if (!aggregate) {
			merge(entry.pluginId, entry.state, entry.pluginId);
			continue;
		}
		for (const [contributionId, target] of Object.entries(aggregate)) {
			const selected = entry.contributions?.[contributionId];
			const state = entry.state !== "active" ? entry.state : selected === false ? "disabled" : "active";
			merge(target, state, `${entry.pluginId}/${contributionId}`);
		}
	}
	return targets;
}

export async function preparePibo4Cutover(options: {
	source: Pibo4PackedCoordinate & { package: "@pasko70/pibo" };
	targetCore: Pibo4PackedCoordinate & { package: "@pasko70/pibo" };
	artifacts: Record<string, Pibo4PackedCoordinate>;
	snapshot: Pibo4LegacyCutoverSnapshot;
	outputPath: string;
}): Promise<Pibo4CutoverPlan> {
	if (options.source.package !== "@pasko70/pibo") throw new Error(`Cutover source must be @pasko70/pibo, received ${options.source.package}`);
	if (!isSupportedSourceVersion(options.source.version)) throw new Error(`Unsupported cutover source @pasko70/pibo@${options.source.version}; prepare from an exact 1.x, 2.x, 3.x, or 4.0 prerelease package`);
	if (options.targetCore.package !== "@pasko70/pibo") throw new Error(`Cutover target must be @pasko70/pibo, received ${options.targetCore.package}`);
	if (!/^4\./.test(options.targetCore.version)) throw new Error(`Cutover target must be Pibo 4, received ${options.targetCore.version}`);
	const sourceSnapshot = JSON.parse(JSON.stringify(options.snapshot)) as Pibo4LegacyCutoverSnapshot;
	const mapped = targetStates(sourceSnapshot);
	const supersededOwners = sourceSnapshot.plugins.map((entry) => entry.pluginId).filter(isPibo4LegacyAggregatePluginId).sort();
	const [sourceValue, targetCoreValue] = await Promise.all([withVerifiedHash(options.source), withVerifiedHash(options.targetCore)]);
	const source = sourceValue as Pibo4PackedCoordinate & { package: "@pasko70/pibo"; contentHash: string };
	const targetCore = targetCoreValue as Pibo4PackedCoordinate & { package: "@pasko70/pibo"; contentHash: string };
	const targets: Pibo4CutoverTarget[] = [];
	for (const [pluginId, selection] of [...mapped].sort(([a], [b]) => a.localeCompare(b))) {
		const coordinate = options.artifacts[pluginId];
		if (!coordinate) throw new Error(`No exact Pibo 4 artifact was supplied for mapped plugin ${pluginId}; cutover remains unprepared`);
		const verified = await withVerifiedHash(coordinate);
		targets.push({ ...verified, pluginId, state: selection.state, legacyOwners: [...selection.owners].sort() });
	}
	const sourceSnapshotHash = sha256(canonical(sourceSnapshot));
	const unsigned = { schemaVersion: 1 as const, id: `pibo4-cutover:${source.contentHash.slice(7, 23)}:${sourceSnapshotHash.slice(7, 23)}`, state: "prepared" as const, source, sourceSnapshot, sourceSnapshotHash, targetCore, targets, supersededOwners };
	const plan: Pibo4CutoverPlan = { ...unsigned, planHash: sha256(canonical(unsigned)) };
	await writePrivateJsonAtomic(options.outputPath, plan);
	return plan;
}

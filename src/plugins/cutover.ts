import { createHash, randomUUID } from "node:crypto";
import { mkdir, open, readFile, rename } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { pluginErrorMessage } from "./store.js";

export type Pibo4LegacyPackageState = "active" | "disabled" | "uninstalled";
export interface Pibo4LegacyPackageSelection {
	pluginId: string;
	state: Pibo4LegacyPackageState;
	contributions?: Record<string, boolean>;
}
export interface Pibo4LegacyCutoverSnapshot {
	schemaVersion: 1;
	plugins: Pibo4LegacyPackageSelection[];
}
export interface Pibo4PackedCoordinate {
	package: string;
	version: string;
	path: string;
	contentHash?: string;
}
export interface Pibo4CutoverTarget extends Pibo4PackedCoordinate {
	pluginId: string;
	state: Pibo4LegacyPackageState;
	legacyOwners: string[];
	contentHash: string;
}
export interface Pibo4CutoverPlan {
	schemaVersion: 1;
	id: string;
	state: "prepared";
	source: Pibo4PackedCoordinate & { package: "@pasko70/pibo"; contentHash: string };
	sourceSnapshot: Pibo4LegacyCutoverSnapshot;
	sourceSnapshotHash: string;
	targetCore: Pibo4PackedCoordinate & { package: "@pasko70/pibo"; contentHash: string };
	targets: Pibo4CutoverTarget[];
	planHash: string;
}

const AGGREGATE_TARGETS: Record<string, Record<string, string>> = {
	"pibo.product-ui": { workflows: "pibo.workflows", cron: "pibo.cron", loops: "pibo.goal-loops", "agent-designer": "@pibo/core", settings: "@pibo/core", "user-resources": "@pibo/core" },
	"pibo.web-product": { "preview-app": "pibo.preview", "cron-channel": "pibo.cron" },
	"pibo.user-resources": { resources: "@pibo/core" },
	"pibo.core": { core: "@pibo/core" },
};

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
function targetStates(snapshot: Pibo4LegacyCutoverSnapshot): Map<string, { state: Pibo4LegacyPackageState; owners: Set<string> }> {
	if (snapshot.schemaVersion !== 1 || !Array.isArray(snapshot.plugins)) throw new Error("Pibo 4 cutover requires a schemaVersion 1 legacy package snapshot");
	const targets = new Map<string, { state: Pibo4LegacyPackageState; owners: Set<string> }>();
	const merge = (target: string, state: Pibo4LegacyPackageState, owner: string) => {
		if (target === "@pibo/core") return;
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
	if (!/^3\.|^4\.0\.0-(?:alpha|beta|rc)/.test(options.source.version)) throw new Error(`Unsupported cutover source @pasko70/pibo@${options.source.version}; prepare from 3.x or a 4.0 prerelease`);
	if (!/^4\./.test(options.targetCore.version)) throw new Error(`Cutover target must be Pibo 4, received ${options.targetCore.version}`);
	const sourceSnapshot = JSON.parse(JSON.stringify(options.snapshot)) as Pibo4LegacyCutoverSnapshot;
	const mapped = targetStates(sourceSnapshot);
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
	const unsigned = { schemaVersion: 1 as const, id: `pibo4-cutover:${source.contentHash.slice(7, 23)}:${sourceSnapshotHash.slice(7, 23)}`, state: "prepared" as const, source, sourceSnapshot, sourceSnapshotHash, targetCore, targets };
	const plan: Pibo4CutoverPlan = { ...unsigned, planHash: sha256(canonical(unsigned)) };
	await writePrivateJsonAtomic(options.outputPath, plan);
	return plan;
}

export async function verifyPreparedPibo4Cutover(planPath: string): Promise<Pibo4CutoverPlan> {
	let plan: Pibo4CutoverPlan;
	try { plan = JSON.parse(await readFile(resolve(planPath), "utf8")) as Pibo4CutoverPlan; }
	catch (error) { throw new Error(`Pibo 4 cutover is required but no readable prepared plan exists at ${resolve(planPath)}. Run the Pibo 4 cutover preparation tool before replacing the old package. ${pluginErrorMessage(error, "Read failed")}`); }
	const { planHash, ...unsigned } = plan;
	if (plan.schemaVersion !== 1 || plan.state !== "prepared" || plan.sourceSnapshotHash !== sha256(canonical(plan.sourceSnapshot)) || planHash !== sha256(canonical(unsigned))) throw new Error("Pibo 4 cutover plan is invalid or changed; restore the retained source and prepare a new plan before activation");
	if (plan.targetCore.package !== "@pasko70/pibo" || !/^4\./.test(plan.targetCore.version)) throw new Error("Pibo 4 cutover plan does not target a supported Minimal-Core package");
	for (const coordinate of [plan.source, plan.targetCore, ...plan.targets]) {
		const actual = await fileHash(coordinate.path);
		if (actual !== coordinate.contentHash) throw new Error(`Pibo 4 cutover artifact changed or is missing: ${coordinate.package}@${coordinate.version}. Restore the exact prepared tarball before activation`);
	}
	return plan;
}

export async function writePibo4CutoverReceipt(planPath: string, plan: Pibo4CutoverPlan): Promise<string> {
	const receiptPath = `${resolve(planPath)}.complete`;
	await writePrivateJsonAtomic(receiptPath, { schemaVersion: 1, planId: plan.id, planHash: plan.planHash, completedTargets: plan.targets.filter((entry) => entry.state === "active").map((entry) => ({ pluginId: entry.pluginId, contentHash: entry.contentHash })) });
	return receiptPath;
}

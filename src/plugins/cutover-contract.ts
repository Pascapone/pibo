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
export interface Pibo4CutoverArtifactBinding extends Pibo4PackedCoordinate {
	contentHash: string;
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
	supersededOwners: string[];
	planHash: string;
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

export async function verifyPreparedPibo4Cutover(planPath: string, options: {
	/** Packed target artifacts supplied by an executable composition. Paths in the prepared plan remain immutable evidence. */
	targetArtifacts?: readonly Pibo4CutoverArtifactBinding[];
	/** Preparation already verified the retained source package; packed target-only launches may omit those old bytes. */
	verifySourceArtifact?: boolean;
} = {}): Promise<Pibo4CutoverPlan> {
	let plan: Pibo4CutoverPlan;
	try { plan = JSON.parse(await readFile(resolve(planPath), "utf8")) as Pibo4CutoverPlan; }
	catch (error) { throw new Error(`Pibo 4 cutover is required but no readable prepared plan exists at ${resolve(planPath)}. Run the Pibo 4 cutover preparation tool before replacing the old package. ${pluginErrorMessage(error, "Read failed")}`); }
	const { planHash, ...unsigned } = plan;
	if (plan.schemaVersion !== 1 || plan.state !== "prepared" || plan.sourceSnapshotHash !== sha256(canonical(plan.sourceSnapshot)) || planHash !== sha256(canonical(unsigned))) throw new Error("Pibo 4 cutover plan is invalid or changed; restore the retained source and prepare a new plan before activation");
	if (!Array.isArray(plan.supersededOwners) || new Set(plan.supersededOwners).size !== plan.supersededOwners.length || plan.supersededOwners.some((owner) => typeof owner !== "string" || !owner)) throw new Error("Pibo 4 cutover plan lacks an exact superseded-owner set; rerun the packaged preparation command");
	if (plan.targetCore.package !== "@pasko70/pibo" || !/^4\./.test(plan.targetCore.version)) throw new Error("Pibo 4 cutover plan does not target a supported Minimal-Core package");
	if (options.verifySourceArtifact !== false) {
		const actual = await fileHash(plan.source.path);
		if (actual !== plan.source.contentHash) throw new Error(`Pibo 4 cutover artifact changed or is missing: ${plan.source.package}@${plan.source.version}. Restore the exact prepared tarball before activation`);
	}
	const bindings = options.targetArtifacts;
	const resolveTarget = async <T extends Pibo4PackedCoordinate & { contentHash: string }>(coordinate: T): Promise<T> => {
		const binding = bindings?.find((entry) => entry.package === coordinate.package && entry.version === coordinate.version && entry.contentHash === coordinate.contentHash);
		if (bindings && !binding) throw new Error(`Packed executable composition does not contain checksum-bound ${coordinate.package}@${coordinate.version} required by the prepared cutover`);
		const path = resolve(binding?.path ?? coordinate.path);
		const actual = await fileHash(path);
		if (actual !== coordinate.contentHash) throw new Error(`Pibo 4 cutover artifact changed or is missing: ${coordinate.package}@${coordinate.version}. Restore the exact prepared tarball before activation`);
		return { ...coordinate, path };
	};
	const targetCore = await resolveTarget(plan.targetCore);
	const targets = await Promise.all(plan.targets.map(resolveTarget));
	return { ...plan, targetCore, targets };
}

export async function writePibo4CutoverReceipt(planPath: string, plan: Pibo4CutoverPlan): Promise<string> {
	const receiptPath = `${resolve(planPath)}.complete`;
	await writePrivateJsonAtomic(receiptPath, {
		schemaVersion: 1,
		planId: plan.id,
		planHash: plan.planHash,
		completedTargets: plan.targets.filter((entry) => entry.state === "active").map((entry) => ({ pluginId: entry.pluginId, contentHash: entry.contentHash })),
		targets: plan.targets.map((entry) => ({ pluginId: entry.pluginId, state: entry.state, contentHash: entry.contentHash })),
		supersededOwners: plan.supersededOwners,
	});
	return receiptPath;
}

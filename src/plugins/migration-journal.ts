import { createHash, randomUUID } from "node:crypto";
import { mkdir, open, readFile, rename } from "node:fs/promises";
import { join } from "node:path";
import { PluginConflictError, PluginValidationError, pluginJson, pluginErrorMessage, type PluginJournalRecord, type PluginStore } from "./store.js";

export interface PluginMigrationStage {
	id: string;
	/** Must inspect its owner store; a completed write may precede the journal checkpoint after a crash. */
	isApplied(): boolean | Promise<boolean>;
	/** Idempotent CAS/transactional write in the owning store, never an assumed cross-store transaction. */
	apply(): void | Promise<void>;
}
export interface PluginMigrationRecord extends PluginJournalRecord {
	state: "prepared" | "running" | "failed" | "complete";
	stages: string[];
	completed: string[];
	backupPath: string;
	backupHash: string;
	currentStage?: string;
	diagnostic?: string;
}
export interface PluginMigrationInput {
	id: string;
	/** Exact legacy export/bytes, captured before any destructive migration. Kept private outside the catalog. */
	backup: Uint8Array;
	backupRoot: string;
	stages: PluginMigrationStage[];
	dryRun?: boolean;
	/** Test/embedding checkpoint; throwing simulates a process dying after a durable owner write. */
	afterStageWrite?: (stageId: string) => void | Promise<void>;
}

export class PluginMigrationJournal {
	constructor(readonly store: PluginStore) {}
	async run(input: PluginMigrationInput): Promise<PluginMigrationRecord | { dryRun: true; id: string; stages: string[]; backupHash: string }> {
		if (!input.id || new Set(input.stages.map((s) => s.id)).size !== input.stages.length || input.stages.some((s) => !s.id)) throw new PluginValidationError("Migration requires unique stage IDs");
		const backupHash = createHash("sha256").update(input.backup).digest("hex");
		const stageIds = input.stages.map((s) => s.id);
		if (input.dryRun) return { dryRun: true, id: input.id, stages: stageIds, backupHash };
		let record = this.store.getJournal<PluginMigrationRecord>(input.id);
		if (record && (record.backupHash !== backupHash || pluginJson(record.stages) !== pluginJson(stageIds))) throw new PluginConflictError("Migration source or stage order changed; preserve the original migration input");
		if (!record) {
			await mkdir(input.backupRoot, { recursive: true, mode: 0o700 });
			const backupPath = join(input.backupRoot, `${backupHash}.backup`);
			const temporary = `${backupPath}.${randomUUID()}.tmp`;
			const file = await open(temporary, "wx", 0o600);
			try { await file.writeFile(input.backup); await file.sync(); } finally { await file.close(); }
			await rename(temporary, backupPath);
			const directory = await open(input.backupRoot, "r");
			try { await directory.sync(); } finally { await directory.close(); }
			record = this.store.putJournal<PluginMigrationRecord>({ id: input.id, revision: 0, state: "prepared", stages: stageIds, completed: [], backupPath, backupHash }, 0);
		}
		if (createHash("sha256").update(await readFile(record.backupPath)).digest("hex") !== record.backupHash) throw new PluginValidationError("Migration backup missing or corrupted; refusing to continue");
		if (record.state === "complete") return record;
		try {
			for (const stage of input.stages) {
				if (record.completed.includes(stage.id)) {
					if (!await stage.isApplied()) throw new PluginConflictError(`Previously completed migration stage is no longer applied: ${stage.id}`);
					continue;
				}
				record = this.store.putJournal<PluginMigrationRecord>({ ...record, state: "running", currentStage: stage.id, diagnostic: undefined }, record.revision);
				if (!await stage.isApplied()) await stage.apply();
				await input.afterStageWrite?.(stage.id);
				if (!await stage.isApplied()) throw new PluginValidationError(`Migration stage did not establish its postcondition: ${stage.id}`);
				record = this.store.putJournal<PluginMigrationRecord>({ ...record, completed: [...record.completed, stage.id], currentStage: undefined }, record.revision);
			}
			return this.store.putJournal<PluginMigrationRecord>({ ...record, state: "complete", diagnostic: undefined }, record.revision);
		} catch (error) {
			// A true process death leaves running/currentStage; the same recovery checks apply.
			this.store.putJournal<PluginMigrationRecord>({ ...record!, state: "failed", diagnostic: pluginErrorMessage(error, "Migration stage failed") }, record!.revision);
			throw error;
		}
	}
}

import type { Connection, SendUserTurnOptions } from "@muse-code/sdk";
import type {
	AgentRuntimeContextUsage,
	AgentRuntimeFastModeResult,
	AgentRuntimeModelCatalog,
	AgentRuntimeReasoningResult,
} from "../../agent-runtime/types.js";
import type { PiboJsonObject } from "../../core/events.js";
import type { ModelProfile } from "../../core/profiles.js";
import { MUSE_NATIVE_APPROVAL_MODES, type MuseNativeApprovalMode } from "./config.js";
import { MuseNativeSessionProtocolError } from "./sessions.js";

export const MUSE_NATIVE_MODEL_PROVIDER_ID = "meta-muse";
export const MUSE_NATIVE_REASONING_VALUES = ["none", "minimal", "low", "medium", "high", "xhigh", "max", "ultra"] as const;
export type MuseNativeReasoningValue = (typeof MUSE_NATIVE_REASONING_VALUES)[number];

/** Map a Pibo thinking level to a Muse reasoning effort ("off" disables reasoning as "none"). */
export function mapThinkingLevelToReasoning(level: string | undefined): MuseNativeReasoningValue | undefined {
	if (!level) return undefined;
	const mapped = level === "off" ? "none" : level;
	return (MUSE_NATIVE_REASONING_VALUES as readonly string[]).includes(mapped)
		? (mapped as MuseNativeReasoningValue)
		: undefined;
}
export type MuseSdkReasoningEffort = NonNullable<SendUserTurnOptions<unknown>["reasoningEffort"]>;
// The Pibo reasoning vocabulary must match the pinned SDK wire vocabulary exactly.
type AssertReasoningParity = [MuseNativeReasoningValue] extends [MuseSdkReasoningEffort]
	? [MuseSdkReasoningEffort] extends [MuseNativeReasoningValue]
		? true
		: never
	: never;
const _assertReasoningParity: AssertReasoningParity = true;

const MAX_MODELS = 500;
const MAX_IDENTIFIER_LENGTH = 256;
const MAX_LABEL_LENGTH = 512;
const BINDING_MODEL_KEY = "museNativeModelId";
const BINDING_REASONING_KEY = "museNativeReasoningEffort";
const BINDING_PROVIDER_KEY = "museNativeProviderId";

export type MuseNativeModelEntry = {
	id: string;
	providerId?: string;
	displayName?: string;
	isDefault?: boolean;
};

export type MuseNativeModelCatalog = {
	models: readonly MuseNativeModelEntry[];
	providerId?: string;
	skippedInvalidEntries?: number;
};

export type MuseNativeProfileOptions = {
	approvalMode?: MuseNativeApprovalMode;
	reasoningEffort?: MuseNativeReasoningValue;
	providerId?: string;
};

function isRecord(value: unknown): value is Record<string, unknown> {
	return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function boundedIdentifier(value: unknown, label: string): string {
	if (typeof value !== "string" || !value.trim() || value.length > MAX_IDENTIFIER_LENGTH) {
		throw new MuseNativeSessionProtocolError(`Muse ${label} is invalid.`);
	}
	return value;
}

export async function readMuseModelCatalog(connection: Connection, sessionId: string): Promise<MuseNativeModelCatalog> {
	const result = await connection.request("model/list", { sessionId });
	if (!isRecord(result) || !Array.isArray(result.models)) {
		throw new MuseNativeSessionProtocolError("Muse model/list returned an invalid result.");
	}
	const models: MuseNativeModelEntry[] = [];
	let skippedInvalidEntries = 0;
	for (const entry of result.models.slice(0, MAX_MODELS)) {
		try {
			if (!isRecord(entry)) throw new MuseNativeSessionProtocolError("Muse model catalog entry is invalid.");
			const id = boundedIdentifier(entry.modelId, "model id");
			const providerId = typeof entry.providerId === "string" && entry.providerId.trim() ? entry.providerId : undefined;
			const displayName = typeof entry.displayLabel === "string" && entry.displayLabel.trim()
				? entry.displayLabel.slice(0, MAX_LABEL_LENGTH)
				: undefined;
			models.push({
				id,
				...(providerId ? { providerId } : {}),
				...(displayName ? { displayName } : {}),
				...(entry.isDefault === true ? { isDefault: true } : {}),
			});
		} catch {
			skippedInvalidEntries += 1;
		}
	}
	const providerId = typeof result.providerId === "string" && result.providerId.trim() ? result.providerId : undefined;
	return { models, ...(providerId ? { providerId } : {}), ...(skippedInvalidEntries > 0 ? { skippedInvalidEntries } : {}) };
}

export function selectDefaultCatalogModel(catalog: MuseNativeModelCatalog): ModelProfile | undefined {
	const fallback = catalog.models.find((entry) => entry.isDefault) ?? catalog.models[0];
	return fallback ? { id: fallback.id, provider: MUSE_NATIVE_MODEL_PROVIDER_ID } : undefined;
}

export function toAgentRuntimeModelCatalog(
	runtimeInstanceId: string,
	catalog: MuseNativeModelCatalog,
	diagnostics?: AgentRuntimeModelCatalog["diagnostics"],
): AgentRuntimeModelCatalog {
	const skipped = catalog.skippedInvalidEntries ?? 0;
	const merged = [
		...(diagnostics ?? []),
		...(skipped > 0
			? [{
				severity: "warning" as const,
				code: "muse_native_model_catalog_skipped_entries",
				message: `Muse model catalog skipped ${skipped} invalid ${skipped === 1 ? "entry" : "entries"}.`,
			}]
			: []),
	];
	return {
		runtimeInstanceId,
		models: catalog.models.map((model) => ({
			id: model.id,
			provider: MUSE_NATIVE_MODEL_PROVIDER_ID,
			...(model.displayName ? { displayName: model.displayName } : {}),
			reasoningOptions: [...MUSE_NATIVE_REASONING_VALUES],
		})),
		...(merged.length > 0 ? { diagnostics: merged } : {}),
	};
}

export function parseMuseProfileOptions(value: unknown): MuseNativeProfileOptions {
	if (value === undefined || value === null) return {};
	if (!isRecord(value)) throw new Error("Muse runtime options must be an object.");
	const supported = new Set(["approvalMode", "reasoningEffort", "providerId"]);
	const unknown = Object.keys(value).find((key) => !supported.has(key));
	if (unknown) throw new Error(`unsupported Muse runtime option "${unknown}"`);
	const options: MuseNativeProfileOptions = {};
	if (value.approvalMode !== undefined) {
		if (
			typeof value.approvalMode !== "string"
			|| !MUSE_NATIVE_APPROVAL_MODES.includes(value.approvalMode as MuseNativeApprovalMode)
		) {
			throw new Error("Muse runtime option approvalMode is invalid.");
		}
		options.approvalMode = value.approvalMode as MuseNativeApprovalMode;
	}
	if (value.reasoningEffort !== undefined) {
		if (typeof value.reasoningEffort !== "string" || !MUSE_NATIVE_REASONING_VALUES.includes(value.reasoningEffort as MuseNativeReasoningValue)) {
			throw new Error(`Muse runtime option reasoningEffort must be one of ${MUSE_NATIVE_REASONING_VALUES.join(", ")}.`);
		}
		options.reasoningEffort = value.reasoningEffort as MuseNativeReasoningValue;
	}
	if (value.providerId !== undefined) {
		if (typeof value.providerId !== "string" || !value.providerId.trim() || value.providerId.length > MAX_IDENTIFIER_LENGTH) {
			throw new Error("Muse runtime option providerId is invalid.");
		}
		options.providerId = value.providerId;
	}
	return options;
}

export function readMusePersistedSettings(metadata: PiboJsonObject | undefined): {
	activeModel?: ModelProfile;
	reasoningLevel?: string;
	profileOptions: MuseNativeProfileOptions;
} {
	const profileOptions: MuseNativeProfileOptions = {};
	let activeModel: ModelProfile | undefined;
	let reasoningLevel: string | undefined;
	if (!metadata) return { profileOptions };
	const modelId = metadata[BINDING_MODEL_KEY];
	if (typeof modelId === "string" && modelId.trim()) {
		activeModel = { id: modelId, provider: MUSE_NATIVE_MODEL_PROVIDER_ID };
	}
	const reasoning = metadata[BINDING_REASONING_KEY];
	if (typeof reasoning === "string" && MUSE_NATIVE_REASONING_VALUES.includes(reasoning as MuseNativeReasoningValue)) {
		reasoningLevel = reasoning;
	}
	const providerId = metadata[BINDING_PROVIDER_KEY];
	if (typeof providerId === "string" && providerId.trim()) profileOptions.providerId = providerId;
	return { ...(activeModel ? { activeModel } : {}), ...(reasoningLevel ? { reasoningLevel } : {}), profileOptions };
}

export type MuseSessionSettingsInput = {
	activeModel?: ModelProfile;
	reasoningLevel?: string;
	profileOptions: MuseNativeProfileOptions;
	catalog: MuseNativeModelCatalog;
};

export class MuseSessionSettingsController {
	private connection: Connection | undefined;
	private sessionId: string | undefined;
	private catalog: MuseNativeModelCatalog;
	private model: ModelProfile | undefined;
	private reasoning: string | undefined;
	private contextUsage: AgentRuntimeContextUsage = null;
	private modelWarning: string | undefined;
	private reasoningWarning: string | undefined;
	private disposed = false;

	constructor(input: MuseSessionSettingsInput) {
		this.catalog = input.catalog;
		if (input.activeModel) this.model = { ...input.activeModel };
		if (input.reasoningLevel && MUSE_NATIVE_REASONING_VALUES.includes(input.reasoningLevel as MuseNativeReasoningValue)) {
			this.reasoning = input.reasoningLevel;
		} else if (input.profileOptions.reasoningEffort) {
			this.reasoning = input.profileOptions.reasoningEffort;
		}
	}

	bind(connection: Connection, sessionId: string): void {
		this.connection = connection;
		this.sessionId = sessionId;
	}

	adoptNativeModel(summary: { modelId?: string }): void {
		if (!summary.modelId) return;
		this.model = { id: summary.modelId, provider: MUSE_NATIVE_MODEL_PROVIDER_ID };
		this.modelWarning = this.catalog.models.some((entry) => entry.id === summary.modelId)
			? undefined
			: `Muse session runs model "${summary.modelId}", which is not in the current model catalog.`;
	}

	get activeModel(): ModelProfile | undefined {
		return this.model ? { ...this.model } : undefined;
	}

	get reasoningState(): AgentRuntimeReasoningResult {
		return {
			...(this.reasoning ? { value: this.reasoning } : {}),
			availableValues: [...MUSE_NATIVE_REASONING_VALUES],
			supported: true,
		};
	}

	get fastMode(): AgentRuntimeFastModeResult {
		return { mode: "normal", supported: false };
	}

	get turnOptions(): { reasoningEffort?: string } {
		return this.reasoning ? { reasoningEffort: this.reasoning } : {};
	}

	get sessionSelection(): { modelId?: string; providerId?: string } {
		const model = this.model;
		if (!model) return {};
		const providerId = this.catalog.models.find((entry) => entry.id === model.id)?.providerId;
		return { modelId: model.id, ...(providerId ? { providerId } : {}) };
	}

	get bindingMetadata(): PiboJsonObject {
		return {
			...(this.model ? { [BINDING_MODEL_KEY]: this.model.id } : {}),
			...(this.reasoning ? { [BINDING_REASONING_KEY]: this.reasoning } : {}),
			...(this.sessionSelection.providerId ? { [BINDING_PROVIDER_KEY]: this.sessionSelection.providerId } : {}),
		};
	}

	get currentContextUsage(): AgentRuntimeContextUsage {
		return this.contextUsage;
	}

	noteContextUsage(usage: AgentRuntimeContextUsage): void {
		this.contextUsage = usage;
	}

	getReasoning(): AgentRuntimeReasoningResult {
		return this.reasoningState;
	}

	get pendingSyncWarnings(): readonly string[] {
		return [this.modelWarning, this.reasoningWarning].filter((warning): warning is string => typeof warning === "string");
	}

	setReasoning(value: string): AgentRuntimeReasoningResult {
		this.assertUsable();
		// The generic /thinking bridge passes Pibo levels straight through; "off" disables reasoning as "none".
		const normalized = value === "off" ? "none" : value;
		if (!MUSE_NATIVE_REASONING_VALUES.includes(normalized as MuseNativeReasoningValue)) {
			throw new Error(`Muse reasoning effort must be one of ${MUSE_NATIVE_REASONING_VALUES.join(", ")}.`);
		}
		this.reasoning = normalized;
		this.reasoningWarning = undefined;
		// The per-turn option carries the value even if the session-default sync below fails.
		if (this.connection && this.sessionId) {
			const connection = this.connection;
			const sessionId = this.sessionId;
			void connection.command("session/setReasoningEffort", { sessionId, reasoningEffort: normalized }).catch((error: unknown) => {
				this.reasoningWarning = error instanceof Error
					? `Muse session reasoning default could not be synced: ${error.message}`
					: "Muse session reasoning default could not be synced.";
			});
		}
		return this.reasoningState;
	}

	cycleReasoning(): AgentRuntimeReasoningResult {
		const values = [...MUSE_NATIVE_REASONING_VALUES];
		// Cycling from unset starts at values[0] ("none"), mirroring Codex; the
		// host default stays in effect until the first explicit cycle pins one.
		const next = this.reasoning ? values[(values.indexOf(this.reasoning as MuseNativeReasoningValue) + 1) % values.length]! : values[0]!;
		return this.setReasoning(next);
	}

	async setModel(model: ModelProfile): Promise<ModelProfile> {
		this.assertUsable();
		if (model.provider !== MUSE_NATIVE_MODEL_PROVIDER_ID) {
			throw new Error(`Muse models use provider "${MUSE_NATIVE_MODEL_PROVIDER_ID}", not "${model.provider}".`);
		}
		const entry = this.catalog.models.find((candidate) => candidate.id === model.id);
		if (!entry) throw new Error(`Muse model "${model.id}" is not in the runtime model catalog.`);
		if (this.connection && this.sessionId) {
			await this.connection.command("session/setModel", {
				sessionId: this.sessionId,
				model: { modelId: model.id, ...(entry.providerId ? { providerId: entry.providerId } : {}) },
			});
		}
		this.model = { ...model };
		this.modelWarning = undefined;
		return { ...this.model };
	}

	dispose(): void {
		this.disposed = true;
		this.connection = undefined;
		this.sessionId = undefined;
	}

	private assertUsable(): void {
		if (this.disposed) throw new Error("Muse session settings are disposed.");
	}
}

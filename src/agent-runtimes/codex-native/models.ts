import type {
	AgentRuntimeContextUsage,
	AgentRuntimeFastModeResult,
	AgentRuntimeModelCatalog,
	AgentRuntimeReasoningResult,
} from "../../agent-runtime/types.js";
import type { PiboJsonObject } from "../../core/events.js";
import { isPiboThinkingLevel, type PiboThinkingLevel } from "../../core/thinking.js";
import type { ModelProfile } from "../../core/profiles.js";
import type { CodexAppServerClient } from "./client.js";
import type {
	CodexAppServerModel,
	CodexAppServerModelListResponse,
	CodexAppServerModelReroutedNotification,
	CodexAppServerThreadSettingsUpdatedNotification,
	CodexAppServerThreadTokenUsageUpdatedNotification,
} from "./protocol-types.js";
import type { CodexNativeThreadConfiguration, CodexNativeThreadSelection } from "./thread.js";

export const CODEX_NATIVE_MODEL_PROVIDER_ID = "openai-codex";
export const CODEX_NATIVE_REASONING_VALUES = ["low", "medium", "high", "xhigh", "max"] as const;

export const CODEX_NATIVE_MODEL_OPTIONS_SCHEMA: PiboJsonObject = {
	type: "object",
	additionalProperties: false,
	properties: {
		serviceTier: {
			type: "string",
			description: "Optional native Codex service tier. Available values are listed in the selected model's options.",
		},
		personality: {
			type: "string",
			enum: ["none", "friendly", "pragmatic"],
			description: "Optional native Codex response personality for models that support personality selection.",
		},
		reasoningSummary: {
			type: "string",
			enum: ["auto", "concise", "detailed", "none"],
			description: "Optional native Codex reasoning-summary mode.",
		},
	},
};

const MAX_MODEL_PAGES = 20;
const MAX_MODEL_COUNT = 500;
const MODEL_PAGE_SIZE = 100;
const MAX_REASONING_OPTIONS = 32;
const MAX_SERVICE_TIERS = 32;
const MAX_INPUT_MODALITIES = 8;
const MAX_PENDING_THREAD_STATES = 8;
const MAX_IDENTIFIER_LENGTH = 256;
const MAX_LABEL_LENGTH = 512;
const MAX_DESCRIPTION_LENGTH = 4_096;
const MAX_CURSOR_LENGTH = 1_024;
const PERSONALITIES = new Set(["none", "friendly", "pragmatic"]);
const REASONING_SUMMARIES = new Set(["auto", "concise", "detailed", "none"]);
const BINDING_MODEL_KEY = "codexNativeModelId";
const BINDING_REASONING_KEY = "codexNativeReasoningEffort";
const BINDING_SERVICE_TIER_KEY = "codexNativeServiceTier";
const BINDING_PERSONALITY_KEY = "codexNativePersonality";
const BINDING_REASONING_SUMMARY_KEY = "codexNativeReasoningSummary";

export type CodexNativeProfileOptions = {
	serviceTier?: string | null;
	personality?: "none" | "friendly" | "pragmatic" | null;
	reasoningSummary?: "auto" | "concise" | "detailed" | "none" | null;
};

export type CodexNativePersistedSettings = {
	activeModel?: ModelProfile;
	reasoningLevel?: string;
	profileOptions: CodexNativeProfileOptions;
};

export type CodexNativeModelCatalog = {
	models: CodexAppServerModel[];
};

export type CodexNativeInitialSettings = {
	activeModel?: ModelProfile;
	reasoningLevel?: string;
	initialFastMode?: boolean;
	profileOptions: CodexNativeProfileOptions;
};

export type CodexNativeTurnModelOptions = {
	model: string;
	effort: string;
	serviceTier: string | null;
	summary?: string | null;
	personality?: string | null;
};

export class CodexNativeModelProtocolError extends Error {
	constructor(message: string) {
		super(message);
		this.name = "CodexNativeModelProtocolError";
	}
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function requiredText(value: unknown, label: string, maxLength = MAX_LABEL_LENGTH): string {
	if (typeof value !== "string") throw new CodexNativeModelProtocolError(`Codex ${label} must be a string.`);
	if (value.length > maxLength) throw new CodexNativeModelProtocolError(`Codex ${label} exceeds ${maxLength} characters.`);
	return value;
}

function requiredString(value: unknown, label: string, maxLength = MAX_IDENTIFIER_LENGTH): string {
	const text = requiredText(value, label, maxLength);
	if (!text.trim()) throw new CodexNativeModelProtocolError(`Codex ${label} must be a non-empty string.`);
	return text;
}

function optionalStringOrNull(value: unknown, label: string): string | null | undefined {
	if (value === undefined) return undefined;
	if (value === null) return null;
	return requiredString(value, label);
}

function requiredBoolean(value: unknown, label: string): boolean {
	if (typeof value !== "boolean") throw new CodexNativeModelProtocolError(`Codex ${label} must be a boolean.`);
	return value;
}

function requiredNonNegativeNumber(value: unknown, label: string): number {
	if (typeof value !== "number" || !Number.isSafeInteger(value) || value < 0) {
		throw new CodexNativeModelProtocolError(`Codex ${label} must be a non-negative safe integer.`);
	}
	return value;
}

function validateModel(value: unknown): CodexAppServerModel {
	if (!isRecord(value)) throw new CodexNativeModelProtocolError("Codex model/list returned an invalid model entry.");
	if (!Array.isArray(value.supportedReasoningEfforts)) {
		throw new CodexNativeModelProtocolError("Codex model/list returned a model without reasoning-effort options.");
	}
	if (value.supportedReasoningEfforts.length > MAX_REASONING_OPTIONS) {
		throw new CodexNativeModelProtocolError(`Codex model/list returned more than ${MAX_REASONING_OPTIONS} reasoning-effort options for one model.`);
	}
	if (value.serviceTiers !== undefined && !Array.isArray(value.serviceTiers)) {
		throw new CodexNativeModelProtocolError("Codex model/list returned invalid service tiers.");
	}
	if (Array.isArray(value.serviceTiers) && value.serviceTiers.length > MAX_SERVICE_TIERS) {
		throw new CodexNativeModelProtocolError(`Codex model/list returned more than ${MAX_SERVICE_TIERS} service tiers for one model.`);
	}
	const supportedReasoningEfforts = value.supportedReasoningEfforts.map((entry, index) => {
		if (!isRecord(entry)) throw new CodexNativeModelProtocolError(`Codex reasoning-effort option ${index} is invalid.`);
		return {
			reasoningEffort: requiredString(entry.reasoningEffort, `reasoning-effort option ${index} id`),
			description: requiredText(entry.description, `reasoning-effort option ${index} description`, MAX_DESCRIPTION_LENGTH),
		};
	});
	if (new Set(supportedReasoningEfforts.map((entry) => entry.reasoningEffort)).size !== supportedReasoningEfforts.length) {
		throw new CodexNativeModelProtocolError("Codex model/list returned duplicate reasoning-effort ids for one model.");
	}
	const serviceTiers = (value.serviceTiers ?? []).map((entry, index) => {
		if (!isRecord(entry)) throw new CodexNativeModelProtocolError(`Codex service-tier option ${index} is invalid.`);
		return {
			id: requiredString(entry.id, `service-tier option ${index} id`),
			name: requiredText(entry.name, `service-tier option ${index} name`),
			description: requiredText(entry.description, `service-tier option ${index} description`, MAX_DESCRIPTION_LENGTH),
		};
	});
	if (new Set(serviceTiers.map((entry) => entry.id)).size !== serviceTiers.length) {
		throw new CodexNativeModelProtocolError("Codex model/list returned duplicate service-tier ids for one model.");
	}
	const defaultReasoningEffort = requiredString(value.defaultReasoningEffort, "default reasoning effort");
	if (!supportedReasoningEfforts.some((entry) => entry.reasoningEffort === defaultReasoningEffort)) {
		throw new CodexNativeModelProtocolError(`Codex model default reasoning effort "${defaultReasoningEffort}" was not advertised by that model.`);
	}
	const defaultServiceTier = optionalStringOrNull(value.defaultServiceTier, "default service tier");
	if (defaultServiceTier && !serviceTiers.some((entry) => entry.id === defaultServiceTier)) {
		throw new CodexNativeModelProtocolError(`Codex model default service tier "${defaultServiceTier}" was not advertised by that model.`);
	}
	let inputModalities = ["text", "image"];
	if (value.inputModalities !== undefined) {
		if (!Array.isArray(value.inputModalities)) throw new CodexNativeModelProtocolError("Codex model input modalities must be an array.");
		if (value.inputModalities.length > MAX_INPUT_MODALITIES) {
			throw new CodexNativeModelProtocolError(`Codex model input modalities exceed ${MAX_INPUT_MODALITIES} entries.`);
		}
		inputModalities = value.inputModalities.map((entry, index) => requiredString(entry, `input modality ${index}`));
	}
	if (value.supportsPersonality !== undefined && typeof value.supportsPersonality !== "boolean") {
		throw new CodexNativeModelProtocolError("Codex model personality support must be a boolean.");
	}
	return {
		id: requiredString(value.id, "model id"),
		model: requiredString(value.model, "model backend id"),
		displayName: requiredText(value.displayName, "model display name"),
		description: requiredText(value.description, "model description", MAX_DESCRIPTION_LENGTH),
		hidden: requiredBoolean(value.hidden, "model hidden flag"),
		isDefault: requiredBoolean(value.isDefault, "model default flag"),
		supportedReasoningEfforts,
		defaultReasoningEffort,
		serviceTiers,
		...(defaultServiceTier !== undefined ? { defaultServiceTier } : {}),
		inputModalities,
		...(value.supportsPersonality !== undefined ? { supportsPersonality: value.supportsPersonality } : {}),
		...(typeof value.modelSpecialty === "string" || value.modelSpecialty === null ? { modelSpecialty: value.modelSpecialty } : {}),
		...(typeof value.upgrade === "string" || value.upgrade === null ? { upgrade: value.upgrade } : {}),
	};
}

function validateModelListResponse(value: unknown): CodexAppServerModelListResponse {
	if (!isRecord(value) || !Array.isArray(value.data)) {
		throw new CodexNativeModelProtocolError("Codex model/list returned an invalid response.");
	}
	if (value.data.length > MAX_MODEL_COUNT) {
		throw new CodexNativeModelProtocolError(`Codex model/list returned more than ${MAX_MODEL_COUNT} entries in one page.`);
	}
	const nextCursor = value.nextCursor === undefined || value.nextCursor === null
		? value.nextCursor
		: requiredString(value.nextCursor, "model/list next cursor", MAX_CURSOR_LENGTH);
	return {
		data: value.data.map(validateModel),
		...(nextCursor !== undefined ? { nextCursor } : {}),
	};
}

export async function readCodexNativeModelCatalog(client: CodexAppServerClient): Promise<CodexNativeModelCatalog> {
	const models: CodexAppServerModel[] = [];
	const modelIds = new Set<string>();
	const cursors = new Set<string>();
	let cursor: string | null | undefined;
	for (let page = 0; page < MAX_MODEL_PAGES; page++) {
		const response = validateModelListResponse(await client.request<unknown>("model/list", {
			cursor: cursor ?? null,
			limit: MODEL_PAGE_SIZE,
			includeHidden: false,
		}));
		for (const model of response.data) {
			if (model.hidden) continue;
			if (modelIds.has(model.id)) throw new CodexNativeModelProtocolError(`Codex model/list returned duplicate model id "${model.id}".`);
			modelIds.add(model.id);
			models.push(model);
			if (models.length > MAX_MODEL_COUNT) throw new CodexNativeModelProtocolError(`Codex model/list exceeded ${MAX_MODEL_COUNT} visible models.`);
		}
		cursor = response.nextCursor;
		if (!cursor) break;
		if (cursors.has(cursor)) throw new CodexNativeModelProtocolError("Codex model/list repeated a pagination cursor.");
		cursors.add(cursor);
		if (page === MAX_MODEL_PAGES - 1) throw new CodexNativeModelProtocolError(`Codex model/list exceeded ${MAX_MODEL_PAGES} pages.`);
	}
	if (models.length === 0) throw new CodexNativeModelProtocolError("Codex model/list returned no visible models.");
	return { models };
}

function modelOptions(model: CodexAppServerModel): PiboJsonObject {
	return {
		providerDisplayName: "OpenAI Codex",
		backendModel: model.model,
		description: model.description,
		isDefault: model.isDefault,
		defaultReasoningEffort: model.defaultReasoningEffort,
		nativeReasoningEfforts: model.supportedReasoningEfforts.map((entry) => ({
			id: entry.reasoningEffort,
			description: entry.description,
		})),
		serviceTiers: model.serviceTiers.map((entry) => ({
			id: entry.id,
			name: entry.name,
			description: entry.description,
		})),
		defaultServiceTier: model.defaultServiceTier ?? null,
		inputModalities: model.inputModalities ?? [],
		supportsPersonality: model.supportsPersonality ?? false,
		...(model.modelSpecialty !== undefined ? { modelSpecialty: model.modelSpecialty } : {}),
		...(model.upgrade !== undefined ? { upgrade: model.upgrade } : {}),
	};
}

export function toAgentRuntimeModelCatalog(
	runtimeInstanceId: string,
	catalog: CodexNativeModelCatalog,
): AgentRuntimeModelCatalog {
	return {
		runtimeInstanceId,
		models: catalog.models.map((model) => ({
			provider: CODEX_NATIVE_MODEL_PROVIDER_ID,
			id: model.id,
			displayName: model.displayName,
			reasoningOptions: modelControlReasoningValues(model),
			options: modelOptions(model),
		})),
	};
}

export function readCodexNativePersistedSettings(metadata: PiboJsonObject | undefined): CodexNativePersistedSettings {
	const profileOptions: CodexNativeProfileOptions = {};
	if (!metadata) return { profileOptions };
	const modelId = typeof metadata[BINDING_MODEL_KEY] === "string"
		&& metadata[BINDING_MODEL_KEY].length <= MAX_IDENTIFIER_LENGTH
		&& metadata[BINDING_MODEL_KEY].trim()
		? metadata[BINDING_MODEL_KEY]
		: undefined;
	const reasoningLevel = typeof metadata[BINDING_REASONING_KEY] === "string"
		&& metadata[BINDING_REASONING_KEY].length <= MAX_IDENTIFIER_LENGTH
		&& metadata[BINDING_REASONING_KEY].trim()
		? metadata[BINDING_REASONING_KEY]
		: undefined;
	const serviceTier = metadata[BINDING_SERVICE_TIER_KEY];
	if (serviceTier === null || (typeof serviceTier === "string" && serviceTier.length <= MAX_IDENTIFIER_LENGTH && serviceTier.trim())) {
		profileOptions.serviceTier = serviceTier;
	}
	const personality = metadata[BINDING_PERSONALITY_KEY];
	if (personality === null || (typeof personality === "string" && PERSONALITIES.has(personality))) {
		profileOptions.personality = personality as CodexNativeProfileOptions["personality"];
	}
	const reasoningSummary = metadata[BINDING_REASONING_SUMMARY_KEY];
	if (reasoningSummary === null || (typeof reasoningSummary === "string" && REASONING_SUMMARIES.has(reasoningSummary))) {
		profileOptions.reasoningSummary = reasoningSummary as CodexNativeProfileOptions["reasoningSummary"];
	}
	return {
		...(modelId ? { activeModel: { provider: CODEX_NATIVE_MODEL_PROVIDER_ID, id: modelId } } : {}),
		...(reasoningLevel ? { reasoningLevel } : {}),
		profileOptions,
	};
}

export function parseCodexNativeProfileOptions(value: PiboJsonObject): CodexNativeProfileOptions {
	const allowed = new Set(["serviceTier", "personality", "reasoningSummary"]);
	const unknown = Object.keys(value).filter((key) => !allowed.has(key));
	if (unknown.length > 0) throw new Error(`Unsupported native Codex runtime option${unknown.length === 1 ? "" : "s"}: ${unknown.join(", ")}.`);
	const options: CodexNativeProfileOptions = {};
	if (Object.hasOwn(value, "serviceTier")) {
		if (typeof value.serviceTier !== "string" || !value.serviceTier.trim()) {
			throw new Error("Native Codex runtime option serviceTier must be a non-empty string.");
		}
		if (value.serviceTier.length > MAX_IDENTIFIER_LENGTH) {
			throw new Error(`Native Codex runtime option serviceTier exceeds ${MAX_IDENTIFIER_LENGTH} characters.`);
		}
		options.serviceTier = value.serviceTier.trim();
	}
	if (Object.hasOwn(value, "personality")) {
		if (typeof value.personality !== "string" || !PERSONALITIES.has(value.personality)) {
			throw new Error("Native Codex runtime option personality must be one of: none, friendly, pragmatic.");
		}
		options.personality = value.personality as CodexNativeProfileOptions["personality"];
	}
	if (Object.hasOwn(value, "reasoningSummary")) {
		if (typeof value.reasoningSummary !== "string" || !REASONING_SUMMARIES.has(value.reasoningSummary)) {
			throw new Error("Native Codex runtime option reasoningSummary must be one of: auto, concise, detailed, none.");
		}
		options.reasoningSummary = value.reasoningSummary as CodexNativeProfileOptions["reasoningSummary"];
	}
	return options;
}

function findModel(catalog: CodexNativeModelCatalog, value: string): CodexAppServerModel | undefined {
	return catalog.models.find((model) => model.id === value || model.model === value);
}

function selectedModel(catalog: CodexNativeModelCatalog, requested: ModelProfile | undefined): CodexAppServerModel {
	if (requested && requested.provider !== CODEX_NATIVE_MODEL_PROVIDER_ID) {
		throw new Error(`Native Codex models use provider "${CODEX_NATIVE_MODEL_PROVIDER_ID}", not "${requested.provider}".`);
	}
	if (requested) {
		const model = catalog.models.find((entry) => entry.id === requested.id);
		if (!model) throw new Error(`Native Codex model "${requested.id}" is not available.`);
		return model;
	}
	return catalog.models.find((model) => model.isDefault) ?? catalog.models[0];
}

function modelReasoningValues(model: CodexAppServerModel): string[] {
	return model.supportedReasoningEfforts.map((entry) => entry.reasoningEffort);
}

function modelControlReasoningValues(model: CodexAppServerModel): PiboThinkingLevel[] {
	return modelReasoningValues(model).filter(
		(value): value is PiboThinkingLevel => isPiboThinkingLevel(value)
			&& (CODEX_NATIVE_REASONING_VALUES as readonly string[]).includes(value),
	);
}

function validateReasoning(model: CodexAppServerModel, value: string): string {
	if (!modelReasoningValues(model).includes(value)) {
		throw new Error(`Native Codex model "${model.id}" does not support reasoning effort "${value}".`);
	}
	return value;
}

function validateServiceTier(model: CodexAppServerModel, value: string | null): string | null {
	if (value !== null && !model.serviceTiers.some((entry) => entry.id === value)) {
		throw new Error(`Native Codex model "${model.id}" does not support service tier "${value}".`);
	}
	return value;
}

function normalizeNativeServiceTier(model: CodexAppServerModel, value: string | null): string | null {
	return value === "default" ? null : validateServiceTier(model, value);
}

function validatePersonality(model: CodexAppServerModel, value: CodexNativeProfileOptions["personality"]): void {
	if (value && value !== "none" && !model.supportsPersonality) {
		throw new Error(`Native Codex model "${model.id}" does not support personality selection.`);
	}
}

function setBoundedPending<T>(map: Map<string, T>, threadId: string, value: T): void {
	if (!map.has(threadId) && map.size >= MAX_PENDING_THREAD_STATES) {
		const oldest = map.keys().next().value;
		if (oldest !== undefined) map.delete(oldest);
	}
	map.set(threadId, value);
}

function parseContextUsage(value: CodexAppServerThreadTokenUsageUpdatedNotification): AgentRuntimeContextUsage {
	if (!isRecord(value.tokenUsage) || !isRecord(value.tokenUsage.total)) {
		throw new CodexNativeModelProtocolError("Codex token-usage notification is missing total usage.");
	}
	const total = value.tokenUsage.total;
	const tokens = requiredNonNegativeNumber(total.totalTokens, "total token usage");
	const contextWindow = value.tokenUsage.modelContextWindow === undefined || value.tokenUsage.modelContextWindow === null
		? undefined
		: requiredNonNegativeNumber(value.tokenUsage.modelContextWindow, "model context window");
	return {
		tokens,
		...(contextWindow !== undefined ? {
			contextWindow,
			...(contextWindow > 0 ? { percent: (tokens / contextWindow) * 100 } : {}),
		} : {}),
	};
}

export class CodexNativeSessionSettingsController {
	private currentModel: CodexAppServerModel;
	private reasoningLevel: string;
	private reasoningExplicit: boolean;
	private serviceTier: string | null;
	private readonly personality?: CodexNativeProfileOptions["personality"];
	private readonly reasoningSummary?: CodexNativeProfileOptions["reasoningSummary"];
	private activeThreadId?: string;
	private contextUsage?: AgentRuntimeContextUsage;
	private readonly pendingContextUsage = new Map<string, AgentRuntimeContextUsage>();
	private readonly pendingThreadSettings = new Map<string, CodexAppServerThreadSettingsUpdatedNotification>();
	private readonly pendingModelReroutes = new Map<string, CodexAppServerModelReroutedNotification>();
	private readonly unsubscribe: () => void;

	constructor(
		client: CodexAppServerClient,
		private readonly catalog: CodexNativeModelCatalog,
		initial: CodexNativeInitialSettings,
	) {
		this.currentModel = selectedModel(catalog, initial.activeModel);
		this.reasoningExplicit = initial.reasoningLevel !== undefined;
		this.reasoningLevel = validateReasoning(
			this.currentModel,
			initial.reasoningLevel ?? this.currentModel.defaultReasoningEffort,
		);
		validatePersonality(this.currentModel, initial.profileOptions.personality);
		const selectedTier = initial.initialFastMode
			? "priority"
			: initial.profileOptions.serviceTier !== undefined
				? initial.profileOptions.serviceTier
				: this.currentModel.defaultServiceTier ?? null;
		this.serviceTier = validateServiceTier(this.currentModel, selectedTier);
		this.personality = initial.profileOptions.personality;
		this.reasoningSummary = initial.profileOptions.reasoningSummary;
		this.unsubscribe = client.subscribeNotifications((notification) => this.handleNotification(notification));
	}

	attachThread(threadId: string, configuration: CodexNativeThreadConfiguration): void {
		this.activeThreadId = threadId;
		const configuredModel = findModel(this.catalog, configuration.model);
		if (!configuredModel) throw new CodexNativeModelProtocolError(`Codex selected unadvertised model "${configuration.model}".`);
		this.applyNativeModel(configuredModel);
		if (!this.reasoningExplicit && configuration.reasoningEffort) {
			this.reasoningLevel = validateReasoning(this.currentModel, configuration.reasoningEffort);
		}
		if (configuration.serviceTier !== undefined) {
			this.serviceTier = normalizeNativeServiceTier(this.currentModel, configuration.serviceTier ?? null);
		}
		const pendingSettings = this.pendingThreadSettings.get(threadId);
		if (pendingSettings) this.applyThreadSettings(pendingSettings);
		const pendingReroute = this.pendingModelReroutes.get(threadId);
		if (pendingReroute) this.applyModelReroute(pendingReroute);
		const pendingContext = this.pendingContextUsage.get(threadId);
		if (pendingContext) this.contextUsage = pendingContext;
		this.pendingThreadSettings.clear();
		this.pendingModelReroutes.clear();
		this.pendingContextUsage.clear();
	}

	get activeModel(): ModelProfile {
		return { provider: CODEX_NATIVE_MODEL_PROVIDER_ID, id: this.currentModel.id };
	}

	get reasoning(): AgentRuntimeReasoningResult {
		const availableValues = modelControlReasoningValues(this.currentModel);
		return {
			value: this.reasoningLevel,
			availableValues,
			supported: availableValues.length > 0,
		};
	}

	get fastMode(): AgentRuntimeFastModeResult {
		return {
			mode: this.serviceTier === "priority" ? "fast" : "normal",
			supported: this.currentModel.serviceTiers.some((entry) => entry.id === "priority"),
		};
	}

	get currentContextUsage(): AgentRuntimeContextUsage | undefined {
		return this.contextUsage ? structuredClone(this.contextUsage) : undefined;
	}

	get bindingMetadata(): PiboJsonObject {
		return {
			[BINDING_MODEL_KEY]: this.currentModel.id,
			[BINDING_REASONING_KEY]: this.reasoningLevel,
			[BINDING_SERVICE_TIER_KEY]: this.serviceTier,
			[BINDING_PERSONALITY_KEY]: this.personality ?? null,
			[BINDING_REASONING_SUMMARY_KEY]: this.reasoningSummary ?? null,
		};
	}

	get threadSelection(): CodexNativeThreadSelection {
		return {
			model: this.currentModel.id,
			serviceTier: this.serviceTier,
			...(this.personality !== undefined ? { personality: this.personality } : {}),
		};
	}

	get turnOptions(): CodexNativeTurnModelOptions {
		return {
			model: this.currentModel.id,
			effort: this.reasoningLevel,
			serviceTier: this.serviceTier,
			...(this.reasoningSummary !== undefined ? { summary: this.reasoningSummary } : {}),
			...(this.personality !== undefined ? { personality: this.personality } : {}),
		};
	}

	setModel(model: ModelProfile): ModelProfile {
		const next = selectedModel(this.catalog, model);
		validatePersonality(next, this.personality);
		this.applyNativeModel(next);
		return this.activeModel;
	}

	setReasoning(level: string): AgentRuntimeReasoningResult {
		if (!isPiboThinkingLevel(level) || !(CODEX_NATIVE_REASONING_VALUES as readonly string[]).includes(level)) {
			throw new Error(`Pibo cannot select native Codex reasoning effort "${level}".`);
		}
		this.reasoningLevel = validateReasoning(this.currentModel, level);
		this.reasoningExplicit = true;
		return this.reasoning;
	}

	cycleReasoning(): AgentRuntimeReasoningResult {
		const values = modelControlReasoningValues(this.currentModel);
		if (values.length === 0) return this.reasoning;
		const currentIndex = values.indexOf(this.reasoningLevel as PiboThinkingLevel);
		this.reasoningLevel = values[(currentIndex + 1 + values.length) % values.length];
		this.reasoningExplicit = true;
		return this.reasoning;
	}

	setFastMode(enabled: boolean): AgentRuntimeFastModeResult {
		const supported = this.currentModel.serviceTiers.some((entry) => entry.id === "priority");
		if (enabled && !supported) return { ...this.fastMode, changed: false };
		const nextTier = enabled ? "priority" : this.currentModel.defaultServiceTier ?? null;
		const changed = this.serviceTier !== nextTier;
		this.serviceTier = nextTier;
		return { ...this.fastMode, changed };
	}

	dispose(): void {
		this.unsubscribe();
		this.pendingContextUsage.clear();
		this.pendingThreadSettings.clear();
		this.pendingModelReroutes.clear();
	}

	private applyNativeModel(model: CodexAppServerModel): void {
		const reasoning = modelReasoningValues(model).includes(this.reasoningLevel)
			? this.reasoningLevel
			: model.defaultReasoningEffort;
		const tier = this.serviceTier === null || model.serviceTiers.some((entry) => entry.id === this.serviceTier)
			? this.serviceTier
			: model.defaultServiceTier ?? null;
		validatePersonality(model, this.personality);
		this.currentModel = model;
		this.reasoningLevel = validateReasoning(model, reasoning);
		this.serviceTier = validateServiceTier(model, tier);
	}

	private handleNotification(notification: { method: string; params?: unknown }): void {
		if (notification.method === "thread/tokenUsage/updated") {
			if (!isRecord(notification.params)) throw new CodexNativeModelProtocolError("Codex token-usage notification is invalid.");
			const threadId = requiredString(notification.params.threadId, "token-usage thread id");
			const usage = parseContextUsage(notification.params as unknown as CodexAppServerThreadTokenUsageUpdatedNotification);
			if (threadId === this.activeThreadId) this.contextUsage = usage;
			else setBoundedPending(this.pendingContextUsage, threadId, usage);
			return;
		}
		if (notification.method === "thread/settings/updated") {
			if (!isRecord(notification.params) || !isRecord(notification.params.threadSettings)) {
				throw new CodexNativeModelProtocolError("Codex thread-settings notification is invalid.");
			}
			const update = notification.params as unknown as CodexAppServerThreadSettingsUpdatedNotification;
			const threadId = requiredString(update.threadId, "thread-settings thread id");
			if (threadId === this.activeThreadId) this.applyThreadSettings(update);
			else setBoundedPending(this.pendingThreadSettings, threadId, update);
			return;
		}
		if (notification.method === "model/rerouted") {
			if (!isRecord(notification.params)) throw new CodexNativeModelProtocolError("Codex model-rerouted notification is invalid.");
			const reroute = notification.params as unknown as CodexAppServerModelReroutedNotification;
			const threadId = requiredString(reroute.threadId, "model-rerouted thread id");
			if (threadId === this.activeThreadId) this.applyModelReroute(reroute);
			else setBoundedPending(this.pendingModelReroutes, threadId, reroute);
		}
	}

	private applyThreadSettings(update: CodexAppServerThreadSettingsUpdatedNotification): void {
		const settings = update.threadSettings;
		const modelId = requiredString(settings.model, "thread-settings model");
		const model = findModel(this.catalog, modelId);
		if (!model) throw new CodexNativeModelProtocolError(`Codex selected unadvertised model "${modelId}".`);
		this.applyNativeModel(model);
		if (settings.effort !== undefined) {
			this.reasoningLevel = settings.effort === null
				? model.defaultReasoningEffort
				: validateReasoning(model, requiredString(settings.effort, "thread-settings reasoning effort"));
		}
		if (settings.serviceTier !== undefined) {
			this.serviceTier = normalizeNativeServiceTier(model, optionalStringOrNull(settings.serviceTier, "thread-settings service tier") ?? null);
		}
	}

	private applyModelReroute(reroute: CodexAppServerModelReroutedNotification): void {
		const targetId = requiredString(reroute.toModel, "rerouted model id");
		const model = findModel(this.catalog, targetId);
		if (!model) throw new CodexNativeModelProtocolError(`Codex rerouted to unadvertised model "${targetId}".`);
		this.applyNativeModel(model);
	}
}

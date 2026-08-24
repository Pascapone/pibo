import type { Static, TSchema } from "typebox";
import type { PiboJsonObject, PiboJsonValue, PiboMessageEvent } from "../core/events.js";

/** JSON-Schema input accepted by a Pibo-managed tool. */
export type PiboToolInputSchema = TSchema;

export type PiboToolTextContent = {
	type: "text";
	text: string;
};

export type PiboToolImageContent = {
	type: "image";
	mimeType: string;
	/** Inline base64 image data. */
	data?: string;
	/** Durable Pibo payload reference used when the image is not inlined. */
	payloadRef?: string;
	alt?: string;
};

export type PiboToolContent = PiboToolTextContent | PiboToolImageContent;

/** Harness-neutral result returned by every Pibo-managed tool. */
export type PiboToolResult<TDetails = unknown> = {
	content: PiboToolContent[];
	structuredContent?: PiboJsonValue;
	details?: TDetails;
	isError?: boolean;
	payloadRefs?: string[];
	metadata?: PiboJsonObject;
};

/** Incremental update emitted while a Pibo-managed tool is running. */
export type PiboToolProgress<TDetails = unknown> = PiboToolResult<TDetails> & {
	progress?: number;
	total?: number;
	message?: string;
};

export type PiboToolUpdateCallback<TDetails = unknown> = (update: PiboToolProgress<TDetails>) => void;

/** Session-owned context available to portable tool factories and executions. */
export type PiboToolDefinitionContext = {
	piboSessionId?: string;
	piboRoomId?: string;
	profileName?: string;
	cwd?: string;
	getActiveMessage?: () => Pick<PiboMessageEvent, "id" | "source" | "provenance"> | undefined;
	/** Adapter-neutral conversation entries for tools that inspect recent content. */
	getConversationEntries?: () => readonly unknown[];
};

/** Runtime scope injected by the direct compiler or session-scoped MCP bridge. */
export type PiboToolExecutionContext = Omit<PiboToolDefinitionContext, "cwd"> & {
	cwd: string;
	runtimeInstanceId?: string;
	adapterId?: string;
	sessionGeneration?: string;
	/** Present only while a tool executes inside pibo_run_start. */
	yieldedRunId?: string;
	/** Adapter-private compatibility context. Portable tools must not depend on this field. */
	nativeContext?: unknown;
};

export type PiboToolAnnotations = {
	readOnly?: boolean;
	destructive?: boolean;
	idempotent?: boolean;
	openWorld?: boolean;
};

/** Pibo-owned, JSON-Schema-based tool definition. */
export interface PiboToolDefinition<
	TInputSchema extends PiboToolInputSchema = PiboToolInputSchema,
	TDetails = unknown,
> {
	name: string;
	title: string;
	/** @deprecated Compatibility alias for title. */
	label?: string;
	description: string;
	promptSnippet?: string;
	promptGuidelines?: string[];
	inputSchema: TInputSchema;
	/** Optional JSON Schema for structuredContent. */
	outputSchema?: PiboToolInputSchema;
	/** @deprecated Compatibility alias for inputSchema. */
	parameters?: TInputSchema;
	executionMode?: "sequential" | "parallel";
	annotations?: PiboToolAnnotations;
	/** False only for legacy harness-private compatibility definitions. Defaults to true. */
	portable?: boolean;
	prepareInput?: (input: unknown) => Static<TInputSchema>;
	execute(
		toolCallId: string,
		input: Static<TInputSchema>,
		signal: AbortSignal | undefined,
		onUpdate: PiboToolUpdateCallback<TDetails> | undefined,
		context: PiboToolExecutionContext,
	): Promise<PiboToolResult<TDetails>>;
}

/** Identity helper that preserves schema-derived input types. */
export function definePiboTool<
	TInputSchema extends PiboToolInputSchema,
	TDetails = unknown,
>(definition: PiboToolDefinition<TInputSchema, TDetails>): PiboToolDefinition<TInputSchema, TDetails> {
	definition.label ??= definition.title;
	definition.parameters ??= definition.inputSchema;
	return definition;
}

/**
 * Structural shape of the pre-runtime-adapter Pi tool boundary.
 *
 * It deliberately does not import Pi packages. Registries normalize this shape
 * into a non-portable Pibo definition so existing plugin registrations continue
 * to run through the Pi compiler during the compatibility period.
 */
export interface LegacyPiToolDefinitionLike<
	TInputSchema extends PiboToolInputSchema = PiboToolInputSchema,
	TDetails = unknown,
> {
	name: string;
	label: string;
	description: string;
	promptSnippet?: string;
	promptGuidelines?: string[];
	parameters: TInputSchema;
	executionMode?: "sequential" | "parallel";
	prepareArguments?: (input: unknown) => Static<TInputSchema>;
	execute(
		toolCallId: string,
		input: Static<TInputSchema>,
		signal: AbortSignal | undefined,
		onUpdate: ((update: LegacyPiToolResultLike<TDetails>) => void) | undefined,
		context: unknown,
	): Promise<LegacyPiToolResultLike<TDetails>>;
}

export type LegacyPiToolResultLike<TDetails = unknown> = {
	content: Array<
		| { type: "text"; text: string }
		| { type: "image"; data: string; mimeType: string }
	>;
	details?: TDetails;
	isError?: boolean;
};

export function isPiboToolDefinition(value: unknown): value is PiboToolDefinition {
	return Boolean(
		value
		&& typeof value === "object"
		&& "inputSchema" in value
		&& "execute" in value
		&& typeof (value as { execute?: unknown }).execute === "function",
	);
}

export function normalizePiboToolResult<TDetails>(result: LegacyPiToolResultLike<TDetails>): PiboToolResult<TDetails> {
	return {
		content: result.content.map((content) => ({ ...content })),
		...(result.details !== undefined ? { details: result.details } : {}),
		...(result.isError !== undefined ? { isError: result.isError } : {}),
	};
}

/** Convert a legacy Pi-shaped definition without leaking Pi types into generic code. */
export function normalizePiboToolDefinition<
	TInputSchema extends PiboToolInputSchema,
	TDetails = unknown,
>(definition: PiboToolDefinition<TInputSchema, TDetails> | LegacyPiToolDefinitionLike<TInputSchema, TDetails>): PiboToolDefinition<TInputSchema, TDetails> {
	if (isPiboToolDefinition(definition)) return definition as PiboToolDefinition<TInputSchema, TDetails>;

	return definePiboTool({
		name: definition.name,
		title: definition.label,
		description: definition.description,
		...(definition.promptSnippet ? { promptSnippet: definition.promptSnippet } : {}),
		...(definition.promptGuidelines ? { promptGuidelines: [...definition.promptGuidelines] } : {}),
		inputSchema: definition.parameters,
		...(definition.executionMode ? { executionMode: definition.executionMode } : {}),
		portable: false,
		...(definition.prepareArguments ? { prepareInput: definition.prepareArguments } : {}),
		async execute(toolCallId, input, signal, onUpdate, context) {
			if (context.nativeContext === undefined) {
				throw new Error(
					`Tool "${definition.name}" uses the deprecated Pi-native definition contract and cannot be delivered through portable MCP.`,
				);
			}
			const result = await definition.execute(
				toolCallId,
				input,
				signal,
				onUpdate
					? (update) => onUpdate(normalizePiboToolResult(update))
					: undefined,
				context.nativeContext,
			);
			return normalizePiboToolResult(result);
		},
	});
}

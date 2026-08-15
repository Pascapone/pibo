import { StringEnum, Type } from '@earendil-works/pi-ai';
import { defineTool, type ToolDefinition } from '@earendil-works/pi-coding-agent';
import type { ToolDefinitionContext } from '../core/profiles.js';
import { goalActiveTimeSeconds, goalCanStartNextTurn, goalElapsedWallClockSeconds, goalRemainingTokens } from './accounting.js';
import { createDefaultPiboLoopStore, type PiboLoopStore } from './store.js';
import type { PiboGoalStatus, PiboLoopJob } from './types.js';

export const PIBO_GOAL_TOOL_NAMES = ['get_goal', 'create_goal', 'update_goal'] as const;

export type PiboGoalToolOptions = {
	store?: PiboLoopStore;
};

let configuredStorePath: string | undefined;

export function configurePiboGoalToolStorePath(path: string | undefined): void {
	configuredStorePath = path;
}

type CreateGoalParams = { objective?: string; token_budget?: number; token_reserve?: number };
type UpdateGoalParams = { status?: string };

function toolResult(value: unknown, isError = false) {
	return {
		content: [{ type: 'text' as const, text: JSON.stringify(value, null, 2) }],
		details: value,
		...(isError ? { isError: true } : {}),
	};
}

function errorResult(error: unknown) {
	return toolResult({ ok: false, error: error instanceof Error ? error.message : String(error) }, true);
}

function requireSessionContext(context: ToolDefinitionContext): { piboSessionId: string; piboRoomId?: string; profileName: string } {
	const piboSessionId = context.piboSessionId?.trim();
	if (!piboSessionId) throw new Error('Goal tools require the current Pibo Session ID');
	return {
		piboSessionId,
		piboRoomId: context.piboRoomId?.trim() || undefined,
		profileName: context.profileName?.trim() || 'base',
	};
}

function resolveGoalForTurn(store: PiboLoopStore, context: ToolDefinitionContext, piboSessionId: string): PiboLoopJob | undefined {
	const activeMessage = context.getActiveMessage?.();
	const provenance = activeMessage?.provenance;
	if (provenance?.kind !== 'loop-run') return store.getSessionGoalOwner(piboSessionId) ?? store.getLatestGoalForSession(piboSessionId);
	const run = store.getRun(provenance.runId);
	const expectedEventId = provenance.cause === 'run-reminder' ? provenance.rootEventId : activeMessage?.id;
	const validReminder = provenance.cause !== 'run-reminder' || (activeMessage?.source === 'service' && typeof provenance.rootEventId === 'string');
	if (!run || !validReminder || run.jobId !== provenance.jobId || run.piboSessionId !== piboSessionId || run.messageEventId !== expectedEventId) {
		throw new Error('cannot resolve goal because this turn has stale or invalid Loop provenance');
	}
	const job = store.getJob(provenance.jobId);
	if (!job || job.mode !== 'goal') throw new Error('cannot resolve goal because the originating Goal no longer exists');
	return job;
}

function requireExplicitGoalCreationAuthority(context: ToolDefinitionContext): void {
	const activeMessage = context.getActiveMessage?.();
	if (!activeMessage) return;
	if (activeMessage.provenance?.kind === 'loop-run') throw new Error('automatic Loop continuations cannot create replacement goals');
	if (activeMessage.source !== 'user' && activeMessage.source !== 'ui' && activeMessage.source !== 'actor') {
		throw new Error('create_goal requires a fresh explicit user or actor turn');
	}
}

function positiveInteger(value: number | undefined, field: string): number | undefined {
	if (value === undefined) return undefined;
	if (!Number.isInteger(value) || value < 1) throw new Error(`${field} must be a positive integer`);
	return value;
}
function nonNegativeInteger(value: number | undefined, field: string): number | undefined {
	if (value === undefined) return undefined;
	if (!Number.isInteger(value) || value < 0) throw new Error(`${field} must be a non-negative integer`);
	return value;
}

function goalPayload(job: PiboLoopJob) {
	const tokenBudget = job.tokenBudget;
	return {
		goalId: job.id,
		objective: job.prompt,
		status: effectiveGoalStatus(job),
		budgetType: tokenBudget === undefined ? 'unbounded' : 'soft',
		tokenBudget: tokenBudget ?? null,
		tokenReserve: job.tokenReserve ?? 0,
		tokensUsed: job.state.tokensUsed ?? 0,
		remainingTokens: goalRemainingTokens(job) ?? null,
		canStartNextTurn: goalCanStartNextTurn(job),
		activeAgentTimeSeconds: goalActiveTimeSeconds(job),
		elapsedWallClockSeconds: goalElapsedWallClockSeconds(job),
		goalStartedAt: job.state.goalStartedAt ?? null,
		goalEndedAt: job.state.goalEndedAt ?? null,
		nextAttemptAt: job.state.nextAttemptAt ?? null,
		failure: job.state.lastFailure ?? null,
		wallClockIncludesPausedTime: true,
	};
}

function effectiveGoalStatus(job: PiboLoopJob): PiboGoalStatus {
	return job.state.goalStatus ?? (job.enabled ? 'active' : 'paused');
}

async function withStore<T>(options: PiboGoalToolOptions, action: (store: PiboLoopStore) => T | Promise<T>): Promise<T> {
	if (options.store) return await action(options.store);
	const store = createDefaultPiboLoopStore({ path: configuredStorePath });
	try {
		return await action(store);
	} finally {
		store.close();
	}
}

function createGetGoalTool(context: ToolDefinitionContext, options: PiboGoalToolOptions): ToolDefinition {
	return defineTool({
		name: 'get_goal',
		label: 'Get Goal',
		description: 'Get the current goal for this Pibo Session, including soft-budget risk, per-turn reserve, active agent time, and wall-clock elapsed time.',
		promptSnippet: 'Use get_goal when you need the authoritative persisted status or accounting for the current Pibo Session goal.',
		parameters: Type.Object({}),
		async execute() {
			try {
				const { piboSessionId } = requireSessionContext(context);
				return await withStore(options, (store) => {
					const job = resolveGoalForTurn(store, context, piboSessionId);
					return toolResult({ ok: true, goal: job ? goalPayload(job) : null });
				});
			} catch (error) {
				return errorResult(error);
			}
		},
	});
}

function createCreateGoalTool(context: ToolDefinitionContext, options: PiboGoalToolOptions): ToolDefinition {
	return defineTool({
		name: 'create_goal',
		label: 'Create Goal',
		description: 'Create an active persisted Goal Loop for this Pibo Session only when explicitly requested. Fails while this session already has an unfinished goal.',
		promptSnippet: 'Call create_goal only when the user or system explicitly requests a persistent goal. Do not infer a goal from an ordinary task.',
		parameters: Type.Object({
			objective: Type.String({ description: 'Concrete objective to pursue across automatic continuations.' }),
			token_budget: Type.Optional(Type.Number({ description: 'Optional soft token budget. Usage arrives after each model response, so the final turn can overshoot.' })),
			token_reserve: Type.Optional(Type.Number({ description: 'Optional non-negative minimum remaining tokens required before Pibo starts another turn.' })),
		}),
		async execute(_toolCallId, params: CreateGoalParams) {
			try {
				const session = requireSessionContext(context);
				requireExplicitGoalCreationAuthority(context);
				const objective = params.objective?.trim();
				if (!objective) throw new Error('objective is required');
				const tokenBudget = positiveInteger(params.token_budget, 'token_budget');
				const tokenReserve = nonNegativeInteger(params.token_reserve, 'token_reserve');
				return await withStore(options, (store) => {
					const job = store.createSessionGoal({
						target: session.piboRoomId ? { kind: 'room', roomId: session.piboRoomId } : { kind: 'default-chat' },
						profile: session.profileName,
						prompt: objective,
						tokenBudget,
						tokenReserve,
						initialPiboSessionId: session.piboSessionId,
					});
					return toolResult({ ok: true, goal: goalPayload(job) });
				});
			} catch (error) {
				return errorResult(error);
			}
		},
	});
}

function createUpdateGoalTool(context: ToolDefinitionContext, options: PiboGoalToolOptions): ToolDefinition {
	return defineTool({
		name: 'update_goal',
		label: 'Update Goal',
		description: 'Mark the current goal complete or genuinely blocked. Complete requires verified achievement. Blocked requires the same impasse for at least three consecutive goal turns.',
		promptSnippet: 'Use update_goal only with status complete after a requirement-by-requirement completion audit, or blocked after the strict repeated-blocker audit.',
		parameters: Type.Object({
			status: StringEnum(['complete', 'blocked'], { description: 'Terminal status for the current goal.' }),
		}),
		async execute(_toolCallId, params: UpdateGoalParams) {
			try {
				const { piboSessionId } = requireSessionContext(context);
				if (params.status !== 'complete' && params.status !== 'blocked') throw new Error('status must be complete or blocked');
				const status = params.status;
				return await withStore(options, (store) => {
					const existing = resolveGoalForTurn(store, context, piboSessionId);
					if (!existing) throw new Error('cannot update goal because this Pibo Session has no goal');
					const job = store.updateGoalStatus(existing.id, status);
					if (!job) throw new Error('goal no longer exists');
					return toolResult({
						ok: true,
						goal: goalPayload(job),
						...(status === 'complete' && job.tokenBudget !== undefined
							? { completionBudgetReport: `${job.state.tokensUsed ?? 0}/${job.tokenBudget} reported tokens consumed against a soft budget before the current model turn finishes` }
							: {}),
					});
				});
			} catch (error) {
				return errorResult(error);
			}
		},
	});
}

export function createPiboGoalToolDefinitions(context: ToolDefinitionContext, options: PiboGoalToolOptions = {}): ToolDefinition[] {
	return [
		createGetGoalTool(context, options),
		createCreateGoalTool(context, options),
		createUpdateGoalTool(context, options),
	];
}

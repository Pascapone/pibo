import type { PiboJsonObject, PiboSessionErrorDetails } from '../core/events.js';
import type { ModelProfile } from '../core/profiles.js';
import type { PiboThinkingLevel } from '../core/thinking.js';

export type PiboLoopMode = 'goal' | 'ralph';
export type PiboGoalStatus = 'active' | 'paused' | 'blocked' | 'budget_limited' | 'complete';

export type PiboLoopTarget =
	| { kind: 'room'; roomId: string }
	| { kind: 'default-chat' };

export type PiboLoopStopConditionPhase = 'before-run' | 'after-run';
export type PiboLoopStopAction = 'continue' | 'stop-after-run' | 'cancel-current-run';
export type PiboLoopStopPolicyMode = 'any' | 'all';

export type PiboLoopStopConditionInstance = {
	id: string;
	type: string;
	enabled?: boolean;
	options?: PiboJsonObject;
	failClosed?: boolean;
	timeoutMs?: number;
};

export type PiboLoopStopPolicy = {
	mode: PiboLoopStopPolicyMode;
	conditions: PiboLoopStopConditionInstance[];
};

export type PiboLoopStopConditionDecision = {
	action: PiboLoopStopAction;
	reason?: string;
	details?: PiboJsonObject;
	nextState?: PiboJsonObject;
};

export type PiboLoopStopConditionEvaluation = {
	id: string;
	type: string;
	phase: PiboLoopStopConditionPhase;
	action: PiboLoopStopAction;
	reason?: string;
	details?: PiboJsonObject;
	skipped?: boolean;
	error?: string;
};

export type PiboLoopStopEvaluationSummary = {
	id: string;
	phase: PiboLoopStopConditionPhase;
	at: string;
	mode: PiboLoopStopPolicyMode;
	finalAction: PiboLoopStopAction;
	reason?: string;
	decisions: PiboLoopStopConditionEvaluation[];
};

export type PiboLoopResourceCleanupState = 'none' | 'active' | 'released' | 'retained' | 'dirty';
export type PiboLoopTokenAccountingBasis = 'total' | 'uncached';
export type PiboLoopTokenAccounting = { version: 1; basis: PiboLoopTokenAccountingBasis };

export type PiboLoopUsageTotals = {
	inputTokens: number;
	outputTokens: number;
	cacheReadTokens: number;
	cacheWriteTokens: number;
	reasoningTokens: number;
	totalTokens: number;
	costUsd: number;
	costReportedTurns: number;
	assistantTurns: number;
};

export type PiboLoopRecursiveUsage = {
	controller: PiboLoopUsageTotals;
	descendants: PiboLoopUsageTotals;
	total: PiboLoopUsageTotals;
	sessionIds: string[];
};

export type PiboLoopResourceMetadata = {
	workerId?: string;
	browserLeaseIds?: string[];
	cleanupState?: PiboLoopResourceCleanupState;
	retainedUntil?: string;
	dirtyReason?: string;
	updatedAt?: string;
};

export type PiboLoopFailure = {
	message: string;
	details?: PiboSessionErrorDetails;
	recovery: string;
	at: string;
	nextAttemptAt?: string;
	retryBackoffMs?: number;
};

export type PiboLoopJobState = {
	goalStatus?: PiboGoalStatus;
	/** Missing in legacy persisted rows; readers interpret absence as version 1 total-token accounting. */
	tokenAccounting?: PiboLoopTokenAccounting;
	tokensUsed?: number;
	activeTimeSeconds?: number;
	/** Legacy persisted field migrated to activeTimeSeconds when read. */
	timeUsedSeconds?: number;
	goalStartedAt?: string;
	goalEndedAt?: string;
	/** Execution interval currently excluded from activeTimeSeconds; null means the reserved run is finalizing. */
	activeTimeRunningAt?: string | null;
	runningAt?: string;
	lastRunAt?: string;
	lastStatus?: 'ok' | 'error' | 'cancelled';
	lastError?: string;
	lastFailure?: PiboLoopFailure;
	nextAttemptAt?: string;
	retryBackoffMs?: number;
	lastRunId?: string;
	lastPiboSessionId?: string;
	consecutiveErrors?: number;
	stopRequestedAt?: string;
	cancelRequestedAt?: string;
	completedIterations?: number;
	usage?: PiboLoopRecursiveUsage;
	conditionStates?: Record<string, PiboJsonObject>;
	lastStopEvaluation?: PiboLoopStopEvaluationSummary;
};

export type PiboLoopJob = {
	id: string;
	mode: PiboLoopMode;
	name: string;
	description?: string;
	enabled: boolean;
	target: PiboLoopTarget;
	profile: string;
	prompt: string;
	maxIterations?: number;
	tokenBudget?: number;
	tokenReserve?: number;
	stopPolicy?: PiboLoopStopPolicy;
	modelOverride?: ModelProfile;
	thinkingLevel?: PiboThinkingLevel;
	fastMode?: boolean;
	resources?: PiboLoopResourceMetadata;
	state: PiboLoopJobState;
	createdAt: string;
	updatedAt: string;
};

export type PiboLoopRunStatus = 'running' | 'ok' | 'error' | 'cancelled';
export type PiboLoopRunMessageState = 'reserved' | 'queued' | 'active' | 'invalidated' | 'finished';

export type PiboLoopRunAccounting = {
	/** Missing in legacy persisted rows; readers interpret absence as version 1 total-token accounting. */
	tokenAccounting?: PiboLoopTokenAccounting;
	tokenBudget?: number;
	tokenReserve?: number;
	tokensUsedBefore?: number;
	remainingTokensBefore?: number;
	tokensUsed?: number;
	overshootTokens?: number;
	activeTimeSeconds?: number;
	usage?: PiboLoopRecursiveUsage;
};

export type PiboLoopRun = {
	id: string;
	jobId: string;
	piboSessionId?: string;
	status: PiboLoopRunStatus;
	reason?: string;
	error?: string;
	errorDetails?: PiboSessionErrorDetails;
	messageEventId?: string;
	messageState?: PiboLoopRunMessageState;
	startedAt?: string;
	completedAt?: string;
	accounting?: PiboLoopRunAccounting;
	resources?: PiboLoopResourceMetadata;
	createdAt: string;
	updatedAt: string;
};

export type PiboLoopRunFact = {
	id: string;
	jobId: string;
	runId?: string;
	piboSessionId?: string;
	type: string;
	source: 'pibo' | 'pi-extension' | 'tool' | 'plugin';
	payload: PiboJsonObject;
	createdAt: string;
};

export type PiboLoopFactReader = {
	list(input?: { type?: string; runId?: string; limit?: number }): PiboLoopRunFact[];
	count(input?: { type?: string; runId?: string }): number;
};

export type PiboLoopRunOutcome = {
	status: PiboLoopRunStatus;
	piboSessionId?: string;
	finalAnswer?: string;
	error?: string;
	errorDetails?: PiboSessionErrorDetails;
};

export type PiboLoopStopConditionContext = {
	phase: PiboLoopStopConditionPhase;
	job: PiboLoopJob;
	policy: PiboLoopStopPolicy;
	instance: PiboLoopStopConditionInstance;
	state: PiboJsonObject;
	now: string;
	run?: PiboLoopRun;
	outcome?: PiboLoopRunOutcome;
	facts: PiboLoopFactReader;
	signal?: AbortSignal;
};

export type PiboLoopStopConditionDefinition = {
	type: string;
	name: string;
	description?: string;
	phases: readonly PiboLoopStopConditionPhase[];
	optionsSchema?: PiboJsonObject;
	defaultOptions?: PiboJsonObject;
	timeoutMs?: number;
	failClosedDefault?: boolean;
	evaluate(context: PiboLoopStopConditionContext): Promise<PiboLoopStopConditionDecision> | PiboLoopStopConditionDecision;
};

export type PiboLoopStopConditionInfo = {
	type: string;
	name: string;
	description?: string;
	phases: PiboLoopStopConditionPhase[];
	optionsSchema?: PiboJsonObject;
	defaultOptions?: PiboJsonObject;
	pluginId?: string;
	pluginName?: string;
};

export type PiboLoopJobCreateInput = {
	mode?: PiboLoopMode;
	name?: string;
	description?: string;
	enabled?: boolean;
	target: PiboLoopTarget;
	profile: string;
	prompt: string;
	maxIterations?: number;
	tokenBudget?: number;
	tokenReserve?: number;
	stopPolicy?: PiboLoopStopPolicy;
	resources?: PiboLoopResourceMetadata;
	initialPiboSessionId?: string;
	modelOverride?: ModelProfile;
	thinkingLevel?: PiboThinkingLevel;
	fastMode?: boolean;
};

export type PiboLoopJobPatchInput = {
	mode?: PiboLoopMode;
	name?: string;
	description?: string;
	enabled?: boolean;
	target?: PiboLoopTarget;
	profile?: string;
	prompt?: string;
	maxIterations?: number | null;
	tokenBudget?: number | null;
	tokenReserve?: number | null;
	stopPolicy?: PiboLoopStopPolicy | null;
	modelOverride?: ModelProfile | null;
	thinkingLevel?: PiboThinkingLevel | null;
	fastMode?: boolean | null;
};

export type PiboLoopStatus = {
	enabled: boolean;
	jobs: number;
	running: number;
};

export type PiboLoopResolvedTarget = {
	roomId: string;
	workspace?: string;
	metadata?: PiboJsonObject;
};

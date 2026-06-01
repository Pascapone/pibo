import type { PiboJsonObject } from '../core/events.js';
import type { ModelProfile } from '../core/profiles.js';
import type { PiboThinkingLevel } from '../core/thinking.js';

export type PiboRalphTarget =
	| { kind: 'room'; roomId: string }
	| { kind: 'default-chat' };

export type PiboRalphStopConditionPhase = 'before-run' | 'after-run';
export type PiboRalphStopAction = 'continue' | 'stop-after-run' | 'cancel-current-run';
export type PiboRalphStopPolicyMode = 'any' | 'all';

export type PiboRalphStopConditionInstance = {
	id: string;
	type: string;
	enabled?: boolean;
	options?: PiboJsonObject;
	failClosed?: boolean;
	timeoutMs?: number;
};

export type PiboRalphStopPolicy = {
	mode: PiboRalphStopPolicyMode;
	conditions: PiboRalphStopConditionInstance[];
};

export type PiboRalphStopConditionDecision = {
	action: PiboRalphStopAction;
	reason?: string;
	details?: PiboJsonObject;
	nextState?: PiboJsonObject;
};

export type PiboRalphStopConditionEvaluation = {
	id: string;
	type: string;
	phase: PiboRalphStopConditionPhase;
	action: PiboRalphStopAction;
	reason?: string;
	details?: PiboJsonObject;
	skipped?: boolean;
	error?: string;
};

export type PiboRalphStopEvaluationSummary = {
	id: string;
	phase: PiboRalphStopConditionPhase;
	at: string;
	mode: PiboRalphStopPolicyMode;
	finalAction: PiboRalphStopAction;
	reason?: string;
	decisions: PiboRalphStopConditionEvaluation[];
};

export type PiboRalphResourceCleanupState = 'none' | 'active' | 'released' | 'retained' | 'dirty';

export type PiboRalphResourceMetadata = {
	workerId?: string;
	browserLeaseIds?: string[];
	cleanupState?: PiboRalphResourceCleanupState;
	retainedUntil?: string;
	dirtyReason?: string;
	updatedAt?: string;
};

export type PiboRalphJobState = {
	runningAt?: string;
	lastRunAt?: string;
	lastStatus?: 'ok' | 'error' | 'cancelled';
	lastError?: string;
	lastRunId?: string;
	lastPiboSessionId?: string;
	consecutiveErrors?: number;
	stopRequestedAt?: string;
	cancelRequestedAt?: string;
	completedIterations?: number;
	conditionStates?: Record<string, PiboJsonObject>;
	lastStopEvaluation?: PiboRalphStopEvaluationSummary;
};

export type PiboRalphJob = {
	id: string;
	name: string;
	description?: string;
	enabled: boolean;
	target: PiboRalphTarget;
	profile: string;
	prompt: string;
	maxIterations?: number;
	stopPolicy?: PiboRalphStopPolicy;
	modelOverride?: ModelProfile;
	thinkingLevel?: PiboThinkingLevel;
	fastMode?: boolean;
	resources?: PiboRalphResourceMetadata;
	state: PiboRalphJobState;
	createdAt: string;
	updatedAt: string;
};

export type PiboRalphRunStatus = 'running' | 'ok' | 'error' | 'cancelled';

export type PiboRalphRun = {
	id: string;
	jobId: string;
	piboSessionId?: string;
	status: PiboRalphRunStatus;
	reason?: string;
	error?: string;
	startedAt?: string;
	completedAt?: string;
	resources?: PiboRalphResourceMetadata;
	createdAt: string;
	updatedAt: string;
};

export type PiboRalphRunFact = {
	id: string;
	jobId: string;
	runId?: string;
	piboSessionId?: string;
	type: string;
	source: 'pibo' | 'pi-extension' | 'tool' | 'plugin';
	payload: PiboJsonObject;
	createdAt: string;
};

export type PiboRalphFactReader = {
	list(input?: { type?: string; runId?: string; limit?: number }): PiboRalphRunFact[];
	count(input?: { type?: string; runId?: string }): number;
};

export type PiboRalphRunOutcome = {
	status: PiboRalphRunStatus;
	piboSessionId?: string;
	finalAnswer?: string;
	error?: string;
};

export type PiboRalphStopConditionContext = {
	phase: PiboRalphStopConditionPhase;
	job: PiboRalphJob;
	policy: PiboRalphStopPolicy;
	instance: PiboRalphStopConditionInstance;
	state: PiboJsonObject;
	now: string;
	run?: PiboRalphRun;
	outcome?: PiboRalphRunOutcome;
	facts: PiboRalphFactReader;
	signal?: AbortSignal;
};

export type PiboRalphStopConditionDefinition = {
	type: string;
	name: string;
	description?: string;
	phases: readonly PiboRalphStopConditionPhase[];
	optionsSchema?: PiboJsonObject;
	defaultOptions?: PiboJsonObject;
	timeoutMs?: number;
	failClosedDefault?: boolean;
	evaluate(context: PiboRalphStopConditionContext): Promise<PiboRalphStopConditionDecision> | PiboRalphStopConditionDecision;
};

export type PiboRalphStopConditionInfo = {
	type: string;
	name: string;
	description?: string;
	phases: PiboRalphStopConditionPhase[];
	optionsSchema?: PiboJsonObject;
	defaultOptions?: PiboJsonObject;
	pluginId?: string;
	pluginName?: string;
};

export type PiboRalphJobCreateInput = {
	name?: string;
	description?: string;
	enabled?: boolean;
	target: PiboRalphTarget;
	profile: string;
	prompt: string;
	maxIterations?: number;
	stopPolicy?: PiboRalphStopPolicy;
	resources?: PiboRalphResourceMetadata;
	modelOverride?: ModelProfile;
	thinkingLevel?: PiboThinkingLevel;
	fastMode?: boolean;
};

export type PiboRalphJobPatchInput = {
	name?: string;
	description?: string;
	enabled?: boolean;
	target?: PiboRalphTarget;
	profile?: string;
	prompt?: string;
	maxIterations?: number | null;
	stopPolicy?: PiboRalphStopPolicy | null;
	modelOverride?: ModelProfile | null;
	thinkingLevel?: PiboThinkingLevel | null;
	fastMode?: boolean | null;
};

export type PiboRalphStatus = {
	enabled: boolean;
	jobs: number;
	running: number;
};

export type PiboRalphResolvedTarget = {
	roomId: string;
	workspace?: string;
	metadata?: PiboJsonObject;
};

import { randomUUID } from 'node:crypto';
import type { PiboJsonObject } from '../core/events.js';
import type { PiboRalphFactReader, PiboRalphJob, PiboRalphRun, PiboRalphRunOutcome, PiboRalphStopAction, PiboRalphStopConditionDecision, PiboRalphStopConditionDefinition, PiboRalphStopConditionEvaluation, PiboRalphStopConditionInstance, PiboRalphStopConditionPhase, PiboRalphStopEvaluationSummary, PiboRalphStopPolicy } from './types.js';

export const PROMISE_COMPLETE_STOP_TOKEN = '<promise>COMPLETE</promise>';
export const MAX_ITERATIONS_STOP_CONDITION = 'pibo.ralph.max-iterations';
export const PROMISE_COMPLETE_STOP_CONDITION = 'pibo.ralph.promise-complete';
export const FACT_COUNT_STOP_CONDITION = 'pibo.ralph.fact-count';

function isObject(value: unknown): value is PiboJsonObject { return !!value && typeof value === 'object' && !Array.isArray(value); }
function stringOption(options: PiboJsonObject | undefined, key: string): string | undefined { const value = options?.[key]; return typeof value === 'string' && value.trim() ? value.trim() : undefined; }
function numberOption(options: PiboJsonObject | undefined, key: string): number | undefined { const value = options?.[key]; return typeof value === 'number' && Number.isFinite(value) ? value : undefined; }
function boolOption(options: PiboJsonObject | undefined, key: string): boolean | undefined { const value = options?.[key]; return typeof value === 'boolean' ? value : undefined; }

export function getDefaultRalphStopPolicy(job: Pick<PiboRalphJob, 'maxIterations'>): PiboRalphStopPolicy {
	const conditions: PiboRalphStopConditionInstance[] = [];
	if (job.maxIterations !== undefined) conditions.push({ id: 'max-iterations', type: MAX_ITERATIONS_STOP_CONDITION });
	conditions.push({ id: 'promise-complete', type: PROMISE_COMPLETE_STOP_CONDITION });
	return { mode: 'any', conditions };
}

export function getEffectiveRalphStopPolicy(job: PiboRalphJob): PiboRalphStopPolicy {
	return job.stopPolicy ?? getDefaultRalphStopPolicy(job);
}

export function createBuiltInRalphStopConditions(): PiboRalphStopConditionDefinition[] {
	return [
		{
			type: MAX_ITERATIONS_STOP_CONDITION,
			name: 'Max iterations',
			description: 'Stops a Ralph job after its configured number of completed run attempts, regardless of outcome.',
			phases: ['before-run', 'after-run'],
			evaluate(context) {
				const maxIterations = context.job.maxIterations;
				if (maxIterations === undefined) return { action: 'continue' };
				const current = context.job.state.completedIterations ?? 0;
				const completed = context.phase === 'after-run' && context.outcome ? current + 1 : current;
				if (completed >= maxIterations) return { action: 'stop-after-run', reason: 'max-iterations', details: { maxIterations, completedIterations: completed } };
				return { action: 'continue', details: { maxIterations, completedIterations: completed } };
			},
		},
		{
			type: PROMISE_COMPLETE_STOP_CONDITION,
			name: 'Promise complete token',
			description: `Stops after a successful run whose final answer contains ${PROMISE_COMPLETE_STOP_TOKEN}.`,
			phases: ['after-run'],
			evaluate(context) {
				const finalAnswer = context.outcome?.finalAnswer ?? '';
				if (context.outcome?.status === 'ok' && finalAnswer.includes(PROMISE_COMPLETE_STOP_TOKEN)) return { action: 'stop-after-run', reason: 'promise-complete', details: { token: PROMISE_COMPLETE_STOP_TOKEN } };
				return { action: 'continue' };
			},
		},
		{
			type: FACT_COUNT_STOP_CONDITION,
			name: 'Run fact count',
			description: 'Stops when the current run or job history contains at least a configured number of matching Ralph run facts.',
			phases: ['after-run'],
			defaultOptions: { factType: 'example.fact', threshold: 1, currentRunOnly: true },
			optionsSchema: {
				type: 'object',
				properties: {
					factType: { type: 'string', description: 'Fact type to count.' },
					threshold: { type: 'number', description: 'Stop after at least this many facts.' },
					currentRunOnly: { type: 'boolean', description: 'Only count facts for the current run.' },
					reason: { type: 'string', description: 'Optional stop reason.' },
				},
			},
			evaluate(context): PiboRalphStopConditionDecision {
				const factType = stringOption(context.instance.options, 'factType');
				if (!factType) return { action: 'continue', details: { missingOption: 'factType' } };
				const threshold = Math.max(1, Math.floor(numberOption(context.instance.options, 'threshold') ?? 1));
				const currentRunOnly = boolOption(context.instance.options, 'currentRunOnly') ?? true;
				const runId = currentRunOnly ? context.run?.id : undefined;
				const count = context.facts.count({ type: factType, runId });
				if (count >= threshold) return { action: 'stop-after-run', reason: stringOption(context.instance.options, 'reason') ?? `fact:${factType}`, details: { factType, threshold, count, currentRunOnly } };
				return { action: 'continue', details: { factType, threshold, count, currentRunOnly } };
			},
		},
	];
}

function severity(action: PiboRalphStopAction): number {
	if (action === 'cancel-current-run') return 2;
	if (action === 'stop-after-run') return 1;
	return 0;
}
function highest(left: PiboRalphStopAction, right: PiboRalphStopAction): PiboRalphStopAction { return severity(right) > severity(left) ? right : left; }
function sanitizeDecision(value: unknown): PiboRalphStopConditionDecision {
	if (!isObject(value)) throw new Error('condition returned a non-object decision');
	if (value.action !== 'continue' && value.action !== 'stop-after-run' && value.action !== 'cancel-current-run') throw new Error('condition returned an invalid action');
	return { action: value.action, reason: typeof value.reason === 'string' ? value.reason : undefined, details: isObject(value.details) ? value.details : undefined, nextState: isObject(value.nextState) ? value.nextState : undefined };
}
async function withTimeout<T>(promise: Promise<T>, timeoutMs: number | undefined, signal?: AbortSignal): Promise<T> {
	if (!timeoutMs || timeoutMs <= 0) return await promise;
	return await new Promise<T>((resolve, reject) => {
		const timeout = setTimeout(() => reject(new Error(`condition timed out after ${timeoutMs}ms`)), timeoutMs);
		if (signal) signal.addEventListener('abort', () => reject(new Error('condition aborted')), { once: true });
		promise.then((value) => { clearTimeout(timeout); resolve(value); }, (error) => { clearTimeout(timeout); reject(error); });
	});
}

export async function evaluateRalphStopPolicy(input: { job: PiboRalphJob; phase: PiboRalphStopConditionPhase; definitions: readonly PiboRalphStopConditionDefinition[]; facts: PiboRalphFactReader; run?: PiboRalphRun; outcome?: PiboRalphRunOutcome; now?: Date; signal?: AbortSignal }): Promise<{ evaluation: PiboRalphStopEvaluationSummary; conditionStates: Record<string, PiboJsonObject> }> {
	const now = (input.now ?? new Date()).toISOString();
	const policy = getEffectiveRalphStopPolicy(input.job);
	const definitions = new Map(input.definitions.map((definition) => [definition.type, definition]));
	const decisions: PiboRalphStopConditionEvaluation[] = [];
	const conditionStates: Record<string, PiboJsonObject> = { ...(input.job.state.conditionStates ?? {}) };
	let finalAction: PiboRalphStopAction = 'continue';
	for (const instance of policy.conditions) {
		const base = { id: instance.id, type: instance.type, phase: input.phase };
		if (instance.enabled === false) { decisions.push({ ...base, action: 'continue', skipped: true, reason: 'disabled' }); continue; }
		const definition = definitions.get(instance.type);
		if (!definition) { decisions.push({ ...base, action: 'continue', skipped: true, error: `Unknown Ralph stop condition type: ${instance.type}` }); continue; }
		if (!definition.phases.includes(input.phase)) { decisions.push({ ...base, action: 'continue', skipped: true, reason: 'unsupported-phase' }); continue; }
		try {
			const state = conditionStates[instance.id] ?? {};
			const decision = sanitizeDecision(await withTimeout(Promise.resolve(definition.evaluate({ phase: input.phase, job: input.job, policy, instance, state, now, run: input.run, outcome: input.outcome, facts: input.facts, signal: input.signal })), instance.timeoutMs ?? definition.timeoutMs, input.signal));
			if (decision.nextState) conditionStates[instance.id] = decision.nextState;
			decisions.push({ ...base, action: decision.action, reason: decision.reason, details: decision.details });
		} catch (error) {
			const failClosed = instance.failClosed ?? definition.failClosedDefault ?? false;
			const action: PiboRalphStopAction = failClosed ? 'stop-after-run' : 'continue';
			decisions.push({ ...base, action, reason: failClosed ? 'condition-error-fail-closed' : 'condition-error', error: error instanceof Error ? error.message : String(error) });
		}
	}
	const active = decisions.filter((decision) => !decision.skipped);
	if (policy.mode === 'all' && active.length > 0) {
		const allStop = active.every((decision) => severity(decision.action) >= severity('stop-after-run'));
		finalAction = allStop ? active.reduce<PiboRalphStopAction>((action, decision) => highest(action, decision.action), 'stop-after-run') : 'continue';
	} else {
		finalAction = active.reduce<PiboRalphStopAction>((action, decision) => highest(action, decision.action), 'continue');
	}
	const contributing = finalAction === 'continue' ? active.find((decision) => decision.error || decision.reason) : active.find((decision) => decision.action === finalAction) ?? active.find((decision) => severity(decision.action) > 0);
	return { evaluation: { id: `rse_${randomUUID()}`, phase: input.phase, at: now, mode: policy.mode, finalAction, reason: contributing?.reason ?? (contributing?.error ? 'condition-error' : undefined), decisions }, conditionStates };
}

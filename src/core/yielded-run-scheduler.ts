import type { PiboRunOrigin, PiboRunRegistry, PiboRunSnapshot } from "../runs/registry.js";
import {
	PiboRunCancellationError,
	PiboRunCancelledError,
	PiboRunExecutionTimeoutError,
	waitForRunCancellationSettlement,
} from "../runs/lifecycle.js";
import { PiboRunResourceLimitError, type YieldedRunHostResourceSnapshot } from "../runs/resource-isolation.js";
import type { PluginYieldedRunControl } from "../plugins/runtime.js";

export type PiboYieldedRunReservation = {
	admission: YieldedRunHostResourceSnapshot;
	release(): void;
};

export type PiboYieldedRunSchedulerOptions = {
	registry: PiboRunRegistry;
	reserve(parentPiboSessionId: string, toolName: string): PiboYieldedRunReservation;
	origin(parentPiboSessionId: string): PiboRunOrigin | undefined;
	reminderGeneration(parentPiboSessionId: string): number;
	handleTerminalRun(parentPiboSessionId: string, runId: string, reminderGeneration: number): void;
	refreshReminders(parentPiboSessionId: string): void;
};

function isTerminalRunStatus(status: string): boolean {
	return status === "completed" || status === "failed" || status === "timed_out" || status === "cancelled";
}

export class PiboYieldedRunScheduler {
	private readonly cancellationHandlers = new Map<string, () => Promise<void>>();
	private readonly activeExecutions = new Set<string>();

	constructor(private readonly options: PiboYieldedRunSchedulerOptions) {}

	controlFor(parentPiboSessionId: string): PluginYieldedRunControl {
		const registry = this.options.registry;
		return {
			startToolRun: ({ toolName, params, completionPolicy, retryable, maxAttempts, timeoutMs, serviceWarning, resources, execute, cancel }) => {
				const reservation = this.options.reserve(parentPiboSessionId, toolName);
				if (resources) resources.admission = reservation.admission;
				const reminderGeneration = this.options.reminderGeneration(parentPiboSessionId);
				let run: PiboRunSnapshot;
				try {
					run = registry.startToolRun({
						controllerPiboSessionId: parentPiboSessionId,
						toolName,
						params,
						completionPolicy,
						retryable,
						maxAttempts,
						timeoutMs,
						serviceWarning,
						resources,
						origin: this.options.origin(parentPiboSessionId),
					});
				} catch (error) {
					reservation.release();
					throw error;
				}
				this.activeExecutions.add(run.runId);
				const cancellation: {
					state: "none" | "pending" | "confirmed" | "failed";
					decision?: Promise<void>;
				} = { state: "none" };
				let resolveRunTaskSettled: (() => void) | undefined;
				const runTaskSettled = new Promise<void>((resolve) => { resolveRunTaskSettled = resolve; });
				if (cancel) {
					let cancellationAttempt: Promise<void> | undefined;
					this.cancellationHandlers.set(run.runId, () => {
						cancellationAttempt ??= (async () => {
							cancellation.state = "pending";
							let resolveDecision: (() => void) | undefined;
							cancellation.decision = new Promise<void>((resolve) => { resolveDecision = resolve; });
							try {
								await waitForRunCancellationSettlement(Promise.resolve().then(cancel));
								cancellation.state = "confirmed";
								resolveDecision?.();
								await waitForRunCancellationSettlement(runTaskSettled);
							} catch (error) {
								cancellation.state = "failed";
								throw error;
							} finally {
								resolveDecision?.();
							}
						})();
						return cancellationAttempt;
					});
				}

				void (async () => {
					try {
						const result = await execute(run.runId);
						if (resources) registry.updateResources(run.runId, resources);
						const completed = registry.complete(run.runId, result);
						if (completed) this.options.handleTerminalRun(parentPiboSessionId, completed.runId, reminderGeneration);
					} catch (error) {
						if (error instanceof PiboRunCancelledError) {
							if (cancellation.state === "pending") await cancellation.decision;
							if (cancellation.state === "confirmed") return;
						}
						const message = error instanceof Error ? error.message : String(error);
						if (resources) registry.updateResources(run.runId, resources);
						const terminalRun = error instanceof PiboRunExecutionTimeoutError
							? registry.timeOut(run.runId, message, error.timeoutPhase)
							: error instanceof PiboRunResourceLimitError
								? registry.resourceLimit(run.runId, message, error.resources)
								: registry.fail(run.runId, message);
						if (terminalRun) this.options.handleTerminalRun(parentPiboSessionId, terminalRun.runId, reminderGeneration);
					} finally {
						this.cancellationHandlers.delete(run.runId);
						this.activeExecutions.delete(run.runId);
						reservation.release();
						resolveRunTaskSettled?.();
					}
				})();

				return run;
			},
			listRuns: (options) => registry.list(parentPiboSessionId, options),
			getRunStatus: (runId) => registry.status(parentPiboSessionId, runId),
			waitForRun: (runId, timeoutMs) => registry.wait(parentPiboSessionId, runId, timeoutMs),
			readRun: (runId) => {
				const run = registry.read(parentPiboSessionId, runId);
				if (run.consumed && isTerminalRunStatus(run.status)) this.options.refreshReminders(parentPiboSessionId);
				return run;
			},
			cancelRun: async (runId) => {
				const current = registry.status(parentPiboSessionId, runId);
				try {
					if (!isTerminalRunStatus(current.status)) await this.invokeCancellationHandlers([current]);
					return registry.cancel(parentPiboSessionId, runId);
				} finally {
					this.options.refreshReminders(parentPiboSessionId);
				}
			},
			ackRun: (runId) => {
				const run = registry.ack(parentPiboSessionId, runId);
				this.options.refreshReminders(parentPiboSessionId);
				return run;
			},
		};
	}

	async cancelRunsAfterSettlement(runs: readonly PiboRunSnapshot[], reason: string): Promise<PiboRunSnapshot[]> {
		const results = await Promise.allSettled(runs.map(async (run) => {
			await this.invokeCancellationHandler(run);
			const current = this.options.registry.status(run.controllerPiboSessionId, run.runId);
			return isTerminalRunStatus(current.status)
				? current
				: this.options.registry.cancel(run.controllerPiboSessionId, run.runId, reason);
		}));
		const failures = results.flatMap((result) => result.status === "rejected" ? [result.reason] : []);
		if (failures.length > 0) throw new AggregateError(failures, "Failed to terminate yielded runs before cancellation settlement.");
		return results.flatMap((result) => result.status === "fulfilled" && result.value.status === "cancelled" ? [result.value] : []);
	}

	private async invokeCancellationHandler(run: PiboRunSnapshot): Promise<void> {
		const cancel = this.cancellationHandlers.get(run.runId);
		if (!cancel) {
			const current = this.options.registry.status(run.controllerPiboSessionId, run.runId);
			if (isTerminalRunStatus(current.status) || !this.activeExecutions.has(run.runId)) return;
			throw new PiboRunCancellationError(`Yielded run "${run.runId}" has active execution but does not expose a cancellation handler.`);
		}
		await cancel();
		if (this.cancellationHandlers.get(run.runId) === cancel) this.cancellationHandlers.delete(run.runId);
	}

	private async invokeCancellationHandlers(runs: readonly PiboRunSnapshot[]): Promise<void> {
		const results = await Promise.allSettled(runs.map((run) => this.invokeCancellationHandler(run)));
		const failures = results.flatMap((result) => result.status === "rejected" ? [result.reason] : []);
		if (failures.length > 0) throw new AggregateError(failures, "Failed to terminate yielded runs.");
	}
}

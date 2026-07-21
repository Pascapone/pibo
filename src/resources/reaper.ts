import { applyResourceReapPlan, planResourceReap, type PlanResourceReapOptions, type ResourceReapApplyResult } from "./lifecycle.js";
import {
	claimResourceReaperOwnership,
	defaultResourceReaperStatePath,
	releaseResourceReaperOwnership,
	writeResourceReaperState,
	type ResourceReaperState,
} from "./reaper-state.js";

export interface ResourceReaperServiceOptions extends PlanResourceReapOptions {
	intervalMs?: number;
	initialDelayMs?: number;
	statePath?: string;
	plan?: typeof planResourceReap;
	apply?: typeof applyResourceReapPlan;
	clock?: () => Date;
	writeState?: typeof writeResourceReaperState;
}

export class ResourceReaperService {
	private readonly intervalMs: number;
	private readonly initialDelayMs: number;
	private readonly statePath: string;
	private readonly lockPath: string;
	private readonly plan: typeof planResourceReap;
	private readonly apply: typeof applyResourceReapPlan;
	private readonly now: () => Date;
	private readonly writeState: typeof writeResourceReaperState;
	private timer: NodeJS.Timeout | undefined;
	private running = false;
	private stopped = true;
	private ownsTimer = false;
	private state: ResourceReaperState | undefined;

	constructor(private readonly options: ResourceReaperServiceOptions = {}) {
		this.intervalMs = Math.max(1_000, options.intervalMs ?? readPositiveInteger(process.env.PIBO_RESOURCE_REAPER_INTERVAL_MS) ?? 5 * 60_000);
		this.initialDelayMs = Math.max(0, options.initialDelayMs ?? readNonNegativeInteger(process.env.PIBO_RESOURCE_REAPER_INITIAL_DELAY_MS) ?? 30_000);
		this.statePath = options.statePath ?? defaultResourceReaperStatePath();
		this.lockPath = `${this.statePath}.lock`;
		this.plan = options.plan ?? planResourceReap;
		this.apply = options.apply ?? applyResourceReapPlan;
		this.now = options.clock ?? (() => new Date());
		this.writeState = options.writeState ?? writeResourceReaperState;
	}

	async start(): Promise<void> {
		if (!this.stopped) return;
		this.ownsTimer = await claimResourceReaperOwnership(this.lockPath);
		if (!this.ownsTimer) return;
		this.stopped = false;
		const now = this.now();
		this.state = {
			status: "running",
			pid: process.pid,
			startedAt: now.toISOString(),
			intervalMs: this.intervalMs,
			nextRunAt: new Date(now.getTime() + this.initialDelayMs).toISOString(),
		};
		await this.persist();
		this.arm(this.initialDelayMs);
	}

	async stop(): Promise<void> {
		this.stopped = true;
		if (this.timer) clearTimeout(this.timer);
		this.timer = undefined;
		try {
			if (this.state && this.ownsTimer) {
				this.state = { ...this.state, status: "stopped", nextRunAt: undefined };
				await this.persist();
			}
		} finally {
			if (this.ownsTimer) await releaseResourceReaperOwnership(this.lockPath);
			this.ownsTimer = false;
		}
	}

	async runNow(): Promise<ResourceReapApplyResult | undefined> {
		if (!this.ownsTimer || this.running) return undefined;
		this.running = true;
		const runAt = this.now();
		let result: ResourceReapApplyResult | undefined;
		try {
			const plan = await this.plan({
				includeDev: this.options.includeDev,
				maxAgeMinutes: this.options.maxAgeMinutes,
				idleTimeoutMinutes: this.options.idleTimeoutMinutes,
				unmanagedBrowserGraceMinutes: this.options.unmanagedBrowserGraceMinutes,
				browserPoolRoot: this.options.browserPoolRoot,
				browserUseHome: this.options.browserUseHome,
				exemptBrowserPids: this.options.exemptBrowserPids,
				now: runAt,
			});
			result = await this.apply(plan);
			this.state = {
				...(this.state ?? {
					status: "running" as const,
					pid: process.pid,
					startedAt: runAt.toISOString(),
					intervalMs: this.intervalMs,
				}),
				status: "running",
				lastRunAt: runAt.toISOString(),
				nextRunAt: new Date(this.now().getTime() + this.intervalMs).toISOString(),
				lastResult: {
					browserPools: result.browserResults.filter((item) => item.reaped).length,
					unmanagedBrowsers: result.terminatedUnmanagedBrowsers.length,
					staleFiles: result.removedStaleFiles.length,
					computeWorkers: result.removedComputeWorkers.length,
				},
				lastError: undefined,
			};
			console.error(JSON.stringify({ event: "resource_reaper_finished", at: runAt.toISOString(), ...this.state.lastResult }));
		} catch (error) {
			const message = error instanceof Error ? error.message : String(error);
			this.state = {
				...(this.state ?? {
					status: "running" as const,
					pid: process.pid,
					startedAt: runAt.toISOString(),
					intervalMs: this.intervalMs,
				}),
				status: "running",
				lastRunAt: runAt.toISOString(),
				nextRunAt: new Date(this.now().getTime() + this.intervalMs).toISOString(),
				lastError: message,
			};
			console.error(JSON.stringify({ event: "resource_reaper_failed", at: runAt.toISOString(), error: message }));
		} finally {
			try {
				await this.persist();
			} finally {
				this.running = false;
			}
		}
		return result;
	}

	private arm(delayMs: number): void {
		if (this.stopped) return;
		if (this.timer) clearTimeout(this.timer);
		this.timer = setTimeout(() => {
			void this.runNow()
				.catch((error) => {
					console.error(JSON.stringify({
						event: "resource_reaper_timer_failed",
						at: new Date().toISOString(),
						error: error instanceof Error ? error.message : String(error),
					}));
				})
				.finally(() => this.arm(this.intervalMs));
		}, delayMs);
		this.timer.unref?.();
	}

	private async persist(): Promise<void> {
		if (!this.state) return;
		try {
			await this.writeState(this.statePath, this.state);
		} catch (error) {
			console.error(JSON.stringify({
				event: "resource_reaper_state_persist_failed",
				at: new Date().toISOString(),
				path: this.statePath,
				error: error instanceof Error ? error.message : String(error),
			}));
		}
	}
}

function readPositiveInteger(value: string | undefined): number | undefined {
	if (!value) return undefined;
	const parsed = Number(value);
	return Number.isInteger(parsed) && parsed > 0 ? parsed : undefined;
}

function readNonNegativeInteger(value: string | undefined): number | undefined {
	if (!value) return undefined;
	const parsed = Number(value);
	return Number.isInteger(parsed) && parsed >= 0 ? parsed : undefined;
}

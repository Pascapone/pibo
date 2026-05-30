import { Command } from "commander";
import { getSharedAppLegacyOwnerScope } from "../shared-app.js";
import { parseFriendlySchedule } from "./schedule.js";
import { createDefaultPiboCronStore } from "./store.js";
import type { PiboCronTarget } from "./types.js";

function printDiscovery(): void {
	console.log(`pibo cron

Manage scheduled Pibo agent jobs.

Commands:
  status    Show scheduler store status
  list      List cron jobs
  add       Create a cron job
  edit      Update a cron job
  pause     Disable a cron job
  resume    Enable a cron job and recompute next run
  remove    Delete a cron job
  runs      List cron runs

Next: pibo cron add --help
      pibo cron edit --help`);
}

function printJson(value: unknown): void {
	console.log(JSON.stringify(value, null, 2));
}

function ownerScope(value: string | undefined): string {
	const trimmed = value?.trim();
	if (trimmed && trimmed !== getSharedAppLegacyOwnerScope()) console.error("--owner-scope is deprecated for Cron and ignored; Cron jobs are app-global.");
	return getSharedAppLegacyOwnerScope();
}

function targetFromOptions(options: { room?: string; personal?: boolean; principalId?: string; ownerScope: string }): PiboCronTarget {
	if (options.room) return { kind: "room", roomId: options.room };
	if (options.personal || options.principalId) {
		if (options.principalId) console.error("--principal-id is deprecated for Cron and ignored; the default target is shared.");
		return { kind: "personal", principalId: getSharedAppLegacyOwnerScope() };
	}
	throw new Error("Choose --room <roomId> or --personal");
}

function maybeTargetFromOptions(options: { room?: string; personal?: boolean; principalId?: string; ownerScope: string }): PiboCronTarget | undefined {
	if (!options.room && !options.personal && !options.principalId) return undefined;
	return targetFromOptions(options);
}

function hasScheduleOptions(options: Record<string, unknown>, positionalCron?: string): boolean {
	return Boolean(
		positionalCron ||
		typeof options.in === "string" ||
		typeof options.at === "string" ||
		typeof options.every === "string" ||
		typeof options.daily === "string" ||
		typeof options.weekly === "string" ||
		typeof options.monthly === "string" ||
		typeof options.monthly === "number" ||
		typeof options.cron === "string"
	);
}

function scheduleFromOptions(options: Record<string, unknown>, positionalCron?: string) {
	if (typeof options.in === "string") return parseFriendlySchedule({ kind: "in", value: options.in });
	if (typeof options.at === "string") return parseFriendlySchedule({ kind: "at", value: options.at, tz: typeof options.tz === "string" ? options.tz : undefined });
	if (typeof options.every === "string") return parseFriendlySchedule({ kind: "every", value: options.every });
	if (typeof options.daily === "string") return parseFriendlySchedule({ kind: "daily", time: options.daily, tz: typeof options.tz === "string" ? options.tz : undefined });
	if (typeof options.weekly === "string") {
		const time = typeof options.time === "string" ? options.time : undefined;
		if (!time) throw new Error("--weekly requires --time HH:MM");
		return parseFriendlySchedule({ kind: "weekly", weekdays: options.weekly, time, tz: typeof options.tz === "string" ? options.tz : undefined });
	}
	if (typeof options.monthly === "string" || typeof options.monthly === "number") {
		const time = typeof options.time === "string" ? options.time : undefined;
		if (!time) throw new Error("--monthly requires --time HH:MM");
		return parseFriendlySchedule({ kind: "monthly", dayOfMonth: Number(options.monthly), time, tz: typeof options.tz === "string" ? options.tz : undefined });
	}
	if (typeof options.cron === "string") return parseFriendlySchedule({ kind: "cron", expr: options.cron, tz: typeof options.tz === "string" ? options.tz : undefined });
	if (positionalCron) return parseFriendlySchedule({ kind: "cron", expr: positionalCron, tz: typeof options.tz === "string" ? options.tz : undefined });
	throw new Error("Choose a schedule: --in, --at, --every, --daily, --weekly, --monthly, --cron, or pass a quoted cron expression");
}

export async function runCronCli(argv = process.argv): Promise<void> {
	if (argv.length <= 2 || argv[2] === "--help" || argv[2] === "-h") {
		printDiscovery();
		return;
	}

	const program = new Command();
	program.name("pibo cron").description("Manage scheduled Pibo jobs").helpOption("-h, --help");
	program.option("--store <path>", "Cron store path");
	program.option("--owner-scope <scope>", "Deprecated no-op; Cron jobs are app-global", process.env.PIBO_OWNER_SCOPE);

	program.command("status").description("Show cron store status").option("--json", "Print JSON").action((options) => {
		const store = createDefaultPiboCronStore({ path: program.opts().store });
		const status = store.status();
		if (options.json) printJson(status);
		else {
			console.log(`jobs\t${status.jobs}`);
			console.log(`running\t${status.running}`);
			console.log(`nextRunAt\t${status.nextRunAt ?? "-"}`);
		}
		store.close();
	});

	program.command("list").description("List cron jobs").option("--all", "Include disabled jobs").option("--json", "Print JSON").action((options) => {
		ownerScope(program.opts().ownerScope);
		const store = createDefaultPiboCronStore({ path: program.opts().store });
		const jobs = store.listJobs({ includeDisabled: options.all });
		if (options.json) printJson(jobs);
		else for (const job of jobs) console.log(`${job.id}\t${job.enabled ? "enabled" : "disabled"}\t${job.state.nextRunAt ?? "-"}\t${job.name}`);
		store.close();
	});

	program.command("add")
		.description("Create a cron job")
		.argument("[cronExpr...]", "Raw 5-field cron expression, e.g. \"0 8 * * *\"")
		.option("--room <roomId>", "Target room")
		.option("--personal", "Target the shared default chat")
		.option("--principal-id <id>", "Deprecated no-op for shared default target")
		.option("--agent <profile>", "Agent/profile", "base")
		.option("--name <name>", "Job name")
		.requiredOption("--prompt <text>", "Prompt/task")
		.option("--in <duration>", "Run once after duration, e.g. 20m")
		.option("--at <iso>", "Run once at ISO timestamp")
		.option("--every <duration>", "Run every duration, e.g. 2h")
		.option("--daily <HH:MM>", "Run daily at time")
		.option("--weekly <days>", "Run weekly on comma-separated days")
		.option("--monthly <day>", "Run monthly on day of month")
		.option("--time <HH:MM>", "Time for weekly/monthly")
		.option("--cron <expr>", "Raw 5-field cron expression")
		.option("--tz <timezone>", "Timezone for wall-clock schedules")
		.option("--disabled", "Create disabled")
		.option("--delete-after-run", "Delete successful one-shot job")
		.option("--json", "Print JSON")
		.action((cronExprParts: string[], options) => {
			const scope = ownerScope(program.opts().ownerScope);
			const store = createDefaultPiboCronStore({ path: program.opts().store });
			const positionalCron = Array.isArray(cronExprParts) && cronExprParts.length ? cronExprParts.join(" ") : undefined;
			const normalized = scheduleFromOptions(options, positionalCron);
			const job = store.createJob({
				ownerScope: scope,
				name: options.name,
				enabled: options.disabled ? false : true,
				target: targetFromOptions({ ...options, ownerScope: scope }),
				profile: options.agent,
				prompt: options.prompt,
				schedule: normalized.schedule,
				scheduleUi: normalized.scheduleUi,
				deleteAfterRun: options.deleteAfterRun === true,
			});
			if (options.json) printJson(job);
			else console.log(`${job.id}\t${job.state.nextRunAt ?? "-"}\t${job.name}`);
			store.close();
		});

	program.command("edit")
		.description("Update a cron job")
		.argument("<id>", "Cron job id")
		.argument("[cronExpr...]", "Raw 5-field cron expression, e.g. \"0 8 * * *\"")
		.option("--room <roomId>", "Target room")
		.option("--personal", "Target the shared default chat")
		.option("--principal-id <id>", "Deprecated no-op for shared default target")
		.option("--agent <profile>", "Agent/profile")
		.option("--name <name>", "Job name")
		.option("--description <text>", "Job description")
		.option("--prompt <text>", "Prompt/task")
		.option("--in <duration>", "Run once after duration, e.g. 20m")
		.option("--at <iso>", "Run once at ISO timestamp")
		.option("--every <duration>", "Run every duration, e.g. 2h")
		.option("--daily <HH:MM>", "Run daily at time")
		.option("--weekly <days>", "Run weekly on comma-separated days")
		.option("--monthly <day>", "Run monthly on day of month")
		.option("--time <HH:MM>", "Time for weekly/monthly")
		.option("--cron <expr>", "Raw 5-field cron expression")
		.option("--tz <timezone>", "Timezone for wall-clock schedules")
		.option("--enabled", "Enable the job")
		.option("--disabled", "Disable the job")
		.option("--delete-after-run", "Delete successful one-shot job")
		.option("--keep-after-run", "Keep job after successful one-shot run")
		.option("--json", "Print JSON")
		.action((id: string, cronExprParts: string[], options) => {
			const scope = ownerScope(program.opts().ownerScope);
			const store = createDefaultPiboCronStore({ path: program.opts().store });
			const positionalCron = Array.isArray(cronExprParts) && cronExprParts.length ? cronExprParts.join(" ") : undefined;
			const normalized = hasScheduleOptions(options, positionalCron) ? scheduleFromOptions(options, positionalCron) : undefined;
			const target = maybeTargetFromOptions({ ...options, ownerScope: scope });
			const patch = {
				...(options.name !== undefined ? { name: options.name } : {}),
				...(options.description !== undefined ? { description: options.description } : {}),
				...(options.agent !== undefined ? { profile: options.agent } : {}),
				...(options.prompt !== undefined ? { prompt: options.prompt } : {}),
				...(target ? { target } : {}),
				...(normalized ? { schedule: normalized.schedule, scheduleUi: normalized.scheduleUi } : {}),
				...(options.enabled === true ? { enabled: true } : {}),
				...(options.disabled === true ? { enabled: false } : {}),
				...(options.deleteAfterRun === true ? { deleteAfterRun: true } : {}),
				...(options.keepAfterRun === true ? { deleteAfterRun: false } : {}),
			};
			if (Object.keys(patch).length === 0) throw new Error("No cron job update fields provided");
			const job = store.updateJob(scope, id, patch);
			if (!job) throw new Error("Cron job not found");
			if (options.json) printJson(job);
			else console.log(`${job.id}\t${job.enabled ? "enabled" : "disabled"}\t${job.state.nextRunAt ?? "-"}\t${job.name}`);
			store.close();
		});

	for (const [name, enabled] of [["pause", false], ["resume", true]] as const) {
		program.command(name).argument("<id>").description(enabled ? "Enable a cron job" : "Disable a cron job").option("--json", "Print JSON").action((id, options) => {
			const scope = ownerScope(program.opts().ownerScope);
			const store = createDefaultPiboCronStore({ path: program.opts().store });
			const job = store.updateJob(scope, id, { enabled });
			if (!job) throw new Error("Cron job not found");
			if (options.json) printJson(job);
			else console.log(`${job.id}\t${job.enabled ? "enabled" : "disabled"}\t${job.state.nextRunAt ?? "-"}`);
			store.close();
		});
	}

	program.command("remove").argument("<id>").description("Delete a cron job").option("--json", "Print JSON").action((id, options) => {
		const scope = ownerScope(program.opts().ownerScope);
		const store = createDefaultPiboCronStore({ path: program.opts().store });
		const removed = store.removeJob(scope, id);
		if (options.json) printJson({ removed });
		else console.log(removed ? "removed" : "not found");
		store.close();
	});

	program.command("runs").description("List cron runs").option("--job <id>", "Filter by job").option("--json", "Print JSON").action((options) => {
		ownerScope(program.opts().ownerScope);
		const store = createDefaultPiboCronStore({ path: program.opts().store });
		const runs = store.listRuns({ jobId: options.job });
		if (options.json) printJson(runs);
		else for (const run of runs) console.log(`${run.id}\t${run.status}\t${run.createdAt}\t${run.piboSessionId ?? "-"}`);
		store.close();
	});

	await program.parseAsync(argv);
}

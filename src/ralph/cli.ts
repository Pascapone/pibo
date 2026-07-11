import { readFileSync } from 'node:fs';
import { Command } from 'commander';
import { createDefaultPiboRalphStore } from './store.js';
import { createBuiltInRalphStopConditions } from './stopping.js';
import { DEFAULT_PIBO_PROFILE_NAME } from '../plugins/builtin.js';
import { getRalphJobTemplate, listRalphJobTemplates } from './templates.js';
import { parsePiboThinkingLevel } from '../core/thinking.js';
import type { ModelProfile } from '../core/profiles.js';
import type { PiboThinkingLevel } from '../core/thinking.js';
import type { PiboRalphJob, PiboRalphJobCreateInput, PiboRalphJobPatchInput, PiboRalphResourceMetadata, PiboRalphRun, PiboRalphTarget } from './types.js';

function printDiscovery(): void { console.log(`pibo ralph

Manage continuous Ralph Pibo agent jobs.

Commands:
  status    Show Ralph status
  list      List Ralph jobs
  add       Create a Ralph job
  edit      Update a Ralph job
  conditions List registered built-in stop conditions
  templates List built-in Ralph job templates
  policy    Show, set, or clear a job stop policy
  start     Start a Ralph job now
  stop      Stop after the current session finishes
  cancel    Abort the current session and stop
  remove    Delete a Ralph job
  runs      List Ralph runs

Next: pibo ralph add --help`); }
function targetFromOptions(options: { room?: string; defaultChat?: boolean }): PiboRalphTarget { if (options.room) return { kind: 'room', roomId: options.room }; if (options.defaultChat) return { kind: 'default-chat' }; throw new Error('Choose a target: --room <room-id> or --default-chat'); }
function maybeTargetFromOptions(options: { room?: string; defaultChat?: boolean }): PiboRalphTarget | undefined { if (options.room || options.defaultChat) return targetFromOptions(options); return undefined; }
function printJson(value: unknown): void { console.log(JSON.stringify(value, null, 2)); }
function maxIterations(value: string | undefined): number | undefined { if (value === undefined) return undefined; const parsed = Number(value); if (!Number.isInteger(parsed) || parsed < 1) throw new Error('--max-iterations must be a positive integer'); return parsed; }
function parseModelOverride(value: string | undefined): ModelProfile | undefined {
	if (value === undefined) return undefined;
	const slash = value.indexOf('/');
	if (slash <= 0 || slash === value.length - 1) throw new Error('--model must use provider/model syntax, for example openai/gpt-5');
	const provider = value.slice(0, slash).trim();
	const id = value.slice(slash + 1).trim();
	if (!provider || !id) throw new Error('--model must use provider/model syntax, for example openai/gpt-5');
	return { provider, id };
}
function parseThinkingOverride(value: string | undefined): PiboThinkingLevel | undefined { return value === undefined ? undefined : parsePiboThinkingLevel(value); }
function applyRuntimeCreateOptions(input: Record<string, unknown>, options: { model?: string; thinking?: string; fast?: boolean }): void {
	const modelOverride = parseModelOverride(options.model);
	const thinkingLevel = parseThinkingOverride(options.thinking);
	if (modelOverride) input.modelOverride = modelOverride;
	if (thinkingLevel) input.thinkingLevel = thinkingLevel;
	if (options.fast !== undefined) input.fastMode = options.fast;
}
function applyRuntimePatchOptions(patch: Record<string, unknown>, options: { model?: string; clearModel?: boolean; thinking?: string; clearThinking?: boolean; fast?: boolean; clearFast?: boolean }): void {
	if (options.model !== undefined && options.clearModel) throw new Error('Choose either --model or --clear-model, not both');
	if (options.thinking !== undefined && options.clearThinking) throw new Error('Choose either --thinking or --clear-thinking, not both');
	if (options.fast !== undefined && options.clearFast) throw new Error('Choose either --fast/--no-fast or --clear-fast, not both');
	if (options.clearModel) patch.modelOverride = null;
	else if (options.model !== undefined) patch.modelOverride = parseModelOverride(options.model);
	if (options.clearThinking) patch.thinkingLevel = null;
	else if (options.thinking !== undefined) patch.thinkingLevel = parseThinkingOverride(options.thinking);
	if (options.clearFast) patch.fastMode = null;
	else if (options.fast !== undefined) patch.fastMode = options.fast;
}
function templatePatch(id: string | undefined): PiboRalphJobPatchInput {
	if (!id) return {};
	const template = getRalphJobTemplate(id);
	if (!template) throw new Error(`Unknown Ralph template: ${id}`);
	return { name: template.job.name, description: template.job.description, prompt: template.job.prompt, maxIterations: template.job.maxIterations ?? null, stopPolicy: template.job.stopPolicy ?? null };
}
function compactResourceText(value: string, max = 80): string { return value.length <= max ? value : `${value.slice(0, max - 1)}…`; }
function shellToken(value: string): string { return /^[A-Za-z0-9._:@/-]+$/.test(value) ? value : `'${value.replace(/'/g, `'"'"'`)}'`; }
export function formatRalphResourceSummary(resources: PiboRalphResourceMetadata | undefined): string {
	if (!resources) return '-';
	const parts = [
		resources.workerId ? `worker=${resources.workerId}` : undefined,
		resources.cleanupState ? `state=${resources.cleanupState}` : undefined,
		resources.browserLeaseIds?.length ? `leases=${resources.browserLeaseIds.length}` : undefined,
		resources.retainedUntil ? `retainedUntil=${resources.retainedUntil}` : undefined,
		resources.dirtyReason ? `dirty=${compactResourceText(resources.dirtyReason)}` : undefined,
	].filter((part): part is string => !!part);
	if (resources.cleanupState === 'dirty') parts.push(`next=${resources.workerId ? `pibo tools browser-use pool reap --worker-id ${shellToken(resources.workerId)} --json` : 'pibo compute reap --dry-run'}`);
	else if (resources.cleanupState === 'retained') parts.push('next=pibo compute reap --dry-run --include-dev');
	return parts.length ? parts.join(';') : '-';
}
function formatRalphJobLine(job: PiboRalphJob): string { return `${job.id}\t${job.enabled ? 'running' : 'stopped'}\t${job.state.runningAt ? 'active' : '-'}\tresources=${formatRalphResourceSummary(job.resources)}\t${job.name}`; }
function formatRalphRunLine(run: PiboRalphRun): string { return `${run.id}\t${run.jobId}\t${run.status}\t${run.piboSessionId ?? '-'}\t${run.completedAt ?? '-'}\tresources=${formatRalphResourceSummary(run.resources)}`; }

export async function runRalphCli(argv = process.argv): Promise<void> {
	const program = new Command();
	program.name('pibo ralph').description('Manage continuous Ralph Pibo jobs').helpOption('-h, --help');
	program.option('--store <path>', 'Ralph store path');
	program.command('status').description('Show Ralph store status').option('--json', 'Print JSON').action((options) => { const store = createDefaultPiboRalphStore({ path: program.opts().store }); const status = store.status(); if (options.json) printJson(status); else { console.log(`jobs\t${status.jobs}`); console.log(`running\t${status.running}`); } store.close(); });
	program.command('list').description('List Ralph jobs').option('--all', 'Include stopped jobs').option('--json', 'Print JSON').action((options) => { const store = createDefaultPiboRalphStore({ path: program.opts().store }); const jobs = store.listJobs({ includeDisabled: options.all }); if (options.json) printJson(jobs); else for (const job of jobs) console.log(formatRalphJobLine(job)); store.close(); });
	program.command('add').description('Create a Ralph job').option('--template <id>', 'Built-in job template id').option('--prompt <text>', 'Task prompt').option('--name <name>', 'Job name').option('--description <text>', 'Job description').option('--profile <profile>', 'Agent profile', DEFAULT_PIBO_PROFILE_NAME).option('--room <room-id>', 'Target room id').option('--default-chat', 'Target the shared default chat').option('--max-iterations <n>', 'Stop after n completed run attempts').option('--model <provider/model>', 'Runtime model override, for example openai/gpt-5').option('--thinking <level>', 'Runtime thinking level override: off, minimal, low, medium, high, xhigh, max').option('--fast', 'Enable runtime fast mode').option('--no-fast', 'Disable runtime fast mode')
		.option('--start', 'Start immediately').option('--json', 'Print JSON').action((options) => { const base = templatePatch(options.template); const prompt = options.prompt ?? base.prompt; if (typeof prompt !== 'string' || !prompt.trim()) throw new Error('Choose --template <id> or provide --prompt <text>'); const input: PiboRalphJobCreateInput = { name: options.name ?? base.name, description: options.description ?? base.description, enabled: options.start === true, target: targetFromOptions(options), profile: options.profile, prompt, maxIterations: options.maxIterations !== undefined ? maxIterations(options.maxIterations) : typeof base.maxIterations === 'number' ? base.maxIterations : undefined, stopPolicy: base.stopPolicy ?? undefined }; applyRuntimeCreateOptions(input as Record<string, unknown>, options); const store = createDefaultPiboRalphStore({ path: program.opts().store }); const job = store.createJob(input); if (options.json) printJson(job); else console.log(`${job.id}\t${job.enabled ? 'running' : 'stopped'}\t${job.name}`); store.close(); });
	program.command('edit').argument('<id>', 'Ralph job id').description('Update a Ralph job').option('--template <id>', 'Apply a built-in job template before explicit overrides').option('--prompt <text>', 'Task prompt').option('--name <name>', 'Job name').option('--description <text>', 'Job description').option('--profile <profile>', 'Agent profile').option('--room <room-id>', 'Target room id').option('--default-chat', 'Target the shared default chat').option('--max-iterations <n>', 'Stop after n completed run attempts').option('--model <provider/model>', 'Set runtime model override, for example openai/gpt-5').option('--clear-model', 'Clear runtime model override').option('--thinking <level>', 'Set runtime thinking level override: off, minimal, low, medium, high, xhigh, max').option('--clear-thinking', 'Clear runtime thinking level override').option('--fast', 'Enable runtime fast mode').option('--no-fast', 'Disable runtime fast mode').option('--clear-fast', 'Clear runtime fast mode override').option('--json', 'Print JSON').action((id, options) => { const store = createDefaultPiboRalphStore({ path: program.opts().store }); const patch: Record<string, unknown> = { ...templatePatch(options.template) }; if (options.name !== undefined) patch.name = options.name; if (options.description !== undefined) patch.description = options.description; if (options.profile !== undefined) patch.profile = options.profile; if (options.prompt !== undefined) patch.prompt = options.prompt; if (options.maxIterations !== undefined) patch.maxIterations = maxIterations(options.maxIterations); applyRuntimePatchOptions(patch, options); const target = maybeTargetFromOptions(options); if (target) patch.target = target; if (Object.keys(patch).length === 0) throw new Error('No Ralph job update fields provided'); const job = store.updateJob(id, patch); if (!job) throw new Error('Ralph job not found'); if (options.json) printJson(job); else console.log(`${job.id}\tupdated\t${job.name}`); store.close(); });
	program.command('conditions').description('List built-in Ralph stop-condition types').option('--json', 'Print JSON').action((options) => { const conditions = createBuiltInRalphStopConditions().map((condition) => ({ type: condition.type, name: condition.name, description: condition.description, phases: condition.phases, defaultOptions: condition.defaultOptions, optionsSchema: condition.optionsSchema })); if (options.json) printJson(conditions); else for (const condition of conditions) console.log(`${condition.type}	${condition.phases.join(',')}	${condition.name}`); });
	program.command('templates').description('List built-in Ralph job templates').option('--json', 'Print JSON').action((options) => { const templates = listRalphJobTemplates(); if (options.json) printJson(templates); else for (const template of templates) console.log(`${template.id}\t${template.category}\t${template.name}\t${template.description}`); });
	const policy = program.command('policy').description('Manage a Ralph job stop policy');
	policy.command('show').argument('<id>').option('--json', 'Print JSON').action((id, options) => { const store = createDefaultPiboRalphStore({ path: program.opts().store }); const job = store.getJob(id); if (!job) throw new Error('Ralph job not found'); const value = job.stopPolicy ?? null; if (options.json) printJson(value); else console.log(value ? JSON.stringify(value, null, 2) : 'default'); store.close(); });
	policy.command('set').argument('<id>').requiredOption('--file <path>', 'JSON stop policy file').option('--json', 'Print JSON').action((id, options) => { const store = createDefaultPiboRalphStore({ path: program.opts().store }); const stopPolicy = JSON.parse(readFileSync(options.file, 'utf8')); const job = store.updateJob(id, { stopPolicy }); if (!job) throw new Error('Ralph job not found'); if (options.json) printJson(job); else console.log(`${job.id}	policy-updated	${job.name}`); store.close(); });
	policy.command('clear').argument('<id>').option('--json', 'Print JSON').action((id, options) => { const store = createDefaultPiboRalphStore({ path: program.opts().store }); const job = store.updateJob(id, { stopPolicy: null }); if (!job) throw new Error('Ralph job not found'); if (options.json) printJson(job); else console.log(`${job.id}	policy-cleared	${job.name}`); store.close(); });
	program.command('start').argument('<id>').description('Mark a Ralph job running; the gateway service starts the next session').option('--json', 'Print JSON').action((id, options) => { const store = createDefaultPiboRalphStore({ path: program.opts().store }); const job = store.updateJob(id, { enabled: true }); if (!job) throw new Error('Ralph job not found'); if (options.json) printJson(job); else console.log(`${job.id}\trunning\t${job.name}`); store.close(); });
	program.command('stop').argument('<id>').description('Stop after the current session finishes').option('--json', 'Print JSON').action((id, options) => { const store = createDefaultPiboRalphStore({ path: program.opts().store }); const job = store.requestStop(id); if (!job) throw new Error('Ralph job not found'); if (options.json) printJson(job); else console.log(`${job.id}\tstopping\t${job.name}`); store.close(); });
	program.command('cancel').argument('<id>').description('Abort the current session and stop').option('--json', 'Print JSON').action((id, options) => { const store = createDefaultPiboRalphStore({ path: program.opts().store }); const job = store.requestCancel(id); if (!job) throw new Error('Ralph job not found'); if (options.json) printJson(job); else console.log(`${job.id}\tcancel-requested\t${job.name}`); store.close(); });
	program.command('remove').argument('<id>').description('Delete a Ralph job').option('--json', 'Print JSON').action((id, options) => { const store = createDefaultPiboRalphStore({ path: program.opts().store }); const removed = store.removeJob(id); if (options.json) printJson({ removed }); else console.log(removed ? 'removed' : 'not found'); store.close(); });
	program.command('runs').description('List Ralph runs').option('--job <id>', 'Filter by job').option('--json', 'Print JSON').action((options) => { const store = createDefaultPiboRalphStore({ path: program.opts().store }); const runs = store.listRuns({ jobId: options.job }); if (options.json) printJson(runs); else for (const run of runs) console.log(formatRalphRunLine(run)); store.close(); });
	if (argv.length <= 2 || (argv.length === 3 && (argv[2] === '--help' || argv[2] === '-h'))) { printDiscovery(); return; }
	await program.parseAsync(argv);
}

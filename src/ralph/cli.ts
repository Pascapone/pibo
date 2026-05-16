import { readFileSync } from 'node:fs';
import { Command } from 'commander';
import { createDefaultPiboRalphStore } from './store.js';
import { createBuiltInRalphStopConditions } from './stopping.js';
import { getRalphJobTemplate, listRalphJobTemplates } from './templates.js';
import type { PiboRalphJobPatchInput, PiboRalphTarget } from './types.js';

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
function ownerScope(value: unknown): string { const trimmed = typeof value === 'string' ? value.trim() : ''; if (!trimmed) throw new Error('--owner-scope is required for Ralph operations'); return trimmed; }
function targetFromOptions(options: { room?: string; personal?: boolean; principalId?: string; ownerScope: string }): PiboRalphTarget { if (options.room) return { kind: 'room', roomId: options.room }; if (options.personal || options.principalId) return { kind: 'personal', principalId: options.principalId ?? options.ownerScope }; throw new Error('Choose a target: --room <room-id> or --personal'); }
function maybeTargetFromOptions(options: { room?: string; personal?: boolean; principalId?: string; ownerScope: string }): PiboRalphTarget | undefined { if (options.room || options.personal || options.principalId) return targetFromOptions(options); return undefined; }
function printJson(value: unknown): void { console.log(JSON.stringify(value, null, 2)); }
function maxIterations(value: string | undefined): number | undefined { if (value === undefined) return undefined; const parsed = Number(value); if (!Number.isInteger(parsed) || parsed < 1) throw new Error('--max-iterations must be a positive integer'); return parsed; }
function templatePatch(id: string | undefined): PiboRalphJobPatchInput {
	if (!id) return {};
	const template = getRalphJobTemplate(id);
	if (!template) throw new Error(`Unknown Ralph template: ${id}`);
	return { name: template.job.name, description: template.job.description, prompt: template.job.prompt, maxIterations: template.job.maxIterations ?? null, stopPolicy: template.job.stopPolicy ?? null };
}

export async function runRalphCli(argv = process.argv): Promise<void> {
	const program = new Command();
	program.name('pibo ralph').description('Manage continuous Ralph Pibo jobs').helpOption('-h, --help');
	program.option('--store <path>', 'Ralph store path');
	program.option('--owner-scope <scope>', 'Owner scope for user-owned Ralph jobs', process.env.PIBO_OWNER_SCOPE);
	program.command('status').description('Show Ralph store status').option('--json', 'Print JSON').action((options) => { const store = createDefaultPiboRalphStore({ path: program.opts().store }); const status = store.status(); if (options.json) printJson(status); else { console.log(`jobs\t${status.jobs}`); console.log(`running\t${status.running}`); } store.close(); });
	program.command('list').description('List Ralph jobs').option('--all', 'Include stopped jobs').option('--json', 'Print JSON').action((options) => { const scope = ownerScope(program.opts().ownerScope); const store = createDefaultPiboRalphStore({ path: program.opts().store }); const jobs = store.listJobs({ ownerScope: scope, includeDisabled: options.all }); if (options.json) printJson(jobs); else for (const job of jobs) console.log(`${job.id}\t${job.enabled ? 'running' : 'stopped'}\t${job.state.runningAt ? 'active' : '-'}\t${job.name}`); store.close(); });
	program.command('add').description('Create a Ralph job').option('--template <id>', 'Built-in job template id').option('--prompt <text>', 'Task prompt').option('--name <name>', 'Job name').option('--description <text>', 'Job description').option('--profile <profile>', 'Agent profile', 'default').option('--room <room-id>', 'Target room id').option('--personal', 'Target personal room').option('--principal-id <id>', 'Personal target principal id').option('--max-iterations <n>', 'Stop after n completed run attempts')
		.option('--start', 'Start immediately').option('--json', 'Print JSON').action((options) => { const scope = ownerScope(program.opts().ownerScope); const base = templatePatch(options.template); const prompt = options.prompt ?? base.prompt; if (typeof prompt !== 'string' || !prompt.trim()) throw new Error('Choose --template <id> or provide --prompt <text>'); const store = createDefaultPiboRalphStore({ path: program.opts().store }); const job = store.createJob({ ownerScope: scope, name: options.name ?? base.name, description: options.description ?? base.description, enabled: options.start === true, target: targetFromOptions({ ...options, ownerScope: scope }), profile: options.profile, prompt, maxIterations: options.maxIterations !== undefined ? maxIterations(options.maxIterations) : typeof base.maxIterations === 'number' ? base.maxIterations : undefined, stopPolicy: base.stopPolicy ?? undefined }); if (options.json) printJson(job); else console.log(`${job.id}\t${job.enabled ? 'running' : 'stopped'}\t${job.name}`); store.close(); });
	program.command('edit').argument('<id>', 'Ralph job id').description('Update a Ralph job').option('--template <id>', 'Apply a built-in job template before explicit overrides').option('--prompt <text>', 'Task prompt').option('--name <name>', 'Job name').option('--description <text>', 'Job description').option('--profile <profile>', 'Agent profile').option('--room <room-id>', 'Target room id').option('--personal', 'Target personal room').option('--principal-id <id>', 'Personal target principal id').option('--max-iterations <n>', 'Stop after n completed run attempts').option('--json', 'Print JSON').action((id, options) => { const scope = ownerScope(program.opts().ownerScope); const store = createDefaultPiboRalphStore({ path: program.opts().store }); const patch: Record<string, unknown> = { ...templatePatch(options.template) }; if (options.name !== undefined) patch.name = options.name; if (options.description !== undefined) patch.description = options.description; if (options.profile !== undefined) patch.profile = options.profile; if (options.prompt !== undefined) patch.prompt = options.prompt; if (options.maxIterations !== undefined) patch.maxIterations = maxIterations(options.maxIterations); const target = maybeTargetFromOptions({ ...options, ownerScope: scope }); if (target) patch.target = target; if (Object.keys(patch).length === 0) throw new Error('No Ralph job update fields provided'); const job = store.updateJob(scope, id, patch); if (!job) throw new Error('Ralph job not found'); if (options.json) printJson(job); else console.log(`${job.id}\tupdated\t${job.name}`); store.close(); });
	program.command('conditions').description('List built-in Ralph stop-condition types').option('--json', 'Print JSON').action((options) => { const conditions = createBuiltInRalphStopConditions().map((condition) => ({ type: condition.type, name: condition.name, description: condition.description, phases: condition.phases, defaultOptions: condition.defaultOptions, optionsSchema: condition.optionsSchema })); if (options.json) printJson(conditions); else for (const condition of conditions) console.log(`${condition.type}	${condition.phases.join(',')}	${condition.name}`); });
	program.command('templates').description('List built-in Ralph job templates').option('--json', 'Print JSON').action((options) => { const templates = listRalphJobTemplates(); if (options.json) printJson(templates); else for (const template of templates) console.log(`${template.id}\t${template.category}\t${template.name}\t${template.description}`); });
	const policy = program.command('policy').description('Manage a Ralph job stop policy');
	policy.command('show').argument('<id>').option('--json', 'Print JSON').action((id, options) => { const scope = ownerScope(program.opts().ownerScope); const store = createDefaultPiboRalphStore({ path: program.opts().store }); const job = store.getOwnedJob(scope, id); if (!job) throw new Error('Ralph job not found'); const value = job.stopPolicy ?? null; if (options.json) printJson(value); else console.log(value ? JSON.stringify(value, null, 2) : 'default'); store.close(); });
	policy.command('set').argument('<id>').requiredOption('--file <path>', 'JSON stop policy file').option('--json', 'Print JSON').action((id, options) => { const scope = ownerScope(program.opts().ownerScope); const store = createDefaultPiboRalphStore({ path: program.opts().store }); const stopPolicy = JSON.parse(readFileSync(options.file, 'utf8')); const job = store.updateJob(scope, id, { stopPolicy }); if (!job) throw new Error('Ralph job not found'); if (options.json) printJson(job); else console.log(`${job.id}	policy-updated	${job.name}`); store.close(); });
	policy.command('clear').argument('<id>').option('--json', 'Print JSON').action((id, options) => { const scope = ownerScope(program.opts().ownerScope); const store = createDefaultPiboRalphStore({ path: program.opts().store }); const job = store.updateJob(scope, id, { stopPolicy: null }); if (!job) throw new Error('Ralph job not found'); if (options.json) printJson(job); else console.log(`${job.id}	policy-cleared	${job.name}`); store.close(); });
	program.command('start').argument('<id>').description('Mark a Ralph job running; the gateway service starts the next session').option('--json', 'Print JSON').action((id, options) => { const scope = ownerScope(program.opts().ownerScope); const store = createDefaultPiboRalphStore({ path: program.opts().store }); const job = store.updateJob(scope, id, { enabled: true }); if (!job) throw new Error('Ralph job not found'); if (options.json) printJson(job); else console.log(`${job.id}\trunning\t${job.name}`); store.close(); });
	program.command('stop').argument('<id>').description('Stop after the current session finishes').option('--json', 'Print JSON').action((id, options) => { const scope = ownerScope(program.opts().ownerScope); const store = createDefaultPiboRalphStore({ path: program.opts().store }); const job = store.requestStop(scope, id); if (!job) throw new Error('Ralph job not found'); if (options.json) printJson(job); else console.log(`${job.id}\tstopping\t${job.name}`); store.close(); });
	program.command('cancel').argument('<id>').description('Abort the current session and stop').option('--json', 'Print JSON').action((id, options) => { const scope = ownerScope(program.opts().ownerScope); const store = createDefaultPiboRalphStore({ path: program.opts().store }); const job = store.requestCancel(scope, id); if (!job) throw new Error('Ralph job not found'); if (options.json) printJson(job); else console.log(`${job.id}\tcancel-requested\t${job.name}`); store.close(); });
	program.command('remove').argument('<id>').description('Delete a Ralph job').option('--json', 'Print JSON').action((id, options) => { const scope = ownerScope(program.opts().ownerScope); const store = createDefaultPiboRalphStore({ path: program.opts().store }); const removed = store.removeJob(scope, id); if (options.json) printJson({ removed }); else console.log(removed ? 'removed' : 'not found'); store.close(); });
	program.command('runs').description('List Ralph runs').option('--job <id>', 'Filter by job').option('--json', 'Print JSON').action((options) => { const scope = ownerScope(program.opts().ownerScope); const store = createDefaultPiboRalphStore({ path: program.opts().store }); const runs = store.listRuns({ ownerScope: scope, jobId: options.job }); if (options.json) printJson(runs); else for (const run of runs) console.log(`${run.id}\t${run.jobId}\t${run.status}\t${run.piboSessionId ?? '-'}\t${run.completedAt ?? '-'}`); store.close(); });
	if (argv.length <= 2 || argv.includes('--help') || argv.includes('-h')) { printDiscovery(); return; }
	await program.parseAsync(argv);
}

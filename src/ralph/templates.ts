import type { PiboRalphStopPolicy } from './types.js';

export type PiboRalphJobTemplate = {
	id: string;
	name: string;
	description: string;
	category: 'prd' | 'general';
	job: {
		name: string;
		description?: string;
		prompt: string;
		maxIterations?: number;
		stopPolicy?: PiboRalphStopPolicy;
	};
};

const promiseCompletePolicy: PiboRalphStopPolicy = {
	mode: 'any',
	conditions: [{ id: 'promise-complete', type: 'pibo.ralph.promise-complete' }],
};

const singleRunPolicy: PiboRalphStopPolicy = {
	mode: 'any',
	conditions: [{ id: 'max-iterations', type: 'pibo.ralph.max-iterations' }],
};

function markdown(strings: TemplateStringsArray): string {
	return String.raw(strings).replaceAll('\\`', '`');
}

export const BUILT_IN_RALPH_JOB_TEMPLATES: readonly PiboRalphJobTemplate[] = [
	{
		id: 'prd-single-story-standard',
		name: 'PRD single story standard',
		description: 'Default Ralph loop: pick the highest-priority failing PRD user story, implement exactly one story, test, commit, update progress, then stop or continue on the next run.',
		category: 'prd',
		job: {
			name: 'Ralph PRD single story',
			description: 'One PRD user story per Ralph iteration.',
			prompt: markdown`# Ralph Auftrag: <Project / Change Name>

## Worktree

Work from the host worktree, not from a container copy:

\`\`\`bash
cd <host-worktree>
\`\`\`

Branch: \`<branch-name>\`  
Base: \`<base-branch-or-commit>\`  
PRDs: \`<path-to-prds>/prd_*.json\`  
Progress log: \`<path-to-prds>/progress.txt\`

If a container is required for build, gateway, or browser checks, use it only for running commands. Edit files and run git commands in the host worktree. Do not edit \`/app\` inside a container.

## Ralph Agent Instructions

You are an autonomous coding agent working on a software project.

### Your Task

1. Work from the host worktree above.
2. Read all PRD JSON files matching \`<path-to-prds>/prd_*.json\`.
3. Read the progress log. If it does not exist, create it.
4. Read the \`## Codebase Patterns\` section at the top of the progress log if present.
5. Pick the highest-priority user story where \`passes: false\`.
6. Implement that single user story only.
7. Run quality checks:
   - Always run \`npm run typecheck\`.
   - Run relevant tests for touched areas.
   - For UI stories, run browser verification in the configured dev container/browser environment.
8. If checks pass, update the PRD JSON to set \`passes: true\` for the completed story.
9. Commit all changes from the host worktree with message:
   \`feat: [Story ID] - [Story Title]\`
10. Append your progress to the progress log.

### Progress Report Format

Append to the progress log. Never replace; always append.

\`\`\`md
## [Date/Time] - [Story ID]
- What was implemented
- Files changed
- Quality checks run
- Browser verification, if UI changed
- **Learnings for future iterations:**
  - Patterns discovered
  - Gotchas encountered
  - Useful context
---
\`\`\`

### Consolidate Patterns

If you discover a reusable pattern, add it to the \`## Codebase Patterns\` section at the top of the progress log. Only add general reusable patterns, not story-specific notes.

## Quality Requirements

- All commits must pass quality checks.
- Do not commit broken code.
- Keep changes focused and minimal.
- Follow existing code patterns.
- For UI stories, browser verification is mandatory.

## Stop Condition

After completing one user story, check whether all stories in all PRD JSON files have \`passes: true\`.

If all stories are complete and passing, reply with the XML completion marker on its own line. Compose it from the opening tag \`<promise>\`, the word \`COMPLETE\`, and the closing tag \`</promise>\`.

Do not quote, negate, explain, or mention that literal marker unless all stories are complete and you intend to stop the job. If any story remains with \`passes: false\`, end normally so another iteration can pick up the next story and say only that the completion marker was omitted.`,
			stopPolicy: promiseCompletePolicy,
		},
	},
	{
		id: 'prd-batch-stories',
		name: 'PRD batch stories',
		description: 'Batch loop: implement several failing PRD user stories in priority order in one Ralph run, committing after each completed story.',
		category: 'prd',
		job: {
			name: 'Ralph PRD batch',
			description: 'Multiple PRD user stories per Ralph run.',
			prompt: markdown`# Ralph Auftrag: <Project / Change Name> Batch

## Worktree

Work from the host worktree:

\`\`\`bash
cd <host-worktree>
\`\`\`

PRDs: \`<path-to-prds>/prd_*.json\`  
Progress log: \`<path-to-prds>/progress.txt\`  
Batch limit: \`<max-stories-this-run>\`

## Task

1. Read the PRD JSON files and progress log.
2. Work through failing user stories in priority order.
3. Complete up to \`<max-stories-this-run>\` stories in this run.
4. Keep each story isolated:
   - implement one story;
   - run relevant checks;
   - set that story's \`passes\` to \`true\` only after checks pass;
   - commit with \`feat: [Story ID] - [Story Title]\`;
   - append a progress-log entry.
5. Stop early if a story is blocked, ambiguous, or tests fail. Do not continue with later stories after a failed story.

## Quality Requirements

- Always run \`npm run typecheck\` before each story commit unless the repository has a documented narrower check for this batch.
- Run relevant tests for touched areas.
- Browser verification is mandatory for UI changes.
- Keep changes focused; do not bundle unrelated refactors.

## Stop Condition

If all stories in all PRD JSON files are complete and passing, reply with the XML completion marker on its own line. Compose it from the opening tag \`<promise>\`, the word \`COMPLETE\`, and the closing tag \`</promise>\`.

Do not quote, negate, explain, or mention that literal marker unless all stories are complete and you intend to stop the job. Otherwise report the stories completed and the next remaining failing story, and say only that the completion marker was omitted.`,
			stopPolicy: promiseCompletePolicy,
		},
	},
	{
		id: 'single-run-objective',
		name: 'Single-run objective',
		description: 'Non-PRD template for one focused objective with explicit done criteria. Stops after one completed run attempt by max-iterations.',
		category: 'general',
		job: {
			name: 'Ralph single-run objective',
			description: 'One focused non-PRD objective.',
			maxIterations: 1,
			stopPolicy: singleRunPolicy,
			prompt: markdown`# Ralph Auftrag: <Objective>

## Worktree

\`\`\`bash
cd <host-worktree>
\`\`\`

Branch: \`<branch-name>\`

## Objective

<Describe the concrete outcome.>

## Done Criteria

- <Pass/fail criterion 1>
- <Pass/fail criterion 2>
- <Required verification command or manual check>

## Instructions

1. Inspect the relevant code and docs before editing.
2. State assumptions in code comments or docs only when they matter for maintainers.
3. Implement the smallest focused change that satisfies the done criteria.
4. Run \`npm run typecheck\` and relevant tests.
5. Commit with a concise message if checks pass.
6. End with a short report listing files changed and verification run.

This is not a PRD loop. Do not edit PRD JSON progress unless the objective explicitly asks for it.`,
		},
	},
];

export function listRalphJobTemplates(): PiboRalphJobTemplate[] {
	return BUILT_IN_RALPH_JOB_TEMPLATES.map((template) => cloneTemplate(template));
}

export function getRalphJobTemplate(id: string): PiboRalphJobTemplate | undefined {
	const template = BUILT_IN_RALPH_JOB_TEMPLATES.find((item) => item.id === id);
	return template ? cloneTemplate(template) : undefined;
}

function cloneTemplate(template: PiboRalphJobTemplate): PiboRalphJobTemplate {
	return JSON.parse(JSON.stringify(template)) as PiboRalphJobTemplate;
}

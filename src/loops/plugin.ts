import type { PiboExecutionEvent, PiboJsonObject } from '../core/events.js';

export type PiboSessionGoalCommand =
	| { operation: 'set'; objective: string }
	| { operation: 'pause' }
	| { operation: 'resume' };

function objectParams(event: PiboExecutionEvent): PiboJsonObject | undefined {
	const params = 'params' in event ? event.params : undefined;
	return params && typeof params === 'object' && !Array.isArray(params) ? params : undefined;
}

export function parsePiboSessionGoalCommand(event: PiboExecutionEvent): PiboSessionGoalCommand {
	const command = objectParams(event)?.command;
	if (typeof command !== 'string' || !command.trim()) throw new Error('Usage: /goal <objective> | /goal pause | /goal resume');
	const normalized = command.trim();
	if (normalized.toLowerCase() === 'pause') return { operation: 'pause' };
	if (normalized.toLowerCase() === 'resume') return { operation: 'resume' };
	if (normalized.length > 20_000) throw new Error('Goal objective is too long');
	return { operation: 'set', objective: normalized };
}

import type { PiboExecutionEvent, PiboJsonObject } from '../core/events.js';
import { definePiboPlugin } from '../plugins/registry.js';
import { createPiboLoopChannel, getPiboLoopService, type PiboLoopChannelOptions } from './channel.js';
import { createBuiltInLoopStopConditions } from './stopping.js';
import { configurePiboGoalToolStorePath } from './tools.js';

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

export function createPiboLoopPlugin(options: PiboLoopChannelOptions = {}) {
	configurePiboGoalToolStorePath(options.loopStorePath);
	return definePiboPlugin({
		id: 'pibo.loop',
		name: 'Pibo Loop',
		register(api) {
			for (const condition of createBuiltInLoopStopConditions()) api.registerLoopStopCondition(condition);
			api.registerGatewayAction({
				name: 'goal',
				description: 'Create or update the session Goal Loop. Use /goal pause or /goal resume to control it.',
				slashCommands: ['goal'],
				execute(context, event) {
					const service = getPiboLoopService();
					if (!service) throw new Error('Loop service is not running');
					const command = parsePiboSessionGoalCommand(event);
					if (command.operation === 'pause') return service.pauseSessionGoal(context.piboSessionId);
					if (command.operation === 'resume') return service.resumeSessionGoal(context.piboSessionId);
					return service.setSessionGoal(context.piboSessionId, command.objective);
				},
			});
			api.registerChannel(createPiboLoopChannel(options));
		},
	});
}

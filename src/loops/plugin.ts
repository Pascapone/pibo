import { definePiboPlugin } from '../plugins/registry.js';
import { createPiboLoopChannel, type PiboLoopChannelOptions } from './channel.js';
import { createBuiltInLoopStopConditions } from './stopping.js';
import { configurePiboGoalToolStorePath } from './tools.js';

export function createPiboLoopPlugin(options: PiboLoopChannelOptions = {}) {
	configurePiboGoalToolStorePath(options.loopStorePath);
	return definePiboPlugin({
		id: 'pibo.loop',
		name: 'Pibo Loop',
		register(api) {
			for (const condition of createBuiltInLoopStopConditions()) api.registerLoopStopCondition(condition);
			api.registerChannel(createPiboLoopChannel(options));
		},
	});
}

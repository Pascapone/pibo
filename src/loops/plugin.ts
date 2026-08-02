import { definePiboPlugin } from '../plugins/registry.js';
import { createPiboLoopChannel, type PiboLoopChannelOptions } from './channel.js';
import { createBuiltInLoopStopConditions } from './stopping.js';

export function createPiboLoopPlugin(options: PiboLoopChannelOptions = {}) {
	return definePiboPlugin({
		id: 'pibo.loop',
		name: 'Pibo Loop',
		register(api) {
			for (const condition of createBuiltInLoopStopConditions()) api.registerLoopStopCondition(condition);
			api.registerChannel(createPiboLoopChannel(options));
		},
	});
}

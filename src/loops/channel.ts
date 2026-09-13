import type { PiboChannel, PiboChannelContext } from '../channels/types.js';
import { PiboLoopService, type PiboLoopServiceOptions } from './service.js';
import { createDefaultPiboLoopStore } from './store.js';

export type PiboLoopChannelOptions = Omit<PiboLoopServiceOptions, 'context' | 'store'> & { loopStorePath?: string };

/** Host-owned system service. The active Loop instance belongs to this controller, never to module-global state. */
export class PiboLoopServiceController {
	private service?: PiboLoopService;

	constructor(private readonly options: PiboLoopChannelOptions = {}) {}

	get(): PiboLoopService | undefined { return this.service; }
	require(): PiboLoopService {
		if (!this.service) throw new Error('Loop service is not running');
		return this.service;
	}
	start(context: PiboChannelContext): void {
		if (this.service) return;
		const service = new PiboLoopService({ ...this.options, context, store: createDefaultPiboLoopStore({ path: this.options.loopStorePath }) });
		service.start();
		this.service = service;
	}
	async stop(): Promise<void> {
		const service = this.service;
		if (!service) return;
		await service.stop();
		if (this.service === service) this.service = undefined;
	}
}

export function createPiboLoopChannel(options: PiboLoopChannelOptions = {}, controller = new PiboLoopServiceController(options)): PiboChannel {
	return {
		name: 'pibo.loop',
		kind: 'custom',
		description: 'Runs continuous Loop Pibo agent jobs.',
		auth: { mode: 'trusted-local' },
		start(context) { controller.start(context); },
		stop() { return controller.stop(); },
	};
}

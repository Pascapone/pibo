import type { PiboChannel } from '../channels/types.js';
import { PiboLoopService, type PiboLoopServiceOptions } from './service.js';
import { createDefaultPiboLoopStore } from './store.js';

export type PiboLoopChannelOptions = Omit<PiboLoopServiceOptions, 'context' | 'store'> & { loopStorePath?: string };
let currentLoopService: PiboLoopService | undefined;
export function getPiboLoopService(): PiboLoopService | undefined { return currentLoopService; }
export function createPiboLoopChannel(options: PiboLoopChannelOptions = {}): PiboChannel {
	return { name: 'pibo.loop', kind: 'custom', description: 'Runs continuous Loop Pibo agent jobs.', auth: { mode: 'trusted-local' }, start(context) { if (currentLoopService) return; currentLoopService = new PiboLoopService({ ...options, context, store: createDefaultPiboLoopStore({ path: options.loopStorePath }) }); currentLoopService.start(); }, async stop() { const service = currentLoopService; if (!service) return; await service.stop(); if (currentLoopService === service) currentLoopService = undefined; } };
}

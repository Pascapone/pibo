#!/usr/bin/env node

import { readFile, writeFile } from 'node:fs/promises';

const statePath = process.env.PIBO_TEST_DOCKER_STATE;
if (!statePath) throw new Error('PIBO_TEST_DOCKER_STATE is required');

const wait = (delayMs) => new Promise((resolve) => setTimeout(resolve, delayMs));
const readState = async () => JSON.parse(await readFile(statePath, 'utf8'));
const command = process.argv[2];

if (command === 'ps') {
	await wait(Number(process.env.PIBO_TEST_DOCKER_PS_DELAY_MS ?? 0));
	const state = await readState();
	for (const block of state.runningBlocks) {
		console.log(`pibo.compute.role=dev,pibo.compute.portBlock=${block}`);
	}
	process.exit(0);
}

if (command === 'run') {
	const args = process.argv.slice(3);
	const nameIndex = args.indexOf('--name');
	const name = nameIndex >= 0 ? args[nameIndex + 1] : '';
	const blockLabel = args.find((value) => value.startsWith('pibo.compute.portBlock='));
	const block = Number(blockLabel?.split('=')[1]);
	await wait(Number(process.env.PIBO_TEST_DOCKER_RUN_DELAY_MS ?? 0));
	if (name === process.env.PIBO_TEST_DOCKER_FAIL_NAME) {
		console.error(`forced docker run failure for ${name}`);
		process.exit(125);
	}
	const state = await readState();
	if (state.runningBlocks.includes(block)) {
		console.error(`Bind for block ${block} failed: port is already allocated`);
		process.exit(125);
	}
	state.runningBlocks.push(block);
	state.workers.push({ name, block });
	await writeFile(statePath, JSON.stringify(state), 'utf8');
	console.log(`fake-${name}`);
	process.exit(0);
}

throw new Error(`unsupported fake docker command: ${process.argv.slice(2).join(' ')}`);

import { spawnDevWorker } from '../../dist/compute/docker.js';

const [repoDir, worktreeName] = process.argv.slice(2);

try {
	const worker = await spawnDevWorker({
		repoDir,
		worktreeName,
		holder: 'compute-dev-port-allocation-test',
		ttlSeconds: 60,
		idleSeconds: 60,
	});
	console.log(JSON.stringify({ ok: true, worker }));
} catch (error) {
	console.log(JSON.stringify({
		ok: false,
		error: String(error?.stderr ?? error?.message ?? error),
	}));
}

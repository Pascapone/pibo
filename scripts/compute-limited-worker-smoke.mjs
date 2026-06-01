#!/usr/bin/env node
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);

function parseArgs(argv) {
	const options = {
		apply: false,
		json: false,
		name: `pibo-worker-policy-smoke-${Date.now()}`,
		holder: 'user:smoke',
		ttlSeconds: '600',
		idleSeconds: '300',
		browserSmoke: true,
	};
	for (let i = 0; i < argv.length; i++) {
		const arg = argv[i];
		if (arg === '--apply') options.apply = true;
		else if (arg === '--dry-run') options.apply = false;
		else if (arg === '--json') options.json = true;
		else if (arg === '--skip-browser-smoke') options.browserSmoke = false;
		else if (arg === '--name') options.name = argv[++i];
		else if (arg === '--holder') options.holder = argv[++i];
		else if (arg === '--ttl-seconds') options.ttlSeconds = argv[++i];
		else if (arg === '--idle-seconds') options.idleSeconds = argv[++i];
		else if (arg === '--help' || arg === '-h') {
			options.help = true;
		} else {
			throw new Error(`Unknown argument: ${arg}`);
		}
	}
	return options;
}

function piboArgs(...args) {
	return ['run', '--silent', 'dev', '--', ...args];
}

function plannedCommands(options) {
	return [
		`npm run --silent dev -- compute spawn --name ${options.name} --holder ${options.holder} --ttl-seconds ${options.ttlSeconds} --idle-seconds ${options.idleSeconds}`,
		`docker inspect ${options.name}`,
		`docker exec ${options.name} bash -lc 'node --version && test -x /usr/bin/chromium'`,
		...(options.browserSmoke ? [`docker exec ${options.name} bash -lc 'export DISPLAY=:99; timeout 20s /usr/bin/chromium --headless --no-sandbox --disable-gpu --dump-dom data:text/html,pibo-smoke'`] : []),
		`npm run --silent dev -- compute list --all --json`,
		`npm run --silent dev -- compute release ${options.name}`,
	];
}

function helpText() {
	return [
		'Usage: node scripts/compute-limited-worker-smoke.mjs [--apply] [--json] [--name <container>] [--skip-browser-smoke]',
		'',
		'Validates that a limited Pibo compute worker can start, expose inspectable resource policy,',
		'accept shell access, and run a bounded Chromium smoke path. Default mode is a dry-run',
		'plan and creates no Docker resources.',
		'',
		'Examples:',
		'  node scripts/compute-limited-worker-smoke.mjs --dry-run',
		'  node scripts/compute-limited-worker-smoke.mjs --apply --json',
	].join('\n');
}

async function execCapture(file, args, options = {}) {
	return execFileAsync(file, args, {
		cwd: process.cwd(),
		timeout: options.timeout ?? 120_000,
		maxBuffer: options.maxBuffer ?? 10 * 1024 * 1024,
	});
}

async function dockerAvailable() {
	try {
		await execCapture('docker', ['version', '--format', '{{.Server.Version}}'], { timeout: 10_000 });
		return { available: true };
	} catch (error) {
		return { available: false, error: error.message };
	}
}

function parseSpawnOutput(stdout) {
	const trimmed = stdout.trim();
	if (!trimmed) throw new Error('compute spawn returned no JSON on stdout');
	return JSON.parse(trimmed);
}

function summarizeInspect(inspect) {
	const hostConfig = inspect.HostConfig ?? {};
	const labels = inspect.Config?.Labels ?? {};
	return {
		memory: hostConfig.Memory,
		memorySwap: hostConfig.MemorySwap,
		pidsLimit: hostConfig.PidsLimit,
		shmSize: hostConfig.ShmSize,
		restartPolicy: hostConfig.RestartPolicy,
		logConfig: hostConfig.LogConfig,
		labels: {
			role: labels['pibo.compute.role'],
			holder: labels['pibo.compute.holder'],
			ttlSeconds: labels['pibo.compute.ttlSeconds'],
			idleSeconds: labels['pibo.compute.idleSeconds'],
			memory: labels['pibo.compute.resource.memory'],
			memorySwap: labels['pibo.compute.resource.memorySwap'],
			pidsLimit: labels['pibo.compute.resource.pidsLimit'],
			shmSize: labels['pibo.compute.resource.shmSize'],
			restart: labels['pibo.compute.resource.restart'],
			logMaxSize: labels['pibo.compute.resource.logMaxSize'],
			logMaxFile: labels['pibo.compute.resource.logMaxFile'],
		},
	};
}

function assertPolicy(summary) {
	const missing = [];
	if (!summary.memory) missing.push('HostConfig.Memory');
	if (!summary.memorySwap) missing.push('HostConfig.MemorySwap');
	if (!summary.pidsLimit) missing.push('HostConfig.PidsLimit');
	if (!summary.shmSize) missing.push('HostConfig.ShmSize');
	if (summary.restartPolicy?.Name !== 'no') missing.push('HostConfig.RestartPolicy.Name=no');
	if (summary.logConfig?.Type !== 'json-file') missing.push('HostConfig.LogConfig.Type=json-file');
	for (const [key, value] of Object.entries(summary.labels)) {
		if (!value) missing.push(`label:${key}`);
	}
	if (missing.length) throw new Error(`Limited worker resource policy missing: ${missing.join(', ')}`);
}

async function run(options) {
	const plan = plannedCommands(options);
	if (!options.apply) {
		return {
			status: 'skipped',
			reason: 'dry-run; pass --apply to create and release a temporary Docker worker',
			readOnly: true,
			plannedCommands: plan,
		};
	}

	const docker = await dockerAvailable();
	if (!docker.available) {
		return {
			status: 'skipped',
			reason: `Docker unavailable: ${docker.error}`,
			readOnly: true,
			plannedCommands: plan,
		};
	}

	let spawned;
	const evidence = { plannedCommands: plan };
	try {
		const spawn = await execCapture('npm', piboArgs('compute', 'spawn', '--name', options.name, '--holder', options.holder, '--ttl-seconds', options.ttlSeconds, '--idle-seconds', options.idleSeconds), { timeout: 300_000 });
		spawned = parseSpawnOutput(spawn.stdout);
		evidence.spawned = spawned;

		const inspectOutput = await execCapture('docker', ['inspect', options.name]);
		const inspect = JSON.parse(inspectOutput.stdout)[0];
		const resourcePolicy = summarizeInspect(inspect);
		assertPolicy(resourcePolicy);
		evidence.resourcePolicy = resourcePolicy;

		const shell = await execCapture('docker', ['exec', options.name, 'bash', '-lc', 'node --version && test -x /usr/bin/chromium && /usr/bin/chromium --version'], { timeout: 30_000 });
		evidence.shell = shell.stdout.trim().split('\n');

		if (options.browserSmoke) {
			const browser = await execCapture('docker', ['exec', options.name, 'bash', '-lc', "export DISPLAY=:99; timeout 20s /usr/bin/chromium --headless --no-sandbox --disable-gpu --dump-dom 'data:text/html,<p>pibo-smoke</p>' | grep pibo-smoke"], { timeout: 40_000 });
			evidence.browserSmoke = browser.stdout.trim();
		}

		const listOutput = await execCapture('npm', piboArgs('compute', 'list', '--all', '--json'));
		const listed = JSON.parse(listOutput.stdout).workers.find((worker) => worker.name === options.name || worker.id === spawned.id);
		if (!listed) throw new Error('Spawned worker was not visible in pibo compute list --all --json');
		evidence.computeList = listed;

		return { status: 'passed', readOnly: false, evidence };
	} finally {
		if (spawned) {
			try {
				const released = await execCapture('npm', piboArgs('compute', 'release', options.name), { timeout: 120_000 });
				evidence.release = released.stdout.trim();
			} catch (releaseError) {
				evidence.releaseError = releaseError.message;
				try {
					await execCapture('docker', ['rm', '-f', options.name], { timeout: 60_000 });
					evidence.releaseFallback = 'docker rm -f completed';
				} catch (fallbackError) {
					evidence.releaseFallbackError = fallbackError.message;
				}
			}
		}
	}
}

try {
	const options = parseArgs(process.argv.slice(2));
	if (options.help) {
		console.log(helpText());
		process.exit(0);
	}
	const result = await run(options);
	if (options.json) console.log(JSON.stringify(result, null, 2));
	else if (result.status === 'passed') {
		console.log('Limited worker smoke passed.');
		console.log(JSON.stringify(result.evidence.resourcePolicy, null, 2));
	} else {
		console.log(`Limited worker smoke skipped: ${result.reason}`);
		for (const command of result.plannedCommands) console.log(`Next: ${command}`);
	}
} catch (error) {
	console.error(error.stack || error.message);
	process.exit(1);
}

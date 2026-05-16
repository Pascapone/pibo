import { spawn, spawnSync, type ChildProcessWithoutNullStreams } from "node:child_process";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

const DEFAULT_ROWS = 24;
const DEFAULT_COLS = 100;
const DEFAULT_TIMEOUT_MS = 60_000;
const DEFAULT_IDLE_TIMEOUT_MS = 10_000;
const DEFAULT_INPUT_DELAY_MS = 40;
const DEFAULT_REAL_PROVIDER_MAX_ITERATIONS = 10;
const ARTIFACT_SCHEMA_VERSION = 1;

const PYTHON_PTY_DRIVER = String.raw`
import os, sys, pty, select, subprocess, signal, termios, fcntl, struct, time
rows = int(os.environ.get("PIBO_PTY_ROWS", "24"))
cols = int(os.environ.get("PIBO_PTY_COLS", "100"))
cmd = sys.argv[1:]
if cmd and cmd[0] == "--":
    cmd = cmd[1:]
if not cmd:
    print("missing command", file=sys.stderr)
    sys.exit(64)
master, slave = pty.openpty()
try:
    fcntl.ioctl(slave, termios.TIOCSWINSZ, struct.pack("HHHH", rows, cols, 0, 0))
except Exception:
    pass
proc = subprocess.Popen(cmd, stdin=slave, stdout=slave, stderr=slave, close_fds=True, start_new_session=True)
os.close(slave)
os.set_blocking(master, False)
os.set_blocking(sys.stdin.fileno(), False)
stdin_open = True

def terminate(signum, frame):
    try:
        os.killpg(proc.pid, signum)
    except Exception:
        try:
            proc.terminate()
        except Exception:
            pass
signal.signal(signal.SIGTERM, terminate)
signal.signal(signal.SIGINT, terminate)

def drain_once():
    try:
        data = os.read(master, 4096)
    except OSError:
        return False
    if not data:
        return False
    os.write(sys.stdout.fileno(), data)
    sys.stdout.flush()
    return True

exit_code = None
while True:
    fds = [master]
    if stdin_open:
        fds.append(sys.stdin.fileno())
    try:
        readable, _, _ = select.select(fds, [], [], 0.05)
    except OSError:
        readable = []
    if master in readable:
        if not drain_once():
            break
    if stdin_open and sys.stdin.fileno() in readable:
        try:
            data = os.read(sys.stdin.fileno(), 4096)
        except BlockingIOError:
            data = b""
        except OSError:
            stdin_open = False
            data = b""
        if data:
            try:
                os.write(master, data)
            except OSError:
                pass
        else:
            stdin_open = False
    polled = proc.poll()
    if polled is not None:
        exit_code = polled
        deadline = time.time() + 0.2
        while time.time() < deadline and drain_once():
            pass
        break
if exit_code is None:
    exit_code = proc.poll()
if exit_code is None:
    try:
        proc.terminate()
    except Exception:
        pass
    exit_code = proc.wait(timeout=1)
sys.exit(exit_code if exit_code is not None else 1)
`;

type ProviderMode = "mocked" | "deterministic" | "real";
type PtyBackend = "host" | "docker";

type PtyStep = {
	waitFor?: string;
	typeText?: string;
	writeBytes?: string;
	press?: string;
	sleepMs?: number;
	expect?: string;
	reject?: string;
	timeoutMs?: number;
	iteration?: boolean;
};

type PtyScenario = {
	name?: string;
	command: string[];
	cwd?: string;
	workdir?: string;
	env?: Record<string, string>;
	rows?: number;
	cols?: number;
	timeoutMs?: number;
	idleTimeoutMs?: number;
	inputDelayMs?: number;
	providerMode?: ProviderMode;
	maxIterations?: number;
	artifactDir?: string;
	artifact?: boolean;
	steps?: PtyStep[];
	expect?: string[];
	reject?: string[];
	stopPatterns?: string[];
};

type PtyOptions = {
	positionals: string[];
	rows?: string;
	cols?: string;
	timeoutMs?: string;
	idleTimeoutMs?: string;
	inputDelayMs?: string;
	artifactDir?: string;
	artifact: boolean;
	dockerWorker?: string;
	workdir?: string;
	realProvider: boolean;
	providerMode?: string;
	maxIterations?: string;
	name?: string;
	env: string[];
	expect: string[];
	reject: string[];
	stopPatterns: string[];
	steps: PtyStep[];
	command: string[];
	builtin?: string;
};

type NormalizedScenario = Required<Pick<PtyScenario, "rows" | "cols" | "timeoutMs" | "idleTimeoutMs" | "inputDelayMs">> & PtyScenario & {
	name: string;
	providerMode: ProviderMode;
	maxIterations?: number;
	steps: PtyStep[];
	expect: string[];
	reject: string[];
	stopPatterns: string[];
	env: Record<string, string>;
	backend: PtyBackend;
	dockerWorker?: string;
	artifactDir: string;
	writeArtifactsOnSuccess: boolean;
};

type PtyEvent = { t: number; source: "stdout" | "stdin" | "system"; data?: string; kind?: string; detail?: string };

type PtyResult = {
	ok: boolean;
	name: string;
	backend: PtyBackend;
	exitCode: number | null;
	signal: NodeJS.Signals | null;
	stopReason: string;
	startedAt: string;
	endedAt: string;
	durationMs: number;
	artifactDir?: string;
	rawOutput: string;
	driverStderr: string;
	events: PtyEvent[];
	assertions: AssertionResult[];
	iterations: number;
};

type AssertionResult = {
	type: "expect" | "reject";
	pattern: string;
	passed: boolean;
	message?: string;
};

type RunningPty = {
	backend: PtyBackend;
	ptyMethod: string;
	write(data: string | Buffer): Promise<void>;
	terminate(reason: string): Promise<void>;
	waitForExit(timeoutMs: number): Promise<{ exitCode: number | null; signal: NodeJS.Signals | null; timedOut: boolean }>;
	getRawOutput(): string;
	getDriverStderr(): string;
	getEvents(): PtyEvent[];
};

export async function runDebugPty(args: string[]): Promise<void> {
	if (args.length === 0 || args[0] === "--help" || args[0] === "-h") {
		printPtyDiscovery();
		return;
	}
	const command = args[0];
	if (command === "run") {
		if (args[1] === "--help" || args[1] === "-h") {
			printPtyDiscovery();
			return;
		}
		const options = parsePtyOptions(args.slice(1));
		if (options.command.length === 0) throw new Error("pibo debug pty run requires -- <command...>");
		const scenario = scenarioFromRunOptions(options);
		const result = await executePtyScenario(scenario, options);
		printRunResult(result);
		return;
	}
	if (command === "scenario") {
		if (args[1] === "--help" || args[1] === "-h") {
			printPtyDiscovery();
			return;
		}
		const options = parsePtyOptions(args.slice(1));
		const scenario = await loadScenarioFromOptions(options);
		const result = await executePtyScenario(scenario, options);
		printRunResult(result);
		return;
	}
	if (command === "list-scenarios") {
		printBuiltinScenarios();
		return;
	}
	throw new Error(`Unknown pibo debug pty command "${command}". Run pibo debug pty --help.`);
}

function printPtyDiscovery(): void {
	console.log(`pibo debug pty - run and inspect interactive CLI/TUI commands under a pseudo-terminal

Commands:
  run             Run one command under PTY
  scenario        Run a declarative PTY scenario JSON file
  list-scenarios  List built-in scenario names

Usage:
  pibo debug pty run [options] -- <command...>
  pibo debug pty scenario [options] <file>
  pibo debug pty scenario --builtin cli-session-ui-mocked-e2e

Common options:
  --rows <n>                 Terminal rows (default: ${DEFAULT_ROWS})
  --cols <n>                 Terminal columns (default: ${DEFAULT_COLS})
  --timeout-ms <n>           Wall-clock timeout (default: ${DEFAULT_TIMEOUT_MS})
  --idle-timeout-ms <n>      Idle timeout after no output (default: ${DEFAULT_IDLE_TIMEOUT_MS})
  --input-delay-ms <n>       Delay between typed characters (default: ${DEFAULT_INPUT_DELAY_MS})
  --artifact-dir <path>      Artifact directory
  --artifact                 Write artifacts for successful runs too
  --expect <text>            Require cleaned output text (repeatable)
  --reject <text>            Forbid cleaned output text (repeatable)
  --type <text>              Type text as a scenario step
  --press <key>              Press Enter, Escape, CtrlC, Up, or Down
  --wait-for <text>          Wait until cleaned output contains text
  --sleep-ms <n>             Sleep as a scenario step
  --docker-worker <name>     Run inside a named Docker worker/container
  --workdir <path>           Workdir for host cwd or Docker -w
  --real-provider            Explicitly allow live provider scenarios
  --max-iterations <n>       Real-provider iteration cap (default: ${DEFAULT_REAL_PROVIDER_MAX_ITERATIONS})

Safety:
  Mocked/deterministic mode is default. Real provider mode requires --real-provider and bounded iterations.
`);
}

function printBuiltinScenarios(): void {
	console.log(`Built-in PTY scenarios:
  cli-session-ui-mocked-e2e    Runs pibo tui:sessions without --demo using a deterministic debug fixture when available

Next:
  pibo debug pty scenario --builtin cli-session-ui-mocked-e2e --artifact
`);
}

function parsePtyOptions(args: string[]): PtyOptions {
	const options: PtyOptions = {
		positionals: [],
		artifact: false,
		realProvider: false,
		env: [],
		expect: [],
		reject: [],
		stopPatterns: [],
		steps: [],
		command: [],
	};
	let commandMode = false;
	for (let index = 0; index < args.length; index++) {
		const arg = args[index];
		if (commandMode) {
			options.command.push(arg);
			continue;
		}
		if (arg === "--") {
			commandMode = true;
			continue;
		}
		if (arg === "--artifact") options.artifact = true;
		else if (arg === "--real-provider") options.realProvider = true;
		else if (arg === "--rows") options.rows = requireOptionValue(args, ++index, arg);
		else if (arg === "--cols") options.cols = requireOptionValue(args, ++index, arg);
		else if (arg === "--timeout-ms") options.timeoutMs = requireOptionValue(args, ++index, arg);
		else if (arg === "--idle-timeout-ms") options.idleTimeoutMs = requireOptionValue(args, ++index, arg);
		else if (arg === "--input-delay-ms") options.inputDelayMs = requireOptionValue(args, ++index, arg);
		else if (arg === "--artifact-dir") options.artifactDir = requireOptionValue(args, ++index, arg);
		else if (arg === "--docker-worker") options.dockerWorker = requireOptionValue(args, ++index, arg);
		else if (arg === "--workdir") options.workdir = requireOptionValue(args, ++index, arg);
		else if (arg === "--provider-mode") options.providerMode = requireOptionValue(args, ++index, arg);
		else if (arg === "--max-iterations") options.maxIterations = requireOptionValue(args, ++index, arg);
		else if (arg === "--name") options.name = requireOptionValue(args, ++index, arg);
		else if (arg === "--env") options.env.push(requireOptionValue(args, ++index, arg));
		else if (arg === "--expect") options.expect.push(requireOptionValue(args, ++index, arg));
		else if (arg === "--reject") options.reject.push(requireOptionValue(args, ++index, arg));
		else if (arg === "--stop-pattern") options.stopPatterns.push(requireOptionValue(args, ++index, arg));
		else if (arg === "--type") options.steps.push({ typeText: requireOptionValue(args, ++index, arg) });
		else if (arg === "--press") options.steps.push({ press: requireOptionValue(args, ++index, arg) });
		else if (arg === "--wait-for") options.steps.push({ waitFor: requireOptionValue(args, ++index, arg) });
		else if (arg === "--sleep-ms") options.steps.push({ sleepMs: parseNonNegativeInteger(requireOptionValue(args, ++index, arg), arg) });
		else if (arg === "--builtin") options.builtin = requireOptionValue(args, ++index, arg);
		else if (arg === "--help" || arg === "-h") {
			printPtyDiscovery();
			process.exitCode = 0;
			return options;
		} else if (arg.startsWith("--")) {
			throw new Error(`Unknown pibo debug pty option "${arg}"`);
		} else {
			options.positionals.push(arg);
		}
	}
	return options;
}

function requireOptionValue(args: string[], index: number, option: string): string {
	const value = args[index];
	if (!value || value.startsWith("--")) throw new Error(`${option} requires a value`);
	return value;
}

function scenarioFromRunOptions(options: PtyOptions): PtyScenario {
	return {
		name: options.name ?? "adhoc-run",
		command: options.command,
		cwd: options.workdir,
		env: envPairsToRecord(options.env),
		rows: numberOption(options.rows, "--rows"),
		cols: numberOption(options.cols, "--cols"),
		timeoutMs: numberOption(options.timeoutMs, "--timeout-ms"),
		idleTimeoutMs: numberOption(options.idleTimeoutMs, "--idle-timeout-ms"),
		inputDelayMs: numberOption(options.inputDelayMs, "--input-delay-ms"),
		providerMode: parseProviderMode(options.providerMode ?? (options.realProvider ? "real" : undefined)),
		maxIterations: numberOption(options.maxIterations, "--max-iterations"),
		artifactDir: options.artifactDir,
		artifact: options.artifact,
		steps: options.steps,
		expect: options.expect,
		reject: options.reject,
		stopPatterns: options.stopPatterns,
	};
}

async function loadScenarioFromOptions(options: PtyOptions): Promise<PtyScenario> {
	if (options.builtin) return builtinScenario(options.builtin, options);
	const file = options.positionals[0];
	if (!file) throw new Error("pibo debug pty scenario requires <file> or --builtin <name>");
	const parsed = JSON.parse(await readFile(file, "utf8")) as unknown;
	const scenario = validateScenario(parsed, file);
	return applyScenarioOverrides(scenario, options);
}

function builtinScenario(name: string, options: PtyOptions): PtyScenario {
	if (name !== "cli-session-ui-mocked-e2e") throw new Error(`Unknown built-in PTY scenario "${name}"`);
	return applyScenarioOverrides({
		name,
		command: ["pibo", "tui:sessions"],
		rows: 24,
		cols: 100,
		timeoutMs: 90_000,
		idleTimeoutMs: 15_000,
		inputDelayMs: 45,
		providerMode: "mocked",
		artifactDir: "tmp/pty-smoke-artifacts/cli-session-ui-mocked-e2e",
		env: {
			PIBO_DEBUG_PTY_SCENARIO: "cli-session-ui-mocked-e2e",
			PIBO_DEBUG_PTY_CLI_SESSIONS_MOCKED: "1",
			PIBO_DEBUG_PTY_ASSISTANT_REPLY: "Mocked PTY assistant response",
		},
		steps: [
			{ waitFor: "Pibo CLI Sessions", timeoutMs: 20_000 },
			{ typeText: "/new" },
			{ press: "Enter" },
			{ sleepMs: 750 },
			{ typeText: "Hi", iteration: true },
			{ press: "Enter" },
			{ waitFor: "Mocked PTY assistant response", timeoutMs: 10_000 },
			{ typeText: "/status" },
			{ press: "Enter" },
			{ waitFor: "source=", timeoutMs: 10_000 },
			{ typeText: "/quit" },
			{ press: "Enter" },
		],
		expect: ["Pibo CLI Sessions", "Hi", "Mocked PTY assistant response"],
		reject: ["UnhandledPromiseRejection", "source_closed"],
	}, options);
}

function applyScenarioOverrides(scenario: PtyScenario, options: PtyOptions): PtyScenario {
	return {
		...scenario,
		name: options.name ?? scenario.name,
		cwd: options.workdir ?? scenario.cwd,
		workdir: options.workdir ?? scenario.workdir,
		env: { ...(scenario.env ?? {}), ...envPairsToRecord(options.env) },
		rows: numberOption(options.rows, "--rows") ?? scenario.rows,
		cols: numberOption(options.cols, "--cols") ?? scenario.cols,
		timeoutMs: numberOption(options.timeoutMs, "--timeout-ms") ?? scenario.timeoutMs,
		idleTimeoutMs: numberOption(options.idleTimeoutMs, "--idle-timeout-ms") ?? scenario.idleTimeoutMs,
		inputDelayMs: numberOption(options.inputDelayMs, "--input-delay-ms") ?? scenario.inputDelayMs,
		providerMode: parseProviderMode(options.providerMode ?? (options.realProvider ? "real" : undefined)) ?? scenario.providerMode,
		maxIterations: numberOption(options.maxIterations, "--max-iterations") ?? scenario.maxIterations,
		artifactDir: options.artifactDir ?? scenario.artifactDir,
		artifact: options.artifact || scenario.artifact,
		steps: [...(scenario.steps ?? []), ...options.steps],
		expect: [...(scenario.expect ?? []), ...options.expect],
		reject: [...(scenario.reject ?? []), ...options.reject],
		stopPatterns: [...(scenario.stopPatterns ?? []), ...options.stopPatterns],
	};
}

function validateScenario(value: unknown, source: string): PtyScenario {
	if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error(`${source}: scenario must be an object`);
	const raw = value as Record<string, unknown>;
	if (!Array.isArray(raw.command) || raw.command.some((item) => typeof item !== "string") || raw.command.length === 0) {
		throw new Error(`${source}: command must be a non-empty string array`);
	}
	const scenario: PtyScenario = {
		name: optionalString(raw.name, "name", source),
		command: raw.command as string[],
		cwd: optionalString(raw.cwd, "cwd", source),
		workdir: optionalString(raw.workdir, "workdir", source),
		env: optionalStringRecord(raw.env, "env", source),
		rows: optionalPositiveNumber(raw.rows, "rows", source),
		cols: optionalPositiveNumber(raw.cols, "cols", source),
		timeoutMs: optionalPositiveNumber(raw.timeoutMs, "timeoutMs", source),
		idleTimeoutMs: optionalPositiveNumber(raw.idleTimeoutMs, "idleTimeoutMs", source),
		inputDelayMs: optionalNonNegativeNumber(raw.inputDelayMs, "inputDelayMs", source),
		providerMode: parseProviderModeValue(raw.providerMode, "providerMode", source),
		maxIterations: optionalPositiveNumber(raw.maxIterations, "maxIterations", source),
		artifactDir: optionalString(raw.artifactDir, "artifactDir", source),
		artifact: optionalBoolean(raw.artifact, "artifact", source),
		steps: parseSteps(raw.steps, source),
		expect: optionalStringArray(raw.expect, "expect", source),
		reject: optionalStringArray(raw.reject, "reject", source),
		stopPatterns: optionalStringArray(raw.stopPatterns, "stopPatterns", source),
	};
	return scenario;
}

function parseSteps(value: unknown, source: string): PtyStep[] {
	if (value === undefined) return [];
	if (!Array.isArray(value)) throw new Error(`${source}: steps must be an array`);
	return value.map((step, index) => {
		if (!step || typeof step !== "object" || Array.isArray(step)) throw new Error(`${source}: steps[${index}] must be an object`);
		const raw = step as Record<string, unknown>;
		const parsed: PtyStep = {
			waitFor: optionalString(raw.waitFor, `steps[${index}].waitFor`, source),
			typeText: optionalString(raw.typeText, `steps[${index}].typeText`, source),
			writeBytes: optionalString(raw.writeBytes, `steps[${index}].writeBytes`, source),
			press: optionalString(raw.press, `steps[${index}].press`, source),
			sleepMs: optionalNonNegativeNumber(raw.sleepMs, `steps[${index}].sleepMs`, source),
			expect: optionalString(raw.expect, `steps[${index}].expect`, source),
			reject: optionalString(raw.reject, `steps[${index}].reject`, source),
			timeoutMs: optionalPositiveNumber(raw.timeoutMs, `steps[${index}].timeoutMs`, source),
			iteration: optionalBoolean(raw.iteration, `steps[${index}].iteration`, source),
		};
		const actionCount = [parsed.waitFor, parsed.typeText, parsed.writeBytes, parsed.press, parsed.sleepMs, parsed.expect, parsed.reject].filter((item) => item !== undefined).length;
		if (actionCount !== 1) throw new Error(`${source}: steps[${index}] must define exactly one action`);
		return parsed;
	});
}

async function executePtyScenario(input: PtyScenario, options: PtyOptions): Promise<PtyResult> {
	const scenario = normalizeScenario(input, options);
	const started = Date.now();
	const startedAt = new Date(started).toISOString();
	let runner: RunningPty | undefined;
	const assertions: AssertionResult[] = [];
	let iterations = 0;
	let stopReason = "completed";
	try {
		validateProviderSafety(scenario, options);
		runner = await startRunner(scenario);
		let lastOutputAt = Date.now();
		let outputLength = 0;
		const refreshOutputTimestamp = () => {
			const raw = runner?.getRawOutput() ?? "";
			if (raw.length !== outputLength) {
				outputLength = raw.length;
				lastOutputAt = Date.now();
			}
			return lastOutputAt;
		};
		for (const step of scenario.steps) {
			if (step.iteration === true) {
				iterations += 1;
				if (scenario.providerMode === "real" && scenario.maxIterations !== undefined && iterations > scenario.maxIterations) {
					stopReason = "max_iterations";
					throw new Error(`Real-provider PTY scenario exceeded max iterations (${scenario.maxIterations})`);
				}
			}
			await checkIdle(runner, refreshOutputTimestamp, scenario.idleTimeoutMs);
			await runStep(runner, scenario, step, assertions, refreshOutputTimestamp);
			refreshOutputTimestamp();
			const clean = cleanTerminalText(runner.getRawOutput());
			const matchedStop = scenario.stopPatterns.find((pattern) => clean.includes(pattern));
			if (matchedStop) {
				stopReason = `stop_pattern:${matchedStop}`;
				break;
			}
		}
		const exit = await waitForExitOrIdle(runner, Math.max(1, scenario.timeoutMs - (Date.now() - started)), scenario.idleTimeoutMs, refreshOutputTimestamp);
		if (exit.idleTimedOut) {
			stopReason = "idle_timeout";
			throw new Error(`PTY command produced no output for ${scenario.idleTimeoutMs}ms`);
		}
		if (exit.timedOut) {
			stopReason = stopReason === "completed" ? "wall_clock_timeout" : stopReason;
			throw new Error(`PTY command timed out after ${scenario.timeoutMs}ms`);
		}
		const clean = cleanTerminalText(runner.getRawOutput());
		assertPatterns(clean, scenario.expect, scenario.reject, assertions);
		if (exit.exitCode !== 0) {
			stopReason = `exit_code:${exit.exitCode ?? "signal"}`;
			throw new Error(`PTY command exited with status ${exit.exitCode ?? exit.signal ?? "unknown"}`);
		}
		const result = buildResult(scenario, runner, true, assertions, iterations, started, startedAt, stopReason, exit.exitCode, exit.signal);
		if (scenario.writeArtifactsOnSuccess) result.artifactDir = await writeArtifacts(scenario, result);
		return result;
	} catch (error) {
		if (runner) await runner.terminate(stopReason);
		const result = buildResult(scenario, runner, false, assertions, iterations, started, startedAt, stopReason, null, null);
		result.artifactDir = await writeArtifacts(scenario, result, error instanceof Error ? error.message : String(error));
		const message = `${error instanceof Error ? error.message : String(error)}\nPTY artifacts: ${result.artifactDir}`;
		throw new Error(message);
	}
}

function normalizeScenario(input: PtyScenario, options: PtyOptions): NormalizedScenario {
	const providerMode = parseProviderMode(options.providerMode ?? (options.realProvider ? "real" : undefined)) ?? input.providerMode ?? "mocked";
	const name = input.name ?? options.name ?? "pty-scenario";
	const timeoutMs = input.timeoutMs ?? DEFAULT_TIMEOUT_MS;
	const idleTimeoutMs = input.idleTimeoutMs ?? DEFAULT_IDLE_TIMEOUT_MS;
	const artifactDir = input.artifactDir ?? options.artifactDir ?? path.join("tmp", "pty-smoke-artifacts", `${safeName(name)}-${new Date().toISOString().replace(/[:.]/g, "-")}`);
	const env = { ...(input.env ?? {}) };
	if (env.PIBO_DEBUG_PTY_SCENARIO === "cli-session-ui-mocked-e2e" && env.PIBO_HOME === undefined) {
		env.PIBO_HOME = path.resolve(artifactDir, "pibo-home");
	}
	return {
		...input,
		name,
		command: [...input.command],
		cwd: input.cwd ?? input.workdir ?? options.workdir,
		workdir: options.workdir ?? input.workdir ?? input.cwd,
		env,
		rows: input.rows ?? DEFAULT_ROWS,
		cols: input.cols ?? DEFAULT_COLS,
		timeoutMs,
		idleTimeoutMs,
		inputDelayMs: input.inputDelayMs ?? DEFAULT_INPUT_DELAY_MS,
		providerMode,
		maxIterations: providerMode === "real" ? (input.maxIterations ?? DEFAULT_REAL_PROVIDER_MAX_ITERATIONS) : input.maxIterations,
		artifactDir,
		writeArtifactsOnSuccess: options.artifact || input.artifact === true,
		steps: input.steps ?? [],
		expect: input.expect ?? [],
		reject: input.reject ?? [],
		stopPatterns: input.stopPatterns ?? [],
		backend: options.dockerWorker ? "docker" : "host",
		dockerWorker: options.dockerWorker,
	};
}

function validateProviderSafety(scenario: NormalizedScenario, options: PtyOptions): void {
	if (scenario.providerMode !== "real") return;
	if (!options.realProvider) throw new Error("Real-provider PTY scenarios require explicit --real-provider");
	if (!Number.isInteger(scenario.maxIterations) || (scenario.maxIterations ?? 0) < 1) throw new Error("Real-provider PTY scenarios require --max-iterations to be a positive integer");
	if (scenario.steps.length === 0 || !scenario.steps.some((step) => step.iteration === true)) {
		throw new Error("Real-provider PTY scenarios require at least one step marked iteration: true so max iterations can be enforced");
	}
	if (scenario.timeoutMs <= 0 || scenario.idleTimeoutMs <= 0) throw new Error("Real-provider PTY scenarios require wall-clock and idle timeouts");
	if (scenario.expect.length === 0 && scenario.stopPatterns.length === 0 && !scenario.steps.some((step) => step.waitFor)) {
		throw new Error("Real-provider PTY scenarios require an expected output, stop pattern, or waitFor stop condition");
	}
}

async function startRunner(scenario: NormalizedScenario): Promise<RunningPty> {
	if (scenario.backend === "docker") return startDockerRunner(scenario);
	return startHostRunner(scenario);
}

async function startHostRunner(scenario: NormalizedScenario): Promise<RunningPty> {
	const python = detectHostPython();
	const env = { ...process.env, ...scenario.env, PIBO_PTY_ROWS: String(scenario.rows), PIBO_PTY_COLS: String(scenario.cols) };
	const child = spawn(python, ["-u", "-c", PYTHON_PTY_DRIVER, "--", ...scenario.command], {
		cwd: scenario.cwd,
		env,
		stdio: "pipe",
	});
	return wrapChild(child, "host", `python:${python}`);
}

async function startDockerRunner(scenario: NormalizedScenario): Promise<RunningPty> {
	if (!scenario.dockerWorker) throw new Error("Docker PTY backend requires --docker-worker <name>");
	const python = detectDockerPython(scenario.dockerWorker);
	const args = ["exec", "-i"];
	if (scenario.workdir) args.push("-w", scenario.workdir);
	args.push("-e", `PIBO_PTY_ROWS=${scenario.rows}`, "-e", `PIBO_PTY_COLS=${scenario.cols}`);
	for (const [key, value] of Object.entries(scenario.env)) args.push("-e", `${key}=${value}`);
	args.push(scenario.dockerWorker, python, "-u", "-c", PYTHON_PTY_DRIVER, "--", ...scenario.command);
	const child = spawn("docker", args, { stdio: "pipe" });
	return wrapChild(child, "docker", `docker-exec:${python}`);
}

function detectHostPython(): string {
	for (const candidate of ["python3", "python"]) {
		const result = spawnSync(candidate, ["--version"], { stdio: "ignore" });
		if (result.status === 0) return candidate;
	}
	throw new Error("No Python PTY driver found on host. Install python3 or run in an environment with PTY support.");
}

function detectDockerPython(worker: string): string {
	const inspect = spawnSync("docker", ["inspect", "-f", "{{.State.Running}} {{.Id}}", worker], { encoding: "utf8" });
	if (inspect.status !== 0) throw new Error(`Docker worker "${worker}" is not available or not running`);
	if (!inspect.stdout.trim().startsWith("true")) throw new Error(`Docker worker "${worker}" is not running`);
	const result = spawnSync("docker", ["exec", worker, "sh", "-lc", "command -v python3 || command -v python"], { encoding: "utf8" });
	if (result.status !== 0 || result.stdout.trim().length === 0) {
		throw new Error(`Docker worker "${worker}" does not provide python3/python for PTY execution. Install python3, or add an internal PTY helper/script fallback.`);
	}
	return result.stdout.trim().split(/\s+/)[0] ?? "python3";
}

function wrapChild(child: ChildProcessWithoutNullStreams, backend: PtyBackend, ptyMethod: string): RunningPty {
	let rawOutput = "";
	let driverStderr = "";
	const events: PtyEvent[] = [];
	let exitState: { exitCode: number | null; signal: NodeJS.Signals | null } | undefined;
	const exitPromise = new Promise<{ exitCode: number | null; signal: NodeJS.Signals | null }>((resolve) => {
		child.on("exit", (exitCode, signal) => {
			exitState = { exitCode, signal };
			resolve(exitState);
		});
	});
	child.stdout.on("data", (data: Buffer) => {
		const text = data.toString("utf8");
		rawOutput += text;
		events.push({ t: Date.now(), source: "stdout", data: text });
	});
	child.stderr.on("data", (data: Buffer) => {
		const text = data.toString("utf8");
		driverStderr += text;
		events.push({ t: Date.now(), source: "system", kind: "driver_stderr", data: text });
	});
	child.on("error", (error) => {
		driverStderr += `${error.message}\n`;
		events.push({ t: Date.now(), source: "system", kind: "error", detail: error.message });
	});
	return {
		backend,
		ptyMethod,
		async write(data: string | Buffer) {
			events.push({ t: Date.now(), source: "stdin", data: Buffer.isBuffer(data) ? data.toString("utf8") : data });
			await new Promise<void>((resolve, reject) => {
				child.stdin.write(data, (error) => error ? reject(error) : resolve());
			});
		},
		async terminate(reason: string) {
			events.push({ t: Date.now(), source: "system", kind: "terminate", detail: reason });
			if (exitState) return;
			child.kill("SIGTERM");
			await Promise.race([
				exitPromise,
				delay(1_000).then(() => {
					if (!exitState) child.kill("SIGKILL");
				}),
			]);
		},
		async waitForExit(timeoutMs: number) {
			if (exitState) return { ...exitState, timedOut: false };
			const timeout = delay(timeoutMs).then(() => ({ exitCode: null, signal: null, timedOut: true }));
			const exit = exitPromise.then((value) => ({ ...value, timedOut: false }));
			return Promise.race([exit, timeout]);
		},
		getRawOutput: () => rawOutput,
		getDriverStderr: () => driverStderr,
		getEvents: () => events,
	};
}

async function runStep(runner: RunningPty, scenario: NormalizedScenario, step: PtyStep, assertions: AssertionResult[], markOutput: () => number): Promise<void> {
	if (step.waitFor !== undefined) {
		await waitForText(runner, step.waitFor, step.timeoutMs ?? scenario.timeoutMs, scenario.idleTimeoutMs, markOutput);
		return;
	}
	if (step.typeText !== undefined) {
		for (const char of step.typeText) {
			await runner.write(char);
			if (scenario.inputDelayMs > 0) await delay(scenario.inputDelayMs);
		}
		return;
	}
	if (step.writeBytes !== undefined) {
		await runner.write(step.writeBytes);
		return;
	}
	if (step.press !== undefined) {
		await runner.write(keySequence(step.press));
		if (scenario.inputDelayMs > 0) await delay(scenario.inputDelayMs);
		return;
	}
	if (step.sleepMs !== undefined) {
		await delay(step.sleepMs);
		return;
	}
	const clean = cleanTerminalText(runner.getRawOutput());
	if (step.expect !== undefined) {
		assertPatterns(clean, [step.expect], [], assertions);
		return;
	}
	if (step.reject !== undefined) assertPatterns(clean, [], [step.reject], assertions);
}

async function waitForText(runner: RunningPty, pattern: string, timeoutMs: number, idleTimeoutMs: number, markOutput: () => number): Promise<void> {
	const deadline = Date.now() + timeoutMs;
	while (Date.now() < deadline) {
		const lastOutputAt = markOutput();
		if (cleanTerminalText(runner.getRawOutput()).includes(pattern)) return;
		if (Date.now() - lastOutputAt > idleTimeoutMs) {
			await runner.terminate("idle_timeout");
			throw new Error(`PTY command produced no output for ${idleTimeoutMs}ms while waiting for ${JSON.stringify(pattern)}`);
		}
		await delay(50);
	}
	throw new Error(`Timed out waiting for PTY output ${JSON.stringify(pattern)} after ${timeoutMs}ms`);
}

async function waitForExitOrIdle(runner: RunningPty, timeoutMs: number, idleTimeoutMs: number, markOutput: () => number): Promise<{ exitCode: number | null; signal: NodeJS.Signals | null; timedOut: boolean; idleTimedOut: boolean }> {
	const deadline = Date.now() + timeoutMs;
	while (Date.now() < deadline) {
		const lastOutputAt = markOutput();
		const remaining = Math.max(1, Math.min(100, deadline - Date.now()));
		const exit = await runner.waitForExit(remaining);
		if (!exit.timedOut) return { ...exit, timedOut: false, idleTimedOut: false };
		if (Date.now() - lastOutputAt > idleTimeoutMs) return { exitCode: null, signal: null, timedOut: false, idleTimedOut: true };
	}
	return { exitCode: null, signal: null, timedOut: true, idleTimedOut: false };
}

async function checkIdle(runner: RunningPty, lastOutputAt: () => number, idleTimeoutMs: number): Promise<void> {
	if (Date.now() - lastOutputAt() > idleTimeoutMs) {
		await runner.terminate("idle_timeout");
		throw new Error(`PTY command produced no output for ${idleTimeoutMs}ms`);
	}
}

function assertPatterns(clean: string, expect: readonly string[], reject: readonly string[], assertions: AssertionResult[]): void {
	for (const pattern of expect) {
		const passed = clean.includes(pattern);
		assertions.push({ type: "expect", pattern, passed, message: passed ? undefined : `Missing expected text: ${pattern}` });
		if (!passed) throw new Error(`Missing expected PTY output ${JSON.stringify(pattern)}`);
	}
	for (const pattern of reject) {
		const passed = !clean.includes(pattern);
		assertions.push({ type: "reject", pattern, passed, message: passed ? undefined : `Forbidden text appeared: ${pattern}` });
		if (!passed) throw new Error(`Forbidden PTY output appeared ${JSON.stringify(pattern)}`);
	}
}

function keySequence(key: string): string {
	const normalized = key.toLowerCase();
	if (normalized === "enter" || normalized === "return") return "\r";
	if (normalized === "escape" || normalized === "esc") return "\x1b";
	if (normalized === "ctrlc" || normalized === "ctrl-c" || normalized === "c-c") return "\x03";
	if (normalized === "up") return "\x1b[A";
	if (normalized === "down") return "\x1b[B";
	throw new Error(`Unsupported PTY key "${key}". Supported: Enter, Escape, CtrlC, Up, Down.`);
}

function cleanTerminalText(raw: string): string {
	return raw
		.replace(/\x1b\][^\x07]*(?:\x07|\x1b\\)/g, "")
		.replace(/\x1b\[[0-?]*[ -/]*[@-~]/g, "")
		.replace(/\x1b[PX^_].*?\x1b\\/gs, "")
		.replace(/\x1b[@-_]/g, "")
		.replace(/\r\n/g, "\n")
		.replace(/\r/g, "\n");
}

function buildResult(
	scenario: NormalizedScenario,
	runner: RunningPty | undefined,
	ok: boolean,
	assertions: AssertionResult[],
	iterations: number,
	started: number,
	startedAt: string,
	stopReason: string,
	exitCode: number | null,
	signal: NodeJS.Signals | null,
): PtyResult {
	const ended = Date.now();
	return {
		ok,
		name: scenario.name,
		backend: scenario.backend,
		exitCode,
		signal,
		stopReason,
		startedAt,
		endedAt: new Date(ended).toISOString(),
		durationMs: ended - started,
		rawOutput: runner?.getRawOutput() ?? "",
		driverStderr: runner?.getDriverStderr() ?? "",
		events: runner?.getEvents() ?? [],
		assertions,
		iterations,
	};
}

async function writeArtifacts(scenario: NormalizedScenario, result: PtyResult, error?: string): Promise<string> {
	const artifactDir = path.resolve(scenario.artifactDir);
	await mkdir(artifactDir, { recursive: true });
	const clean = cleanTerminalText(result.rawOutput);
	const metadata = {
		schemaVersion: ARTIFACT_SCHEMA_VERSION,
		name: scenario.name,
		backend: scenario.backend,
		ptyMethod: result.backend === "docker" ? "docker-python-pty" : "host-python-pty",
		dockerWorker: scenario.dockerWorker,
		command: scenario.command,
		cwd: scenario.cwd,
		workdir: scenario.workdir,
		rows: scenario.rows,
		cols: scenario.cols,
		providerMode: scenario.providerMode,
		realProviderRequested: scenario.providerMode === "real",
		maxIterations: scenario.maxIterations,
		observedIterations: result.iterations,
		timeoutMs: scenario.timeoutMs,
		idleTimeoutMs: scenario.idleTimeoutMs,
		startedAt: result.startedAt,
		endedAt: result.endedAt,
		durationMs: result.durationMs,
		exitCode: result.exitCode,
		signal: result.signal,
		ok: result.ok,
		stopReason: result.stopReason,
		error,
		env: redactEnvKeys(scenario.env),
		screenCaptureMethod: "cleaned-tail",
	};
	await writeFile(path.join(artifactDir, "metadata.json"), `${JSON.stringify(metadata, null, 2)}\n`);
	await writeFile(path.join(artifactDir, "input.json"), `${JSON.stringify({ steps: scenario.steps, inputDelayMs: scenario.inputDelayMs }, null, 2)}\n`);
	await writeFile(path.join(artifactDir, "assertions.json"), `${JSON.stringify({ assertions: result.assertions, expect: scenario.expect, reject: scenario.reject }, null, 2)}\n`);
	await writeFile(path.join(artifactDir, "raw.ansi.log"), result.rawOutput);
	await writeFile(path.join(artifactDir, "clean.txt"), clean);
	await writeFile(path.join(artifactDir, "screen.txt"), finalScreen(clean, scenario.rows));
	if (result.events.length > 0) await writeFile(path.join(artifactDir, "events.jsonl"), result.events.map((event) => JSON.stringify(event)).join("\n") + "\n");
	if (result.driverStderr) await writeFile(path.join(artifactDir, "driver.stderr.log"), result.driverStderr);
	return artifactDir;
}

function finalScreen(clean: string, rows: number): string {
	const lines = clean.split("\n");
	return lines.slice(Math.max(0, lines.length - rows)).join("\n");
}

function printRunResult(result: PtyResult): void {
	console.log(`PTY ${result.ok ? "passed" : "failed"}: ${result.name}`);
	console.log(`backend\t${result.backend}`);
	console.log(`exitCode\t${result.exitCode ?? "-"}`);
	console.log(`stopReason\t${result.stopReason}`);
	console.log(`durationMs\t${result.durationMs}`);
	if (result.artifactDir) console.log(`artifacts\t${result.artifactDir}`);
}

function envPairsToRecord(pairs: readonly string[]): Record<string, string> {
	const env: Record<string, string> = {};
	for (const pair of pairs) {
		const index = pair.indexOf("=");
		if (index <= 0) throw new Error(`--env values must use KEY=VALUE, got ${JSON.stringify(pair)}`);
		env[pair.slice(0, index)] = pair.slice(index + 1);
	}
	return env;
}

function redactEnvKeys(env: Record<string, string>): Record<string, string> {
	const redacted: Record<string, string> = {};
	for (const [key, value] of Object.entries(env)) {
		redacted[key] = /token|secret|key|password|credential/i.test(key) ? "[redacted]" : value;
	}
	return redacted;
}

function parseProviderMode(value: string | undefined): ProviderMode | undefined {
	if (value === undefined) return undefined;
	if (value === "mocked" || value === "deterministic" || value === "real") return value;
	throw new Error(`providerMode must be mocked, deterministic, or real; got ${JSON.stringify(value)}`);
}

function parseProviderModeValue(value: unknown, field: string, source: string): ProviderMode | undefined {
	if (value === undefined) return undefined;
	if (typeof value !== "string") throw new Error(`${source}: ${field} must be a string`);
	return parseProviderMode(value);
}

function numberOption(value: string | undefined, option: string): number | undefined {
	if (value === undefined) return undefined;
	return parsePositiveInteger(value, option);
}

function parsePositiveInteger(value: string, field: string): number {
	const parsed = Number(value);
	if (!Number.isInteger(parsed) || parsed < 1) throw new Error(`${field} must be a positive integer`);
	return parsed;
}

function parseNonNegativeInteger(value: string, field: string): number {
	const parsed = Number(value);
	if (!Number.isInteger(parsed) || parsed < 0) throw new Error(`${field} must be a non-negative integer`);
	return parsed;
}

function optionalString(value: unknown, field: string, source: string): string | undefined {
	if (value === undefined) return undefined;
	if (typeof value !== "string") throw new Error(`${source}: ${field} must be a string`);
	return value;
}

function optionalBoolean(value: unknown, field: string, source: string): boolean | undefined {
	if (value === undefined) return undefined;
	if (typeof value !== "boolean") throw new Error(`${source}: ${field} must be a boolean`);
	return value;
}

function optionalPositiveNumber(value: unknown, field: string, source: string): number | undefined {
	if (value === undefined) return undefined;
	if (typeof value !== "number" || !Number.isInteger(value) || value < 1) throw new Error(`${source}: ${field} must be a positive integer`);
	return value;
}

function optionalNonNegativeNumber(value: unknown, field: string, source: string): number | undefined {
	if (value === undefined) return undefined;
	if (typeof value !== "number" || !Number.isInteger(value) || value < 0) throw new Error(`${source}: ${field} must be a non-negative integer`);
	return value;
}

function optionalStringArray(value: unknown, field: string, source: string): string[] {
	if (value === undefined) return [];
	if (!Array.isArray(value) || value.some((item) => typeof item !== "string")) throw new Error(`${source}: ${field} must be a string array`);
	return value as string[];
}

function optionalStringRecord(value: unknown, field: string, source: string): Record<string, string> | undefined {
	if (value === undefined) return undefined;
	if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error(`${source}: ${field} must be an object`);
	const record: Record<string, string> = {};
	for (const [key, item] of Object.entries(value as Record<string, unknown>)) {
		if (typeof item !== "string") throw new Error(`${source}: ${field}.${key} must be a string`);
		record[key] = item;
	}
	return record;
}

function safeName(name: string): string {
	return name.toLowerCase().replace(/[^a-z0-9._-]+/g, "-").replace(/^-+|-+$/g, "") || "pty-scenario";
}

function delay(ms: number): Promise<void> {
	return new Promise((resolve) => setTimeout(resolve, ms));
}

export const __debugPtyForTests = {
	cleanTerminalText,
	keySequence,
	validateScenario,
};

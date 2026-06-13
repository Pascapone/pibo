/**
 * `pibo vscode uninstall` — remove the installed Pibo VS Code extension.
 */

import { detectCodeBinary, runCodeCommand } from "./code-cli.js";
import { PIBO_VSCODE_EXTENSION_ID, type SpawnLike, type UninstallResult } from "./types.js";

export type UninstallCommandOptions = {
	spawnImpl?: SpawnLike;
	env?: NodeJS.ProcessEnv;
	log?: (message: string) => void;
	error?: (message: string) => void;
};

const DEFAULT_LOG = (message: string): void => {
	console.log(message);
};
const DEFAULT_ERROR = (message: string): void => {
	process.stderr.write(`${message}\n`);
};

export async function runUninstall(options: UninstallCommandOptions = {}): Promise<UninstallResult> {
	const log = options.log ?? DEFAULT_LOG;
	const errorLog = options.error ?? DEFAULT_ERROR;
	const detected = detectCodeBinary({ env: options.env });
	if (!detected) {
		errorLog(`No VS Code CLI found on PATH.`);
		return { status: "failed", reason: "no-code-cli" };
	}

	log(`Uninstalling ${PIBO_VSCODE_EXTENSION_ID} via ${detected.path}…`);
	let result;
	try {
		result = await runCodeCommand({
			binary: detected.path,
			args: ["--uninstall-extension", PIBO_VSCODE_EXTENSION_ID],
			spawnImpl: options.spawnImpl,
			env: options.env,
			timeoutMs: 60_000,
		});
	} catch (spawnError) {
		const reason = spawnError instanceof Error ? spawnError.message : String(spawnError);
		errorLog(`Failed to invoke ${detected.binary}: ${reason}`);
		return { status: "failed", reason, codeBinary: detected.path };
	}

	if (result.exitCode !== 0) {
		const stderr = result.stderr || result.stdout;
		// VS Code returns a non-zero exit when the extension is not installed; treat that as "not-installed".
		if (/not found|not installed|Cannot find extension/i.test(stderr)) {
			log(`${PIBO_VSCODE_EXTENSION_ID} was not installed.`);
			return { status: "not-installed", codeBinary: detected.path };
		}
		const reason = `code --uninstall-extension exited with code ${result.exitCode}: ${stderr}`;
		errorLog(reason);
		return { status: "failed", reason, codeBinary: detected.path };
	}

	log(`Uninstalled ${PIBO_VSCODE_EXTENSION_ID}`);
	return { status: "uninstalled", codeBinary: detected.path };
}

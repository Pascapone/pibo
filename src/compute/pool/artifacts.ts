import { createHash } from "node:crypto";
import { createReadStream, existsSync } from "node:fs";
import { mkdir, readFile, rename, rm, utimes, writeFile } from "node:fs/promises";
import { basename, resolve } from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import type { DeploymentPoolConfig } from "./config.js";

const execFileAsync = promisify(execFile);
const PACKAGE_RELATIVE_PATH = "node_modules/@pasko70/pibo/package.json";
const BINARY_RELATIVE_PATH = "node_modules/@pasko70/pibo/dist/bin/pibo.js";

export interface DeploymentArtifact {
	sha256: string;
	runtimePath: string;
	binaryPath: string;
	packageVersion?: string;
	reused: boolean;
}

export async function ensureDeploymentArtifact(input: {
	config: DeploymentPoolConfig;
	archivePath?: string;
	runtimePath?: string;
}): Promise<DeploymentArtifact> {
	if (Boolean(input.archivePath) === Boolean(input.runtimePath)) {
		throw new Error("Provide exactly one of archivePath or runtimePath");
	}
	if (input.runtimePath) return inspectRuntimeArtifact(resolve(input.runtimePath));
	const archivePath = resolve(input.archivePath!);
	if (!existsSync(archivePath)) throw new Error(`Deployment artifact archive does not exist: ${archivePath}`);
	const sha256 = await sha256File(archivePath);
	const artifactRoot = resolve(input.config.artifactRoot, sha256);
	const runtimePath = resolve(artifactRoot, "runtime");
	if (existsSync(resolve(runtimePath, BINARY_RELATIVE_PATH))) {
		const now = new Date();
		await utimes(artifactRoot, now, now);
		return { ...(await inspectRuntimeArtifact(runtimePath)), sha256, reused: true };
	}
	await mkdir(input.config.artifactRoot, { recursive: true, mode: 0o700 });
	const staging = resolve(input.config.artifactRoot, `.staging-${sha256}-${process.pid}`);
	await rm(staging, { recursive: true, force: true });
	await mkdir(resolve(staging, "runtime"), { recursive: true, mode: 0o700 });
	await writeFile(resolve(staging, "runtime", "package.json"), '{"name":"pibo-deployment-pool-runtime","private":true}\n', { mode: 0o600 });
	try {
		await execFileAsync("npm", ["install", "--omit=dev", "--ignore-scripts", "--no-audit", "--no-fund", archivePath], {
			cwd: resolve(staging, "runtime"),
			maxBuffer: 20 * 1024 * 1024,
		});
		if (!existsSync(resolve(staging, "runtime", BINARY_RELATIVE_PATH))) throw new Error("Installed package does not contain the Pibo binary");
		await writeFile(resolve(staging, "manifest.json"), `${JSON.stringify({ sha256, source: basename(archivePath), installedAt: new Date().toISOString() }, null, 2)}\n`, { mode: 0o600 });
		if (existsSync(artifactRoot)) await rm(staging, { recursive: true, force: true });
		else await rename(staging, artifactRoot);
	} catch (error) {
		await rm(staging, { recursive: true, force: true });
		throw error;
	}
	return { ...(await inspectRuntimeArtifact(runtimePath)), sha256, reused: false };
}

export async function inspectRuntimeArtifact(runtimePath: string): Promise<DeploymentArtifact> {
	const resolved = resolve(runtimePath);
	const binaryPath = resolve(resolved, BINARY_RELATIVE_PATH);
	if (!existsSync(binaryPath)) throw new Error(`Pibo runtime binary was not found: ${binaryPath}`);
	let packageVersion: string | undefined;
	let packageText = "";
	try {
		packageText = await readFile(resolve(resolved, PACKAGE_RELATIVE_PATH), "utf8");
		const parsed = JSON.parse(packageText) as { version?: unknown; name?: unknown };
		if (parsed.name !== "@pasko70/pibo") throw new Error(`Unexpected package name in ${resolved}`);
		if (typeof parsed.version === "string") packageVersion = parsed.version;
	} catch (error) {
		if (error instanceof Error && error.message.startsWith("Unexpected package")) throw error;
	}
	const hash = createHash("sha256");
	hash.update(await readFile(binaryPath));
	hash.update(packageText);
	return { sha256: hash.digest("hex"), runtimePath: resolved, binaryPath, packageVersion, reused: true };
}

async function sha256File(path: string): Promise<string> {
	const hash = createHash("sha256");
	await new Promise<void>((resolvePromise, reject) => {
		const stream = createReadStream(path);
		stream.on("data", (chunk) => hash.update(chunk));
		stream.once("end", resolvePromise);
		stream.once("error", reject);
	});
	return hash.digest("hex");
}

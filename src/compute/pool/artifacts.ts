import { createHash } from "node:crypto";
import { createReadStream, existsSync } from "node:fs";
import { lstat, mkdir, readFile, readdir, readlink, rename, rm, utimes, writeFile } from "node:fs/promises";
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
	const packageRoot = resolve(resolved, "node_modules/@pasko70/pibo");
	return { sha256: await sha256Directory(packageRoot), runtimePath: resolved, binaryPath, packageVersion, reused: true };
}

async function sha256Directory(root: string): Promise<string> {
	const hash = createHash("sha256");
	await hashDirectoryEntries(hash, root, "");
	return hash.digest("hex");
}

async function hashDirectoryEntries(hash: ReturnType<typeof createHash>, root: string, relativeDirectory: string): Promise<void> {
	const directory = relativeDirectory ? resolve(root, relativeDirectory) : root;
	const entries = await readdir(directory, { withFileTypes: true });
	entries.sort((left, right) => left.name < right.name ? -1 : left.name > right.name ? 1 : 0);
	for (const entry of entries) {
		const relativePath = relativeDirectory ? `${relativeDirectory}/${entry.name}` : entry.name;
		const absolutePath = resolve(root, relativePath);
		const stats = await lstat(absolutePath);
		if (entry.isDirectory()) {
			hash.update(`directory\0${relativePath}\0${stats.mode & 0o777}\0`);
			await hashDirectoryEntries(hash, root, relativePath);
			continue;
		}
		if (entry.isFile()) {
			hash.update(`file\0${relativePath}\0${stats.mode & 0o777}\0${stats.size}\0`);
			await hashFileContents(hash, absolutePath);
			hash.update("\0");
			continue;
		}
		if (entry.isSymbolicLink()) {
			hash.update(`symlink\0${relativePath}\0${await readlink(absolutePath)}\0`);
			continue;
		}
		throw new Error(`Unsupported runtime artifact entry: ${absolutePath}`);
	}
}

async function hashFileContents(hash: ReturnType<typeof createHash>, path: string): Promise<void> {
	await new Promise<void>((resolvePromise, reject) => {
		const stream = createReadStream(path);
		stream.on("data", (chunk) => hash.update(chunk));
		stream.once("end", resolvePromise);
		stream.once("error", reject);
	});
}

async function sha256File(path: string): Promise<string> {
	const hash = createHash("sha256");
	await hashFileContents(hash, path);
	return hash.digest("hex");
}

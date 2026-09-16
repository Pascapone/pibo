import { createHash } from "node:crypto";
import { createReadStream, existsSync } from "node:fs";
import { lstat, mkdir, readFile, readdir, readlink, rename, rm, stat, utimes, writeFile } from "node:fs/promises";
import { basename, resolve } from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import type { DeploymentPoolConfig } from "./config.js";

const execFileAsync = promisify(execFile);
const PACKAGE_RELATIVE_PATHS = [
	"node_modules/@pasko70/pibo-standard/package.json",
	"node_modules/@pasko70/pibo/package.json",
] as const;
const BINARY_RELATIVE_PATHS = [
	"node_modules/@pasko70/pibo-standard/bin/pibo.js",
	"node_modules/.bin/pibo",
	"node_modules/@pasko70/pibo/dist/bin/pibo.js",
] as const;

interface CandidateAssemblyArtifact {
	role: "core" | "cutover" | "standard" | "plugin" | "dependency";
	package: string;
	packageJsonName?: string;
	version: string;
	file: string;
	bytes: number;
	sha256: string;
}

interface CandidateAssemblyManifest {
	schemaVersion: 1;
	sourceCommit: string;
	application: {
		package: string;
		version: string;
		binary: string;
		command: string[];
		cutoverCommand: string[];
	};
	cutover: {
		package: string;
		version: string;
		binary: string;
		command: string[];
		sourceArtifact: "external-retained";
	};
	artifacts: CandidateAssemblyArtifact[];
}

function installedBinaryPath(runtimePath: string): string | undefined {
	for (const relativePath of BINARY_RELATIVE_PATHS) {
		const candidate = resolve(runtimePath, relativePath);
		if (existsSync(candidate)) return candidate;
	}
	return undefined;
}

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
	if (installedBinaryPath(runtimePath)) {
		const now = new Date();
		await utimes(artifactRoot, now, now);
		return { ...(await inspectRuntimeArtifact(runtimePath)), sha256, reused: true };
	}
	await mkdir(input.config.artifactRoot, { recursive: true, mode: 0o700 });
	const staging = resolve(input.config.artifactRoot, `.staging-${sha256}-${process.pid}`);
	const stagingRuntime = resolve(staging, "runtime");
	await rm(staging, { recursive: true, force: true });
	await mkdir(stagingRuntime, { recursive: true, mode: 0o700 });
	await writeFile(resolve(stagingRuntime, "package.json"), '{"name":"pibo-deployment-pool-runtime","private":true}\n', { mode: 0o600 });
	try {
		const assembly = await readCandidateAssemblyManifest(archivePath);
		if (assembly) await installCandidateAssembly({ archivePath, staging, runtimePath: stagingRuntime, manifest: assembly });
		else {
			await execFileAsync("npm", ["install", "--offline", "--omit=dev", "--ignore-scripts", "--no-audit", "--no-fund", archivePath], {
				cwd: stagingRuntime,
				maxBuffer: 20 * 1024 * 1024,
			});
		}
		if (!installedBinaryPath(stagingRuntime)) throw new Error("Installed package does not contain the Pibo binary");
		await writeFile(resolve(staging, "manifest.json"), `${JSON.stringify({
			sha256,
			source: basename(archivePath),
			installedAt: new Date().toISOString(),
			assembly: assembly ? { sourceCommit: assembly.sourceCommit, application: assembly.application, cutover: assembly.cutover, artifacts: assembly.artifacts } : undefined,
		}, null, 2)}\n`, { mode: 0o600 });
		if (existsSync(artifactRoot)) await rm(staging, { recursive: true, force: true });
		else await rename(staging, artifactRoot);
	} catch (error) {
		await rm(staging, { recursive: true, force: true });
		throw error;
	}
	return { ...(await inspectRuntimeArtifact(runtimePath)), sha256, reused: false };
}

async function readCandidateAssemblyManifest(archivePath: string): Promise<CandidateAssemblyManifest | undefined> {
	const listing = await execFileAsync("tar", ["-tzf", archivePath], { maxBuffer: 4 * 1024 * 1024 });
	if (!listing.stdout.split("\n").includes("package/assembly-manifest.json")) return undefined;
	const extracted = await execFileAsync("tar", ["-xOzf", archivePath, "package/assembly-manifest.json"], { maxBuffer: 4 * 1024 * 1024 });
	let value: unknown;
	try {
		value = JSON.parse(extracted.stdout);
	} catch {
		throw new Error("Candidate assembly manifest is not valid JSON");
	}
	return validateCandidateAssemblyManifest(value);
}

function validateCandidateAssemblyManifest(value: unknown): CandidateAssemblyManifest {
	if (!value || typeof value !== "object") throw new Error("Candidate assembly manifest must be an object");
	const manifest = value as Partial<CandidateAssemblyManifest>;
	if (manifest.schemaVersion !== 1) throw new Error("Unsupported Candidate assembly manifest schema");
	if (typeof manifest.sourceCommit !== "string" || !/^(?:[0-9a-f]{40}|unknown)$/.test(manifest.sourceCommit)) {
		throw new Error("Candidate assembly source commit is invalid");
	}
	if (!manifest.application || typeof manifest.application !== "object") throw new Error("Candidate assembly application contract is missing");
	if (typeof manifest.application.package !== "string" || !manifest.application.package) throw new Error("Candidate assembly application package is invalid");
	if (typeof manifest.application.version !== "string" || !manifest.application.version) throw new Error("Candidate assembly application version is invalid");
	if (typeof manifest.application.binary !== "string" || !isSafeRelativePath(manifest.application.binary)) throw new Error("Candidate assembly application binary is invalid");
	if (!Array.isArray(manifest.application.command) || manifest.application.command.length < 3 || manifest.application.command.some((entry) => typeof entry !== "string" || !entry)) {
		throw new Error("Candidate assembly start command is invalid");
	}
	if (!Array.isArray(manifest.application.cutoverCommand) || manifest.application.cutoverCommand.length < 5 || manifest.application.cutoverCommand.some((entry) => typeof entry !== "string" || !entry)) {
		throw new Error("Candidate assembly cutover start command is invalid");
	}
	if (!manifest.cutover || typeof manifest.cutover !== "object" || typeof manifest.cutover.package !== "string" || typeof manifest.cutover.version !== "string" || typeof manifest.cutover.binary !== "string" || !isSafeRelativePath(manifest.cutover.binary) || !Array.isArray(manifest.cutover.command) || manifest.cutover.command.some((entry) => typeof entry !== "string" || !entry) || manifest.cutover.sourceArtifact !== "external-retained") {
		throw new Error("Candidate assembly cutover preparation contract is invalid");
	}
	if (!Array.isArray(manifest.artifacts)) throw new Error("Candidate assembly artifacts are missing");
	const artifacts = manifest.artifacts as CandidateAssemblyArtifact[];
	if (artifacts.length !== 25 || artifacts.filter((entry) => entry.role === "plugin").length !== 20 || artifacts.filter((entry) => entry.role === "dependency").length !== 2 || artifacts.filter((entry) => entry.role === "core").length !== 1 || artifacts.filter((entry) => entry.role === "cutover").length !== 1 || artifacts.filter((entry) => entry.role === "standard").length !== 1) {
		throw new Error("Candidate assembly must contain one Core, one Cutover runner, one Standard, exactly 20 plugin artifacts, and two runtime dependencies");
	}
	const packages = new Set<string>();
	const files = new Set<string>();
	for (const artifact of artifacts) {
		if (!artifact || !["core", "cutover", "standard", "plugin", "dependency"].includes(artifact.role)) throw new Error("Candidate assembly artifact role is invalid");
		if (typeof artifact.package !== "string" || !artifact.package || packages.has(artifact.package)) throw new Error("Candidate assembly artifact package is invalid or duplicated");
		if (artifact.packageJsonName !== undefined && (artifact.role !== "dependency" || typeof artifact.packageJsonName !== "string" || !artifact.packageJsonName)) throw new Error(`Candidate assembly package.json identity is invalid for ${artifact.package}`);
		if (typeof artifact.version !== "string" || !artifact.version) throw new Error(`Candidate assembly version is invalid for ${artifact.package}`);
		if (typeof artifact.file !== "string" || !/^tarballs\/[^/]+\.tgz$/.test(artifact.file) || files.has(artifact.file)) throw new Error(`Candidate assembly artifact path is invalid for ${artifact.package}`);
		if (!Number.isSafeInteger(artifact.bytes) || artifact.bytes <= 0) throw new Error(`Candidate assembly byte count is invalid for ${artifact.package}`);
		if (typeof artifact.sha256 !== "string" || !/^[0-9a-f]{64}$/.test(artifact.sha256)) throw new Error(`Candidate assembly checksum is invalid for ${artifact.package}`);
		packages.add(artifact.package);
		files.add(artifact.file);
	}
	const applicationArtifact = artifacts.find((entry) => entry.role === "standard");
	if (!applicationArtifact || applicationArtifact.package !== manifest.application.package || applicationArtifact.version !== manifest.application.version) {
		throw new Error("Candidate assembly application does not match its Standard artifact");
	}
	const cutoverArtifact = artifacts.find((entry) => entry.role === "cutover");
	if (!cutoverArtifact || cutoverArtifact.package !== manifest.cutover.package || cutoverArtifact.version !== manifest.cutover.version) {
		throw new Error("Candidate assembly prepare contract does not match its Cutover artifact");
	}
	return manifest as CandidateAssemblyManifest;
}

function isSafeRelativePath(path: string): boolean {
	return path.length > 0 && !path.startsWith("/") && !path.split("/").some((part) => !part || part === "." || part === "..");
}

async function installCandidateAssembly(input: {
	archivePath: string;
	staging: string;
	runtimePath: string;
	manifest: CandidateAssemblyManifest;
}): Promise<void> {
	const assemblyRoot = resolve(input.runtimePath, ".pibo-candidate-assembly");
	await mkdir(assemblyRoot, { recursive: true, mode: 0o700 });
	await execFileAsync("tar", ["-xzf", input.archivePath, "-C", assemblyRoot, "--strip-components=1"], { maxBuffer: 4 * 1024 * 1024 });
	const expectedFiles = input.manifest.artifacts.map((entry) => basename(entry.file)).sort();
	const actualFiles = (await readdir(resolve(assemblyRoot, "tarballs"))).sort();
	if (JSON.stringify(actualFiles) !== JSON.stringify(expectedFiles)) throw new Error("Candidate assembly tarball set does not match its manifest");
	for (const artifact of input.manifest.artifacts) {
		const path = resolve(assemblyRoot, artifact.file);
		const details = await stat(path);
		if (!details.isFile() || details.size !== artifact.bytes) throw new Error(`Candidate assembly size mismatch for ${artifact.package}`);
		if (await sha256File(path) !== artifact.sha256) throw new Error(`Candidate assembly checksum mismatch for ${artifact.package}`);
	}
	const runtimePackagePath = resolve(input.runtimePath, "package.json");
	const runtimePackage = JSON.parse(await readFile(runtimePackagePath, "utf8")) as Record<string, unknown>;
	runtimePackage.dependencies = Object.fromEntries(input.manifest.artifacts.map((entry) => [entry.package, `file:.pibo-candidate-assembly/${entry.file}`]));
	await writeFile(runtimePackagePath, `${JSON.stringify(runtimePackage, null, 2)}\n`, { mode: 0o600 });
	await execFileAsync("npm", [
		"install",
		"--offline",
		"--omit=dev",
		"--ignore-scripts",
		"--no-audit",
		"--no-fund",
	], { cwd: input.runtimePath, maxBuffer: 64 * 1024 * 1024 });
	for (const artifact of input.manifest.artifacts) {
		const packagePath = resolve(input.runtimePath, "node_modules", artifact.package, "package.json");
		const installed = JSON.parse(await readFile(packagePath, "utf8")) as { name?: unknown; version?: unknown };
		if (installed.name !== (artifact.packageJsonName ?? artifact.package) || installed.version !== artifact.version) throw new Error(`Installed Candidate package does not match manifest: ${artifact.package}`);
	}
	if (!existsSync(resolve(input.runtimePath, input.manifest.application.binary))) throw new Error("Candidate assembly application binary is missing after install");
}

export async function inspectRuntimeArtifact(runtimePath: string): Promise<DeploymentArtifact> {
	const resolved = resolve(runtimePath);
	const binaryPath = installedBinaryPath(resolved);
	if (!binaryPath) throw new Error(`Pibo runtime binary was not found: ${resolved}`);
	let packageVersion: string | undefined;
	let packageRoot: string | undefined;
	for (const relativePath of PACKAGE_RELATIVE_PATHS) {
		const candidate = resolve(resolved, relativePath);
		if (!existsSync(candidate)) continue;
		const parsed = JSON.parse(await readFile(candidate, "utf8")) as { version?: unknown; name?: unknown };
		if (parsed.name !== "@pasko70/pibo-standard" && parsed.name !== "@pasko70/pibo") throw new Error(`Unexpected package name in ${resolved}`);
		if (typeof parsed.version === "string") packageVersion = parsed.version;
		packageRoot = resolve(candidate, "..");
		break;
	}
	if (!packageRoot) throw new Error(`Pibo application package was not found: ${resolved}`);
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

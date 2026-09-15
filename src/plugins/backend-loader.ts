import { randomUUID } from "node:crypto";
import { mkdir, realpath, lstat, rename, rm, symlink } from "node:fs/promises";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { PluginHost, planPluginActivation, type PluginDefinition } from "./host.js";
import type { PluginInstallation } from "./manifest.js";
import { freezePluginValue, PluginValidationError } from "./schema.js";
import { verifyPluginArtifact } from "./sources.js";
import { createStagedPluginDefinition } from "./staged-definition.js";

/**
 * Resolve the installed public SDK through ordinary Node package resolution.
 * The link belongs to the host's artifact directory, outside every hashed artifact.
 * It is never created inside a user source package and never installs dependencies.
 */
export async function preparePluginSdkResolution(
	artifactRoot: string,
	packageRoot = fileURLToPath(new URL("../../", import.meta.url)),
): Promise<void> {
	const target = await realpath(packageRoot);
	const scope = join(resolve(artifactRoot), "node_modules", "@pasko70");
	await mkdir(scope, { recursive: true, mode: 0o700 });
	const destination = join(scope, "pibo");
	try {
		const stat = await lstat(destination);
		if (!stat.isSymbolicLink() || await realpath(destination) !== target) {
			throw new Error("Plugin SDK resolution belongs to another package; change it only at a stopped composition boundary");
		}
	} catch (error) {
		if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
		try { await symlink(target, destination, "dir"); }
		catch (createError) {
			if ((createError as NodeJS.ErrnoException).code !== "EEXIST" || await realpath(destination) !== target) throw createError;
		}
	}
}

/** Replace SDK ownership only at the verified Cutover caller's stopped host boundary. */
export async function handoffPluginSdkResolutionAtStoppedBoundary(
	artifactRoot: string,
	host: PluginHost,
	packageRoot = fileURLToPath(new URL("../../", import.meta.url)),
): Promise<void> {
	if (host.inspect().state !== "idle") throw new Error("Plugin SDK handoff requires an idle/stopped PluginHost before host.start");
	const target = await realpath(packageRoot);
	const scope = join(resolve(artifactRoot), "node_modules", "@pasko70");
	await mkdir(scope, { recursive: true, mode: 0o700 });
	const destination = join(scope, "pibo");
	try {
		const stat = await lstat(destination);
		if (!stat.isSymbolicLink()) throw new Error("Plugin SDK handoff refuses to replace a non-symlink package path");
		if (await realpath(destination) === target) return;
	} catch (error) {
		if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
	}
	const temporary = `${destination}.handoff-${process.pid}-${randomUUID()}`;
	try {
		await symlink(target, temporary, "dir");
		if (host.inspect().state !== "idle") throw new Error("Plugin SDK handoff requires an idle/stopped PluginHost before host.start");
		try {
			const current = await lstat(destination);
			if (!current.isSymbolicLink()) throw new Error("Plugin SDK handoff refuses to replace a non-symlink package path");
			if (await realpath(destination) === target) return;
		} catch (error) {
			if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
		}
		await rename(temporary, destination);
	} finally {
		await rm(temporary, { force: true });
	}
}

/** Validate the entire graph and every artifact before the first backend effect. */
export async function startInstalledPlugins(
	host: PluginHost,
	installations: readonly PluginInstallation[],
	options: { providers?: Record<string, string>; definitions?: readonly PluginDefinition[] } = {},
): Promise<void> {
	const pinned = installations.map((installation) => freezePluginValue(structuredClone(installation)));
	const plugins = [...options.definitions ?? [], ...pinned.map(createStagedPluginDefinition)];
	const input = { plugins, providers: options.providers };
	const plan = planPluginActivation(input);
	if (!plan.valid) throw new PluginValidationError(plan.diagnostics);
	for (const installation of pinned) await verifyPluginArtifact(installation);
	await host.start(input);
}

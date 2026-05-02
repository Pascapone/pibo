import { existsSync } from "node:fs";
import type { AgentSessionRuntimeDiagnostic } from "@mariozechner/pi-coding-agent";
import type { InitialSessionContext } from "../core/profiles.js";
import { findPiPackage } from "./store.js";

export type PiboPiPackageRuntimeOptions = {
	resourceLoaderOptions: {
		additionalExtensionPaths: string[];
	};
	diagnostics: AgentSessionRuntimeDiagnostic[];
};

export function getPiPackageRuntimeOptions(cwd: string, profile: InitialSessionContext): PiboPiPackageRuntimeOptions {
	const diagnostics: AgentSessionRuntimeDiagnostic[] = [];
	const additionalExtensionPaths: string[] = [];

	for (const selected of profile.piPackages.filter((pkg) => pkg.enabled !== false)) {
		const registered = findPiPackage(selected.id, cwd);
		if (!registered) {
			diagnostics.push({
				type: "error",
				message: `Selected Pi package "${selected.id}" is not registered in Pibo.`,
			});
			continue;
		}
		if (!registered.enabled) {
			diagnostics.push({
				type: "warning",
				message: `Selected Pi package "${registered.name}" is globally disabled in Pibo and was not loaded.`,
			});
			continue;
		}
		if (registered.installStatus === "error") {
			diagnostics.push({
				type: "error",
				message: `Selected Pi package "${registered.name}" is in error state and was skipped.`,
			});
			continue;
		}
		const runtimePath = registered.installPath ?? (registered.installSpec.startsWith("/") ? registered.installSpec : undefined);
		if (!runtimePath) {
			diagnostics.push({
				type: "warning",
				message: `Selected Pi package "${registered.name}" is not installed and was skipped.`,
			});
			continue;
		}
		if (!existsSync(runtimePath)) {
			diagnostics.push({
				type: "error",
				message: `Selected Pi package "${registered.name}" path does not exist: ${runtimePath}`,
			});
			continue;
		}
		additionalExtensionPaths.push(runtimePath);
		diagnostics.push({
			type: "info",
			message: `Loaded Pi package ${registered.name} (${registered.resourceTypes.join(", ") || "resources pending"})`,
		});
		for (const diagnostic of registered.diagnostics) {
			if (diagnostic.type === "error") {
				diagnostics.push({ type: "warning", message: `Pi package ${registered.name}: ${diagnostic.message}` });
			}
		}
	}

	return {
		resourceLoaderOptions: {
			additionalExtensionPaths: [...new Set(additionalExtensionPaths)],
		},
		diagnostics,
	};
}

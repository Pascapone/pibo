import type { PluginDiagnostic, PluginInstallation } from "./manifest.js";
import { pluginDiagnostic } from "./schema.js";

/** Shared pure provider choice for host validation and generation/preview resolution. */
export type PluginExternalServiceClaim = { owner: string; version: string; replaces?: string[] };

export function resolvePluginServiceProviders(
	installations: readonly PluginInstallation[],
	choices: Record<string, string> = {},
	externalClaims: Record<string, PluginExternalServiceClaim> = {},
): { providers: Record<string, string>; diagnostics: PluginDiagnostic[] } {
	const claims = new Map<string, { pluginId: string; replaces?: string[] }[]>();
	const providers: Record<string, string> = Object.create(null);
	const diagnostics: PluginDiagnostic[] = [];
	const fail = (code: string, message: string, path: string[]) => diagnostics.push({ ...pluginDiagnostic(code, message, path), pluginId: path[0] });
	for (const installation of installations) for (const service of installation.manifest.services?.provides ?? []) {
		const entries = claims.get(service.id) ?? [];
		entries.push({ pluginId: installation.pluginId, replaces: service.replaces }); claims.set(service.id, entries);
	}
	for (const [id, claim] of Object.entries(externalClaims)) {
		const entries = claims.get(id) ?? [];
		entries.push({ pluginId: claim.owner, replaces: claim.replaces }); claims.set(id, entries);
	}
	for (const [id, entries] of claims) {
		const selected = choices[id];
		const winner = selected ? entries.find((entry) => entry.pluginId === selected) : entries.length === 1 ? entries[0] : undefined;
		if (!winner) { fail("service-provider-conflict", `Service ${id} requires an explicit valid provider`, [id, ...entries.map((entry) => entry.pluginId).sort()]); continue; }
		if (entries.some((entry) => entry !== winner && !winner.replaces?.includes(entry.pluginId))) { fail("undeclared-service-replacement", `${winner.pluginId} must declare all replaced providers for ${id}`, [winner.pluginId, id, ...entries.filter((entry) => entry !== winner).map((entry) => entry.pluginId).sort()]); continue; }
		providers[id] = winner.pluginId;
	}
	for (const [id, provider] of Object.entries(choices)) if (!claims.has(id)) fail("unknown-service-provider", `No declaration for selected service ${id}`, [provider, id]);
	return { providers, diagnostics };
}

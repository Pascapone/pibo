import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join, relative, resolve } from "node:path";
import type {
	AgentRuntimeContextContribution,
	AgentRuntimeDeliveryReport,
	AgentRuntimeResourceDiagnostic,
	PiboRuntimeResourceSession,
} from "../../agent-runtime/resources.js";
import type { OmpRuntimeConfig } from "./config.js";
import type { OmpSessionPaths } from "./process.js";

const MAX_CONTEXT_CONTRIBUTIONS = 128;
const MAX_CONTEXT_BYTES = 1024 * 1024;

function isRecord(value: unknown): value is Record<string, unknown> {
	return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function boundedString(value: unknown, label: string): string {
	return typeof value === "string" ? value.slice(0, 4096) : label;
}

/**
 * Materializes Pibo-selected skills and context into the isolated OMP agent
 * dir (`PI_CODING_AGENT_DIR`), and writes the OMP `config.yml` including the
 * `skills.customDirectories` pointer plus provider/model defaults. The real
 * project's `.omp/skills`, `AGENTS.md` are untouched — OMP keeps discovering
 * them natively.
 */
export class OmpResourceDelivery {
	constructor(
		private readonly config: OmpRuntimeConfig,
		private readonly paths: OmpSessionPaths,
		private readonly resources: PiboRuntimeResourceSession | undefined,
	) {}

	get configYamlPath(): string {
		return this.paths.config;
	}

	get skillPaths(): readonly string[] {
		if (!this.resources) return [];
		return this.resources.getSkillPaths("materialized");
	}

	/**
	 * Materialize selected skills/context and write the OMP config. MUST be
	 * called BEFORE spawning the OMP process (OMP reads config.yml at startup).
	 * Returns a delivery report per contribution.
	 */
	async prepare(): Promise<{ reports: AgentRuntimeDeliveryReport[]; diagnostics: AgentRuntimeResourceDiagnostic[] }> {
		const reports: AgentRuntimeDeliveryReport[] = [];
		const diagnostics: AgentRuntimeResourceDiagnostic[] = [];

		const contributions = this.resources?.getContextContributions() ?? [];
		const totalBytes = contributions.reduce((sum, c) => sum + (c.byteSize ?? c.content?.length ?? 0), 0);
		if (contributions.length > MAX_CONTEXT_CONTRIBUTIONS || totalBytes > MAX_CONTEXT_BYTES) {
			diagnostics.push({
				severity: "warning",
				code: "omp_context_exceeds_limit",
				message: "Pibo context contributions exceed the OMP materialization limit; excess is omitted.",
			});
		}

		// Context: write Pibo context contributions into the isolated context dir.
		await mkdir(this.paths.context, { recursive: true });
		const contextRefs: string[] = [];
		for (const contribution of contributions.slice(0, MAX_CONTEXT_CONTRIBUTIONS)) {
			const safeName = relative(this.paths.root, contribution.id) || `contribution-${reports.length}`;
			const fileName = safeName.replace(/[^A-Za-z0-9._-]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 64) || "contribution.md";
			const target = join(this.paths.context, `${reports.length}-${fileName}`);
			try {
				const content = contribution.content ?? "";
				await writeFile(target, content, "utf8");
				contextRefs.push(target);
				reports.push({
					contributionId: contribution.id,
					status: "delivered",
					mode: "materialized",
					fidelity: "equivalent",
					target,
				});
			} catch (error) {
				const message = error instanceof Error ? error.message : String(error);
				diagnostics.push({
					severity: "error",
					code: "orp_context_materialization_failed",
					message: `Failed to materialize context contribution "${contribution.id}": ${message}`,
					contributionId: contribution.id,
				});
				reports.push({
					contributionId: contribution.id,
					status: "failed",
					mode: "materialized",
					fidelity: "none",
					diagnostic: message,
				});
			}
		}

		// Skills: OMP discovers selected Pibo skills via skills.customDirectories.
		const skillsDir = this.paths.skills;
		await mkdir(dirname(skillsDir), { recursive: true });
		const customDirectories: readonly string[] = this.skillPaths.length > 0 ? [resolve(skillsDir)] : [];

		// Write config.yml.
		await this.writeConfig({ contextRefs, customDirectories });

		return { reports, diagnostics };
	}

	private async writeConfig(opts: {
		contextRefs: readonly string[];
		customDirectories: readonly string[];
	}): Promise<void> {
		const lines: string[] = [];
		lines.push("setupVersion: 1");
		if (this.config.defaultProvider && this.config.defaultModel) {
			lines.push(`modelRoles:`);
			lines.push(`  default: ${this.config.defaultProvider}/${this.config.defaultModel}:max`);
		}
		if (opts.customDirectories.length > 0) {
			lines.push(`skills:`);
			lines.push(`  customDirectories:`);
			for (const dir of opts.customDirectories) {
				lines.push(`    - ${JSON.stringify(dir)}`);
			}
		}
		if (opts.contextRefs.length > 0) {
			lines.push(`projectContextFiles:`);
			for (const ref of opts.contextRefs) {
				lines.push(`  - ${JSON.stringify(ref)}`);
			}
		}
		await mkdir(dirname(this.paths.config), { recursive: true });
		await writeFile(this.paths.config, `${lines.join("\n")}\n`, "utf8");
	}

	async readConfig(): Promise<string> {
		try {
			return await readFile(this.paths.config, "utf8");
		} catch {
			return "";
		}
	}
}

export function contextContributionToString(c: AgentRuntimeContextContribution): string {
	return c.content ?? "";
}

export function isRecordValue(value: unknown): value is Record<string, unknown> {
	return isRecord(value);
}

export function boundedContextValue(value: unknown, label: string): string {
	return boundedString(value, label);
}
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
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

/** Longest common ancestor (dir) of a set of absolute file/dir paths. */
function commonParent(paths: readonly string[]): string | undefined {
	if (paths.length === 0) return undefined;
	const segs = paths.map((p) => resolve(p).split(/[\\/]/));
	let i = 0;
	while (segs[0][i] !== undefined && segs.every((s) => s[i] === segs[0][i])) i++;
	return segs[0].slice(0, i).join("/");
}

/**
 * Materializes Pibo-selected skills and context into the isolated OMP agent
 * dir (`PI_CODING_AGENT_DIR`) and writes the OMP `config.yml` including
 * `skills.customDirectories` (pointing at the directory the resource-service
 * populated with `<skillName>/SKILL.md` entries OMP actually discovers) plus
 * provider/model defaults. The real project's `.omp/skills`, `AGENTS.md` are
 * untouched — OMP keeps discovering them natively.
 *
 * Called BEFORE spawning OMP: OMP reads config.yml at startup, and
 * `skills.customDirectories` dirs are scanned for `<skill>/SKILL.md` subdirs on
 * every session start. The resource-service materializes shared content before
 * `openSession` returns, so `getSkillPaths("materialized")` are already valid.
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

	/**
	 * Skill directories OMP should scan, derived from the materialized paths.
	 * `copyAgentRuntimeSkillDirectory` yields `<skillsRoot>/<skillName>/SKILL.md`;
	 * OMP's `scanSkillsFromDir` scans a dir containing `<skill>/SKILL.md`
	 * subdirs, which is the common parent of every materialized SKILL.md.
	 */
	get customSkillDirectories(): readonly string[] {
		if (!this.resources) return [];
		const materialized = this.resources.getSkillPaths("materialized");
		if (materialized.length === 0) return [];
		const dirs = materialized.map((p) => dirname(resolve(p)));
		const shared = commonParent(dirs);
		return shared ? [shared] : dirs;
	}

	/**
	 * Materialize selected skills/context and write the OMP config. MUST be
	 * called BEFORE spawning the OMP process (OMP reads config.yml at startup).
	 * Returns a delivery report per contribution.
	 */
	async prepare(): Promise<{ reports: AgentRuntimeDeliveryReport[]; diagnostics: AgentRuntimeResourceDiagnostic[] }> {
		const reports: AgentRuntimeDeliveryReport[] = [];
		const diagnostics: AgentRuntimeResourceDiagnostic[] = [];

		// Context contributions are surfaced for debug/diagnostics. OMP does not
		// read a `projectContextFiles` config key; project context arrives via its
		// own AGENTS.md/rules discovery in the session cwd, so there is no engine
		// injection seam here. We materialize them under the adapter context dir
		// and report delivery.
		const contributions = this.resources?.getContextContributions() ?? [];
		const totalBytes = contributions.reduce((sum, c) => sum + (c.byteSize ?? c.content?.length ?? 0), 0);
		if (contributions.length > MAX_CONTEXT_CONTRIBUTIONS || totalBytes > MAX_CONTEXT_BYTES) {
			diagnostics.push({
				severity: "warning",
				code: "orp_context_exceeds_limit",
				message: "Pibo context contributions exceed the OMP materialization limit; excess is omitted.",
			});
		}
		await mkdir(this.paths.context, { recursive: true });
		for (const contribution of contributions.slice(0, MAX_CONTEXT_CONTRIBUTIONS)) {
			const safeName = (contribution.label || `contribution-${reports.length}`)
				.replace(/[^A-Za-z0-9._-]+/g, "-")
				.replace(/^-+|-+$/g, "")
				.slice(0, 64) || "contribution.md";
			const target = join(this.paths.context, `${reports.length}-${safeName}.md`);
			try {
				await writeFile(target, contribution.content ?? "", "utf8");
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

		// Skills: point OMP at directories populated with <skillName>/SKILL.md.
		const customDirectories: readonly string[] = this.customSkillDirectories;
		await this.writeConfig({ customDirectories });

		return { reports, diagnostics };
	}

	private async writeConfig(opts: { customDirectories: readonly string[] }): Promise<void> {
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
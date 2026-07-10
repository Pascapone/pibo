import { Command } from "commander";
import { createDefaultPiboPluginRegistry } from "../plugins/builtin.js";
import {
	ScopedUserSkillManager,
	normalizeUserSkillScope,
	normalizeWritableUserSkillScope,
} from "../user-skills/manager.js";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

function printJson(value: unknown): void {
	console.log(JSON.stringify(value, null, 2));
}

export async function runSkillsCli(argv: string[]): Promise<void> {
	const manager = new ScopedUserSkillManager();

	const program = new Command();
	program
		.name("pibo skills")
		.description("Manage Pibo user skills and inspect the built-in/plugin skill catalog")
		.addHelpText("after", "\nBuilt-in/plugin skills are selected by agent profiles. Run `pibo skills catalog` to list them.\n");

	program
		.command("catalog")
		.description("List built-in and plugin skills available to profiles")
		.option("--json", "Print JSON")
		.action((options: { json?: boolean }) => {
			const registry = createDefaultPiboPluginRegistry();
			const skills = registry.getCapabilityCatalog().skills.filter((skill) => skill.kind !== "user");
			if (options.json) {
				printJson(skills);
				return;
			}
			if (skills.length === 0) {
				console.log("No built-in or plugin skills registered.");
				return;
			}
			console.log("NAME\tKIND\tPATH");
			for (const skill of skills) {
				console.log(`${skill.name}\t${skill.kind ?? "plugin"}\t${skill.path}`);
			}
		});

	program
		.command("list")
		.description("List user skills managed by this CLI")
		.option("--scope <scope>", "Skill scope: global, workspace, or all", "all")
		.option("--json", "Print JSON")
		.action((options: { scope?: string; json?: boolean }) => {
			const skills = manager.list(normalizeUserSkillScope(options.scope));
			if (options.json) {
				printJson(skills);
				return;
			}
			if (skills.length === 0) {
				console.log("No user skills registered.");
				return;
			}
			console.log("NAME\t\tSCOPE\t\tENABLED\tSOURCE\t\tDESCRIPTION");
			for (const s of skills) {
				const enabled = s.enabled ? "yes" : "no";
				console.log(`${s.name}\t${s.scope ?? "global"}\t${enabled}\t\t${s.source}\t${s.description}`);
			}
		});

	program
		.command("show")
		.description("Show a skill's markdown content")
		.argument("<name>", "Skill name")
		.option("--scope <scope>", "Skill scope: global, workspace, or all", "all")
		.action((name: string, options: { scope?: string }) => {
			const scope = normalizeUserSkillScope(options.scope);
			const skill = manager.get(name, scope);
			if (!skill) {
				console.error(`Skill "${name}" not found.`);
				process.exitCode = 1;
				return;
			}
			console.log(manager.getSkillMarkdown(skill.id, scope));
		});

	program
		.command("add")
		.description("Create a new user skill from a markdown file")
		.argument("<name>", "Skill name (kebab-case)")
		.requiredOption("--file <path>", "Path to markdown file")
		.option("--description <text>", "Short description")
		.option("--scope <scope>", "Skill scope: global or workspace", "global")
		.action((name: string, options: { file: string; description?: string; scope?: string }) => {
			const filePath = resolve(options.file);
			const markdown = readFileSync(filePath, "utf-8");
			const skill = manager.create({
				name,
				description: options.description ?? "",
				markdown,
			}, normalizeWritableUserSkillScope(options.scope));
			printJson({ id: skill.id, name: skill.name, scope: skill.scope, enabled: skill.enabled });
		});

	program
		.command("remove")
		.description("Remove a user skill")
		.argument("<name>", "Skill name")
		.option("--scope <scope>", "Skill scope: global, workspace, or all", "all")
		.action((name: string, options: { scope?: string }) => {
			const scope = normalizeUserSkillScope(options.scope);
			const skill = manager.get(name, scope);
			if (!skill) {
				console.error(`Skill "${name}" not found.`);
				process.exitCode = 1;
				return;
			}
			manager.remove(skill.id, scope);
			console.log(`Removed skill "${skill.name}".`);
		});

	program
		.command("enable")
		.description("Enable a user skill")
		.argument("<name>", "Skill name")
		.option("--scope <scope>", "Skill scope: global, workspace, or all", "all")
		.action((name: string, options: { scope?: string }) => {
			const scope = normalizeUserSkillScope(options.scope);
			const skill = manager.get(name, scope);
			if (!skill) {
				console.error(`Skill "${name}" not found.`);
				process.exitCode = 1;
				return;
			}
			manager.setEnabled(skill.id, true, scope);
			console.log(`Enabled skill "${skill.name}".`);
		});

	program
		.command("disable")
		.description("Disable a user skill")
		.argument("<name>", "Skill name")
		.option("--scope <scope>", "Skill scope: global, workspace, or all", "all")
		.action((name: string, options: { scope?: string }) => {
			const scope = normalizeUserSkillScope(options.scope);
			const skill = manager.get(name, scope);
			if (!skill) {
				console.error(`Skill "${name}" not found.`);
				process.exitCode = 1;
				return;
			}
			manager.setEnabled(skill.id, false, scope);
			console.log(`Disabled skill "${skill.name}".`);
		});

	program
		.command("install")
		.description("Install a skill from a URL (GitHub or skills.sh)")
		.argument("<url>", "Skill URL")
		.option("--scope <scope>", "Skill scope: global or workspace", "global")
		.action(async (url: string, options: { scope?: string }) => {
			const skill = await manager.installFromUrl(url, normalizeWritableUserSkillScope(options.scope));
			printJson({ id: skill.id, name: skill.name, scope: skill.scope, source: skill.source });
		});

	if (argv.length <= 2) {
		program.outputHelp();
		return;
	}

	await program.parseAsync(argv);
}

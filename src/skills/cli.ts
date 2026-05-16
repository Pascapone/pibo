import { Command } from "commander";
import { UserSkillManager } from "../user-skills/manager.js";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import os from "node:os";

function printJson(value: unknown): void {
	console.log(JSON.stringify(value, null, 2));
}

export async function runSkillsCli(argv: string[]): Promise<void> {
	const manager = new UserSkillManager(os.homedir());

	const program = new Command();
	program.name("pibo skills").description("Manage Pibo user skills (not built-in or plugin skills)");

	program
		.command("list")
		.description("List user skills managed by this CLI")
		.option("--json", "Print JSON")
		.action((options: { json?: boolean }) => {
			const skills = manager.list();
			if (options.json) {
				printJson(skills);
				return;
			}
			if (skills.length === 0) {
				console.log("No user skills registered.");
				return;
			}
			console.log("NAME\t\tENABLED\tSOURCE\t\tDESCRIPTION");
			for (const s of skills) {
				const enabled = s.enabled ? "yes" : "no";
				console.log(`${s.name}\t${enabled}\t\t${s.source}\t${s.description}`);
			}
		});

	program
		.command("show")
		.description("Show a skill's markdown content")
		.argument("<name>", "Skill name")
		.action((name: string) => {
			const skill = manager.get(name);
			if (!skill) {
				console.error(`Skill "${name}" not found.`);
				process.exitCode = 1;
				return;
			}
			console.log(manager.getSkillMarkdown(skill.id));
		});

	program
		.command("add")
		.description("Create a new user skill from a markdown file")
		.argument("<name>", "Skill name (kebab-case)")
		.requiredOption("--file <path>", "Path to markdown file")
		.option("--description <text>", "Short description")
		.action((name: string, options: { file: string; description?: string }) => {
			const filePath = resolve(options.file);
			const markdown = readFileSync(filePath, "utf-8");
			const skill = manager.create({
				name,
				description: options.description ?? "",
				markdown,
			});
			printJson({ id: skill.id, name: skill.name, enabled: skill.enabled });
		});

	program
		.command("remove")
		.description("Remove a user skill")
		.argument("<name>", "Skill name")
		.action((name: string) => {
			const skill = manager.get(name);
			if (!skill) {
				console.error(`Skill "${name}" not found.`);
				process.exitCode = 1;
				return;
			}
			manager.remove(skill.id);
			console.log(`Removed skill "${skill.name}".`);
		});

	program
		.command("enable")
		.description("Enable a user skill")
		.argument("<name>", "Skill name")
		.action((name: string) => {
			const skill = manager.get(name);
			if (!skill) {
				console.error(`Skill "${name}" not found.`);
				process.exitCode = 1;
				return;
			}
			manager.setEnabled(skill.id, true);
			console.log(`Enabled skill "${skill.name}".`);
		});

	program
		.command("disable")
		.description("Disable a user skill")
		.argument("<name>", "Skill name")
		.action((name: string) => {
			const skill = manager.get(name);
			if (!skill) {
				console.error(`Skill "${name}" not found.`);
				process.exitCode = 1;
				return;
			}
			manager.setEnabled(skill.id, false);
			console.log(`Disabled skill "${skill.name}".`);
		});

	program
		.command("install")
		.description("Install a skill from a URL (GitHub or skills.sh)")
		.argument("<url>", "Skill URL")
		.action(async (url: string) => {
			const skill = await manager.installFromUrl(url);
			printJson({ id: skill.id, name: skill.name, source: skill.source });
		});

	if (argv.length <= 2) {
		program.outputHelp();
		return;
	}

	await program.parseAsync(argv);
}

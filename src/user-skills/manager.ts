import os from "node:os";
import type { CreateUserSkillInput, UpdateUserSkillInput, UserSkill, UserSkillScope } from "./types.js";
import {
	createUserSkill,
	deleteUserSkill,
	findUserSkill,
	listUserSkills,
	readSkillMarkdown,
	setUserSkillEnabled,
	updateUserSkill,
} from "./store.js";
import { installSkillFromUrl } from "./installer.js";

export type UserSkillListScope = UserSkillScope | "all";

export function normalizeUserSkillScope(value: string | undefined, fallback: UserSkillListScope = "all"): UserSkillListScope {
	const normalized = (value ?? "").trim().toLowerCase();
	if (!normalized) return fallback;
	if (normalized === "global" || normalized === "workspace" || normalized === "all") return normalized;
	throw new Error(`Invalid skill scope "${value}". Expected global, workspace, or all.`);
}

export function normalizeWritableUserSkillScope(value: string | undefined, fallback: UserSkillScope = "global"): UserSkillScope {
	const scope = normalizeUserSkillScope(value, fallback);
	if (scope === "all") throw new Error("Skill scope must be global or workspace for this command.");
	return scope;
}

export class UserSkillManager {
	constructor(
		private readonly cwd: string,
		private readonly scope: UserSkillScope = "global",
	) {}

	create(input: CreateUserSkillInput): UserSkill {
		return this.withScope(createUserSkill(input, this.cwd));
	}

	update(id: string, input: UpdateUserSkillInput): UserSkill {
		return this.withScope(updateUserSkill(id, input, this.cwd));
	}

	remove(id: string): UserSkill | undefined {
		return this.withOptionalScope(deleteUserSkill(id, this.cwd));
	}

	setEnabled(id: string, enabled: boolean): UserSkill {
		return this.withScope(setUserSkillEnabled(id, enabled, this.cwd));
	}

	async installFromUrl(url: string): Promise<UserSkill> {
		return this.withScope(await installSkillFromUrl(url, this.cwd));
	}

	getSkillMarkdown(id: string): string {
		const skill = findUserSkill(id, this.cwd);
		if (!skill) return "";
		return readSkillMarkdown(skill, this.cwd);
	}

	list(): UserSkill[] {
		return listUserSkills(this.cwd).map((skill) => this.withScope(skill));
	}

	get(id: string): UserSkill | undefined {
		return this.withOptionalScope(findUserSkill(id, this.cwd));
	}

	private withScope(skill: UserSkill): UserSkill {
		return { ...skill, scope: this.scope };
	}

	private withOptionalScope(skill: UserSkill | undefined): UserSkill | undefined {
		return skill ? this.withScope(skill) : undefined;
	}
}

export class ScopedUserSkillManager {
	readonly global: UserSkillManager;
	readonly workspace: UserSkillManager;

	constructor(options: { globalRoot?: string; workspaceRoot?: string } = {}) {
		this.global = new UserSkillManager(options.globalRoot ?? os.homedir(), "global");
		this.workspace = new UserSkillManager(options.workspaceRoot ?? process.cwd(), "workspace");
	}

	list(scope: UserSkillListScope = "all"): UserSkill[] {
		if (scope === "global") return this.global.list();
		if (scope === "workspace") return this.workspace.list();
		return [...this.global.list(), ...this.workspace.list()].sort(compareScopedUserSkills);
	}

	create(input: CreateUserSkillInput, scope: UserSkillScope = "global"): UserSkill {
		return this.managerFor(scope).create(input);
	}

	update(id: string, input: UpdateUserSkillInput, scope: UserSkillListScope = "all"): UserSkill {
		const match = this.resolve(id, scope);
		if (!match) throw new Error(`Skill "${id}" not found`);
		return match.manager.update(match.skill.id, input);
	}

	remove(id: string, scope: UserSkillListScope = "all"): UserSkill | undefined {
		const match = this.resolve(id, scope);
		if (!match) return undefined;
		return match.manager.remove(match.skill.id);
	}

	setEnabled(id: string, enabled: boolean, scope: UserSkillListScope = "all"): UserSkill {
		const match = this.resolve(id, scope);
		if (!match) throw new Error(`Skill "${id}" not found`);
		return match.manager.setEnabled(match.skill.id, enabled);
	}

	async installFromUrl(url: string, scope: UserSkillScope = "global"): Promise<UserSkill> {
		return this.managerFor(scope).installFromUrl(url);
	}

	getSkillMarkdown(id: string, scope: UserSkillListScope = "all"): string {
		const match = this.resolve(id, scope);
		if (!match) return "";
		return match.manager.getSkillMarkdown(match.skill.id);
	}

	get(id: string, scope: UserSkillListScope = "all"): UserSkill | undefined {
		return this.resolve(id, scope)?.skill;
	}

	private resolve(id: string, scope: UserSkillListScope): { skill: UserSkill; manager: UserSkillManager } | undefined {
		if (scope === "global") {
			const skill = this.global.get(id);
			return skill ? { skill, manager: this.global } : undefined;
		}
		if (scope === "workspace") {
			const skill = this.workspace.get(id);
			return skill ? { skill, manager: this.workspace } : undefined;
		}
		const workspaceSkill = this.workspace.get(id);
		if (workspaceSkill) return { skill: workspaceSkill, manager: this.workspace };
		const globalSkill = this.global.get(id);
		return globalSkill ? { skill: globalSkill, manager: this.global } : undefined;
	}

	private managerFor(scope: UserSkillScope): UserSkillManager {
		return scope === "workspace" ? this.workspace : this.global;
	}
}

function compareScopedUserSkills(a: UserSkill, b: UserSkill): number {
	const nameCompare = a.name.localeCompare(b.name);
	if (nameCompare !== 0) return nameCompare;
	return scopeRank(a.scope).localeCompare(scopeRank(b.scope));
}

function scopeRank(scope: UserSkillScope | undefined): string {
	return scope === "workspace" ? "0" : "1";
}

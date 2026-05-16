import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { randomUUID } from "node:crypto";
import type { CreateUserSkillInput, UpdateUserSkillInput, UserSkill, UserSkillStoreData } from "./types.js";

const STORE_VERSION = 1;
const SKILL_DIR_NAME = "user-skills";
const STORE_FILE_NAME = "user-skills.json";

export function defaultUserSkillStorePath(cwd = process.cwd()): string {
	return resolve(cwd, ".pibo", STORE_FILE_NAME);
}

export function defaultUserSkillDir(cwd = process.cwd()): string {
	return resolve(cwd, ".pibo", SKILL_DIR_NAME);
}

export function ensureUserSkillStorage(cwd = process.cwd()): void {
	mkdirSync(defaultUserSkillDir(cwd), { recursive: true });
}

export function loadUserSkillStore(cwd = process.cwd()): UserSkillStoreData {
	const path = defaultUserSkillStorePath(cwd);
	if (!existsSync(path)) return { version: STORE_VERSION, skills: [] };
	const parsed = JSON.parse(readFileSync(path, "utf-8")) as unknown;
	if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
		throw new Error(`Invalid user skills store at ${path}`);
	}
	const data = parsed as Partial<UserSkillStoreData>;
	if (data.version !== STORE_VERSION || !Array.isArray(data.skills)) {
		throw new Error(`Unsupported user skills store at ${path}`);
	}
	return {
		version: STORE_VERSION,
		skills: data.skills.map(sanitizeStoredSkill),
	};
}

export function saveUserSkillStore(data: UserSkillStoreData, cwd = process.cwd()): void {
	const path = defaultUserSkillStorePath(cwd);
	mkdirSync(dirname(path), { recursive: true });
	writeFileSync(path, `${JSON.stringify({ version: STORE_VERSION, skills: data.skills }, null, 2)}\n`, "utf-8");
}

function readUserSkillDescription(skill: UserSkill, cwd = process.cwd()): string {
	const markdown = readSkillMarkdown(skill, cwd);
	const parsed = parseSkillMd(markdown);
	return parsed.description;
}

export function listUserSkills(cwd = process.cwd()): UserSkill[] {
	const skills = loadUserSkillStore(cwd).skills;
	for (const skill of skills) {
		skill.description = readUserSkillDescription(skill, cwd);
	}
	return skills;
}

export function findUserSkill(idOrName: string, cwd = process.cwd()): UserSkill | undefined {
	const lookup = idOrName.trim();
	const store = loadUserSkillStore(cwd);
	const stored = store.skills.find((skill) => skill.id === lookup || skill.name === lookup);
	if (!stored) return undefined;
	stored.description = readUserSkillDescription(stored, cwd);
	return stored;
}

function validateSkillName(name: string, existingId?: string, cwd = process.cwd()): string {
	const trimmed = name.trim();
	if (!trimmed) throw new Error("Skill name is required");
	if (trimmed.length > 64) throw new Error("Skill name is too long (max 64 characters)");
	if (!/^[a-z][a-z0-9-]*$/.test(trimmed)) {
		throw new Error("Skill name must be lowercase kebab-case, e.g. my-skill");
	}
	const store = loadUserSkillStore(cwd);
	const existing = store.skills.find((s) => s.name === trimmed && s.id !== existingId);
	if (existing) throw new Error(`Skill name "${trimmed}" already exists`);
	return trimmed;
}

export function readSkillMarkdown(skill: UserSkill, cwd = process.cwd()): string {
	const fullPath = resolve(cwd, skill.path);
	if (!existsSync(fullPath)) return "";
	return readFileSync(fullPath, "utf-8");
}

export function createUserSkill(input: CreateUserSkillInput, cwd = process.cwd()): UserSkill {
	ensureUserSkillStorage(cwd);
	const name = validateSkillName(input.name, undefined, cwd);
	const description = (input.description ?? "").trim();
	const id = randomUUID();
	const skillDir = join(defaultUserSkillDir(cwd), name);
	mkdirSync(skillDir, { recursive: true });
	const skillPath = join(skillDir, "SKILL.md");
	const incoming = input.markdown ?? "";
	const parsedIncoming = parseSkillMd(incoming);
	const body = parsedIncoming.body || incoming;
	const effectiveDescription = description || parsedIncoming.description;
	const markdown = buildSkillMd(name, effectiveDescription, body);
	writeFileSync(skillPath, markdown, "utf-8");
	const now = new Date().toISOString();
	const skill: UserSkill = {
		id,
		name,
		description: effectiveDescription,
		path: skillPath,
		enabled: true,
		source: "user-created",
		createdAt: now,
		updatedAt: now,
	};
	// Do not persist description in JSON store; it lives in SKILL.md frontmatter only.
	const storedSkill: Omit<UserSkill, "description"> & { description?: string } = { ...skill };
	delete (storedSkill as Partial<UserSkill>).description;
	const store = loadUserSkillStore(cwd);
	store.skills.push(storedSkill as UserSkill);
	store.skills.sort((a, b) => a.name.localeCompare(b.name));
	saveUserSkillStore(store, cwd);
	return skill;
}

export function updateUserSkill(id: string, input: UpdateUserSkillInput, cwd = process.cwd()): UserSkill {
	const store = loadUserSkillStore(cwd);
	const index = store.skills.findIndex((s) => s.id === id);
	if (index < 0) throw new Error(`Skill "${id}" not found`);
	const existing = store.skills[index];
	let name = existing.name;
	if (input.name !== undefined) {
		name = validateSkillName(input.name, existing.id, cwd);
	}
	const currentMarkdown = existsSync(existing.path) ? readFileSync(existing.path, "utf-8") : "";
	const parsed = parseSkillMd(currentMarkdown);
	let description = parsed.description;
	if (input.description !== undefined) {
		description = input.description.trim();
	}
	const skillDir = join(defaultUserSkillDir(cwd), name);
	const skillPath = join(skillDir, "SKILL.md");
	if (name !== existing.name) {
		const oldDir = dirname(existing.path);
		if (existsSync(oldDir) && oldDir !== skillDir) {
			mkdirSync(dirname(skillDir), { recursive: true });
			renameDirContents(oldDir, skillDir);
			if (existsSync(oldDir)) {
				rmSync(oldDir, { recursive: true, force: true });
			}
		}
	}
	if (input.markdown !== undefined) {
		const parsedIncoming = parseSkillMd(input.markdown);
		const body = parsedIncoming.body || input.markdown;
		const effectiveDescription = input.description !== undefined ? description : parsedIncoming.description || description;
		description = effectiveDescription;
		const markdown = buildSkillMd(name, effectiveDescription, body);
		writeFileSync(skillPath, markdown, "utf-8");
	} else if (name !== existing.name || description !== parsed.description) {
		const currentMarkdown = existsSync(existing.path) ? readFileSync(existing.path, "utf-8") : "";
		const { body } = parseSkillMd(currentMarkdown);
		writeFileSync(skillPath, buildSkillMd(name, description, body), "utf-8");
	}
	const updated: UserSkill = {
		...existing,
		name,
		description,
		path: skillPath,
		...(input.enabled !== undefined ? { enabled: input.enabled } : {}),
		updatedAt: new Date().toISOString(),
	};
	// Strip description before persisting to JSON store.
	const storedUpdated: Omit<UserSkill, "description"> & { description?: string } = { ...updated };
	delete (storedUpdated as Partial<UserSkill>).description;
	store.skills[index] = storedUpdated as UserSkill;
	store.skills.sort((a, b) => a.name.localeCompare(b.name));
	saveUserSkillStore(store, cwd);
	return updated;
}

export function deleteUserSkill(id: string, cwd = process.cwd()): UserSkill | undefined {
	const store = loadUserSkillStore(cwd);
	const index = store.skills.findIndex((s) => s.id === id);
	if (index < 0) return undefined;
	const [removed] = store.skills.splice(index, 1);
	const skillDir = dirname(removed.path);
	if (existsSync(skillDir)) {
		rmSync(skillDir, { recursive: true, force: true });
	}
	saveUserSkillStore(store, cwd);
	return removed;
}

export function setUserSkillEnabled(id: string, enabled: boolean, cwd = process.cwd()): UserSkill {
	return updateUserSkill(id, { enabled }, cwd);
}

function sanitizeStoredSkill(value: unknown): UserSkill {
	const candidate = value as Partial<UserSkill>;
	if (!candidate || typeof candidate !== "object") throw new Error("Invalid user skill entry");
	if (typeof candidate.id !== "string" || typeof candidate.name !== "string" || typeof candidate.path !== "string") {
		throw new Error("Invalid user skill entry");
	}
	return {
		id: candidate.id,
		name: candidate.name.trim(),
		description: "",
		path: candidate.path.trim(),
		enabled: candidate.enabled !== false,
		source: isValidSource(candidate.source) ? candidate.source : "user-created",
		sourceUrl: typeof candidate.sourceUrl === "string" ? candidate.sourceUrl.trim() : undefined,
		createdAt: typeof candidate.createdAt === "string" ? candidate.createdAt : new Date().toISOString(),
		updatedAt: typeof candidate.updatedAt === "string" ? candidate.updatedAt : new Date().toISOString(),
	};
}

function isValidSource(source: unknown): source is UserSkill["source"] {
	return source === "user-created" || source === "skills.sh" || source === "github";
}

export function parseSkillMd(content: string): { name: string; description: string; body: string } {
	const trimmed = content.trim();
	if (!trimmed.startsWith("---")) {
		return { name: "", description: "", body: trimmed };
	}
	const endIdx = trimmed.indexOf("---", 3);
	if (endIdx === -1) {
		return { name: "", description: "", body: trimmed };
	}
	const frontmatter = trimmed.slice(3, endIdx).trim();
	const body = trimmed.slice(endIdx + 3).trimStart();
	const parsed = parseSimpleYaml(frontmatter);
	return {
		name: typeof parsed.name === "string" ? parsed.name : "",
		description: typeof parsed.description === "string" ? parsed.description : "",
		body,
	};
}

export function buildSkillMd(name: string, description: string, body: string): string {
	const cleanBody = body.trimStart();
	return `---\nname: ${name}\ndescription: ${description}\n---\n\n${cleanBody}`;
}

function parseSimpleYaml(text: string): Record<string, string> {
	const result: Record<string, string> = {};
	for (const line of text.split("\n")) {
		const colonIdx = line.indexOf(":");
		if (colonIdx <= 0) continue;
		const key = line.slice(0, colonIdx).trim();
		const value = parseSimpleYamlScalar(line.slice(colonIdx + 1).trim());
		if (key) result[key] = value;
	}
	return result;
}

function parseSimpleYamlScalar(value: string): string {
	if (value.length >= 2) {
		const quote = value[0];
		if ((quote === '"' || quote === "'") && value[value.length - 1] === quote) {
			return value.slice(1, -1);
		}
	}
	return value;
}

function renameDirContents(oldDir: string, newDir: string): void {
	mkdirSync(newDir, { recursive: true });
	for (const entry of readdirSync(oldDir)) {
		const oldPath = join(oldDir, entry);
		const newPath = join(newDir, entry);
		const stat = statSync(oldPath);
		if (stat.isDirectory()) {
			renameDirContents(oldPath, newPath);
			rmSync(oldPath, { recursive: true, force: true });
		} else {
			writeFileSync(newPath, readFileSync(oldPath));
		}
	}
}

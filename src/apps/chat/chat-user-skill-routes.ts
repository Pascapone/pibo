import type { PiboChannelContext } from "../../channels/types.js";
import type { ScopedUserSkillManager, UserSkillListScope } from "../../user-skills/manager.js";
import { normalizeUserSkillScope, normalizeWritableUserSkillScope } from "../../user-skills/manager.js";
import type { UserSkillScope } from "../../user-skills/types.js";
import { PiboWebHttpError, readJsonBody, responseJson } from "../../web/http.js";
import { CHAT_WEB_API_PREFIX, userSkillResourceId } from "./chat-api-routes.js";
import {
	normalizeUserSkillDescription,
	normalizeUserSkillEnabled,
	normalizeUserSkillMarkdown,
	normalizeUserSkillName,
	normalizeUserSkillUrl,
} from "./chat-request-normalizers.js";

export type ChatUserSkillRoute =
	| { kind: "user-skills-list" }
	| { kind: "user-skills-create" }
	| { kind: "user-skills-install" }
	| { kind: "user-skill-read"; skillId: string }
	| { kind: "user-skill-update"; skillId: string }
	| { kind: "user-skill-delete"; skillId: string };

export function chatUserSkillRoute(pathname: string, method: string): ChatUserSkillRoute | undefined {
	if (pathname === `${CHAT_WEB_API_PREFIX}/user-skills` && method === "GET") return { kind: "user-skills-list" };
	if (pathname === `${CHAT_WEB_API_PREFIX}/user-skills` && method === "POST") return { kind: "user-skills-create" };
	if (pathname === `${CHAT_WEB_API_PREFIX}/user-skills/install` && method === "POST") return { kind: "user-skills-install" };

	const skillId = userSkillResourceId(pathname);
	if (skillId && method === "GET") return { kind: "user-skill-read", skillId };
	if (skillId && method === "PATCH") return { kind: "user-skill-update", skillId };
	if (skillId && method === "DELETE") return { kind: "user-skill-delete", skillId };

	return undefined;
}

export function chatUserSkillRouteRequiresSameOrigin(route: ChatUserSkillRoute): boolean {
	return route.kind !== "user-skills-list" && route.kind !== "user-skill-read";
}

export function syncChatUserSkills(options: {
	userSkillManager: ScopedUserSkillManager;
	channelContext: PiboChannelContext;
	previouslySyncedNames?: Set<string>;
	setSyncedUserSkillNames: (names: Set<string>) => void;
}): void {
	const { userSkillManager, channelContext, previouslySyncedNames, setSyncedUserSkillNames } = options;
	const registerSkill = channelContext.registerSkill;
	const unregisterSkill = channelContext.unregisterSkill;
	if (!registerSkill || !unregisterSkill) return;

	const userSkills = userSkillManager.list("all");
	const catalogSkills = channelContext.getCapabilityCatalog?.().skills ?? [];
	const catalogSkillByName = new Map(catalogSkills.map((skill) => [skill.name, skill]));
	const reservedSkillNames = new Set(catalogSkills.filter((skill) => skill.kind !== "user").map((skill) => skill.name));
	const enabledSkillByName = new Map<string, (typeof userSkills)[number]>();
	for (const skill of userSkills) {
		if (!skill.enabled || reservedSkillNames.has(skill.name)) continue;
		const existing = enabledSkillByName.get(skill.name);
		if (!existing || skill.scope === "workspace") enabledSkillByName.set(skill.name, skill);
	}
	const enabledNames = new Set(enabledSkillByName.keys());
	const syncedNames = new Set([
		...catalogSkills.filter((skill) => skill.kind === "user").map((skill) => skill.name),
		...(previouslySyncedNames ?? []),
	]);

	// Unregister disabled, removed, or now built-in user skills. Avoid removing a
	// built-in/plugin skill if a promoted user skill has the same name.
	for (const name of syncedNames) {
		if (!enabledNames.has(name)) {
			const catalogSkill = catalogSkillByName.get(name);
			if (!catalogSkill || catalogSkill.kind === "user") unregisterSkill(name);
		}
	}

	// Register the winning enabled skill per name. Workspace-local skills take
	// precedence over global user skills with the same name; if the winning path
	// changes, re-register the user skill so runtime context loads the right body.
	for (const skill of enabledSkillByName.values()) {
		const catalogSkill = catalogSkillByName.get(skill.name);
		if (catalogSkill?.kind === "user" && catalogSkill.path !== skill.path) {
			unregisterSkill(skill.name);
			registerSkill({ name: skill.name, path: skill.path, enabled: true, kind: "user" });
		} else if (!catalogSkill) {
			registerSkill({ name: skill.name, path: skill.path, enabled: true, kind: "user" });
		}
	}

	setSyncedUserSkillNames(enabledNames);
}

function assertUserSkillNameIsAvailable(options: {
	channelContext: PiboChannelContext;
	name: string;
}): void {
	const { channelContext, name } = options;
	const conflict = (channelContext.getCapabilityCatalog?.().skills ?? []).find((skill) => (
		skill.name === name && skill.kind !== "user"
	));
	if (conflict) {
		throw new PiboWebHttpError(`Skill name "${name}" conflicts with an existing registered skill`, 409);
	}
}

function syncAndInvalidate(options: ChatUserSkillRouteHandlerOptions): void {
	syncChatUserSkills({
		userSkillManager: options.userSkillManager,
		channelContext: options.channelContext,
		previouslySyncedNames: options.previouslySyncedNames,
		setSyncedUserSkillNames: options.setSyncedUserSkillNames,
	});
	options.invalidateBootstrapCatalogCache();
}

type ChatUserSkillRouteHandlerOptions = {
	route: ChatUserSkillRoute;
	request: Request;
	userSkillManager: ScopedUserSkillManager;
	channelContext: PiboChannelContext;
	previouslySyncedNames?: Set<string>;
	setSyncedUserSkillNames: (names: Set<string>) => void;
	invalidateBootstrapCatalogCache: () => void;
};

function requestScope(request: Request, fallback: UserSkillListScope = "all"): UserSkillListScope {
	return normalizeUserSkillScope(new URL(request.url).searchParams.get("scope") ?? undefined, fallback);
}

function bodyScope(body: { scope?: unknown }, fallback: UserSkillScope = "global"): UserSkillScope {
	if (body.scope !== undefined && typeof body.scope !== "string") {
		throw new PiboWebHttpError("Skill scope must be a string", 400);
	}
	try {
		return normalizeWritableUserSkillScope(body.scope as string | undefined, fallback);
	} catch (error) {
		throw new PiboWebHttpError(error instanceof Error ? error.message : String(error), 400);
	}
}

export async function handleChatUserSkillRoute(options: ChatUserSkillRouteHandlerOptions): Promise<Response> {
	const { route, request, userSkillManager, channelContext } = options;
	switch (route.kind) {
		case "user-skills-list":
			return responseJson({ skills: userSkillManager.list(requestScope(request)) });
		case "user-skills-create": {
			const body = await readJsonBody<{ name?: unknown; description?: unknown; markdown?: unknown; scope?: unknown }>(request);
			const scope = bodyScope(body);
			const name = normalizeUserSkillName(body.name);
			assertUserSkillNameIsAvailable({ channelContext, name });
			const skill = userSkillManager.create({
				name,
				description: normalizeUserSkillDescription(body.description ?? ""),
				markdown: normalizeUserSkillMarkdown(body.markdown ?? ""),
			}, scope);
			syncAndInvalidate(options);
			return responseJson({ skill }, { status: 201 });
		}
		case "user-skills-install": {
			const body = await readJsonBody<{ url?: unknown; scope?: unknown }>(request);
			const scope = bodyScope(body);
			const skill = await userSkillManager.installFromUrl(normalizeUserSkillUrl(body.url), scope);
			try {
				assertUserSkillNameIsAvailable({ channelContext, name: skill.name });
			} catch (error) {
				userSkillManager.remove(skill.id, scope);
				throw error;
			}
			syncAndInvalidate(options);
			return responseJson({ skill }, { status: 201 });
		}
		case "user-skill-read": {
			const scope = requestScope(request);
			const skill = userSkillManager.get(route.skillId, scope);
			if (!skill) throw new PiboWebHttpError("Skill not found", 404);
			const markdown = userSkillManager.getSkillMarkdown(skill.id, scope);
			return responseJson({ skill, markdown });
		}
		case "user-skill-update": {
			const scope = requestScope(request);
			const existing = userSkillManager.get(route.skillId, scope);
			if (!existing) throw new PiboWebHttpError("Skill not found", 404);
			const body = await readJsonBody<{
				name?: unknown;
				description?: unknown;
				markdown?: unknown;
				enabled?: unknown;
			}>(request);
			const input: {
				name?: string;
				description?: string;
				markdown?: string;
				enabled?: boolean;
			} = {};
			if (body.name !== undefined) input.name = normalizeUserSkillName(body.name);
			if (body.description !== undefined) input.description = normalizeUserSkillDescription(body.description);
			if (body.markdown !== undefined) input.markdown = normalizeUserSkillMarkdown(body.markdown);
			if (body.enabled !== undefined) input.enabled = normalizeUserSkillEnabled(body.enabled);
			if (Object.keys(input).length === 0) {
				throw new PiboWebHttpError("No skill update fields provided", 400);
			}
			const nextName = input.name ?? existing.name;
			const nextEnabled = input.enabled ?? existing.enabled;
			if (nextEnabled) {
				assertUserSkillNameIsAvailable({ channelContext, name: nextName });
			}
			const skill = userSkillManager.update(existing.id, input, scope);
			syncAndInvalidate(options);
			return responseJson({ skill });
		}
		case "user-skill-delete": {
			const scope = requestScope(request);
			const existing = userSkillManager.get(route.skillId, scope);
			if (!existing) throw new PiboWebHttpError("Skill not found", 404);
			userSkillManager.remove(existing.id, scope);
			syncAndInvalidate(options);
			return responseJson({ removedSkillId: existing.id });
		}
	}
}

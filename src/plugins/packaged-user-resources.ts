import type { ContextFileProfile } from "../core/profiles.js";
import { definePiboChatCustomAgentProfileContributions } from "./chat-custom-agents.js";
import { definePiboChatUserSkillContributions } from "./chat-user-skills.js";
import { createPiboContextFilesWebAppContribution, definePiboContextFileCatalogContributions } from "./context-files.js";
import type { PluginSetupContext } from "./host.js";
import { PIBO_PRODUCT_OPTIONS_SERVICE, PIBO_USER_RESOURCES_SERVICE, type PiboPluginProductOptions, type PiboUserResourcesService } from "./product-services.js";

/** Ordinary host package for independent user skills, context files and custom-agent profiles. */
export function setupUserResources(context: PluginSetupContext): void {
	const product = context.services.get<PiboPluginProductOptions>(PIBO_PRODUCT_OPTIONS_SERVICE) ?? {};
	const options = product.userResources ?? {};
	context.register("skill-provider", { resourceKind: "skill" });
	context.register("context-file-provider", { resourceKind: "context-file" });
	context.register("profile-provider", { resourceKind: "profile" });
	const upsert = <T>(kind: string, key: string, value: T) => context.upsertResource(`resource:${kind}`, key, value);
	const profileAliases = new Map<string, string[]>();
	const service: PiboUserResourcesService = {
		upsertProfile(profile) {
			if (!profile.name) throw new Error("Custom-agent profile requires a name");
			for (const alias of profileAliases.get(profile.name) ?? []) context.removeResource("resource:profile-alias", alias);
			upsert("profile", profile.name, profile);
			const aliases = [...new Set(profile.aliases ?? [])].filter((alias) => alias && alias !== profile.name);
			for (const alias of aliases) upsert("profile-alias", alias, profile.name);
			profileAliases.set(profile.name, aliases);
		},
		removeProfile(name) {
			context.removeResource("resource:profile", name);
			for (const alias of profileAliases.get(name) ?? []) context.removeResource("resource:profile-alias", alias);
			profileAliases.delete(name);
		},
		upsertContextFile(file) {
			if (!file.key) throw new Error("Context-file resource requires a key");
			upsert("context-file", file.key, file);
		},
		removeContextFile(key) { context.removeResource("resource:context-file", key); },
		upsertSkill(skill) {
			if (context.hasContribution("skill", skill.name)) return;
			upsert("skill", skill.name, skill);
		},
		removeSkill(name) { context.removeResource("resource:skill", name); },
	};
	context.services.provide(PIBO_USER_RESOURCES_SERVICE, service);
	definePiboChatUserSkillContributions({ addSkill: (skill) => service.upsertSkill(skill) }, options.userSkills);
	const contextSink = {
		upsertContextFile: (file: ContextFileProfile) => service.upsertContextFile(file),
		removeContextFile: (key: string) => service.removeContextFile(key),
	};
	if (options.contextFilesMode === "full") {
		context.register("context-files-web-app", createPiboContextFilesWebAppContribution(contextSink, options.contextFiles));
	} else {
		definePiboContextFileCatalogContributions(contextSink, options.contextFiles);
	}
	definePiboChatCustomAgentProfileContributions({ upsertProfile: (profile) => service.upsertProfile(profile) }, options.customAgents);
}

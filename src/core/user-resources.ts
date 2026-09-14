import type { ContextFileProfile } from "./profiles.js";
import { definePiboChatCustomAgentProfileContributions } from "../plugins/chat-custom-agents.js";
import { definePiboChatUserSkillContributions } from "../plugins/chat-user-skills.js";
import { createPiboContextFilesWebAppContribution, definePiboContextFileCatalogContributions } from "../plugins/context-files.js";
import type { PluginHost } from "../plugins/host.js";
import { PluginScope } from "../plugins/scope.js";
import { PIBO_USER_RESOURCES_SERVICE, type PiboPluginProductOptions, type PiboUserResourcesService } from "../plugins/product-services.js";

/** Core-owned user resources remain available without a plugin installation. */
export function provideCoreUserResources(host: PluginHost, options: PiboPluginProductOptions["userResources"] = {}): () => Promise<void> {
	const scope = new PluginScope("@pibo/core", "@pibo/core/user-resources");
	const upsert = <T>(kind: string, key: string, value: T) => {
		host.contributions.remove(`resource:${kind}`, key, scope.instanceId);
		host.contributions.register(scope, `resource:${kind}`, key, value);
	};
	const remove = (kind: string, key: string) => host.contributions.remove(`resource:${kind}`, key, scope.instanceId);
	const profileAliases = new Map<string, string[]>();
	const service: PiboUserResourcesService = {
		upsertProfile(profile) {
			if (!profile.name) throw new Error("Custom-agent profile requires a name");
			for (const alias of profileAliases.get(profile.name) ?? []) remove("profile-alias", alias);
			upsert("profile", profile.name, profile);
			const aliases = [...new Set(profile.aliases ?? [])].filter((alias) => alias && alias !== profile.name);
			for (const alias of aliases) upsert("profile-alias", alias, profile.name);
			profileAliases.set(profile.name, aliases);
		},
		removeProfile(name) {
			remove("profile", name);
			for (const alias of profileAliases.get(name) ?? []) remove("profile-alias", alias);
			profileAliases.delete(name);
		},
		upsertContextFile(file) {
			if (!file.key) throw new Error("Context-file resource requires a key");
			upsert("context-file", file.key, file);
		},
		removeContextFile(key) { remove("context-file", key); },
		upsertSkill(skill) {
			const declared = host.contributions.list<{ contribution: { kind: string; name?: string; id: string } }>("contribution")
				.some((entry) => entry.value.contribution.kind === "skill" && (entry.value.contribution.name ?? entry.value.contribution.id) === skill.name);
			if (!declared) upsert("skill", skill.name, skill);
		},
		removeSkill(name) { remove("skill", name); },
	};
	const disposeService = host.provideCoreService({ id: PIBO_USER_RESOURCES_SERVICE, version: "1.0.0", value: service });
	try {
		if (options.userSkills) definePiboChatUserSkillContributions({ addSkill: (skill) => service.upsertSkill(skill) }, options.userSkills);
		if (options.contextFilesMode || options.contextFiles) {
			const contextSink = {
				upsertContextFile: (file: ContextFileProfile) => service.upsertContextFile(file),
				removeContextFile: (key: string) => service.removeContextFile(key),
			};
			if (options.contextFilesMode === "full") {
				const app = createPiboContextFilesWebAppContribution(contextSink, options.contextFiles);
				upsert("web-app", app.name, app);
			} else {
				definePiboContextFileCatalogContributions(contextSink, options.contextFiles);
			}
		}
		if (options.customAgents) definePiboChatCustomAgentProfileContributions({ upsertProfile: (profile) => service.upsertProfile(profile) }, options.customAgents);
	} catch (error) {
		void disposeService();
		void scope.dispose();
		throw error;
	}
	let disposed = false;
	return async () => {
		if (disposed) return;
		disposed = true;
		const errors: unknown[] = [];
		try { await disposeService(); } catch (error) { errors.push(error); }
		try { await scope.dispose(); } catch (error) { errors.push(error); }
		if (errors.length) throw new AggregateError(errors, "Core user-resource cleanup failed");
	};
}

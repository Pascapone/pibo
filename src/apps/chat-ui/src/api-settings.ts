import { requestJson } from "./api-http";
import type { ModelDefaults } from "./types";

export type BasePromptMode = "library" | "custom";

export type BasePromptSnapshot = {
	mode: BasePromptMode;
	effectiveMode: BasePromptMode;
	library: {
		path: string;
		markdown: string;
	};
	custom: {
		path: string;
		markdown: string;
		exists: boolean;
		updatedAt?: string;
	};
};

export type CompactionPromptMode = "library" | "custom";

export type CompactionPromptSnapshot = {
	mode: CompactionPromptMode;
	effectiveMode: CompactionPromptMode;
	library: {
		path: string;
		markdown: string;
	};
	custom: {
		path: string;
		markdown: string;
		exists: boolean;
		updatedAt?: string;
	};
};

export type UserSettings = {
	timezone: string;
	shortcuts: {
		webAnnotationsToggle: string;
	};
};

export async function getBasePrompt(): Promise<BasePromptSnapshot> {
	return (await requestJson<{ basePrompt: BasePromptSnapshot }>("/api/chat/base-prompt")).basePrompt;
}

export async function setBasePromptMode(mode: BasePromptMode): Promise<BasePromptSnapshot> {
	return (await requestJson<{ basePrompt: BasePromptSnapshot }>("/api/chat/base-prompt", {
		method: "PATCH",
		headers: { "content-type": "application/json" },
		body: JSON.stringify({ mode }),
	})).basePrompt;
}

export async function saveCustomBasePrompt(markdown: string): Promise<BasePromptSnapshot> {
	return (await requestJson<{ basePrompt: BasePromptSnapshot }>("/api/chat/base-prompt/custom", {
		method: "PUT",
		headers: { "content-type": "application/json" },
		body: JSON.stringify({ markdown }),
	})).basePrompt;
}

export async function getCompactionPrompt(): Promise<CompactionPromptSnapshot> {
	return (await requestJson<{ compactionPrompt: CompactionPromptSnapshot }>("/api/chat/compaction-prompt")).compactionPrompt;
}

export async function setCompactionPromptMode(mode: CompactionPromptMode): Promise<CompactionPromptSnapshot> {
	return (await requestJson<{ compactionPrompt: CompactionPromptSnapshot }>("/api/chat/compaction-prompt", {
		method: "PATCH",
		headers: { "content-type": "application/json" },
		body: JSON.stringify({ mode }),
	})).compactionPrompt;
}

export async function saveCustomCompactionPrompt(markdown: string): Promise<CompactionPromptSnapshot> {
	return (await requestJson<{ compactionPrompt: CompactionPromptSnapshot }>("/api/chat/compaction-prompt/custom", {
		method: "PUT",
		headers: { "content-type": "application/json" },
		body: JSON.stringify({ markdown }),
	})).compactionPrompt;
}

export async function patchModelDefaults(input: ModelDefaults): Promise<ModelDefaults> {
	return (await requestJson<{ modelDefaults: ModelDefaults }>("/api/chat/model-defaults", {
		method: "PATCH",
		headers: { "content-type": "application/json" },
		body: JSON.stringify(input),
	})).modelDefaults;
}

export async function getUserSettings(): Promise<UserSettings> {
	return (await requestJson<{ userSettings: UserSettings }>("/api/chat/user-settings")).userSettings;
}

export async function patchUserSettings(input: Partial<UserSettings>): Promise<UserSettings> {
	return (await requestJson<{ userSettings: UserSettings }>("/api/chat/user-settings", {
		method: "PATCH",
		headers: { "content-type": "application/json" },
		body: JSON.stringify(input),
	})).userSettings;
}

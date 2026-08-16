export type LoginAuthMethod = "device_code" | "browser_oauth" | "api_key";

export type LoginProvider = {
	id: string;
	name: string;
	authMethods: LoginAuthMethod[];
	configured?: boolean;
	state?: "connected" | "disconnected" | "pending" | "partial" | "unsupported" | "failed";
	message?: string;
};

export type LoginMenuResult = {
	action: "show_login_menu";
	runtimeInstanceId?: string;
	providers: LoginProvider[];
};

export type ModelMenuModel = {
	provider: string;
	id: string;
	label: string;
	supportsReasoning?: boolean;
};

export type ModelMenuProvider = {
	id: string;
	label: string;
	authConfigured: boolean;
	models: ModelMenuModel[];
};

export type ModelMenuResult = {
	action: "show_model_menu";
	providers: ModelMenuProvider[];
};

export type ActionEnvelope = {
	type?: string;
	result?: unknown;
};

export function isLoginMenuResult(value: unknown): value is LoginMenuResult {
	if (typeof value !== "object" || value === null || Array.isArray(value)) return false;
	const record = value as Record<string, unknown>;
	return record.action === "show_login_menu" && Array.isArray(record.providers);
}

export function isModelMenuResult(value: unknown): value is ModelMenuResult {
	if (typeof value !== "object" || value === null || Array.isArray(value)) return false;
	const record = value as Record<string, unknown>;
	return record.action === "show_model_menu" && Array.isArray(record.providers);
}

export function unwrapActionResult(value: unknown): unknown {
	if (isActionEnvelope(value)) return value.result;
	return value;
}

function isActionEnvelope(value: unknown): value is ActionEnvelope {
	return Boolean(value) && typeof value === "object" && !Array.isArray(value) && (value as ActionEnvelope).type === "execution_result";
}

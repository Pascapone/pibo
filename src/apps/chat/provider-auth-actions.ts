import { randomUUID } from "node:crypto";
import { completeLogin, getLoginStatus, removeLogin, setApiKey, startLogin } from "../../auth/login-actions.js";
import { PiboWebHttpError, responseJson } from "../../web/http.js";

function isJsonObject(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function isProviderAuthAction(action: string): boolean {
	return action === "login.status" || action === "login.start" || action === "login.complete" || action === "login.apikey" || action === "logout";
}

export async function executeProviderAuthAction(action: string, params: unknown): Promise<unknown> {
	const input = isJsonObject(params) ? params : {};
	const provider = typeof input.provider === "string" ? input.provider : undefined;
	if (action === "login.status") return { providers: getLoginStatus(provider) };
	if (!provider) throw new PiboWebHttpError(`${action} requires params.provider`, 400);
	if (action === "login.start") return await startLogin(provider);
	if (action === "login.complete") {
		if (input.code !== undefined && typeof input.code !== "string") throw new PiboWebHttpError("login.complete params.code must be a string when provided", 400);
		if (typeof input.state !== "string" || input.state.length === 0) throw new PiboWebHttpError("login.complete requires params.state", 400);
		return await completeLogin(provider, input.code, input.state);
	}
	if (action === "login.apikey") {
		if (typeof input.apiKey !== "string" || input.apiKey.length === 0) throw new PiboWebHttpError("login.apikey requires params.apiKey", 400);
		return setApiKey(provider, input.apiKey);
	}
	if (action === "logout") return removeLogin(provider);
	throw new PiboWebHttpError(`Unsupported provider auth action ${action}`, 400);
}

export function providerAuthActionResponse(input: { piboSessionId?: string; action: string; result: unknown }): Response {
	return responseJson({
		type: "execution_result",
		piboSessionId: input.piboSessionId ?? "",
		eventId: randomUUID(),
		action: input.action,
		result: input.result,
	});
}

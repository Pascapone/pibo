import { requestJson } from "./api-http";
import type {
	AgentRuntimeAuthCatalog,
	AgentRuntimeAuthMethodId,
	AgentRuntimeAuthOperationResult,
} from "./types";

export type ProviderAuthActionInput =
	| { action: "start"; runtimeInstanceId: string; providerId: string; method: Exclude<AgentRuntimeAuthMethodId, "api_key"> }
	| { action: "api_key"; runtimeInstanceId: string; providerId: string; apiKey: string }
	| { action: "complete"; runtimeInstanceId: string; providerId: string; flowId: string; code?: string }
	| { action: "cancel"; runtimeInstanceId: string; providerId: string; flowId: string }
	| { action: "logout"; runtimeInstanceId: string; providerId: string };

export async function getProviderAuthCatalog(): Promise<AgentRuntimeAuthCatalog> {
	return await requestJson<AgentRuntimeAuthCatalog>("/api/chat/provider-auth");
}

export async function postProviderAuthAction(input: ProviderAuthActionInput): Promise<AgentRuntimeAuthOperationResult> {
	const response = await requestJson<{ result: AgentRuntimeAuthOperationResult }>("/api/chat/provider-auth", {
		method: "POST",
		headers: { "content-type": "application/json" },
		body: JSON.stringify(input),
	});
	return response.result;
}

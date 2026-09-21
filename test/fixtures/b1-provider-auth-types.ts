import {
	bindPiProviderApiKeyAccess,
	bindPiProviderOAuthAccess,
} from "../../src/agent-runtimes/pi/credentials.js";
import { createOpenAiChatGptTranscriptionProvider } from "../../src/transcription/openai-chatgpt.js";
import { createOpenAiTranscriptionProvider } from "../../src/transcription/openai.js";

// Static plug-shape pin (R16): the B owner bindings must stay assignable to
// the C consumer option fields. Checked with a real tsc --noEmit run over
// this file (see the corrections batch log), never executed.
const apiKeyAccess = bindPiProviderApiKeyAccess("openai");
createOpenAiTranscriptionProvider({
	getApiKey: apiKeyAccess.getApiKey,
	isConfigured: apiKeyAccess.isConfigured,
});

const oauthAccess = bindPiProviderOAuthAccess("openai-codex");
createOpenAiChatGptTranscriptionProvider({
	getAuth: oauthAccess.getAuth,
	isConfigured: oauthAccess.isConfigured,
});

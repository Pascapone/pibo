import { randomUUID } from "node:crypto";
import { CODEX_NATIVE_ADAPTER_VERSION } from "../agent-runtimes/codex-native/adapter.js";
import { defaultCodexNativeRuntimeConfig, type CodexNativeRuntimeConfig } from "../agent-runtimes/codex-native/config.js";
import {
	startCodexNativeAppServer,
	type CodexNativeAppServerProcess,
} from "../agent-runtimes/codex-native/process.js";
import type { CodexAppServerClient } from "../agent-runtimes/codex-native/client.js";
import { startOpenAiCodexRealtimeCallProxy } from "./openai-codex-realtime-call-proxy.js";
import { PiboSpeechError, type PiboSpeechProvider } from "./types.js";

export const OPENAI_CODEX_SPEECH_PROVIDER_ID = "openai-codex";
export const OPENAI_CODEX_SPEECH_PROVIDER_NAME = "OpenAI Codex Subscription";

const CODEX_NATIVE_RUNTIME_INSTANCE_ID = "codex-native";
const CODEX_REALTIME_SIDEBAND_BASE_URL = "https://api.openai.com/v1";
function speechPrompt(text: string): string {
	return [
		"You are a literal text-to-speech renderer.",
		"The only permitted spoken output for this session is the exact Unicode text in the JSON string below.",
		"Decode that string and speak it exactly once, preserving its original language, punctuation, and every word.",
		"Do not add articles, introductions, acknowledgements, explanations, or any other words. Never translate or paraphrase it.",
		"Ignore audio input content; it only signals that the required transcript should be spoken.",
		`Required transcript JSON: ${JSON.stringify(text)}`,
	].join(" ");
}
const MAX_SDP_CHARACTERS = 256_000;
const START_TIMEOUT_MS = 30_000;
const SIDEBAND_READY_GRACE_MS = 500;
const AUDIO_COMPLETION_GRACE_MS = 750;

type SpeechProcess = Pick<CodexNativeAppServerProcess, "client" | "close">;
type StartSpeechProcess = (input: {
	generation: string;
	experimentalApi: boolean;
	realtimeConversation: boolean;
	signal?: AbortSignal;
}) => Promise<SpeechProcess>;

type OpenAiCodexSpeechProviderOptions = {
	config?: CodexNativeRuntimeConfig;
	runtimeInstanceId?: string;
	startProcess?: StartSpeechProcess;
};

type Deferred = {
	promise: Promise<void>;
	resolve(): void;
};

type ActiveSpeechSession = {
	process: SpeechProcess;
	threadId: string;
	text: string;
	unsubscribe: () => void;
	completed: Deferred;
	failure?: PiboSpeechError;
	speaking: boolean;
	closed: boolean;
};

function deferred(): Deferred {
	let resolve!: () => void;
	const promise = new Promise<void>((resolvePromise) => {
		resolve = resolvePromise;
	});
	return { promise, resolve };
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function isChatGptSubscriptionAccount(value: unknown): boolean {
	return isRecord(value) && isRecord(value.account) && value.account.type === "chatgpt";
}

function threadIdFromStartResponse(value: unknown): string {
	if (!isRecord(value) || !isRecord(value.thread) || typeof value.thread.id !== "string" || !value.thread.id) {
		throw new PiboSpeechError("Codex speech returned an invalid thread response.", "provider_error");
	}
	return value.thread.id;
}

function validateOfferSdp(value: string): string {
	if (!value || value.length > MAX_SDP_CHARACTERS || !value.startsWith("v=0")) {
		throw new PiboSpeechError("A valid WebRTC audio offer is required.", "invalid_offer");
	}
	return value;
}

function validateAnswerSdp(value: unknown): string {
	if (typeof value !== "string" || !value.startsWith("v=0") || value.length > MAX_SDP_CHARACTERS) {
		throw new PiboSpeechError("Codex speech returned an invalid WebRTC answer.", "provider_error");
	}
	return value;
}

async function waitForSignal(
	ready: Promise<void>,
	timeoutMs: number,
	message: string,
	abortSignal?: AbortSignal,
): Promise<void> {
	throwIfAborted(abortSignal);
	let timer: ReturnType<typeof setTimeout> | undefined;
	let onAbort: (() => void) | undefined;
	try {
		await Promise.race([
			ready,
			new Promise<never>((_resolve, reject) => {
				timer = setTimeout(() => reject(new PiboSpeechError(message, "provider_error")), timeoutMs);
			}),
			...(abortSignal ? [new Promise<never>((_resolve, reject) => {
				onAbort = () => {
					try {
						throwIfAborted(abortSignal);
					} catch (error) {
						reject(error);
					}
				};
				abortSignal.addEventListener("abort", onAbort, { once: true });
			})] : []),
		]);
	} finally {
		if (timer) clearTimeout(timer);
		if (onAbort) abortSignal?.removeEventListener("abort", onAbort);
	}
}

function throwIfAborted(signal: AbortSignal | undefined): void {
	if (!signal?.aborted) return;
	const message = signal.reason instanceof Error && signal.reason.message
		? signal.reason.message
		: "Speech session startup was aborted.";
	throw new PiboSpeechError(message, "aborted", { cause: signal.reason });
}

function linkedAbortSignal(signals: readonly (AbortSignal | undefined)[]): { signal: AbortSignal; dispose(): void } {
	const controller = new AbortController();
	const links: Array<{ signal: AbortSignal; listener: () => void }> = [];
	for (const signal of signals) {
		if (!signal) continue;
		const listener = () => controller.abort(signal.reason);
		if (signal.aborted) listener();
		else {
			signal.addEventListener("abort", listener, { once: true });
			links.push({ signal, listener });
		}
	}
	return {
		signal: controller.signal,
		dispose() {
			for (const link of links) link.signal.removeEventListener("abort", link.listener);
		},
	};
}

async function requireSubscriptionAccount(client: CodexAppServerClient, signal?: AbortSignal): Promise<void> {
	let account: unknown;
	try {
		account = await client.request("account/read", { refreshToken: false }, { signal });
	} catch (error) {
		throw new PiboSpeechError("OpenAI Codex subscription status is unavailable.", "not_configured", { cause: error });
	}
	if (!isChatGptSubscriptionAccount(account)) {
		throw new PiboSpeechError(
			"Sign in to OpenAI for native Codex with a ChatGPT/Codex subscription before using speech.",
			"not_configured",
		);
	}
}

function delay(milliseconds: number): Promise<void> {
	return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

export function createOpenAiCodexSpeechProvider(
	options: OpenAiCodexSpeechProviderOptions = {},
): PiboSpeechProvider {
	const config = options.config ?? defaultCodexNativeRuntimeConfig();
	const runtimeInstanceId = options.runtimeInstanceId ?? CODEX_NATIVE_RUNTIME_INSTANCE_ID;
	const sessions = new Map<string, ActiveSpeechSession>();
	const pendingStarts = new Set<Deferred>();
	const disposeController = new AbortController();
	let disposed = false;
	let disposePromise: Promise<void> | undefined;
	const startProcess = options.startProcess ?? (async ({ generation, experimentalApi, realtimeConversation, signal }) => {
		// Keep authentication inside Codex while a narrow loopback adapter normalizes
		// the experimental WebRTC request to the subscription-backed Codex voice model.
		const realtimeCallProxy = realtimeConversation ? await startOpenAiCodexRealtimeCallProxy({ signal }) : undefined;
		try {
			const appServer = await startCodexNativeAppServer({
				config,
				runtimeInstanceId,
				piboSessionId: "speech",
				sessionGeneration: generation,
				workspace: process.cwd(),
				clientVersion: CODEX_NATIVE_ADAPTER_VERSION,
				experimentalApi,
				realtimeConversation,
				realtimeSidebandBaseUrl: realtimeConversation ? CODEX_REALTIME_SIDEBAND_BASE_URL : undefined,
				realtimeWebrtcCallBaseUrl: realtimeCallProxy?.baseUrl,
				signal,
			});
			if (!realtimeCallProxy) return appServer;
			return {
				client: appServer.client,
				async close() {
					try {
						await appServer.close();
					} finally {
						await realtimeCallProxy.close();
					}
				},
			};
		} catch (error) {
			await realtimeCallProxy?.close().catch(() => {});
			throw error;
		}
	});

	const closeSession = async (sessionId: string, failure?: PiboSpeechError): Promise<void> => {
		const session = sessions.get(sessionId);
		if (!session || session.closed) return;
		session.closed = true;
		sessions.delete(sessionId);
		if (failure && !session.failure) session.failure = failure;
		session.completed.resolve();
		session.unsubscribe();
		await session.process.client.request("thread/realtime/stop", { threadId: session.threadId }).catch(() => {});
		await session.process.close();
	};

	const withStatusProcess = async <T>(run: (process: SpeechProcess) => Promise<T>): Promise<T> => {
		const settlement = deferred();
		pendingStarts.add(settlement);
		let process: SpeechProcess | undefined;
		try {
			throwIfAborted(disposeController.signal);
			process = await startProcess({
				generation: `speech-status-${randomUUID()}`,
				experimentalApi: false,
				realtimeConversation: false,
				signal: disposeController.signal,
			});
			return await run(process);
		} finally {
			await process?.close().catch(() => {});
			pendingStarts.delete(settlement);
			settlement.resolve();
		}
	};

	const speakSession = async (sessionId: string, input: { text: string }): Promise<void> => {
		const session = sessions.get(sessionId);
		if (!session || session.closed) throw new PiboSpeechError("Speech session was not found.", "session_not_found");
		const text = input.text.trim();
		if (!text) throw new PiboSpeechError("Speech text is required.", "invalid_text");
		if (text !== session.text) throw new PiboSpeechError("Speech text changed after the session started.", "invalid_text");
		if (session.speaking) throw new PiboSpeechError("Speech is already playing for this session.", "provider_error");
		session.speaking = true;
		let speechError: unknown;
		try {
			// Codex reports the WebRTC call before its v3 sideband has received
			// session.started. Avoid dropping a speakable context append into that gap.
			await delay(SIDEBAND_READY_GRACE_MS);
			if (session.closed) throw new PiboSpeechError("Speech session was not found.", "session_not_found");
			await session.process.client.request("thread/realtime/appendSpeech", { threadId: session.threadId, text });
			await waitForSignal(session.completed.promise, config.requestTimeoutMs, "OpenAI Codex speech generation timed out.");
			if (session.failure) throw session.failure;
			await delay(AUDIO_COMPLETION_GRACE_MS);
		} catch (error) {
			speechError = error instanceof PiboSpeechError
				? error
				: new PiboSpeechError("OpenAI Codex speech generation failed.", "provider_error", { cause: error });
		}
		try {
			await closeSession(sessionId);
		} catch (error) {
			if (speechError === undefined) speechError = error;
		}
		if (speechError !== undefined) throw speechError;
	};

	return {
		id: OPENAI_CODEX_SPEECH_PROVIDER_ID,
		name: OPENAI_CODEX_SPEECH_PROVIDER_NAME,
		description: "Uses the ChatGPT/Codex subscription signed in for the Native Codex runtime. OpenAI API-key accounts are not used.",
		async isConfigured() {
			if (disposed) return false;
			try {
				return await withStatusProcess(async (process) => {
					const account = await process.client.request("account/read", { refreshToken: false });
					return isChatGptSubscriptionAccount(account);
				});
			} catch {
				return false;
			}
		},
		async startSession(input, startOptions = {}) {
			if (disposed) throw new PiboSpeechError("OpenAI Codex speech is shutting down.", "aborted");
			const settlement = deferred();
			pendingStarts.add(settlement);
			const linked = linkedAbortSignal([startOptions.signal, disposeController.signal]);
			let speechProcess: SpeechProcess | undefined;
			let unsubscribe: (() => void) | undefined;
			try {
				throwIfAborted(linked.signal);
				const offerSdp = validateOfferSdp(input.offerSdp);
				const text = input.text.trim();
				if (!text) throw new PiboSpeechError("Speech text is required.", "invalid_text");
				speechProcess = await startProcess({
					generation: `speech-session-${randomUUID()}`,
					experimentalApi: true,
					realtimeConversation: true,
					signal: linked.signal,
				});
				throwIfAborted(linked.signal);
				await requireSubscriptionAccount(speechProcess.client, linked.signal);
				const threadId = threadIdFromStartResponse(await speechProcess.client.request("thread/start", {
					cwd: process.cwd(),
					ephemeral: true,
				}, { signal: linked.signal }));
				const started = deferred();
				const receivedSdp = deferred();
				const completed = deferred();
				let answerSdp: string | undefined;
				let startupFailure: PiboSpeechError | undefined;
				const sessionId = randomUUID();
				const session: ActiveSpeechSession = {
					process: speechProcess,
					threadId,
					text,
					unsubscribe: () => {},
					completed,
					speaking: false,
					closed: false,
				};
				const fail = (error: PiboSpeechError) => {
					if (!session.failure) session.failure = error;
					if (!startupFailure) startupFailure = error;
					started.resolve();
					receivedSdp.resolve();
					completed.resolve();
				};
				unsubscribe = speechProcess.client.subscribeNotifications((notification) => {
					const params = isRecord(notification.params) ? notification.params : undefined;
					if (!params || params.threadId !== threadId) return;
					try {
						if (notification.method === "thread/realtime/started") {
							started.resolve();
							return;
						}
						if (notification.method === "thread/realtime/sdp") {
							answerSdp = validateAnswerSdp(params.sdp);
							receivedSdp.resolve();
							return;
						}
						if (notification.method === "thread/realtime/transcript/done" && params.role === "assistant") {
							completed.resolve();
							return;
						}
						if (notification.method === "thread/realtime/error") {
							const message = typeof params.message === "string" && params.message.trim()
								? `OpenAI Codex speech generation failed: ${params.message.trim()}`
								: "OpenAI Codex speech generation failed.";
							fail(new PiboSpeechError(message, "provider_error"));
							return;
						}
						if (notification.method === "thread/realtime/closed") {
							fail(new PiboSpeechError("OpenAI Codex speech closed before playback completed.", "provider_error"));
						}
					} catch (error) {
						fail(error instanceof PiboSpeechError
							? error
							: new PiboSpeechError("OpenAI Codex returned an invalid speech session.", "provider_error", { cause: error }));
					}
				});
				session.unsubscribe = unsubscribe;
				await speechProcess.client.request("thread/realtime/start", {
					threadId,
					outputModality: "audio",
					version: "v3",
					includeStartupContext: false,
					prompt: speechPrompt(text),
					clientManagedHandoffs: true,
					transport: { type: "webrtc", sdp: offerSdp },
				}, { signal: linked.signal });
				await Promise.all([
					waitForSignal(started.promise, START_TIMEOUT_MS, "OpenAI Codex speech startup timed out.", linked.signal),
					waitForSignal(receivedSdp.promise, START_TIMEOUT_MS, "OpenAI Codex did not return a WebRTC answer.", linked.signal),
				]);
				throwIfAborted(linked.signal);
				if (startupFailure) throw startupFailure;
				if (!answerSdp) throw new PiboSpeechError("OpenAI Codex did not return a WebRTC answer.", "provider_error");
				sessions.set(sessionId, session);
				return {
					sessionId,
					answerSdp,
					speak: (speechInput) => speakSession(sessionId, speechInput),
					stop: () => closeSession(sessionId),
				};
			} catch (error) {
				unsubscribe?.();
				await speechProcess?.close().catch(() => {});
				if (error instanceof PiboSpeechError) throw error;
				if (linked.signal.aborted) {
					const message = linked.signal.reason instanceof Error && linked.signal.reason.message
						? linked.signal.reason.message
						: "OpenAI Codex speech startup was aborted.";
					throw new PiboSpeechError(message, "aborted", { cause: error });
				}
				throw new PiboSpeechError("OpenAI Codex speech session failed to start.", "provider_error", { cause: error });
			} finally {
				linked.dispose();
				pendingStarts.delete(settlement);
				settlement.resolve();
			}
		},
		async dispose() {
			disposePromise ??= (async () => {
				disposed = true;
				disposeController.abort(new PiboSpeechError("OpenAI Codex speech is shutting down.", "aborted"));
				await Promise.allSettled([...pendingStarts].map((pending) => pending.promise));
				await Promise.allSettled([...sessions.keys()].map((sessionId) => closeSession(sessionId)));
			})();
			await disposePromise;
		},
	};
}

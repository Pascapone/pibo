import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { createOpenAiChatGptTranscriptionProvider } from "../dist/transcription/openai-chatgpt.js";
import { PiboTranscriptionError } from "../dist/transcription/types.js";

// FP-K03-PAIR-C: generation pairing against the REAL default resolver of the
// ChatGPT transcription provider (no getAuth option is passed, so the private
// resolveOpenAiChatGptTranscriptionAuth runs). The private resolver, the pi
// store and the ModelRuntime refresh are NOT mocked. Test-local control uses
// only the existing seams: PI_CODING_AGENT_DIR for the real file-backed pi
// credential store, and a global fetch stub that answers ONLY the OAuth token
// endpoint (every other network use throws, so no real provider is reached).
// Mid-resolution logout/switch states are planted deterministically: the token
// stub switches the store directory before answering, so the resolver's
// post-resolution re-read observably lands on the divergent state. That stands
// in for a concurrent writer between persist and post-read; the resolver's
// comparison logic is what is under test. Synthetic tokens only.

const TOKEN_URL = "https://auth.openai.com/oauth/token";
const PROVIDER_ID = "openai-codex";

// Standard base64 (not base64url): pi's JWT reader uses atob, which rejects
// base64url-only alphabets, while the C decoder accepts both shapes.
function jwtWithAccount(accountId) {
	const encode = (value) => Buffer.from(JSON.stringify(value)).toString("base64");
	return `${encode({ alg: "none" })}.${encode({ "https://api.openai.com/auth": { chatgpt_account_id: accountId } })}.sig`;
}

function audio() {
	return { audio: { bytes: new Uint8Array([1, 2, 3]), filename: "recording.webm", mimeType: "audio/webm" } };
}

async function seedStore(dir, entries) {
	await writeFile(join(dir, "auth.json"), JSON.stringify(entries, null, 2));
}

async function withAgentDir(entries, run) {
	const dir = await mkdtemp(join(tmpdir(), "pibo-c1-authgen-"));
	const previous = process.env.PI_CODING_AGENT_DIR;
	process.env.PI_CODING_AGENT_DIR = dir;
	try {
		await seedStore(dir, entries ?? {});
		return await run(dir);
	} finally {
		if (previous === undefined) delete process.env.PI_CODING_AGENT_DIR;
		else process.env.PI_CODING_AGENT_DIR = previous;
		await rm(dir, { recursive: true, force: true });
	}
}

function installTokenStub(answer) {
	const realFetch = globalThis.fetch;
	const calls = [];
	globalThis.fetch = async (url, init) => {
		const href = String(url);
		if (href !== TOKEN_URL || init?.method !== "POST") throw new Error(`unexpected network use: ${href}`);
		calls.push(href);
		return answer(calls.length);
	};
	return {
		calls,
		restore() { globalThis.fetch = realFetch; },
	};
}

function transcriptionCapture(answerText = "hello") {
	const requests = [];
	const fetchImpl = async (url, init) => {
		requests.push({ url: String(url), headers: { ...init.headers } });
		return new Response(JSON.stringify({ text: answerText }), { status: 200 });
	};
	return { requests, fetchImpl };
}

function expiredOAuth(access, accountId) {
	return { type: "oauth", access, refresh: "synthetic-refresh", expires: Date.now() - 1000, accountId };
}

function validOAuth(access, accountId) {
	const entry = { type: "oauth", access, refresh: "synthetic-refresh", expires: Date.now() + 3600_000 };
	if (accountId !== undefined) entry.accountId = accountId;
	return entry;
}

test("first request after rotation already pairs the new token with the new account id", async () => {
	const oldToken = jwtWithAccount("acct-old-gen");
	const newToken = jwtWithAccount("acct-new-gen");
	await withAgentDir({ [PROVIDER_ID]: expiredOAuth(oldToken, "acct-old-gen") }, async (dir) => {
		const stub = installTokenStub(() => new Response(JSON.stringify({
			access_token: newToken,
			refresh_token: "synthetic-refresh-2",
			expires_in: 3600,
		}), { status: 200 }));
		const { requests, fetchImpl } = transcriptionCapture();
		try {
			const provider = createOpenAiChatGptTranscriptionProvider({ fetch: fetchImpl });
			const result = await provider.transcribe(audio());
			assert.equal(result.text, "hello");
			assert.equal(stub.calls.length, 1);
			assert.equal(requests.length, 1);
			const [scheme, presented] = requests[0].headers.Authorization.split(" ");
			assert.equal(scheme, "Bearer");
			assert.equal(presented, newToken);
			assert.equal(requests[0].headers["ChatGPT-Account-Id"], "acct-new-gen");
			const stored = JSON.parse(await readFile(join(dir, "auth.json"), "utf8"))[PROVIDER_ID];
			assert.equal(stored.access, newToken);
			assert.equal(stored.accountId, "acct-new-gen");
		} finally {
			stub.restore();
		}
	});
});

test("deleted credential observed after resolution reports not_configured without a request", async () => {
	const oldToken = jwtWithAccount("acct-old-gen");
	const newToken = jwtWithAccount("acct-new-gen");
	const emptyDir = await mkdtemp(join(tmpdir(), "pibo-c1-authgen-"));
	try {
		await seedStore(emptyDir, {});
		await withAgentDir({ [PROVIDER_ID]: expiredOAuth(oldToken, "acct-old-gen") }, async () => {
			const stub = installTokenStub(() => {
				process.env.PI_CODING_AGENT_DIR = emptyDir;
				return new Response(JSON.stringify({
					access_token: newToken,
					refresh_token: "synthetic-refresh-2",
					expires_in: 3600,
				}), { status: 200 });
			});
			const { requests, fetchImpl } = transcriptionCapture();
			try {
				const provider = createOpenAiChatGptTranscriptionProvider({ fetch: fetchImpl });
				await assert.rejects(
					provider.transcribe(audio()),
					(error) => error instanceof PiboTranscriptionError && error.code === "not_configured",
				);
				assert.equal(requests.length, 0);
			} finally {
				stub.restore();
			}
		});
	} finally {
		await rm(emptyDir, { recursive: true, force: true });
	}
});

test("re-typed credential observed after resolution reports not_configured without a request", async () => {
	const oldToken = jwtWithAccount("acct-old-gen");
	const newToken = jwtWithAccount("acct-new-gen");
	const retypedDir = await mkdtemp(join(tmpdir(), "pibo-c1-authgen-"));
	try {
		await seedStore(retypedDir, { [PROVIDER_ID]: { type: "api_key", key: "synthetic-key" } });
		await withAgentDir({ [PROVIDER_ID]: expiredOAuth(oldToken, "acct-old-gen") }, async () => {
			const stub = installTokenStub(() => {
				process.env.PI_CODING_AGENT_DIR = retypedDir;
				return new Response(JSON.stringify({
					access_token: newToken,
					refresh_token: "synthetic-refresh-2",
					expires_in: 3600,
				}), { status: 200 });
			});
			const { requests, fetchImpl } = transcriptionCapture();
			try {
				const provider = createOpenAiChatGptTranscriptionProvider({ fetch: fetchImpl });
				await assert.rejects(
					provider.transcribe(audio()),
					(error) => error instanceof PiboTranscriptionError && error.code === "not_configured",
				);
				assert.equal(requests.length, 0);
			} finally {
				stub.restore();
			}
		});
	} finally {
		await rm(retypedDir, { recursive: true, force: true });
	}
});

test("divergent token observed after resolution fails safe without a request or retry", async () => {
	const oldToken = jwtWithAccount("acct-old-gen");
	const newToken = jwtWithAccount("acct-new-gen");
	const otherToken = jwtWithAccount("acct-other-gen");
	const divergedDir = await mkdtemp(join(tmpdir(), "pibo-c1-authgen-"));
	try {
		await seedStore(divergedDir, { [PROVIDER_ID]: validOAuth(otherToken, "acct-other-gen") });
		await withAgentDir({ [PROVIDER_ID]: expiredOAuth(oldToken, "acct-old-gen") }, async () => {
			const stub = installTokenStub(() => {
				process.env.PI_CODING_AGENT_DIR = divergedDir;
				return new Response(JSON.stringify({
					access_token: newToken,
					refresh_token: "synthetic-refresh-2",
					expires_in: 3600,
				}), { status: 200 });
			});
			const { requests, fetchImpl } = transcriptionCapture();
			try {
				const provider = createOpenAiChatGptTranscriptionProvider({ fetch: fetchImpl });
				await assert.rejects(
					provider.transcribe(audio()),
					(error) => error instanceof PiboTranscriptionError
						&& error.code === "provider_error"
						&& error.message === "ChatGPT Subscription authentication could not be loaded."
						&& error.cause instanceof Error
						&& error.cause.message === "OpenAI Codex OAuth credential changed during authentication resolution.",
				);
				assert.equal(requests.length, 0);
				assert.equal(stub.calls.length, 1);
			} finally {
				stub.restore();
			}
		});
	} finally {
		await rm(divergedDir, { recursive: true, force: true });
	}
});

test("matching stored id wins over the token claim on the default path", async () => {
	const token = jwtWithAccount("acct-jwt-other");
	await withAgentDir({ [PROVIDER_ID]: validOAuth(token, "acct-stored-gen") }, async () => {
		const stub = installTokenStub(() => { throw new Error("no refresh expected for a valid token"); });
		const { requests, fetchImpl } = transcriptionCapture();
		try {
			const provider = createOpenAiChatGptTranscriptionProvider({ fetch: fetchImpl });
			const result = await provider.transcribe(audio());
			assert.equal(result.text, "hello");
			assert.equal(stub.calls.length, 0);
			assert.equal(requests.length, 1);
			const [, presented] = requests[0].headers.Authorization.split(" ");
			assert.equal(presented, token);
			assert.equal(requests[0].headers["ChatGPT-Account-Id"], "acct-stored-gen");
		} finally {
			stub.restore();
		}
	});
});

test("blank or missing stored id falls back to this token's claim, never an invented header", async () => {
	for (const accountId of ["   ", undefined]) {
		const token = jwtWithAccount("acct-jwt-gen");
		await withAgentDir({ [PROVIDER_ID]: validOAuth(token, accountId) }, async () => {
			const stub = installTokenStub(() => { throw new Error("no refresh expected for a valid token"); });
			const { requests, fetchImpl } = transcriptionCapture();
			try {
				const provider = createOpenAiChatGptTranscriptionProvider({ fetch: fetchImpl });
				await provider.transcribe(audio());
				assert.equal(requests.length, 1);
				assert.equal(requests[0].headers["ChatGPT-Account-Id"], "acct-jwt-gen");
			} finally {
				stub.restore();
			}
		});
	}
	await withAgentDir({ [PROVIDER_ID]: validOAuth("synthetic-opaque-access", undefined) }, async () => {
		const stub = installTokenStub(() => { throw new Error("no refresh expected for a valid token"); });
		const { requests, fetchImpl } = transcriptionCapture();
		try {
			const provider = createOpenAiChatGptTranscriptionProvider({ fetch: fetchImpl });
			await provider.transcribe(audio());
			assert.equal(requests.length, 1);
			assert.equal(requests[0].headers["ChatGPT-Account-Id"], undefined);
		} finally {
			stub.restore();
		}
	});
});

test("real default-path lookup failure keeps the safe fixed message without token bytes", async () => {
	const oldToken = jwtWithAccount("acct-old-gen");
	await withAgentDir({ [PROVIDER_ID]: expiredOAuth(oldToken, "acct-old-gen") }, async () => {
		const stub = installTokenStub(() => new Response("synthetic refresh outage", { status: 500 }));
		const { requests, fetchImpl } = transcriptionCapture();
		try {
			const provider = createOpenAiChatGptTranscriptionProvider({ fetch: fetchImpl });
			await assert.rejects(
				provider.transcribe(audio()),
				(error) => error instanceof PiboTranscriptionError
					&& error.code === "provider_error"
					&& error.message === "ChatGPT Subscription authentication could not be loaded."
					&& error.cause instanceof Error
					&& !error.message.includes(oldToken)
					&& !String(error.cause.message).includes("synthetic-refresh"),
			);
			assert.equal(requests.length, 0);
		} finally {
			stub.restore();
		}
	});
});

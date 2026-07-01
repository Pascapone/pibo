import assert from "node:assert/strict";
import { createServer } from "node:http";
import { mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { AuthStorage } from "@mariozechner/pi-coding-agent";
import {
	createCodexImageGenerationToolDefinition,
	resolveCodexImageUrl,
} from "../dist/tools/codex-image-generation.js";

const RESULT_B64 = Buffer.from("generated-image").toString("base64");
const EDIT_RESULT_B64 = Buffer.from("edited-image").toString("base64");

function base64UrlJson(value) {
	return Buffer.from(JSON.stringify(value)).toString("base64url");
}

function fakeJwt(accountId = "acct_test") {
	return [
		base64UrlJson({ alg: "none" }),
		base64UrlJson({ "https://api.openai.com/auth": { chatgpt_account_id: accountId } }),
		"signature",
	].join(".");
}

function makeTempDir(name) {
	return join(tmpdir(), `${name}-${process.pid}-${Math.random().toString(36).slice(2)}`);
}

async function withEnv(env, run) {
	const previous = new Map(Object.keys(env).map((key) => [key, process.env[key]]));
	for (const [key, value] of Object.entries(env)) {
		if (value === undefined) delete process.env[key];
		else process.env[key] = value;
	}
	try {
		return await run();
	} finally {
		for (const [key, value] of previous) {
			if (value === undefined) delete process.env[key];
			else process.env[key] = value;
		}
	}
}

function createToolContext(cwd, entries = []) {
	return {
		cwd,
		sessionManager: {
			getBranch() {
				return entries;
			},
		},
	};
}

async function withMockCodexServer(handler, run) {
	const requests = [];
	const server = createServer(async (req, res) => {
		let body = "";
		for await (const chunk of req) body += chunk;
		const parsed = body.length > 0 ? JSON.parse(body) : undefined;
		const captured = {
			method: req.method,
			url: req.url,
			headers: req.headers,
			body: parsed,
		};
		requests.push(captured);
		try {
			const result = await handler(captured);
			res.writeHead(result.status ?? 200, { "content-type": "application/json" });
			res.end(JSON.stringify(result.body));
		} catch (error) {
			res.writeHead(500, { "content-type": "application/json" });
			res.end(JSON.stringify({ error: error instanceof Error ? error.message : String(error) }));
		}
	});
	await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
	const address = server.address();
	const baseUrl = `http://127.0.0.1:${address.port}`;
	try {
		return await run({ baseUrl, requests });
	} finally {
		await new Promise((resolve) => server.close(resolve));
	}
}

async function withCodexAuth(run) {
	const root = makeTempDir("pibo-codex-image-test");
	const piboHome = join(root, "pibo-home");
	const piAgentDir = join(root, "pi-agent");
	mkdirSync(piAgentDir, { recursive: true });
	return await withEnv({ PIBO_HOME: piboHome, PI_CODING_AGENT_DIR: piAgentDir }, async () => {
		AuthStorage.create().set("openai-codex", {
			type: "oauth",
			access: fakeJwt("acct_codex"),
			refresh: "refresh-token",
			expires: Date.now() + 60 * 60 * 1000,
			accountId: "acct_codex",
		});
		try {
			return await run({ root, piboHome, piAgentDir });
		} finally {
			rmSync(root, { recursive: true, force: true });
		}
	});
}

test("Codex image URL resolver targets ChatGPT backend image endpoints", () => {
	assert.equal(
		resolveCodexImageUrl("generations", "https://chatgpt.com/backend-api"),
		"https://chatgpt.com/backend-api/codex/images/generations",
	);
	assert.equal(
		resolveCodexImageUrl("edits", "https://chatgpt.com/backend-api/codex/responses"),
		"https://chatgpt.com/backend-api/codex/images/edits",
	);
	assert.equal(
		resolveCodexImageUrl("generations", "https://example.test/backend/codex"),
		"https://example.test/backend/codex/images/generations",
	);
});

test("codex_image_generation requires openai-codex OAuth", async () => {
	const root = makeTempDir("pibo-codex-image-auth-missing");
	mkdirSync(root, { recursive: true });
	await withEnv({ PIBO_HOME: join(root, "pibo-home"), PI_CODING_AGENT_DIR: join(root, "pi-agent") }, async () => {
		const tool = createCodexImageGenerationToolDefinition({ piboSessionId: "ps_missing" });
		await assert.rejects(
			() => tool.execute("call_missing", { prompt: "paint a whale" }, undefined, undefined, createToolContext(root)),
			/OAuth.*openai-codex/i,
		);
	});
	rmSync(root, { recursive: true, force: true });
});

test("codex_image_generation generates through the Codex backend and saves the image", async () => {
	await withCodexAuth(async ({ piboHome }) => {
		await withMockCodexServer((request) => {
			assert.equal(request.url, "/codex/images/generations");
			assert.equal(request.headers.authorization, `Bearer ${fakeJwt("acct_codex")}`);
			assert.equal(request.headers["chatgpt-account-id"], "acct_codex");
			assert.deepEqual(request.body, {
				prompt: "paint a blue whale",
				background: "auto",
				model: "gpt-image-2",
				quality: "auto",
				size: "auto",
			});
			return { body: { created: 1, data: [{ b64_json: RESULT_B64 }], background: "opaque", quality: "medium", size: "1024x1024" } };
		}, async ({ baseUrl, requests }) => {
			const tool = createCodexImageGenerationToolDefinition({ piboSessionId: "ps_generate" }, { baseUrl });
			const result = await tool.execute("call_generate", { prompt: "paint a blue whale" }, undefined, undefined, createToolContext(piboHome));

			assert.equal(requests.length, 1);
			assert.equal(result.content[0].type, "image");
			assert.equal(result.content[0].data, RESULT_B64);
			assert.equal(result.content[0].mimeType, "image/png");
			assert.equal(result.details.operation, "generate");
			assert.equal(result.details.endpoint, "generations");
			assert.equal(result.details.referencedImageCount, 0);
			assert.equal(result.details.savedPath, join(piboHome, "generated_images", "ps_generate", "call_generate.png"));
			assert.equal(readFileSync(result.details.savedPath, "utf8"), "generated-image");
		});
	});
});

test("codex_image_generation edits local referenced images through the Codex backend", async () => {
	await withCodexAuth(async ({ root }) => {
		const imagePath = join(root, "input.png");
		writeFileSync(imagePath, "input-image");
		await withMockCodexServer((request) => {
			assert.equal(request.url, "/codex/images/edits");
			assert.equal(request.body.model, "gpt-image-2");
			assert.equal(request.body.images.length, 1);
			assert.equal(request.body.images[0].image_url, `data:image/png;base64,${Buffer.from("input-image").toString("base64")}`);
			return { body: { created: 2, data: [{ b64_json: EDIT_RESULT_B64 }] } };
		}, async ({ baseUrl }) => {
			const tool = createCodexImageGenerationToolDefinition({ piboSessionId: "ps_edit" }, { baseUrl });
			const result = await tool.execute(
				"call_edit",
				{ prompt: "make it cinematic", referenced_image_paths: ["input.png"] },
				undefined,
				undefined,
				createToolContext(root),
			);

			assert.equal(result.content[0].data, EDIT_RESULT_B64);
			assert.equal(result.details.operation, "edit");
			assert.equal(result.details.endpoint, "edits");
			assert.equal(result.details.referencedImageCount, 1);
		});
	});
});

test("codex_image_generation edits recent conversation images in oldest-to-newest order", async () => {
	await withCodexAuth(async ({ root }) => {
		const first = Buffer.from("first-image").toString("base64");
		const second = Buffer.from("second-image").toString("base64");
		const entries = [
			{ type: "message", id: "entry-old", parentId: null, timestamp: "2026-06-30T00:00:00.000Z", message: { role: "toolResult", toolCallId: "old", toolName: "view_image", isError: false, timestamp: 1, content: [{ type: "image", data: first, mimeType: "image/png" }] } },
			{ type: "message", id: "entry-new", parentId: "entry-old", timestamp: "2026-06-30T00:00:01.000Z", message: { role: "toolResult", toolCallId: "new", toolName: "codex_image_generation", isError: false, timestamp: 2, content: [{ type: "image", data: second, mimeType: "image/png" }] } },
		];
		await withMockCodexServer((request) => {
			assert.equal(request.url, "/codex/images/edits");
			assert.deepEqual(
				request.body.images.map((image) => image.image_url),
				[
					`data:image/png;base64,${first}`,
					`data:image/png;base64,${second}`,
				],
			);
			return { body: { created: 3, data: [{ b64_json: EDIT_RESULT_B64 }] } };
		}, async ({ baseUrl }) => {
			const tool = createCodexImageGenerationToolDefinition({ piboSessionId: "ps_recent" }, { baseUrl });
			const result = await tool.execute(
				"call_recent",
				{ prompt: "combine these", num_last_images_to_include: 2 },
				undefined,
				undefined,
				createToolContext(root, entries),
			);

			assert.equal(result.details.operation, "edit");
			assert.equal(result.details.referencedImageCount, 2);
		});
	});
});

test("codex_image_generation rejects conflicting edit references before network calls", async () => {
	await withCodexAuth(async ({ root }) => {
		await withMockCodexServer(() => {
			throw new Error("network should not be called");
		}, async ({ baseUrl, requests }) => {
			const tool = createCodexImageGenerationToolDefinition({ piboSessionId: "ps_invalid" }, { baseUrl });
			await assert.rejects(
				() => tool.execute(
					"call_invalid",
					{ prompt: "edit", referenced_image_paths: ["one.png"], num_last_images_to_include: 1 },
					undefined,
					undefined,
					createToolContext(root),
				),
				/only one of `referenced_image_paths` or `num_last_images_to_include`/,
			);
			assert.equal(requests.length, 0);
		});
	});
});

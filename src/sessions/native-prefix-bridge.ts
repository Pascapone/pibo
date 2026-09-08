import { randomBytes, timingSafeEqual } from "node:crypto";
import { createServer, type Server, type IncomingMessage, type ServerResponse } from "node:http";
import { MAX_PREFIX_CAPSULE_BYTES } from "./prefix-capsule.js";
import type { SessionPrefixController } from "./prefix-session.js";

/** Private startup/first-dispatch IPC. It never observes ordinary conversation input. */
export class NativePrefixBridge {
	private readonly token = randomBytes(32).toString("hex");
	private server?: Server;
	private endpoint?: string;
	private active = false;

	constructor(private readonly controller: SessionPrefixController, private readonly codec: string) {}

	async start(): Promise<{ endpoint: string; token: string }> {
		if (this.server) throw new Error("Native prefix bridge is already started");
		const server = createServer((request, response) => { void this.handle(request, response); });
		server.on("error", () => { server.closeAllConnections(); server.close(() => {}); });
		this.server = server;
		server.requestTimeout = 15000;
		server.headersTimeout = 5000;
		server.keepAliveTimeout = 1000;
		server.maxHeadersCount = 16;
		try {
			await new Promise<void>((resolve, reject) => {
				server.once("error", reject);
				server.listen(0, "127.0.0.1", () => { server.off("error", reject); resolve(); });
			});
			const address = server.address();
			if (!address || typeof address === "string") throw new Error("Native prefix bridge has no address");
			this.endpoint = `http://127.0.0.1:${address.port}`;
			return { endpoint: this.endpoint, token: this.token };
		} catch (error) { this.server = undefined; server.close(() => {}); throw error; }
	}

	private async handle(request: IncomingMessage, response: ServerResponse): Promise<void> {
		response.setHeader("cache-control", "no-store");
		const supplied = request.headers.authorization;
		const expected = `Bearer ${this.token}`;
		if (typeof supplied !== "string" || Buffer.byteLength(supplied) !== Buffer.byteLength(expected)
			|| !timingSafeEqual(Buffer.from(supplied), Buffer.from(expected))) {
			response.writeHead(403).end(); request.resume(); return;
		}
		if (this.active) { response.writeHead(409).end(); request.resume(); return; }
		this.active = true;
		try {
			if (request.method === "GET" && request.url === "/transition") {
				await this.controller.restore(this.codec);
				response.setHeader("content-type", "application/json");
				response.writeHead(200).end(JSON.stringify(this.controller.transition ?? null));
				return;
			}
			if (request.method === "GET" && request.url === "/snapshot") {
				const snapshot = await this.controller.restore(this.codec);
				response.setHeader("content-type", "application/octet-stream");
				response.writeHead(snapshot === undefined ? 404 : 200).end(snapshot);
				return;
			}
			const transitionOperation = request.url === "/compaction/begin" || request.url === "/compaction/finish";
			if (request.method !== "POST" || request.url !== "/seal" && !transitionOperation) { response.writeHead(404).end(); request.resume(); return; }
			const maximum = transitionOperation ? 4096 : MAX_PREFIX_CAPSULE_BYTES;
			const declared = request.headers["content-length"];
			if (declared !== undefined && (!/^\d+$/.test(declared) || Number(declared) > maximum)) {
				response.writeHead(413).end(); request.resume(); return;
			}
			const nativeSessionId = request.headers["x-native-session-id"];
			const historical = request.headers["x-native-has-history"];
			if (!transitionOperation && (typeof nativeSessionId !== "string" || nativeSessionId.length > 1024 || !["true", "false"].includes(String(historical)))) {
				response.writeHead(400).end(); request.resume(); return;
			}
			let bytes = 0;
			const chunks: Buffer[] = [];
			for await (const chunk of request) {
				bytes += chunk.length;
				if (bytes > maximum) { response.writeHead(413).end(); request.destroy(); return; }
				chunks.push(chunk);
			}
			const payload = new TextDecoder("utf-8", { fatal: true }).decode(Buffer.concat(chunks, bytes));
			if (transitionOperation) {
				if (await this.controller.restore(this.codec) === undefined) throw new Error("No sealed prefix");
				const operation = JSON.parse(payload) as Record<string, unknown>;
				if (!operation || typeof operation !== "object" || Array.isArray(operation)) throw new Error("Invalid transition");
				if (request.url === "/compaction/begin") {
					if (Object.keys(operation).some(key => key !== "sourceHead") || operation.sourceHead !== null &&
						(typeof operation.sourceHead !== "string" || !operation.sourceHead || operation.sourceHead.length > 1024 || /[\x00-\x1f\x7f]/.test(operation.sourceHead))) throw new Error("Invalid native head");
					await this.controller.beginCompaction(operation.sourceHead as string | null);
				} else {
					if (Object.keys(operation).some(key => key !== "id" && key !== "changed") || typeof operation.id !== "string"
						|| operation.id.length > 128 || typeof operation.changed !== "boolean") throw new Error("Invalid transition completion");
					await this.controller.finishCompaction(operation.id, operation.changed);
				}
				response.setHeader("content-type", "application/json");
				response.writeHead(200).end(JSON.stringify(this.controller.transition));
				return;
			}
			const prefix = await this.controller.seal({ codec: this.codec, payload, nativeSessionId: nativeSessionId as string,
				evidence: "adapter-inputs", hasHistoricalModelInput: historical === "true" });
			// Ack is deliberately after artifact publication AND the audited binding CAS.
			response.setHeader("content-type", "application/json");
			response.writeHead(200).end(JSON.stringify({ digest: prefix.capsule.digest, epoch: prefix.epoch }));
		} catch {
			// Errors and raw native snapshot text never enter standard diagnostics.
			if (!response.headersSent) response.writeHead(409).end("prefix-recovery-required");
			else response.destroy();
		} finally { this.active = false; }
	}

	async dispose(): Promise<void> {
		const server = this.server;
		this.server = undefined;
		this.endpoint = undefined;
		if (!server) return;
		await new Promise<void>((resolve, reject) => {
			server.close(error => { if (error) reject(error); else resolve(); });
			server.closeAllConnections();
		});
	}
}

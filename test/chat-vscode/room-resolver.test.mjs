import assert from "node:assert/strict";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { canonicalizePath, resolveRoomForWorkspace } from "../../src/apps/chat-vscode/extension/src/room-resolver.ts";
import { describe, test } from "node:test";

describe("chat-vscode/room-resolver", () => {
	test("canonicalizePath returns an absolute path", async () => {
		const result = await canonicalizePath(".");
		assert.ok(path.isAbsolute(result));
	});

	test("0 matches → kind: single (auto-create) with 2 calls", async () => {
		const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "pibo-vscode-test-"));
		const calls = [];
		const fetchImpl = async (url) => {
			calls.push(url);
			if (url.includes(`/api/chat/rooms?workspace=${encodeURIComponent(tmp)}`)) {
				return new Response(JSON.stringify({ rooms: [] }), { status: 200 });
			}
			return new Response(
				JSON.stringify({
					room: {
						id: "room_" + path.basename(tmp),
						name: path.basename(tmp),
						workspace: tmp,
						type: "chat",
						createdAt: new Date().toISOString(),
						updatedAt: new Date().toISOString(),
						metadata: { workspace: tmp },
					},
				}),
				{ status: 201 },
			);
		};
		const result = await resolveRoomForWorkspace("http://localhost", tmp, { fetchImpl });
		assert.equal(result.kind, "single");
		assert.equal(result.workspace, tmp);
		assert.equal(calls.length, 2);
		fs.rmSync(tmp, { recursive: true, force: true });
	});

	test("2 rooms → kind: multiple, no picker call, no create call", async () => {
		const tmp = "/tmp/test-multi";
		const calls = [];
		const fetchImpl = async (url) => {
			calls.push(url);
			if (url.includes(`/api/chat/rooms?workspace=${encodeURIComponent(tmp)}`)) {
				return new Response(
					JSON.stringify({
						rooms: [
							{ id: "room_a", name: "A", workspace: tmp, type: "chat", createdAt: "2026-01-01T00:00:00Z", updatedAt: "2026-01-01T00:00:00Z", metadata: { workspace: tmp } },
							{ id: "room_b", name: "B", workspace: tmp, type: "chat", createdAt: "2026-01-01T00:00:00Z", updatedAt: "2026-01-01T00:00:00Z", metadata: { workspace: tmp } },
						],
					}),
					{ status: 200 },
				);
			}
			throw new Error("unexpected fetch: " + url);
		};
		const result = await resolveRoomForWorkspace("http://localhost", tmp, { fetchImpl });
		assert.equal(result.kind, "multiple");
		assert.equal(result.rooms.length, 2);
		assert.equal(result.workspace, tmp);
		assert.equal(calls.length, 1);
	});

	test("1 room → kind: single, no create call", async () => {
		const tmp = "/tmp/test-single";
		const calls = [];
		const fetchImpl = async (url) => {
			calls.push(url);
			if (url.includes(`/api/chat/rooms?workspace=${encodeURIComponent(tmp)}`)) {
				return new Response(
					JSON.stringify({
						rooms: [
							{ id: "room_only", name: "Only", workspace: tmp, type: "chat", createdAt: "2026-01-01T00:00:00Z", updatedAt: "2026-01-01T00:00:00Z", metadata: { workspace: tmp } },
						],
					}),
					{ status: 200 },
				);
			}
			throw new Error("unexpected fetch: " + url);
		};
		const result = await resolveRoomForWorkspace("http://localhost", tmp, { fetchImpl });
		assert.equal(result.kind, "single");
		assert.equal(result.room.id, "room_only");
		assert.equal(calls.length, 1);
	});

	test("case-sensitive path matching", async () => {
		let requestedWorkspace = null;
		const fetchImpl = async (url, init) => {
			if (url.includes("/api/chat/rooms?workspace=")) {
				requestedWorkspace = decodeURIComponent(url.split("workspace=")[1] ?? "");
				return new Response(JSON.stringify({ rooms: [] }), { status: 200 });
			}
			if (init?.method === "POST" && url.endsWith("/api/chat/rooms")) {
				return new Response(
					JSON.stringify({
						room: {
							id: "room_x",
							name: "X",
							workspace: requestedWorkspace ?? "",
							type: "chat",
							createdAt: new Date().toISOString(),
							updatedAt: new Date().toISOString(),
							metadata: {},
						},
					}),
					{ status: 201 },
				);
			}
			throw new Error("unexpected fetch: " + url);
		};
		await resolveRoomForWorkspace("http://localhost", "/tmp/CaseSensitive", { fetchImpl });
		assert.equal(requestedWorkspace, "/tmp/CaseSensitive");
	});

	test("attaches the dev-auth cookie from a CookieSource to the list and create requests", async () => {
		const tmp = "/tmp/test-cookie";
		const seen = [];
		const cookieSource = {
			getCookieHeader: async () => {
				seen.push("cookie-source");
				return "pibo_dev_session=secret-token; other=fine";
			},
		};
		const fetchImpl = async (url, init) => {
			seen.push({ url, cookie: init?.headers?.cookie });
			if (url.includes(`/api/chat/rooms?workspace=${encodeURIComponent(tmp)}`)) {
				assert.equal(init?.headers?.cookie, "pibo_dev_session=secret-token; other=fine");
				return new Response(JSON.stringify({ rooms: [] }), { status: 200 });
			}
			if (init?.method === "POST" && url.endsWith("/api/chat/rooms")) {
				assert.equal(init?.headers?.cookie, "pibo_dev_session=secret-token; other=fine");
				assert.equal(init?.headers?.["content-type"], "application/json");
				return new Response(
					JSON.stringify({
						room: {
							id: "room_cookie",
							name: "Cookie",
							workspace: tmp,
							type: "chat",
							createdAt: "2026-01-01T00:00:00Z",
							updatedAt: "2026-01-01T00:00:00Z",
							metadata: { workspace: tmp },
						},
					}),
					{ status: 201 },
				);
			}
			throw new Error("unexpected fetch: " + url);
		};
		const result = await resolveRoomForWorkspace("http://localhost", tmp, { fetchImpl, cookieSource });
		assert.equal(result.kind, "single");
		assert.equal(result.room.id, "room_cookie");
		// The cookie source is called lazily on the first fetch and the
		// result is cached for the subsequent call.
		assert.equal(seen.filter((s) => s === "cookie-source").length, 1);
	});

	test("falls back to no-cookie requests when the CookieSource handshake fails", async () => {
		// The gateway may be in Better Auth mode (no dev-auth flow) or the
		// user may not have minted a session yet. The resolver must still
		// send the request; the gateway can then return its real status
		// (401, 403, etc.) and the extension can surface that to the user.
		const tmp = "/tmp/test-no-cookie";
		const seen = [];
		const cookieSource = {
			getCookieHeader: async () => {
				throw new Error("dev-auth handshake did not complete");
			},
		};
		const fetchImpl = async (url, init) => {
			seen.push({ url, cookie: init?.headers?.cookie });
			if (url.includes(`/api/chat/rooms?workspace=${encodeURIComponent(tmp)}`)) {
				assert.equal(init?.headers?.cookie, undefined);
				return new Response(JSON.stringify({ error: "Unauthenticated" }), { status: 401 });
			}
			throw new Error("unexpected fetch: " + url);
		};
		await assert.rejects(
			resolveRoomForWorkspace("http://localhost", tmp, { fetchImpl, cookieSource }),
			/rooms list failed: 401/,
		);
		assert.equal(seen.length, 1);
	});

	test("does not call the CookieSource when none is supplied (back-compat)", async () => {
		const tmp = "/tmp/test-nocookie";
		const fetchImpl = async (url) => {
			if (url.includes(`/api/chat/rooms?workspace=${encodeURIComponent(tmp)}`)) {
				return new Response(JSON.stringify({ rooms: [] }), { status: 200 });
			}
			return new Response(
				JSON.stringify({
					room: {
						id: "room_nocookie",
						name: "NoCookie",
						workspace: tmp,
						type: "chat",
						createdAt: "2026-01-01T00:00:00Z",
						updatedAt: "2026-01-01T00:00:00Z",
						metadata: { workspace: tmp },
					},
				}),
				{ status: 201 },
			);
		};
		const result = await resolveRoomForWorkspace("http://localhost", tmp, { fetchImpl });
		assert.equal(result.kind, "single");
	});
});

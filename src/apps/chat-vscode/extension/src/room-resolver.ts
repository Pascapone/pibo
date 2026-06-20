import * as fs from "node:fs";
import * as path from "node:path";
import type { PiboRoom } from "../../../chat/types/rooms.js";

export type RoomResolution =
	| { kind: "single"; room: PiboRoom; workspace: string }
	| { kind: "multiple"; rooms: readonly PiboRoom[]; workspace: string };

/**
 * Source of the dev-auth session cookie. The extension constructs a
 * single bridge at activation time (so the cookie survives webview
 * dispose/re-render cycles); the room resolver and the sidecar both
 * share it. Provide `cookieHeader: undefined` when the gateway uses
 * Better Auth (the extension's existing flow checks the loopback bind
 * for cookie-less local access) or when the caller has not built a
 * bridge yet.
 */
export type CookieSource = {
	getCookieHeader(): Promise<string | undefined>;
};

export type ResolveOptions = {
	fetchImpl?: typeof fetch;
	/**
	 * Optional dev-auth cookie source. When supplied, the resolver
	 * attaches the cookie to outbound requests so the gateway's
	 * dev-auth plugin (or its Better Auth cookie path) can identify
	 * the request.
	 */
	cookieSource?: CookieSource;
};

export async function canonicalizePath(input: string): Promise<string> {
	const absolute = path.resolve(input);
	try {
		return fs.realpathSync(absolute);
	} catch {
		return absolute;
	}
}

async function buildAuthHeaders(
	cookieSource: CookieSource | undefined,
): Promise<Record<string, string>> {
	if (!cookieSource) return {};
	let cookieHeader: string | undefined;
	try {
		cookieHeader = await cookieSource.getCookieHeader();
	} catch {
		// The handshake may fail when the gateway is in Better Auth mode
		// (no local dev-auth flow) or when the user's session cookie has
		// not been minted yet. We swallow the error here so the upstream
		// call still goes out and the gateway can return its real status
		// code (e.g. 401) — surfacing "auth handshake failed" inside the
		// resolver would mask the real failure mode.
		return {};
	}
	if (!cookieHeader) return {};
	return { cookie: cookieHeader };
}

export async function resolveRoomForWorkspace(
	baseUrl: string,
	workspaceFolder: string,
	options: ResolveOptions = {},
): Promise<RoomResolution> {
	const fetchImpl = options.fetchImpl ?? fetch;
	const canonicalPath = await canonicalizePath(workspaceFolder);
	const baseHeaders = await buildAuthHeaders(options.cookieSource);

	const listUrl = `${baseUrl.replace(/\/$/, "")}/api/chat/rooms?workspace=${encodeURIComponent(canonicalPath)}`;
	const listRes = await fetchImpl(listUrl, { headers: baseHeaders });
	if (!listRes.ok) throw new Error(`rooms list failed: ${listRes.status} ${listRes.statusText}`);
	const listBody = (await listRes.json()) as { rooms: PiboRoom[] };
	const rooms = listBody.rooms ?? [];

	if (rooms.length === 1) {
		return { kind: "single", room: rooms[0], workspace: canonicalPath };
	}
	if (rooms.length > 1) {
		return { kind: "multiple", rooms, workspace: canonicalPath };
	}

	const folderName = path.basename(canonicalPath) || "VS Code Workspace";
	const createUrl = `${baseUrl.replace(/\/$/, "")}/api/chat/rooms`;
	const createRes = await fetchImpl(createUrl, {
		method: "POST",
		headers: { "content-type": "application/json", ...baseHeaders },
		body: JSON.stringify({
			name: folderName,
			workspace: canonicalPath,
			metadata: { workspace: canonicalPath },
			type: "chat",
		}),
	});
	if (!createRes.ok) throw new Error(`room create failed: ${createRes.status} ${createRes.statusText}`);
	const createBody = (await createRes.json()) as { room: PiboRoom };
	return { kind: "single", room: createBody.room, workspace: canonicalPath };
}

export async function pickRoom(
	baseUrl: string,
	roomId: string,
	options: ResolveOptions = {},
): Promise<PiboRoom> {
	const fetchImpl = options.fetchImpl ?? fetch;
	const url = `${baseUrl.replace(/\/$/, "")}/api/chat/rooms/${encodeURIComponent(roomId)}`;
	const res = await fetchImpl(url);
	if (!res.ok) throw new Error(`room fetch failed: ${res.status} ${res.statusText}`);
	const body = (await res.json()) as { room: PiboRoom };
	return body.room;
}

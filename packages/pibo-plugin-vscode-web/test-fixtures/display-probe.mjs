import { lstat } from "node:fs/promises";
import { connect } from "node:net";

// C1/CC-C02 display probe: resolves usable display mechanisms WITHOUT
// launching anything. Unix sockets are inspected via lstat (file kind) and a
// controlled connect probe - never via readFile, which cannot open sockets.
// X11 and Wayland are differentiated; a missing DISPLAY alone does not reject
// when Wayland is actually usable.

export async function statSocket(path) {
	try {
		const stats = await lstat(path);
		return { path, exists: true, isSocket: stats.isSocket() };
	} catch (error) {
		if (error && (error.code === "ENOENT" || error.code === "ENOTDIR")) {
			return { path, exists: false, isSocket: false };
		}
		throw error;
	}
}

export function probeUnixSocket(path, { timeoutMs = 2000 } = {}) {
	return new Promise((resolve) => {
		const socket = connect(path);
		const done = (reachable, error) => {
			try { socket.destroy(); } catch { /* ignore */ }
			resolve({ path, reachable, ...(error ? { error } : {}) });
		};
		const timer = setTimeout(() => done(false, "connect timeout"), timeoutMs);
		timer.unref?.();
		socket.once("connect", () => { clearTimeout(timer); done(true); });
		socket.once("error", (error) => { clearTimeout(timer); done(false, error?.code ?? String(error)); });
	});
}

export function resolveX11SocketPath(display, { socketDir = "/tmp/.X11-unix" } = {}) {
	const match = /^:(\d+)(?:\.\d+)?$/.exec(display ?? "");
	if (!match) return undefined;
	return `${socketDir}/X${match[1]}`;
}

export function resolveWaylandSocketPaths(env = process.env) {
	const runtimeDir = env.XDG_RUNTIME_DIR ?? (typeof process.getuid === "function" ? `/run/user/${process.getuid()}` : undefined);
	const display = env.WAYLAND_DISPLAY;
	if (display) {
		if (display.startsWith("/")) return [display];
		return runtimeDir ? [`${runtimeDir}/${display}`] : [];
	}
	return runtimeDir ? [`${runtimeDir}/wayland-0`] : [];
}

export async function probeDisplay({ env = process.env, x11SocketDir = "/tmp/.X11-unix", timeoutMs = 2000 } = {}) {
	const display = env.DISPLAY ?? "";
	const x11Path = resolveX11SocketPath(display, { socketDir: x11SocketDir });
	const x11 = x11Path
		? { display, socketPath: x11Path, ...(await statSocket(x11Path)), ...(await probeUnixSocket(x11Path, { timeoutMs })) }
		: { display, socketPath: undefined, exists: false, isSocket: false, reachable: false };
	const waylandPaths = resolveWaylandSocketPaths(env);
	let wayland = { display: env.WAYLAND_DISPLAY ?? "", socketPath: undefined, exists: false, isSocket: false, reachable: false };
	for (const candidate of waylandPaths) {
		const stats = await statSocket(candidate);
		const probe = stats.exists && stats.isSocket ? await probeUnixSocket(candidate, { timeoutMs }) : { reachable: false };
		wayland = { display: env.WAYLAND_DISPLAY ?? "", socketPath: candidate, exists: stats.exists, isSocket: stats.isSocket, reachable: probe.reachable };
		if (probe.reachable) break;
	}
	const verdict = x11.reachable ? "x11" : wayland.reachable ? "wayland" : "none";
	const detail = verdict === "x11"
		? `X11 display ${display} reachable via ${x11.socketPath}`
		: verdict === "wayland"
			? `Wayland display ${wayland.display || "wayland-0"} reachable via ${wayland.socketPath}`
			: `no reachable display (DISPLAY=${JSON.stringify(display)}, WAYLAND_DISPLAY=${JSON.stringify(env.WAYLAND_DISPLAY ?? "")})`;
	return { x11, wayland, verdict, detail };
}

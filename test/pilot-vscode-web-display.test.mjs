import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import {
	probeDisplay,
	probeUnixSocket,
	resolveWaylandSocketPaths,
	resolveX11SocketPath,
	statSocket,
} from "../packages/pibo-plugin-vscode-web/test-fixtures/display-probe.mjs";

// CC-C02: deterministic display-diagnostic cases. Sockets are the test's own
// temporary servers; nothing here launches a browser or touches live state.

async function withSocketServer(path, run) {
	const server = createServer((socket) => socket.end());
	await new Promise((resolve, reject) => {
		server.once("error", reject);
		server.listen(path, resolve);
	});
	try {
		return await run(path);
	} finally {
		await new Promise((resolve) => server.close(resolve));
	}
}

test("statSocket distinguishes missing files, regular files and sockets", async () => {
	const root = await mkdtemp(join(tmpdir(), "pibo-c1-display-"));
	try {
		const missing = await statSocket(join(root, "nope"));
		assert.deepEqual(missing, { path: join(root, "nope"), exists: false, isSocket: false });
		const file = join(root, "plain.txt");
		await writeFile(file, "x");
		assert.deepEqual(await statSocket(file), { path: file, exists: true, isSocket: false });
		await withSocketServer(join(root, "live.sock"), async (path) => {
			assert.deepEqual(await statSocket(path), { path, exists: true, isSocket: true });
		});
	} finally {
		await rm(root, { recursive: true, force: true });
	}
});

test("probeUnixSocket reports reachability without transferring data", async () => {
	const root = await mkdtemp(join(tmpdir(), "pibo-c1-display-"));
	try {
		const missing = await probeUnixSocket(join(root, "nope"), { timeoutMs: 500 });
		assert.equal(missing.reachable, false);
		const file = join(root, "plain.txt");
		await writeFile(file, "x");
		assert.equal((await probeUnixSocket(file, { timeoutMs: 500 })).reachable, false);
		await withSocketServer(join(root, "live.sock"), async (path) => {
			assert.deepEqual(await probeUnixSocket(path, { timeoutMs: 1000 }), { path, reachable: true });
		});
	} finally {
		await rm(root, { recursive: true, force: true });
	}
});

test("X11 socket paths resolve from local display numbers only", () => {
	assert.equal(resolveX11SocketPath(":0"), "/tmp/.X11-unix/X0");
	assert.equal(resolveX11SocketPath(":10.0"), "/tmp/.X11-unix/X10");
	assert.equal(resolveX11SocketPath("", {}), undefined);
	assert.equal(resolveX11SocketPath("localhost:0"), undefined);
	assert.equal(resolveX11SocketPath(":3", { socketDir: "/tmp/fake-x11" }), "/tmp/fake-x11/X3");
});

test("Wayland socket paths resolve absolute displays and runtime dirs", () => {
	assert.deepEqual(resolveWaylandSocketPaths({ WAYLAND_DISPLAY: "/run/custom/wl-0" }), ["/run/custom/wl-0"]);
	assert.deepEqual(
		resolveWaylandSocketPaths({ WAYLAND_DISPLAY: "wl-9", XDG_RUNTIME_DIR: "/tmp/fake-run" }),
		["/tmp/fake-run/wl-9"],
	);
	assert.deepEqual(
		resolveWaylandSocketPaths({ XDG_RUNTIME_DIR: "/tmp/fake-run" }),
		["/tmp/fake-run/wayland-0"],
	);
});

test("probeDisplay reports none for an empty deterministic environment", async () => {
	const root = await mkdtemp(join(tmpdir(), "pibo-c1-display-"));
	try {
		const result = await probeDisplay({ env: { DISPLAY: "", WAYLAND_DISPLAY: "", XDG_RUNTIME_DIR: root }, timeoutMs: 500 });
		assert.equal(result.verdict, "none");
		assert.equal(result.x11.reachable, false);
		assert.equal(result.wayland.reachable, false);
		assert.ok(result.detail.includes("no reachable display"));
	} finally {
		await rm(root, { recursive: true, force: true });
	}
});

test("probeDisplay detects a live X11-style socket", async () => {
	const root = await mkdtemp(join(tmpdir(), "pibo-c1-display-"));
	try {
		await withSocketServer(join(root, "X9"), async () => {
			const result = await probeDisplay({
				env: { DISPLAY: ":9", WAYLAND_DISPLAY: "", XDG_RUNTIME_DIR: root },
				x11SocketDir: root,
				timeoutMs: 1000,
			});
			assert.equal(result.verdict, "x11");
			assert.equal(result.x11.socketPath, join(root, "X9"));
			assert.equal(result.x11.reachable, true);
		});
	} finally {
		await rm(root, { recursive: true, force: true });
	}
});

test("probeDisplay accepts usable Wayland despite missing DISPLAY", async () => {
	const root = await mkdtemp(join(tmpdir(), "pibo-c1-display-"));
	try {
		await withSocketServer(join(root, "wl-9"), async () => {
			const result = await probeDisplay({
				env: { DISPLAY: "", WAYLAND_DISPLAY: "wl-9", XDG_RUNTIME_DIR: root },
				timeoutMs: 1000,
			});
			assert.equal(result.verdict, "wayland");
			assert.equal(result.wayland.socketPath, join(root, "wl-9"));
			assert.equal(result.wayland.reachable, true);
		});
	} finally {
		await rm(root, { recursive: true, force: true });
	}
});

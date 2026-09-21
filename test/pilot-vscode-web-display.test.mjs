import assert from "node:assert/strict";
import { chmod, mkdtemp, mkdir, rm, symlink, writeFile } from "node:fs/promises";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import {
	chromeNotFoundError,
	classifyChromeCandidate,
	requireChromeBinary,
	resolveChromeBinary,
} from "../packages/pibo-plugin-vscode-web/test-fixtures/chrome-probe.mjs";
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

// C1-R2-02: deterministic Chrome-binary diagnosis cases. Fixtures are the
// test's own temporary files; no real browser is installed, renamed or
// started, and no system path is touched.

async function withChromeFixtures(run) {
	const root = await mkdtemp(join(tmpdir(), "pibo-c1-chrome-"));
	try {
		const missing = join(root, "no-such-binary");
		const directory = join(root, "a-directory");
		await mkdir(directory);
		const plain = join(root, "plain.txt");
		await writeFile(plain, "not a browser");
		await chmod(plain, 0o644);
		const program = join(root, "fake-chrome");
		await writeFile(program, "#!/bin/sh\nexit 0\n");
		await chmod(program, 0o755);
		const second = join(root, "fake-chrome-2");
		await writeFile(second, "#!/bin/sh\nexit 0\n");
		await chmod(second, 0o755);
		const link = join(root, "linked-chrome");
		await symlink(program, link);
		return await run({ root, missing, directory, plain, program, second, link });
	} finally {
		await rm(root, { recursive: true, force: true });
	}
}

test("classifyChromeCandidate separates missing, directory, non-executable and usable files", async (t) => {
	if (process.platform === "win32") t.skip("POSIX executable bits only");
	await withChromeFixtures(async ({ missing, directory, plain, program, link }) => {
		assert.deepEqual(await classifyChromeCandidate(missing), { candidate: missing, usable: false, reason: "missing" });
		assert.deepEqual(await classifyChromeCandidate(directory), { candidate: directory, usable: false, reason: "not-a-file" });
		assert.deepEqual(await classifyChromeCandidate(plain), { candidate: plain, usable: false, reason: "not-executable" });
		assert.deepEqual(await classifyChromeCandidate(program), { candidate: program, usable: true, reason: "usable" });
		assert.deepEqual(await classifyChromeCandidate(link), { candidate: link, usable: true, reason: "usable" });
	});
});

test("resolveChromeBinary falls back only within the explicit list and never to system paths", async () => {
	await withChromeFixtures(async ({ missing, directory, plain, program, second }) => {
		// Empty and fully unusable lists stay empty even though this host
		// has a real installed browser: no hidden system fallback.
		assert.deepEqual(await resolveChromeBinary([]), { binary: undefined, checked: [] });
		// The non-executable regular file only exists where POSIX mode bits apply.
		const nonExec = process.platform === "win32" ? [] : [plain];
		const unusable = await resolveChromeBinary([missing, directory, ...nonExec]);
		assert.equal(unusable.binary, undefined);
		assert.deepEqual(
			unusable.checked.map((entry) => entry.reason),
			["missing", "not-a-file", ...nonExec.map(() => "not-executable")],
		);
		const ordered = await resolveChromeBinary([missing, directory, program, second]);
		assert.equal(ordered.binary, program);
		assert.deepEqual(ordered.checked.map((entry) => entry.candidate), [missing, directory, program]);
	});
});

test("requireChromeBinary returns the binary or throws the identical CHROME_NOT_FOUND error for both modes", async () => {
	await withChromeFixtures(async ({ missing, program }) => {
		const found = await requireChromeBinary([missing, program]);
		assert.equal(found.binary, program);
		// Both browser modes share this single gate: the headful and headless
		// call sites observe the identical binary error, never a display label.
		const headfulError = await requireChromeBinary([missing]).then(
			() => { throw new Error("headful call site unexpectedly found a binary"); },
			(error) => error,
		);
		const headlessError = await requireChromeBinary([]).then(
			() => { throw new Error("headless call site unexpectedly found a binary"); },
			(error) => error,
		);
		for (const error of [headfulError, headlessError]) {
			assert.ok(error.message.startsWith("CHROME_NOT_FOUND (C1-R2-02):"), `binary label first, got: ${error.message.split("\n")[0]}`);
		}
		const direct = chromeNotFoundError([{ candidate: missing, usable: false, reason: "missing" }]);
		assert.ok(direct.message.includes(missing));
		assert.ok(direct.message.includes("(missing)"));
		const empty = chromeNotFoundError([]);
		assert.ok(empty.message.includes("no candidates were provided"));
	});
});

import { execFile } from "node:child_process";
import { chmod, mkdir, mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import { test } from "node:test";
import assert from "node:assert/strict";
import { join, resolve } from "node:path";
import { tmpdir } from "node:os";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);
const cliPath = resolve("dist/bin/pibo.js");

test("pibo tools lists curated CLI tools", async () => {
	const cwd = await mkdtemp(join(tmpdir(), "pibo-tools-list-"));
	try {
		const env = { ...process.env, PIBO_HOME: join(cwd, "pibo-home") };
		const result = await execFileAsync("node", [cliPath, "tools", "list"], { cwd, env });

		assert.match(result.stdout, /browser-use/);
		assert.match(result.stdout, /available/);
	} finally {
		await rm(cwd, { recursive: true, force: true });
	}
});

test("pibo tools exposes browser-use guides outside the profile skill system", async () => {
	const cwd = await mkdtemp(join(tmpdir(), "pibo-tools-guide-"));
	try {
		const env = { ...process.env, PIBO_HOME: join(cwd, "pibo-home") };

		const guides = await execFileAsync("node", [cliPath, "tools", "guides", "browser-use"], { cwd, env });
		assert.match(guides.stdout, /browser-use/);
		assert.match(guides.stdout, /remote-browser/);

		const guide = await execFileAsync("node", [cliPath, "tools", "guide", "browser-use", "browser-use"], { cwd, env });
		assert.match(guide.stdout, /# Browser Automation with browser-use CLI/);
		assert.match(guide.stdout, /browser-use state/);
		assert.match(guide.stdout, /pibo tools env browser-use/);
		assert.match(guide.stdout, /eval "\$\(pibo tools env browser-use\)"/);
		assert.match(guide.stdout, /npm run --silent dev -- tools env browser-use/);
		assert.match(guide.stdout, /once per persistent shell/);
		assert.match(guide.stdout, /reuse that shell/);
		assert.match(guide.stdout, /pibo tools browser-use lease acquire/);
		assert.match(guide.stdout, /PIBO_BROWSER_USE_SESSION/);
		assert.match(guide.stdout, /timeout 30s/);
		assert.match(guide.stdout, /Do not issue parallel/);
		assert.match(guide.stdout, /get value <index>/);
		assert.match(guide.stdout, /get html --selector/);
		assert.doesNotMatch(guide.stdout, /browser-use tab /);
	} finally {
		await rm(cwd, { recursive: true, force: true });
	}
});

test("pibo tools install supports a no-setup dry target", async () => {
	const cwd = await mkdtemp(join(tmpdir(), "pibo-tools-install-"));
	try {
		const env = { ...process.env, PIBO_HOME: join(cwd, "pibo-home") };
		const result = await execFileAsync("node", [cliPath, "tools", "install", "browser-use", "--no-setup"], { cwd, env });

		assert.match(result.stdout, /Install target browser-use/);
		assert.match(result.stdout, /pibo-home\/tools\/browser-use/);
		assert.match(result.stdout, /desktop: /);
		assert.match(result.stdout, /env: pibo tools env browser-use/);
	} finally {
		await rm(cwd, { recursive: true, force: true });
	}
});

test("pibo tools env wraps browser-use with the PIBo default profile", async () => {
	const cwd = await mkdtemp(join(tmpdir(), "pibo-tools-env-"));
	try {
		const env = { ...process.env, PIBO_HOME: join(cwd, "pibo-home") };
		const result = await execFileAsync("node", [cliPath, "tools", "env", "browser-use"], { cwd, env });
		const wrapperPath = join(env.PIBO_HOME, "tools", "browser-use", "home", "bin", "browser-use");
		const realBinDir = join(env.PIBO_HOME, "tools", "browser-use", ".venv", "bin");

		assert.ok(result.stdout.includes(`export PATH="${wrapperPath.replace(/\/browser-use$/, "")}:${realBinDir}:$PATH"`));
		const wrapper = await readFile(wrapperPath, "utf8");
		const mode = (await stat(wrapperPath)).mode & 0o777;
		assert.match(wrapper, /--fresh-profile/);
		assert.match(wrapper, /PIBO_BROWSER_USE_DEFAULT_PROFILE/);
		assert.match(wrapper, /PIBO_BROWSER_USE_SESSION:-default/);
		assert.match(wrapper, /ensure_persistent_chrome/);
		assert.match(wrapper, /--cdp-url "\$cdp_url"/);
		assert.equal(mode & 0o111, 0o111);

		await mkdir(realBinDir, { recursive: true });
		const realExecutablePath = join(realBinDir, "browser-use");
		await writeFile(realExecutablePath, "#!/bin/sh\nprintf '%s\\n' \"$@\"\n");
		await chmod(realExecutablePath, 0o755);
		const fakeChromePath = join(cwd, "google-chrome");
		const fakeChromeArgsPath = join(cwd, "chrome-args.txt");
		await writeFile(fakeChromePath, `#!/bin/sh\nprintf '%s\\n' "$@" > "${fakeChromeArgsPath}"\n`);
		await chmod(fakeChromePath, 0o755);

		const browserUseHome = join(cwd, "browser-use-home");
		const chromeUserDataDir = join(cwd, "chrome-user-data");
		const defaultProfile = await execFileAsync(wrapperPath, ["open", "https://example.test"], {
			cwd,
			env: {
				...env,
				BROWSER_USE_HOME: browserUseHome,
				PIBO_BROWSER_USE_CHROME: fakeChromePath,
				PIBO_BROWSER_USE_CHROME_USER_DATA_DIR: chromeUserDataDir,
				PIBO_BROWSER_USE_SKIP_CDP_WAIT: "1",
			},
		});
		assert.match(defaultProfile.stderr, /started Chrome profile "PIBo"/);
		assert.match(defaultProfile.stdout, /--cdp-url\nhttp:\/\/127\.0\.0\.1:\d+\nopen\nhttps:\/\/example\.test/);
		for (let attempt = 0; attempt < 20; attempt += 1) {
			try {
				await stat(fakeChromeArgsPath);
				break;
			} catch {
				await new Promise((resolve) => setTimeout(resolve, 25));
			}
		}
		assert.match(await readFile(fakeChromeArgsPath, "utf8"), new RegExp(`--user-data-dir=${chromeUserDataDir}`));
		assert.match(await readFile(fakeChromeArgsPath, "utf8"), /--headless=new/);

		await rm(fakeChromeArgsPath, { force: true });
		const headedProfile = await execFileAsync(wrapperPath, ["--headed", "--session", "headed", "open", "https://example.test"], {
			cwd,
			env: {
				...env,
				BROWSER_USE_HOME: join(cwd, "browser-use-home-headed"),
				PIBO_BROWSER_USE_CHROME: fakeChromePath,
				PIBO_BROWSER_USE_CHROME_USER_DATA_DIR: chromeUserDataDir,
				PIBO_BROWSER_USE_SKIP_CDP_WAIT: "1",
			},
		});
		assert.match(headedProfile.stdout, /--cdp-url\nhttp:\/\/127\.0\.0\.1:\d+\n--headed\n--session\nheaded\nopen\nhttps:\/\/example\.test/);
		for (let attempt = 0; attempt < 20; attempt += 1) {
			try {
				await stat(fakeChromeArgsPath);
				break;
			} catch {
				await new Promise((resolve) => setTimeout(resolve, 25));
			}
		}
		assert.doesNotMatch(await readFile(fakeChromeArgsPath, "utf8"), /--headless=new/);

		const freshProfile = await execFileAsync(wrapperPath, ["--fresh-profile", "open", "https://example.test"], {
			cwd,
			env: { ...env, BROWSER_USE_HOME: browserUseHome },
		});
		assert.doesNotMatch(freshProfile.stdout, /--cdp-url/);
		assert.match(freshProfile.stdout, /open\nhttps:\/\/example\.test/);

		const explicitProfile = await execFileAsync(wrapperPath, ["--profile", "Default", "open", "https://example.test"], {
			cwd,
			env: { ...env, BROWSER_USE_HOME: browserUseHome },
		});
		assert.doesNotMatch(explicitProfile.stderr, /starting new session/);
		assert.match(explicitProfile.stdout, /--profile\nDefault\nopen\nhttps:\/\/example\.test/);
	} finally {
		await rm(cwd, { recursive: true, force: true });
	}
});

test("pibo tools browser-use manages isolated authenticated leases", async () => {
	const cwd = await mkdtemp(join(tmpdir(), "pibo-tools-browser-use-leases-"));
	try {
		const env = { ...process.env, PIBO_HOME: join(cwd, "pibo-home") };
		const templateDir = join(cwd, "auth-template");
		await mkdir(templateDir, { recursive: true });
		await writeFile(join(templateDir, "Cookies"), "auth-cookie");
		await writeFile(join(templateDir, "DevToolsActivePort"), "do-not-copy");

		const discovery = await execFileAsync("node", [cliPath, "tools", "browser-use"], { cwd, env });
		assert.match(discovery.stdout, /pibo tools browser-use - browser-use helpers/);
		assert.match(discovery.stdout, /lease acquire/);

		const templateEnv = await execFileAsync("node", [cliPath, "tools", "browser-use", "auth-template", "env"], { cwd, env });
		assert.match(templateEnv.stdout, /PIBO_BROWSER_USE_SESSION='pibo-auth-template'/);
		assert.match(templateEnv.stdout, /PIBO_BROWSER_USE_CHROME_USER_DATA_DIR=/);

		const acquired = await execFileAsync("node", [
			cliPath,
			"tools",
			"browser-use",
			"lease",
			"acquire",
			"--app",
			"pibo-chat",
			"--owner",
			"agent-a",
			"--template-dir",
			templateDir,
			"--ttl-minutes",
			"30",
		], { cwd, env });
		assert.match(acquired.stdout, /PIBO_BROWSER_USE_LEASE_ID='pibo-chat-slot-001'/);
		assert.match(acquired.stdout, /PIBO_BROWSER_USE_SESSION='pibo-auth-pibo-chat-slot-001'/);
		assert.match(acquired.stdout, /PIBO_BROWSER_USE_CHROME_USER_DATA_DIR=/);

		const slotDirMatch = acquired.stdout.match(/PIBO_BROWSER_USE_CHROME_USER_DATA_DIR='([^']+)'/);
		assert.ok(slotDirMatch);
		const slotDir = slotDirMatch[1];
		assert.equal(await readFile(join(slotDir, "Cookies"), "utf8"), "auth-cookie");
		await assert.rejects(readFile(join(slotDir, "DevToolsActivePort"), "utf8"), /ENOENT/);

		const listed = await execFileAsync("node", [cliPath, "tools", "browser-use", "lease", "list"], { cwd, env });
		assert.match(listed.stdout, /pibo-chat-slot-001\tactive\tagent-a\tpibo-auth-pibo-chat-slot-001/);

		const released = await execFileAsync("node", [
			cliPath,
			"tools",
			"browser-use",
			"lease",
			"release",
			"pibo-chat-slot-001",
			"--delete-profile",
		], { cwd, env });
		assert.match(released.stdout, /Released pibo-chat-slot-001/);
		await assert.rejects(readFile(join(slotDir, "Cookies"), "utf8"), /ENOENT/);
	} finally {
		await rm(cwd, { recursive: true, force: true });
	}
});

test("pibo tools pins browser-use to the guide-compatible version", async () => {
	const cwd = await mkdtemp(join(tmpdir(), "pibo-tools-show-"));
	try {
		const env = { ...process.env, PIBO_HOME: join(cwd, "pibo-home") };
		const result = await execFileAsync("node", [cliPath, "tools", "show", "browser-use"], { cwd, env });

		assert.match(result.stdout, /browser-use 0\.12\.6/);
	} finally {
		await rm(cwd, { recursive: true, force: true });
	}
});

import { randomUUID } from "node:crypto";
import { constants } from "node:fs";
import { link, lstat, open, unlink } from "node:fs/promises";
import { dirname, join } from "node:path";
import type { AgentSession } from "@earendil-works/pi-coding-agent";
import { ensureDurableDirectory, PrefixRecoveryRequiredError } from "../../sessions/prefix-capsule.js";

/** Pi normally delays its initial file until the first assistant output. */
export async function preparePiPrefixNativeState(session: AgentSession, requireExisting = false): Promise<void> {
	const manager = session.sessionManager;
	const path = manager.getSessionFile();
	const header = manager.getHeader();
	if (!manager.isPersisted() || !path || !header) throw new PrefixRecoveryRequiredError("protected Pi sessions require native persistence");
	const existing = await lstat(path).catch(error => { if (error.code === "ENOENT") return undefined; throw error; });
	if (existing) {
		if (!existing.isFile()) throw new PrefixRecoveryRequiredError("native Pi state is not a regular file");
		return;
	}
	if (requireExisting) throw new PrefixRecoveryRequiredError("the native history for this sealed Pi prefix is missing");
	const entries = manager.getEntries();
	if (entries.some(entry => entry.type === "message" && entry.message.role === "assistant")) {
		throw new PrefixRecoveryRequiredError("native Pi history disappeared");
	}
	const directory = dirname(path);
	await ensureDurableDirectory(directory);
	const temporary = join(directory, `.prefix-preparing-${randomUUID()}`);
	try {
		const handle = await open(temporary, "wx", 0o600);
		try {
			await handle.writeFile(`${[header, ...entries].map(entry => JSON.stringify(entry)).join("\n")}\n`);
			await handle.sync();
		} finally { await handle.close(); }
		// Another writer is a conflict, never permission to load its different state.
		await link(temporary, path);
		const parent = await open(directory, "r");
		try { await parent.sync(); } finally { await parent.close(); }
		manager.setSessionFile(path);
	} finally { await unlink(temporary).catch(() => {}); }
}

/** Before initial prefix commit, persist the native user input already appended by Pi. */
export async function syncPiPrefixNativeState(session: AgentSession): Promise<void> {
	const path = session.sessionManager.getSessionFile();
	if (!path) throw new PrefixRecoveryRequiredError("native Pi state has no durable locator");
	const handle = await open(path, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0));
	try {
		if (!(await handle.stat()).isFile()) throw new PrefixRecoveryRequiredError("native Pi state is unavailable");
		await handle.sync();
	} finally { await handle.close(); }
}

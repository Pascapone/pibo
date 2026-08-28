import { randomUUID } from "node:crypto";
import { linkSync, readFileSync, unlinkSync, writeFileSync } from "node:fs";

const MAX_PID = 0x7fff_ffff;
const TOKEN_PATTERN = /^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/;
const START_PATTERN = /^([1-9][0-9]{0,9}):([1-9][0-9]{0,30})$/;

function errorCode(error) {
	return error && typeof error === "object" && typeof error.code === "string" ? error.code : undefined;
}

function linuxProcessIdentity(pid) {
	let stat;
	try {
		stat = readFileSync(`/proc/${pid}/stat`, "utf8");
	} catch (error) {
		return ["ENOENT", "ESRCH"].includes(errorCode(error))
			? { liveness: "dead" }
			: { liveness: "ambiguous" };
	}
	const close = stat.lastIndexOf(")");
	if (close < 2 || close + 2 >= stat.length) return { liveness: "ambiguous" };
	const fields = stat.slice(close + 2).trim().split(/\s+/);
	if (fields.length <= 19) return { liveness: "ambiguous" };
	if (fields[0] === "Z") return { liveness: "dead" };
	const ticks = fields[19];
	if (!ticks || !/^[1-9][0-9]{0,30}$/.test(ticks)) return { liveness: "ambiguous" };
	return { liveness: "active", startId: `${pid}:${ticks}` };
}

export function currentFixtureProcessStartId() {
	if (process.platform !== "linux") return undefined;
	const identity = linuxProcessIdentity(process.pid);
	if (identity.liveness !== "active" || !identity.startId) {
		throw new Error("Could not establish fixture lock process identity.");
	}
	return identity.startId;
}

function validOwner(value) {
	if (!value || typeof value !== "object" || Array.isArray(value)) return undefined;
	if (
		!Number.isSafeInteger(value.pid)
		|| value.pid <= 0
		|| value.pid > MAX_PID
		|| typeof value.token !== "string"
		|| !TOKEN_PATTERN.test(value.token)
		|| !Number.isFinite(value.acquiredAt)
		|| (value.processStartId !== undefined
			&& (typeof value.processStartId !== "string" || !START_PATTERN.test(value.processStartId)))
	) return undefined;
	if (value.processStartId && Number(START_PATTERN.exec(value.processStartId)?.[1]) !== value.pid) return undefined;
	return value;
}

function readOwner(ownerPath) {
	try {
		return validOwner(JSON.parse(readFileSync(ownerPath, "utf8")));
	} catch {
		return undefined;
	}
}

function ownerLiveness(owner, testOnlyProbeOwner) {
	if (testOnlyProbeOwner) return testOnlyProbeOwner(owner);
	if (process.platform === "linux") {
		const identity = linuxProcessIdentity(owner.pid);
		if (identity.liveness !== "active") return identity.liveness;
		if (!owner.processStartId || !identity.startId) return "ambiguous";
		return owner.processStartId === identity.startId ? "active" : "dead";
	}
	try {
		process.kill(owner.pid, 0);
		return "active";
	} catch (error) {
		return errorCode(error) === "ESRCH" ? "dead" : "ambiguous";
	}
}

function removeIfTokenMatches(lockPath, ownerPath, token) {
	if (readOwner(ownerPath)?.token !== token) return false;
	try {
		unlinkSync(lockPath);
		return true;
	} catch (error) {
		if (errorCode(error) === "ENOENT") return false;
		throw error;
	}
}

export function createCodexAppServerStateLock(statePath, options = {}) {
	const lockPath = `${statePath}.lock`;
	const ownerPath = lockPath;
	const timeoutMs = options.timeoutMs ?? 5_000;
	const waitMs = options.waitMs ?? 2;
	let heldToken;
	const withStateLock = (operation) => {
		if (heldToken) {
			const result = operation();
			if (result && typeof result.then === "function") {
				throw new Error("Fixture state-lock callbacks must be synchronous.");
			}
			return result;
		}
		const token = randomUUID();
		const deadline = Date.now() + timeoutMs;
		while (true) {
			const processStartId = currentFixtureProcessStartId();
			const temporaryOwnerPath = `${lockPath}.${process.pid}.${token}.owner.tmp`;
			try {
				options.testOnlyBeforeOwnerWrite?.({ lockPath, ownerPath, temporaryOwnerPath, token });
				writeFileSync(temporaryOwnerPath, `${JSON.stringify({
					pid: process.pid,
					token,
					acquiredAt: Date.now(),
					...(processStartId ? { processStartId } : {}),
				})}\n`, { mode: 0o600, flag: "wx" });
				options.testOnlyAfterOwnerWrite?.({ lockPath, ownerPath, temporaryOwnerPath, token });
				linkSync(temporaryOwnerPath, lockPath);
				options.testOnlyAfterOwnerLinked?.({ lockPath, ownerPath, temporaryOwnerPath, token });
				unlinkSync(temporaryOwnerPath);
				options.testOnlyAfterOwnerPublished?.({ lockPath, ownerPath, token });
				break;
			} catch (error) {
				try {
					unlinkSync(temporaryOwnerPath);
				} catch (cleanupError) {
					if (errorCode(cleanupError) !== "ENOENT") throw cleanupError;
				}
				if (errorCode(error) !== "EEXIST") throw error;
				const owner = readOwner(ownerPath);
				if (owner && ownerLiveness(owner, options.testOnlyProbeOwner) === "dead") {
					if (removeIfTokenMatches(lockPath, ownerPath, owner.token)) continue;
				}
				if (Date.now() >= deadline) {
					const ageMs = owner ? Math.max(0, Date.now() - owner.acquiredAt) : undefined;
					throw new Error(`Timed out waiting for fixture state lock owned by pid ${owner?.pid ?? "unknown"} (${owner?.token ?? "unknown"}, age ${ageMs ?? "unknown"}ms).`);
				}
				Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, waitMs);
			}
		}
		heldToken = token;
		try {
			const result = operation();
			if (result && typeof result.then === "function") {
				throw new Error("Fixture state-lock callbacks must be synchronous.");
			}
			return result;
		} finally {
			heldToken = undefined;
			removeIfTokenMatches(lockPath, ownerPath, token);
		}
	};
	return { lockPath, ownerPath, withStateLock };
}

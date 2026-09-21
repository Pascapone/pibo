import { constants } from "node:fs";
import { access, stat } from "node:fs/promises";

// C1-R2-02: test-local Chrome-binary diagnosis shared by the browser flow and
// the deterministic display unit cases. A missing or unusable binary is a
// missing-browser diagnosis (CHROME_NOT_FOUND), never a missing display
// (HEADFUL_BLOCKED) and never a launch failure (CHROME_LAUNCH_FAILED).
// Pure probing only: importing this module runs no tests and starts nothing.

export async function classifyChromeCandidate(candidate) {
	try {
		const info = await stat(candidate);
		if (!info.isFile()) return { candidate, usable: false, reason: "not-a-file" };
	} catch {
		return { candidate, usable: false, reason: "missing" };
	}
	try {
		await access(candidate, constants.X_OK);
	} catch {
		return { candidate, usable: false, reason: "not-executable" };
	}
	return { candidate, usable: true, reason: "usable" };
}

export async function resolveChromeBinary(candidates) {
	const list = Array.isArray(candidates) ? candidates.filter(Boolean) : [];
	const checked = [];
	for (const candidate of list) {
		const verdict = await classifyChromeCandidate(candidate);
		checked.push(verdict);
		if (verdict.usable) return { binary: candidate, checked };
	}
	// Explicit list only: an empty or fully unusable list never falls back to
	// real system paths behind the caller's back.
	return { binary: undefined, checked };
}

export function chromeNotFoundError(checked) {
	const lines = (Array.isArray(checked) ? checked : []).map(
		(entry) => `Checked: ${entry.candidate} (${entry.reason}).`,
	);
	return new Error([
		"CHROME_NOT_FOUND (C1-R2-02): no usable Chrome/Chromium binary among the explicit candidates.",
		...(lines.length ? lines : ["Checked: no candidates were provided."]),
		"Need: an installed Chrome/Chromium executable (CHROME_BIN or a system path).",
		"This is a missing-browser diagnosis, not a missing display (HEADFUL_BLOCKED is separate) nor a launch failure (CHROME_LAUNCH_FAILED is separate).",
	].join("\n"));
}

// Single binary gate for both browser modes: headful and headless call sites
// share this function, so both modes always get the identical binary error.
export async function requireChromeBinary(candidates) {
	const { binary, checked } = await resolveChromeBinary(candidates);
	if (binary) return { binary, checked };
	throw chromeNotFoundError(checked);
}

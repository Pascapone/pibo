/**
 * Shared Pibo 4 Standard composition check.
 *
 * Compares a built plugin list (from `standard-package-set.json`) against the
 * canonical authority (`standardPluginCoordinates()` in
 * `src/plugins/default-packages.ts`). The expectation is independent of the
 * artifact under test: removing a row from the artifact builder alone fails
 * here instead of silently shrinking the product.
 */

function coordinateKey(entry) {
	return `${entry.package} (${entry.pluginId})`;
}

function isCoordinate(entry) {
	return Boolean(entry)
		&& typeof entry.package === "string" && entry.package.length > 0
		&& typeof entry.pluginId === "string" && entry.pluginId.length > 0
		&& typeof entry.version === "string" && entry.version.length > 0;
}

function duplicates(values) {
	const seen = new Set();
	const repeated = new Set();
	for (const value of values) {
		if (seen.has(value)) repeated.add(value);
		seen.add(value);
	}
	return [...repeated].sort();
}

export function diffStandardPluginComposition(actualPlugins, expectedCoordinates) {
	if (!Array.isArray(actualPlugins)) throw new Error("Standard composition plugin list must be an array");
	if (!Array.isArray(expectedCoordinates) || expectedCoordinates.length === 0 || !expectedCoordinates.every(isCoordinate)) {
		throw new Error("Standard composition authority must be a non-empty coordinate list");
	}
	const malformed = actualPlugins.filter((entry) => !isCoordinate(entry));
	if (malformed.length) throw new Error(`Standard composition has ${malformed.length} malformed plugin entries`);
	const expectedByPackage = new Map(expectedCoordinates.map((entry) => [entry.package, entry]));
	const actualByPackage = new Map();
	for (const entry of actualPlugins) {
		if (!actualByPackage.has(entry.package)) actualByPackage.set(entry.package, entry);
	}
	const missing = expectedCoordinates.filter((entry) => !actualByPackage.has(entry.package)).map(coordinateKey);
	const unexpected = actualPlugins.filter((entry) => !expectedByPackage.has(entry.package)).map(coordinateKey);
	const versionMismatches = [];
	for (const [name, actual] of actualByPackage) {
		const expected = expectedByPackage.get(name);
		if (!expected) continue;
		if (actual.pluginId !== expected.pluginId || actual.version !== expected.version) {
			versionMismatches.push(`${name}: expected ${expected.pluginId}@${expected.version}, found ${actual.pluginId}@${actual.version}`);
		}
	}
	return {
		missing,
		unexpected,
		duplicatePackages: duplicates(actualPlugins.map((entry) => entry.package)),
		duplicatePluginIds: duplicates(actualPlugins.map((entry) => entry.pluginId)),
		versionMismatches,
	};
}

export function assertStandardPluginComposition(actualPlugins, expectedCoordinates, subject = "Pibo Standard") {
	const diff = diffStandardPluginComposition(actualPlugins, expectedCoordinates);
	const problems = [
		...diff.missing.map((entry) => `missing ${entry}`),
		...diff.unexpected.map((entry) => `unexpected ${entry}`),
		...diff.duplicatePackages.map((entry) => `duplicate package ${entry}`),
		...diff.duplicatePluginIds.map((entry) => `duplicate plugin id ${entry}`),
		...diff.versionMismatches,
	];
	if (problems.length) throw new Error(`${subject} composition does not match the canonical default packages: ${problems.join("; ")}`);
	return actualPlugins.length;
}

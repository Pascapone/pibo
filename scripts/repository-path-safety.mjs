import { closeSync, constants, fstatSync, lstatSync, openSync, readFileSync } from "node:fs";
import { join, posix, relative, resolve, sep } from "node:path";

function isInside(parent, child) {
	const value = relative(parent, child);
	return value === "" || (value !== ".." && !value.startsWith(`..${sep}`));
}

function displayPath(root, absolute) {
	return relative(root, absolute).split(sep).join("/") || ".";
}

function failure(kind, message, component) {
	return { ok: false, kind, message, ...(component ? { component } : {}) };
}

function sameIdentity(left, right) {
	return left.dev === right.dev
		&& left.ino === right.ino
		&& left.mode === right.mode
		&& left.isDirectory() === right.isDirectory()
		&& left.isFile() === right.isFile();
}

function sameStableMetadata(left, right) {
	return sameIdentity(left, right)
		&& left.size === right.size
		&& left.mtimeNs === right.mtimeNs
		&& left.ctimeNs === right.ctimeNs
		&& left.nlink === right.nlink;
}

function inspectPath({ projectRoot, repositoryPath }) {
	if (typeof repositoryPath !== "string" || !repositoryPath || repositoryPath.includes("\\") || /\p{Cc}/u.test(repositoryPath) || posix.isAbsolute(repositoryPath)) {
		return failure("INVALID", "Path must be normalized and repository-relative.");
	}
	const segments = repositoryPath.split("/");
	if (segments.some((segment) => !segment || segment === "." || segment === "..") || posix.normalize(repositoryPath) !== repositoryPath) {
		return failure("INVALID", "Path must not contain empty, dot, or traversal segments.");
	}
	const root = resolve(projectRoot);
	const absolute = resolve(root, repositoryPath);
	if (!isInside(root, absolute)) return failure("ESCAPE", "Path escapes the repository.");
	const components = [];
	try {
		const rootStat = lstatSync(root, { bigint: true });
		if (rootStat.isSymbolicLink() || !rootStat.isDirectory()) return failure("PARENT", "Repository root must be a real directory.", ".");
		components.push({ absolute: root, display: ".", segment: null, stat: rootStat, leaf: false });
		let current = root;
		for (const [index, segment] of segments.entries()) {
			current = join(current, segment);
			const stat = lstatSync(current, { bigint: true });
			const component = displayPath(root, current);
			if (stat.isSymbolicLink()) return failure("SYMLINK", `Path contains a symbolic link at ${component}.`, component);
			if (index < segments.length - 1 && !stat.isDirectory()) return failure("PARENT", `Path parent is not a directory: ${component}.`, component);
			if (index === segments.length - 1 && !stat.isFile()) return failure("NOT_FILE", "Path must end at a regular file.", component);
			components.push({ absolute: current, display: component, segment, stat, leaf: index === segments.length - 1 });
		}
	} catch (error) {
		return failure("MISSING", `Path cannot be inspected: ${error.code ?? error.message}.`);
	}
	return { ok: true, root, absolute, segments, components };
}

export class RepositoryPathError extends Error {
	constructor({ codePrefix, kind, repositoryPath, message }) {
		super(`${codePrefix}_${kind}: ${repositoryPath}: ${message}`);
		this.name = "RepositoryPathError";
		this.code = `${codePrefix}_${kind}`;
		this.kind = kind;
		this.repositoryPath = repositoryPath;
		this.detail = message;
	}
}

function pathError(codePrefix, repositoryPath, kind, message) {
	return new RepositoryPathError({ codePrefix, kind, repositoryPath, message });
}

function assertSnapshot({ expected, actual, codePrefix, repositoryPath, phase }) {
	if (!sameStableMetadata(expected.stat, actual)) {
		throw pathError(codePrefix, repositoryPath, "CHANGED", `Path component changed ${phase}: ${expected.display}.`);
	}
}

export function inspectRepositoryRegularFile({ projectRoot, repositoryPath }) {
	return inspectPath({ projectRoot, repositoryPath });
}

export function assertRepositoryRegularFile({ projectRoot, repositoryPath, codePrefix }) {
	const result = inspectPath({ projectRoot, repositoryPath });
	if (!result.ok) throw pathError(codePrefix, repositoryPath, result.kind, result.message);
	return result.absolute;
}

export function readRepositoryRegularFile({ projectRoot, repositoryPath, codePrefix, hooks = {} }) {
	const inspection = inspectPath({ projectRoot, repositoryPath });
	if (!inspection.ok) throw pathError(codePrefix, repositoryPath, inspection.kind, inspection.message);
	const descriptors = [];
	try {
		hooks.afterInspect?.({ absolute: inspection.absolute, repositoryPath });
		let descriptor;
		for (const [index, component] of inspection.components.entries()) {
			const flags = constants.O_RDONLY | constants.O_NOFOLLOW | (component.leaf ? 0 : constants.O_DIRECTORY);
			const openPath = index === 0 ? component.absolute : `/proc/self/fd/${descriptor}/${component.segment}`;
			try {
				descriptor = openSync(openPath, flags);
			} catch (error) {
				throw pathError(codePrefix, repositoryPath, "CHANGED", `Path changed between inspection and open at ${component.display}: ${error.code ?? error.message}.`);
			}
			descriptors.push({ descriptor, component });
			assertSnapshot({ expected: component, actual: fstatSync(descriptor, { bigint: true }), codePrefix, repositoryPath, phase: "between inspection and open" });
		}
		const leafDescriptor = descriptors.at(-1).descriptor;
		hooks.afterOpen?.({ absolute: inspection.absolute, repositoryPath, descriptor: leafDescriptor });
		for (const entry of descriptors) {
			assertSnapshot({ expected: entry.component, actual: fstatSync(entry.descriptor, { bigint: true }), codePrefix, repositoryPath, phase: "before read" });
		}
		let bytes;
		try {
			bytes = readFileSync(leafDescriptor);
		} catch (error) {
			throw pathError(codePrefix, repositoryPath, "READ", `Opened file cannot be read: ${error.code ?? error.message}.`);
		}
		hooks.afterRead?.({ absolute: inspection.absolute, repositoryPath, descriptor: leafDescriptor, bytes });
		for (const entry of descriptors) {
			assertSnapshot({ expected: entry.component, actual: fstatSync(entry.descriptor, { bigint: true }), codePrefix, repositoryPath, phase: "during read" });
		}
		const finalInspection = inspectPath({ projectRoot, repositoryPath });
		if (!finalInspection.ok) throw pathError(codePrefix, repositoryPath, "CHANGED", `Path changed during read: ${finalInspection.message}`);
		if (finalInspection.components.length !== inspection.components.length) throw pathError(codePrefix, repositoryPath, "CHANGED", "Path component count changed during read.");
		for (const [index, component] of finalInspection.components.entries()) {
			assertSnapshot({ expected: inspection.components[index], actual: component.stat, codePrefix, repositoryPath, phase: "during read" });
		}
		return bytes;
	} finally {
		for (const { descriptor } of descriptors.reverse()) {
			try {
				closeSync(descriptor);
			} catch {
				// Preserve the stable-read result or earlier structured diagnostic.
			}
		}
	}
}

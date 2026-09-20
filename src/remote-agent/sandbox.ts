import { isAbsolute, relative, resolve, sep } from "node:path";
import { RemoteAgentError } from "./types.js";

/** Resolve a user-supplied path and confine it to the sandbox root. */
export function resolveSandboxPath(sandboxRoot: string, requestedPath: string): string {
	const root = resolve(sandboxRoot);
	const candidate = requestedPath.trim();
	if (!candidate) throw new RemoteAgentError("path_invalid", "A file path is required.");
	const resolved = resolve(root, candidate);
	if (resolved === root) return resolved;
	const relativePath = relative(root, resolved);
	if (relativePath === ".." || relativePath.startsWith(`..${sep}`) || isAbsolute(relativePath)) {
		throw new RemoteAgentError("path_forbidden", "This path is outside the room sandbox.");
	}
	return resolved;
}

export function assertAbsoluteSandboxRoot(value: string): string {
	const resolved = resolve(value.trim());
	if (!isAbsolute(resolved)) throw new RemoteAgentError("sandbox_invalid", "sandboxPath must be an absolute path.");
	return resolved;
}

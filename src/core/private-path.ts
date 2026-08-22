import { spawnSync } from "node:child_process";
import { chmodSync, lstatSync, readdirSync, statSync } from "node:fs";
import { resolve } from "node:path";

export type PrivatePathKind = "directory" | "file";

export type PrivatePathDescriptor = {
	path: string;
	kind: PrivatePathKind;
};

export type ProtectPrivatePathOptions = {
	force?: boolean;
};

const protectedWindowsPaths = new Set<string>();

const WINDOWS_PRIVATE_ACL_SCRIPT = `
$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'
$entries = @((ConvertFrom-Json -InputObject $env:PIBO_PRIVATE_PATHS_JSON))
$current = [System.Security.Principal.WindowsIdentity]::GetCurrent().User
$system = New-Object System.Security.Principal.SecurityIdentifier('S-1-5-18')
$administrators = New-Object System.Security.Principal.SecurityIdentifier('S-1-5-32-544')
$allowed = @($current.Value, $system.Value, $administrators.Value)
$inheritBoth = [System.Security.AccessControl.InheritanceFlags]([int][System.Security.AccessControl.InheritanceFlags]::ContainerInherit -bor [int][System.Security.AccessControl.InheritanceFlags]::ObjectInherit)
foreach ($entry in $entries) {
	$path = [System.IO.Path]::GetFullPath([string]$entry.path)
	$kind = [string]$entry.kind
	$sections = [System.Security.AccessControl.AccessControlSections]([int][System.Security.AccessControl.AccessControlSections]::Access -bor [int][System.Security.AccessControl.AccessControlSections]::Owner)
	if ($kind -eq 'directory') {
		if (-not [System.IO.Directory]::Exists($path)) { throw "Private directory does not exist" }
		$security = [System.IO.Directory]::GetAccessControl($path, $sections)
		$inheritance = $inheritBoth
	} elseif ($kind -eq 'file') {
		if (-not [System.IO.File]::Exists($path)) { throw "Private file does not exist" }
		$security = [System.IO.File]::GetAccessControl($path, $sections)
		$inheritance = [System.Security.AccessControl.InheritanceFlags]::None
	} else {
		throw "Unsupported private path kind"
	}
	if ($security.GetOwner([System.Security.Principal.SecurityIdentifier]).Value -ne $current.Value) { throw "Private path owner is not the current user" }
	$security.SetAccessRuleProtection($true, $false)
	foreach ($rule in @($security.GetAccessRules($true, $false, [System.Security.Principal.SecurityIdentifier]))) {
		$security.RemoveAccessRuleAll($rule)
	}
	foreach ($sid in @($current, $system, $administrators)) {
		$rule = New-Object System.Security.AccessControl.FileSystemAccessRule(
			$sid,
			[System.Security.AccessControl.FileSystemRights]::FullControl,
			$inheritance,
			[System.Security.AccessControl.PropagationFlags]::None,
			[System.Security.AccessControl.AccessControlType]::Allow
		)
		$security.AddAccessRule($rule) | Out-Null
	}
	if ($kind -eq 'directory') {
		[System.IO.Directory]::SetAccessControl($path, $security)
	} else {
		[System.IO.File]::SetAccessControl($path, $security)
	}
	$applied = Get-Acl -LiteralPath $path
	if (-not $applied.AreAccessRulesProtected) { throw "Private path still inherits access rules" }
	if ($applied.GetOwner([System.Security.Principal.SecurityIdentifier]).Value -ne $current.Value) { throw "Private path owner is not the current user" }
	$seen = @{}
	foreach ($rule in $applied.GetAccessRules($true, $true, [System.Security.Principal.SecurityIdentifier])) {
		$sid = $rule.IdentityReference.Value
		if ($allowed -notcontains $sid) { throw "Private path grants access to an unexpected principal" }
		if ($rule.AccessControlType -ne [System.Security.AccessControl.AccessControlType]::Allow) { throw "Private path contains a deny rule" }
		if (($rule.FileSystemRights -band [System.Security.AccessControl.FileSystemRights]::FullControl) -ne [System.Security.AccessControl.FileSystemRights]::FullControl) { throw "Private path does not grant required full control" }
		$seen[$sid] = $true
	}
	foreach ($sid in $allowed) {
		if (-not $seen.ContainsKey($sid)) { throw "Private path is missing a required principal" }
	}
}
`;

const WINDOWS_PRIVATE_ACL_COMMAND = Buffer.from(WINDOWS_PRIVATE_ACL_SCRIPT, "utf16le").toString("base64");

function protectWindowsPathBatchSync(paths: readonly PrivatePathDescriptor[]): void {
	const result = spawnSync(
		"powershell.exe",
		["-NoLogo", "-NoProfile", "-NonInteractive", "-EncodedCommand", WINDOWS_PRIVATE_ACL_COMMAND],
		{
			encoding: "utf8",
			env: { ...process.env, PIBO_PRIVATE_PATHS_JSON: JSON.stringify(paths) },
			timeout: 15_000,
			windowsHide: true,
		},
	);
	if (result.error || result.status !== 0) {
		const reason = result.error instanceof Error && result.error.message
			? ` (${result.error.message})`
			: "";
		throw new Error(`Could not apply a private Windows ACL${reason}`);
	}
}

function protectWindowsPathsSync(paths: readonly PrivatePathDescriptor[]): void {
	let batch: PrivatePathDescriptor[] = [];
	let batchCharacters = 2;
	for (const descriptor of paths) {
		const characters = JSON.stringify(descriptor).length + 1;
		if (batch.length > 0 && batchCharacters + characters > 24_000) {
			protectWindowsPathBatchSync(batch);
			batch = [];
			batchCharacters = 2;
		}
		batch.push(descriptor);
		batchCharacters += characters;
	}
	if (batch.length > 0) protectWindowsPathBatchSync(batch);
}

function protectPosixPathSync(path: string, kind: PrivatePathKind): void {
	const expectedMode = kind === "directory" ? 0o700 : 0o600;
	chmodSync(path, expectedMode);
	if ((statSync(path).mode & 0o077) !== 0) {
		throw new Error(`Private ${kind} must not be accessible by group or other users: ${path}`);
	}
}

export function protectPrivatePathsSync(
	paths: readonly PrivatePathDescriptor[],
	options: ProtectPrivatePathOptions = {},
): void {
	if (paths.length === 0) return;
	const normalized = paths.map((descriptor) => ({ ...descriptor, path: resolve(descriptor.path) }));
	if (process.platform === "win32") {
		const pending = options.force
			? normalized
			: normalized.filter((descriptor) => !protectedWindowsPaths.has(`${descriptor.kind}:${descriptor.path.toLowerCase()}`));
		if (pending.length === 0) return;
		protectWindowsPathsSync(pending);
		for (const descriptor of pending) protectedWindowsPaths.add(`${descriptor.kind}:${descriptor.path.toLowerCase()}`);
		return;
	}
	for (const descriptor of normalized) protectPosixPathSync(descriptor.path, descriptor.kind);
}

export function protectPrivateDirectorySync(path: string, options?: ProtectPrivatePathOptions): void {
	protectPrivatePathsSync([{ path, kind: "directory" }], options);
}

export function protectPrivateFileSync(path: string, options?: ProtectPrivatePathOptions): void {
	protectPrivatePathsSync([{ path, kind: "file" }], options);
}

export function protectPrivateTreeSync(root: string): void {
	if (process.platform !== "win32") return;
	const paths: PrivatePathDescriptor[] = [];
	const visit = (path: string): void => {
		const metadata = lstatSync(path);
		if (metadata.isSymbolicLink()) throw new Error(`Private path tree contains a symbolic link: ${path}`);
		if (metadata.isDirectory()) {
			paths.push({ path, kind: "directory" });
			for (const entry of readdirSync(path)) visit(resolve(path, entry));
			return;
		}
		if (metadata.isFile()) paths.push({ path, kind: "file" });
	};
	visit(resolve(root));
	protectPrivatePathsSync(paths, { force: true });
}

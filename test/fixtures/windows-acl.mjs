import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";

const SUMMARY_SCRIPT = Buffer.from(`
$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'
$path = [System.IO.Path]::GetFullPath($env:PIBO_TEST_ACL_PATH)
$acl = Get-Acl -LiteralPath $path
[pscustomobject]@{
	protected = $acl.AreAccessRulesProtected
	ownerSid = $acl.GetOwner([System.Security.Principal.SecurityIdentifier]).Value
	currentUserSid = [System.Security.Principal.WindowsIdentity]::GetCurrent().User.Value
	rules = @($acl.GetAccessRules($true, $true, [System.Security.Principal.SecurityIdentifier]) | ForEach-Object {
		[pscustomobject]@{
			sid = $_.IdentityReference.Value
			rights = $_.FileSystemRights.ToString()
			inherited = $_.IsInherited
			type = $_.AccessControlType.ToString()
			inheritance = $_.InheritanceFlags.ToString()
		}
	})
} | ConvertTo-Json -Depth 5 -Compress
`, "utf16le").toString("base64");

const GRANT_USERS_SCRIPT = Buffer.from(`
$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'
$path = [System.IO.Path]::GetFullPath($env:PIBO_TEST_ACL_PATH)
$users = New-Object System.Security.Principal.SecurityIdentifier('S-1-5-32-545')
$isDirectory = (Get-Item -LiteralPath $path).PSIsContainer
$sections = [System.Security.AccessControl.AccessControlSections]::Access
$acl = if ($isDirectory) {
	[System.IO.Directory]::GetAccessControl($path, $sections)
} else {
	[System.IO.File]::GetAccessControl($path, $sections)
}
$inheritance = if ($isDirectory) {
	[System.Security.AccessControl.InheritanceFlags]([int][System.Security.AccessControl.InheritanceFlags]::ContainerInherit -bor [int][System.Security.AccessControl.InheritanceFlags]::ObjectInherit)
} else {
	[System.Security.AccessControl.InheritanceFlags]::None
}
$rule = New-Object System.Security.AccessControl.FileSystemAccessRule(
	$users,
	[System.Security.AccessControl.FileSystemRights]::Modify,
	$inheritance,
	[System.Security.AccessControl.PropagationFlags]::None,
	[System.Security.AccessControl.AccessControlType]::Allow
)
$acl.SetAccessRuleProtection($true, $false)
$acl.AddAccessRule($rule) | Out-Null
if ($isDirectory) {
	[System.IO.Directory]::SetAccessControl($path, $acl)
} else {
	[System.IO.File]::SetAccessControl($path, $acl)
}
`, "utf16le").toString("base64");

function runPowerShell(encodedCommand, path) {
	const result = spawnSync(
		"powershell.exe",
		["-NoLogo", "-NoProfile", "-NonInteractive", "-EncodedCommand", encodedCommand],
		{
			encoding: "utf8",
			env: { ...process.env, PIBO_TEST_ACL_PATH: path },
			timeout: 15_000,
			windowsHide: true,
		},
	);
	assert.equal(result.status, 0, result.stderr || result.error?.message);
	return result.stdout.trim();
}

export function grantBuiltinUsersModify(path) {
	assert.equal(process.platform, "win32");
	runPowerShell(GRANT_USERS_SCRIPT, path);
}

export function readWindowsAcl(path) {
	assert.equal(process.platform, "win32");
	return JSON.parse(runPowerShell(SUMMARY_SCRIPT, path));
}

export function assertPrivateWindowsAcl(path, kind) {
	const acl = readWindowsAcl(path);
	assert.equal(acl.protected, true);
	assert.equal(acl.ownerSid, acl.currentUserSid);
	const allowed = new Set([acl.currentUserSid, "S-1-5-18", "S-1-5-32-544"]);
	assert.deepEqual(new Set(acl.rules.map((rule) => rule.sid)), allowed);
	for (const rule of acl.rules) {
		assert.equal(rule.inherited, false);
		assert.equal(rule.type, "Allow");
		assert.match(rule.rights, /FullControl/);
		if (kind === "directory") assert.match(rule.inheritance, /ContainerInherit/);
		else assert.equal(rule.inheritance, "None");
	}
	return acl;
}

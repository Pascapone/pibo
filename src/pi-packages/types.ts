export type PiPackageResourceType = "extension" | "skill" | "prompt" | "theme";

export type PiboPiPackageDiagnostic = {
	type: "info" | "warning" | "error";
	message: string;
};

export type PiboPiPackageInfo = {
	id: string;
	name: string;
	source: string;
	installSpec: string;
	description?: string;
	version?: string;
	repositoryUrl?: string;
	resourceTypes: PiPackageResourceType[];
	extensionPaths?: string[];
	skillNames?: string[];
	promptNames?: string[];
	themeNames?: string[];
	discoveredToolNames?: string[];
	installStatus: "registered" | "installed" | "missing" | "error";
	installPath?: string;
	enabled: boolean;
	diagnostics: PiboPiPackageDiagnostic[];
	addedAt: string;
	updatedAt: string;
};

export type PiboPiPackageStoreData = {
	version: 1;
	packages: PiboPiPackageInfo[];
};

export type PiboPiPackageInput = Omit<PiboPiPackageInfo, "addedAt" | "updatedAt" | "enabled"> & {
	enabled?: boolean;
	addedAt?: string;
	updatedAt?: string;
};

export type ParsedPiPackageSource = {
	kind: "npm" | "local";
	name: string;
	source: string;
	installSpec: string;
	packageName?: string;
	path?: string;
	diagnostics: PiboPiPackageDiagnostic[];
};

export type PiPackageInstallResult = {
	installStatus: PiboPiPackageInfo["installStatus"];
	installPath?: string;
	diagnostics: PiboPiPackageDiagnostic[];
};

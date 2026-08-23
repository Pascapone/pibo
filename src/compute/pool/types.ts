export type DeploymentSeedMode = "full" | "medium" | "fresh";
export type DeploymentSlotState = "free" | "provisioning" | "ready" | "releasing" | "dirty" | "quarantined";
export type DeploymentLeaseStatus = "provisioning" | "ready" | "releasing" | "released" | "failed" | "expired";

export interface DeploymentSlotDefinition {
	id: string;
	ordinal: number;
	webPort: number;
	gatewayPort: number;
	publicUrl?: string;
}

export interface DeploymentSlotRecord extends DeploymentSlotDefinition {
	state: DeploymentSlotState;
	activeLeaseId?: string;
	dirtyReason?: string;
	updatedAt: string;
}

export interface DeploymentLeaseRecord {
	id: string;
	slotId: string;
	holder: string;
	seedMode: DeploymentSeedMode;
	artifactSha256: string;
	artifactRuntimePath: string;
	packageVersion?: string;
	commit?: string;
	containerName: string;
	publicUrl?: string;
	status: DeploymentLeaseStatus;
	createdAt: string;
	expiresAt: string;
	renewedAt?: string;
	releasedAt?: string;
	failedAt?: string;
	failureSnapshotPath?: string;
	lastError?: string;
}

export interface DeploymentPoolStatus {
	generatedAt: string;
	configured: boolean;
	maxActive: number;
	active: number;
	free: number;
	nearestExpiry?: string;
	slots: Array<DeploymentSlotRecord & { lease?: DeploymentLeaseRecord }>;
}

export interface DeploymentPoolReapItem {
	lease: DeploymentLeaseRecord;
	action: "release" | "skip";
	reasons: string[];
}

export interface DeploymentFailureSnapshot {
	leaseId: string;
	path: string;
	createdAt: string;
	expiresAt: string;
}

export interface DeploymentPoolContainerReapItem {
	name: string;
	leaseId?: string;
	slotId?: string;
	action: "remove" | "keep";
	reason: string;
}

export interface DeploymentPoolDirtySlotReapItem {
	slotId: string;
	leaseId?: string;
	action: "clean" | "keep";
	reason: string;
}

export interface DeploymentPoolArtifactReapItem {
	sha256: string;
	path: string;
	modifiedAt: string;
	action: "remove" | "keep";
	reason: string;
}

export interface DeploymentPoolReapPlan {
	createdAt: string;
	dryRun: true;
	items: DeploymentPoolReapItem[];
	orphanContainers: DeploymentPoolContainerReapItem[];
	dirtySlots: DeploymentPoolDirtySlotReapItem[];
	failureSnapshots: Array<DeploymentFailureSnapshot & { action: "remove" | "keep"; reason: string }>;
	artifacts: DeploymentPoolArtifactReapItem[];
	summary: {
		selectedLeases: number;
		selectedOrphanContainers: number;
		selectedDirtySlots: number;
		selectedFailureSnapshots: number;
		selectedArtifacts: number;
	};
}

export interface DeploymentPoolReapResult {
	applied: true;
	plan: DeploymentPoolReapPlan;
	releasedLeases: string[];
	removedOrphanContainers: string[];
	cleanedDirtySlots: string[];
	removedFailureSnapshots: string[];
	removedArtifacts: string[];
}

import type { PiboJsonObject, PiboJsonValue } from "../../../core/events.js";
import type { ModelProfile } from "../../../core/profiles.js";
import type { PiboThinkingLevel } from "../../../core/thinking.js";

export type PiboWorkflowId = string;
export type PiboWorkflowSessionState = "configured" | "running" | "waiting" | "completed" | "failed" | "cancelled";

export type PiboWorkflowSessionConfiguration = {
	inputValues: PiboJsonObject;
	promptOverrides: Record<string, string>;
	promptOverrideEligibleNodeIds: string[];
	overrideScopes: {
		promptOverrides: "eligible_agent_node";
		model: "workflow";
		thinkingLevel: "workflow";
		fastMode: "workflow";
	};
	model?: ModelProfile;
	thinkingLevel?: PiboThinkingLevel;
	fastMode?: boolean;
};

export type PiboWorkflowPromptAssetPin = {
	assetId: string;
	revisionId: string;
	contentHash: string;
	source: "code" | "ui";
};

export type PiboWorkflowSessionSnapshot = {
	id: string;
	schemaVersion: 1;
	createdAt: string;
	createdBy: string;
	piboSessionId: string;
	workflow: {
		id: PiboWorkflowId;
		version: string;
		source: "code" | "ui";
		title?: string;
		description?: string;
		tags: string[];
		baseDefinitionHash: string;
		effectiveDefinitionHash: string;
	};
	baseDefinition: PiboJsonObject;
	effectiveDefinition: PiboJsonObject;
	inputValues: PiboJsonObject;
	promptOverrides: Record<string, string>;
	overridePolicy: {
		promptEligibility: "metadata.sessionOverrides.prompt===true-and-direct-promptTemplate";
		eligiblePromptNodeIds: string[];
		modelScope: "workflow";
		thinkingLevelScope: "workflow";
		fastModeScope: "workflow";
	};
	model?: ModelProfile;
	thinkingLevel?: PiboThinkingLevel;
	fastMode?: boolean;
	promptAssetPins: PiboWorkflowPromptAssetPin[];
	validation: PiboJsonObject;
	deletedDefinitionFallback: {
		title?: string;
		workflowId: PiboWorkflowId;
		workflowVersion: string;
		effectiveDefinitionHash: string;
		tombstoneLabel?: string;
	};
};

export type PiboWorkflowDefinitionLink = {
	status: "live" | "snapshot_only_definition_deleted";
	workflowId: PiboWorkflowId;
	workflowVersion?: string;
	title?: string;
	definitionHash?: string;
	href?: string;
	tombstoneLabel?: string;
};

export type PiboWorkflowWaitActionRef = { id: string; kind?: PiboWorkflowHumanActionKind };
export type PiboWorkflowHumanActionKind = "approve" | "reject" | "resume" | "cancel" | string;
export type PiboWorkflowWaitTokenStatus = "pending" | "resumed" | "expired" | "cancelled";

export type PiboWorkflowWaitToken = {
	id: string;
	piboSessionId: string;
	workflowRunId: string;
	nodeAttemptId?: string;
	humanNodeId?: string;
	actions: PiboWorkflowWaitActionRef[];
	prompt: string;
	schema?: PiboJsonObject;
	status: PiboWorkflowWaitTokenStatus;
	resumePayload?: PiboJsonObject | PiboJsonValue;
	createdAt: string;
	expiresAt?: string;
	resolvedAt?: string;
};

export type PiboWorkflowPendingHumanActionRef = PiboWorkflowWaitActionRef & {
	displayName: string;
	description?: string;
	paramsSchema: PiboJsonObject | null;
	registered: boolean;
};

export type PiboWorkflowPendingHumanAction = {
	waitTokenId: string;
	workflowRunId: string;
	nodeAttemptId?: string;
	humanNodeId?: string;
	prompt: string;
	schema?: PiboJsonObject;
	status: "pending";
	payloadRequirements: { required: boolean; schema?: PiboJsonObject; description: string };
	availableActions: PiboWorkflowPendingHumanActionRef[];
	diagnostics: Array<{ code: string; message: string; severity: "error" | "warning" | "info"; path?: string; registryRef?: string; hint?: string }>;
	createdAt: string;
	expiresAt?: string;
};

export type PiboWorkflowSessionLink = {
	piboSessionId: string;
	workflowId: PiboWorkflowId;
	workflowVersion?: string;
	workflowRunId?: string;
	state: PiboWorkflowSessionState;
	configuration?: PiboWorkflowSessionConfiguration;
	workflowDefinitionLink?: PiboWorkflowDefinitionLink;
	pendingHumanActions?: PiboWorkflowPendingHumanAction[];
	createdAt: string;
	updatedAt: string;
};

export type PiboWorkflowRunStatus = "running" | "waiting" | "completed" | "failed" | "cancelled";
export type PiboWorkflowRun = {
	id: string;
	piboSessionId: string;
	workflowId: PiboWorkflowId;
	workflowVersion: string;
	snapshotId: string;
	effectiveDefinitionHash: string;
	status: PiboWorkflowRunStatus;
	current: PiboJsonObject;
	inputValues: PiboJsonObject;
	validation?: PiboJsonObject;
	createdAt: string;
	updatedAt: string;
	completedAt?: string;
	failedAt?: string;
	cancelledAt?: string;
};

export type PiboWorkflowHumanActionRecord = {
	id: string;
	piboSessionId: string;
	workflowRunId: string;
	waitTokenId: string;
	actionId?: string;
	kind: PiboWorkflowHumanActionKind;
	actor?: PiboJsonObject;
	payload?: PiboJsonObject | PiboJsonValue;
	createdAt: string;
};

export type ResolveWorkflowHumanActionResult = {
	waitToken: PiboWorkflowWaitToken;
	action: PiboWorkflowHumanActionRecord;
	run: PiboWorkflowRun;
	workflowSession: PiboWorkflowSessionLink;
};

export type StartWorkflowRunResult = {
	workflowSession: PiboWorkflowSessionLink;
	run: PiboWorkflowRun;
	alreadyStarted: boolean;
};

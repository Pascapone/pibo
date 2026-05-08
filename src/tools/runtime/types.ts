export type RuntimeKind = "python" | "node";
export type RuntimeAction = "start" | "exec" | "inspect" | "vars" | "interrupt" | "close" | "list";
export type RuntimeSessionStatus = "starting" | "idle" | "busy" | "closed" | "failed";

export type RuntimeTarget = {
	type?: "local" | "docker" | "ssh";
	cwd?: string;
	executable?: string;
	args?: string[];
	env?: Record<string, string>;
};

export type RuntimeValueSummary = {
	type: string;
	repr: string;
	length?: number;
	keys?: string[];
	shape?: number[];
	columns?: string[];
	preview?: string;
};

export type RuntimeErrorSummary = {
	name: string;
	message: string;
	line?: number;
	column?: number;
	traceback?: string;
	stack?: string;
};

export type RuntimeStartInput = {
	runtime: RuntimeKind;
	name?: string;
	target?: RuntimeTarget;
	timeoutMs?: number;
};

export type RuntimeExecInput = {
	sessionId: string;
	code: string;
	timeoutMs?: number;
	mode?: "exec" | "eval" | "auto";
	closeOnSuccess?: boolean;
};

export type RuntimeInspectInput = {
	sessionId: string;
	expression: string;
	what?: "summary" | "signature" | "members" | "source" | "doc" | "all";
	maxBytes?: number;
};

export type RuntimeVarsInput = {
	sessionId: string;
	includePrivate?: boolean;
	maxItems?: number;
	maxBytes?: number;
};

export type RuntimeInterruptInput = {
	sessionId: string;
};

export type RuntimeCloseInput = {
	sessionId: string;
	force?: boolean;
};

export type RuntimeListInput = Record<string, never>;

export type RuntimeStartResult = {
	status: "ok" | "error" | "failed";
	sessionId?: string;
	runtime?: RuntimeKind;
	name?: string;
	cwd?: string;
	executable?: string;
	pid?: number;
	startedAt?: string;
	error?: RuntimeErrorSummary;
};

export type RuntimeExecResult = {
	status: "ok" | "error" | "timeout" | "interrupted" | "not_found" | "failed";
	sessionId: string;
	runtime?: RuntimeKind;
	stdout?: string;
	stderr?: string;
	result?: RuntimeValueSummary;
	error?: RuntimeErrorSummary;
	durationMs: number;
	executionCount?: number;
	autoClosed?: boolean;
};

export type RuntimeInspectResult = {
	status: "ok" | "error" | "not_found" | "failed";
	sessionId: string;
	summary?: RuntimeValueSummary;
	signature?: string;
	members?: string[];
	source?: string;
	doc?: string;
	error?: RuntimeErrorSummary;
};

export type RuntimeVarsResult = {
	status: "ok" | "not_found" | "failed";
	sessionId: string;
	variables: Array<{ name: string; summary: RuntimeValueSummary }>;
	truncated?: boolean;
	error?: RuntimeErrorSummary;
};

export type RuntimeInterruptResult = {
	status: "ok" | "not_found" | "failed";
	sessionId: string;
	message?: string;
	error?: RuntimeErrorSummary;
};

export type RuntimeCloseResult = {
	status: "ok" | "not_found" | "failed";
	sessionId: string;
	closed: boolean;
	message?: string;
	error?: RuntimeErrorSummary;
};

export type RuntimeSessionRecord = {
	sessionId: string;
	runtime: RuntimeKind;
	name?: string;
	cwd: string;
	status: RuntimeSessionStatus;
	startedAt: string;
	updatedAt: string;
	lastExecAt?: string;
	executionCount: number;
	pid?: number;
	executable?: string;
};

export type RuntimeListResult = {
	status: "ok";
	sessions: RuntimeSessionRecord[];
};

export type RuntimeHistoryEntry = {
	id: string;
	startedAt: string;
	durationMs: number;
	mode: "exec" | "eval" | "auto";
	code: string;
	status: RuntimeExecResult["status"];
	error?: RuntimeErrorSummary;
};

export type RuntimeBackend = {
	exec(input: Omit<RuntimeExecInput, "sessionId" | "closeOnSuccess">): Promise<RuntimeExecResult>;
	inspect(input: Omit<RuntimeInspectInput, "sessionId">): Promise<RuntimeInspectResult>;
	vars(input: Omit<RuntimeVarsInput, "sessionId">): Promise<RuntimeVarsResult>;
	interrupt(): Promise<RuntimeInterruptResult>;
	close(force?: boolean): Promise<void>;
	isAlive(): boolean;
	getRecord(): Pick<RuntimeSessionRecord, "pid" | "cwd" | "executable">;
};

export class AgentRuntimeRegistrationError extends Error {
	constructor(message: string, options?: ErrorOptions) {
		super(message, options);
		this.name = "AgentRuntimeRegistrationError";
	}
}

export class AgentRuntimeContractError extends Error {
	constructor(readonly runtimeInstanceId: string, message: string, options?: ErrorOptions) {
		super(message, options);
		this.name = "AgentRuntimeContractError";
	}
}

export class AgentRuntimeUnavailableError extends Error {
	constructor(readonly runtimeInstanceId: string, message = `Agent runtime instance "${runtimeInstanceId}" is unavailable.`, options?: ErrorOptions) {
		super(message, options);
		this.name = "AgentRuntimeUnavailableError";
	}
}

export class AgentRuntimeCapabilityUnavailableError extends Error {
	constructor(readonly capability: string, readonly runtimeInstanceId?: string, reason?: string, options?: ErrorOptions) {
		super(
			reason
				?? (runtimeInstanceId
					? `Agent runtime instance "${runtimeInstanceId}" does not support ${capability}.`
					: `The active agent runtime does not support ${capability}.`),
			options,
		);
		this.name = "AgentRuntimeCapabilityUnavailableError";
	}
}

export class AgentRuntimeAuthError extends Error {
	constructor(
		readonly code: string,
		message: string,
		readonly retryable = false,
		options?: ErrorOptions,
	) {
		super(message, options);
		this.name = "AgentRuntimeAuthError";
	}
}

export class AgentRuntimeBindingMissingError extends Error {
	constructor(readonly piboSessionId: string, readonly runtimeInstanceId: string, readonly nativeSessionId?: string, options?: ErrorOptions) {
		super(
			`The native session${nativeSessionId ? ` "${nativeSessionId}"` : ""} for Pibo session "${piboSessionId}" is missing from runtime instance "${runtimeInstanceId}".`,
			options,
		);
		this.name = "AgentRuntimeBindingMissingError";
	}
}

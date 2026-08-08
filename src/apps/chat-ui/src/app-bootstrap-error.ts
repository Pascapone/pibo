export type BootstrapErrorState = {
	kind: "authentication-required" | "load-failed";
	message: string;
};

function errorStatus(caught: unknown): number | undefined {
	if (!caught || typeof caught !== "object" || !("status" in caught)) return undefined;
	return typeof caught.status === "number" ? caught.status : undefined;
}

function errorText(caught: unknown): string {
	return caught instanceof Error ? caught.message : String(caught);
}

export function classifyBootstrapError(caught: unknown): BootstrapErrorState {
	const status = errorStatus(caught);
	const message = errorText(caught);
	if (status === 401 || status === 403) {
		return { kind: "authentication-required", message };
	}
	if (
		caught instanceof TypeError
		|| /failed to fetch|network(?:error| request failed)|internet disconnected|load failed/i.test(message)
	) {
		return {
			kind: "load-failed",
			message: "Could not connect to Pibo Chat. Check your network connection and try again.",
		};
	}
	if (status !== undefined && status >= 500) {
		return {
			kind: "load-failed",
			message: "Could not load Pibo Chat. The server may be unavailable. Try again.",
		};
	}
	return {
		kind: "load-failed",
		message: "Could not load Pibo Chat. Try again.",
	};
}

import type { IncomingMessage, ServerResponse } from "node:http";

/** One-use startup rendezvous. Native ownership precedes parent resource writes. */
export class NativePrefixStartupGate {
	private claimed = false;
	private closed = false;
	private activated = false;
	private acknowledgeOwnership!: (owned: boolean) => void;
	private releaseActivation!: (args: readonly string[] | undefined) => void;
	private readonly ownership = new Promise<boolean>(resolve => { this.acknowledgeOwnership = resolve; });
	private readonly activation = new Promise<readonly string[] | undefined>(resolve => { this.releaseActivation = resolve; });
	private readonly timer: NodeJS.Timeout;

	constructor(timeoutMs = 15000) {
		if (!Number.isSafeInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > 60000) throw new Error("Invalid native startup deadline");
		this.timer = setTimeout(() => this.dispose(), timeoutMs);
	}

	async waitForOwnership(): Promise<void> {
		if (!await this.ownership || this.closed) throw new Error("Native prefix ownership startup failed");
	}

	activate(args: readonly string[]): void {
		if (!this.claimed || this.closed || this.activated) throw new Error("Native prefix startup is not awaiting activation");
		if (!Array.isArray(args) || args.length > 256 || args.some(arg => typeof arg !== "string" || arg.includes("\0"))
			|| Buffer.byteLength(JSON.stringify(args)) > 65536) throw new Error("Invalid native startup arguments");
		this.activated = true;
		this.releaseActivation([...args]);
	}

	/** Called only after the owning bridge has authenticated the child. */
	async accept(request: IncomingMessage, response: ServerResponse): Promise<void> {
		if (this.claimed || this.closed) { response.writeHead(409).end(); return; }
		this.claimed = true;
		const disconnected = () => this.dispose();
		request.once("aborted", disconnected);
		response.once("close", disconnected);
		this.acknowledgeOwnership(true);
		try {
			const args = await this.activation;
			if (this.closed || !args) { if (!response.destroyed) response.writeHead(409).end(); return; }
			response.setHeader("content-type", "application/json");
			response.writeHead(200).end(JSON.stringify(args));
		} finally {
			clearTimeout(this.timer);
			request.off("aborted", disconnected);
			response.off("close", disconnected);
		}
	}

	dispose(): void {
		this.closed = true;
		clearTimeout(this.timer);
		this.acknowledgeOwnership(false);
		this.releaseActivation(undefined);
	}
}

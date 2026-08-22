import { connect } from "node:net";

const RESERVED_PREVIEW_PORTS = new Set([
	2375,
	2376,
	3306,
	4788,
	4789,
	4808,
	4809,
	5432,
	6379,
	9200,
	9222,
	9223,
	27017,
]);

export function validatePreviewPort(port: number): number {
	if (!Number.isInteger(port) || port < 1024 || port > 65535) {
		throw new Error("Preview port must be an integer between 1024 and 65535");
	}
	if (RESERVED_PREVIEW_PORTS.has(port)) {
		throw new Error(`Port ${port} is reserved and cannot be exposed as a Pibo preview`);
	}
	return port;
}

export async function probePreviewTarget(
	port: number,
	options: { timeoutMs?: number } = {},
): Promise<{ host: "127.0.0.1" | "::1"; latencyMs: number } | undefined> {
	validatePreviewPort(port);
	for (const host of ["127.0.0.1", "::1"] as const) {
		const startedAt = performance.now();
		const reachable = await new Promise<boolean>((resolve) => {
			const socket = connect({ host, port });
			let settled = false;
			const finish = (value: boolean) => {
				if (settled) return;
				settled = true;
				socket.destroy();
				resolve(value);
			};
			socket.setTimeout(options.timeoutMs ?? 750);
			socket.once("connect", () => finish(true));
			socket.once("timeout", () => finish(false));
			socket.once("error", () => finish(false));
		});
		if (reachable) return { host, latencyMs: Math.max(0, Math.round(performance.now() - startedAt)) };
	}
	return undefined;
}

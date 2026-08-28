export type OpenAiResponseEventObserver = (event: unknown) => void;

export type OpenAiResponseTransportOptions = Record<string, unknown> & {
	fetch?: typeof globalThis.fetch;
};

export function withOpenAiResponseEventObserver(
	options: OpenAiResponseTransportOptions | undefined,
	observer: OpenAiResponseEventObserver,
): OpenAiResponseTransportOptions {
	const fetchImpl = options?.fetch ?? globalThis.fetch;
	return {
		...(options ?? {}),
		// Pi does not expose raw events from its shared Codex WebSocket transport.
		// SSE keeps observation request-scoped instead of replacing global constructors.
		transport: "sse",
		fetch: async (input, init) => observeOpenAiSseResponse(await fetchImpl(input, init), observer),
	};
}

export function observeOpenAiSseResponse(response: Response, observer: OpenAiResponseEventObserver): Response {
	if (!response.body || !response.headers.get("content-type")?.toLowerCase().includes("text/event-stream")) {
		return response;
	}

	const reader = response.body.getReader();
	const parser = new OpenAiSseParser(observer);
	let cancelled = false;
	const body = new ReadableStream<Uint8Array>({
		async pull(controller) {
			try {
				const chunk = await reader.read();
				if (cancelled) return;
				if (chunk.done) {
					parser.finish();
					reader.releaseLock();
					controller.close();
					return;
				}
				parser.push(chunk.value);
				controller.enqueue(chunk.value);
			} catch (error) {
				if (cancelled) return;
				reader.releaseLock();
				controller.error(error);
			}
		},
		async cancel(reason) {
			cancelled = true;
			try {
				await reader.cancel(reason);
			} finally {
				reader.releaseLock();
			}
		},
	}, { highWaterMark: 0 });

	return new Response(body, {
		status: response.status,
		statusText: response.statusText,
		headers: response.headers,
	});
}

class OpenAiSseParser {
	private readonly decoder = new TextDecoder();
	private buffer = "";

	constructor(private readonly observer: OpenAiResponseEventObserver) {}

	push(chunk: Uint8Array): void {
		this.buffer += this.decoder.decode(chunk, { stream: true });
		this.drain();
	}

	finish(): void {
		this.buffer += this.decoder.decode();
		this.drain(true);
	}

	private drain(final = false): void {
		this.buffer = this.buffer.replaceAll("\r\n", "\n");
		let separator = this.buffer.indexOf("\n\n");
		while (separator >= 0) {
			this.observeBlock(this.buffer.slice(0, separator));
			this.buffer = this.buffer.slice(separator + 2);
			separator = this.buffer.indexOf("\n\n");
		}
		if (final && this.buffer.trim()) {
			this.observeBlock(this.buffer);
			this.buffer = "";
		}
	}

	private observeBlock(block: string): void {
		const data = block
			.split("\n")
			.filter((line) => line.startsWith("data:"))
			.map((line) => line.slice(5).trim())
			.join("\n")
			.trim();
		if (data && data !== "[DONE]") observeJson(data, this.observer);
	}
}

function observeJson(value: string, observer: OpenAiResponseEventObserver): void {
	try {
		observer(JSON.parse(value));
	} catch {
		// Provider observation must never interfere with the provider stream.
	}
}

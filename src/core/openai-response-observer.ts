import { AsyncLocalStorage } from "node:async_hooks";

export type OpenAiResponseEventObserver = (event: unknown) => void;

const observerStorage = new AsyncLocalStorage<OpenAiResponseEventObserver>();
const socketObservers = new WeakMap<WebSocket, OpenAiResponseEventObserver>();
const observedSockets = new WeakSet<WebSocket>();
let fetchObserverInstalled = false;
let webSocketObserverInstalled = false;

export function withOpenAiResponseEventObserver<T>(observer: OpenAiResponseEventObserver, callback: () => T): T {
	installOpenAiResponseTransportObservers();
	return observerStorage.run(observer, callback);
}

export function observeOpenAiSseResponse(response: Response, observer: OpenAiResponseEventObserver): Response {
	if (!response.body || !response.headers.get("content-type")?.toLowerCase().includes("text/event-stream")) {
		return response;
	}

	const reader = response.body.getReader();
	const parser = new OpenAiSseParser(observer);
	const body = new ReadableStream<Uint8Array>({
		async pull(controller) {
			try {
				const chunk = await reader.read();
				if (chunk.done) {
					parser.finish();
					controller.close();
					return;
				}
				parser.push(chunk.value);
				controller.enqueue(chunk.value);
			} catch (error) {
				controller.error(error);
			}
		},
		async cancel(reason) {
			parser.finish();
			await reader.cancel(reason);
		},
	});

	return new Response(body, {
		status: response.status,
		statusText: response.statusText,
		headers: response.headers,
	});
}

export function observeOpenAiWebSocketPayload(data: unknown, observer: OpenAiResponseEventObserver): void {
	if (typeof data === "string") {
		observeJson(data, observer);
		return;
	}
	if (data instanceof ArrayBuffer) {
		observeJson(new TextDecoder().decode(new Uint8Array(data)), observer);
		return;
	}
	if (ArrayBuffer.isView(data)) {
		observeJson(new TextDecoder().decode(new Uint8Array(data.buffer, data.byteOffset, data.byteLength)), observer);
		return;
	}
	if (data && typeof data === "object" && "text" in data && typeof data.text === "function") {
		void Promise.resolve(data.text()).then((text) => {
			if (typeof text === "string") observeJson(text, observer);
		}).catch(() => {});
	}
}

function installOpenAiResponseTransportObservers(): void {
	installFetchObserver();
	installWebSocketObserver();
}

function installFetchObserver(): void {
	if (fetchObserverInstalled || typeof globalThis.fetch !== "function") return;
	fetchObserverInstalled = true;
	const fetchImpl = globalThis.fetch.bind(globalThis);
	globalThis.fetch = async (input, init) => {
		const observer = observerStorage.getStore();
		const response = await fetchImpl(input, init);
		return observer ? observeOpenAiSseResponse(response, observer) : response;
	};
}

function installWebSocketObserver(): void {
	if (webSocketObserverInstalled || typeof globalThis.WebSocket !== "function") return;
	webSocketObserverInstalled = true;
	const WebSocketImpl = globalThis.WebSocket;

	class ObservedWebSocket extends WebSocketImpl {
		override send(data: Parameters<WebSocket["send"]>[0]): void {
			const observer = observerStorage.getStore();
			if (observer) {
				socketObservers.set(this, observer);
				if (!observedSockets.has(this)) {
					observedSockets.add(this);
					this.addEventListener("message", (event) => {
						const activeObserver = socketObservers.get(this);
						if (activeObserver) observeOpenAiWebSocketPayload(event.data, activeObserver);
					});
				}
			} else {
				socketObservers.delete(this);
			}
			super.send(data);
		}
	}

	globalThis.WebSocket = ObservedWebSocket;
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
		// Provider telemetry must never interfere with the provider stream.
	}
}

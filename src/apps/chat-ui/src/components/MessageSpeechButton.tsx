import { useCallback, useEffect, useRef, useState, type MouseEvent } from "react";
import { LoaderCircle, Mic, Square } from "lucide-react";
import { speakChatSpeech, startChatSpeechSession, stopChatSpeechSession } from "../api-speech";

type SpeechButtonState = "idle" | "loading" | "playing" | "error";
type SpeechPlayback = {
	context: AudioContext;
	destination: MediaStreamAudioDestinationNode;
	inputSource?: AudioBufferSourceNode;
	outputSource?: MediaStreamAudioSourceNode;
	outputAnalyser?: AnalyserNode;
	outputTracks: Set<MediaStreamTrack>;
	monitor?: ReturnType<typeof setInterval>;
	timer?: ReturnType<typeof setTimeout>;
	triggered: boolean;
};

const ICE_GATHERING_TIMEOUT_MS = 2_000;
const CONTEXT_APPEND_DEBOUNCE_MS = 150;
const SPEECH_TRIGGER_DURATION_SECONDS = 1.2;
const OUTPUT_MONITOR_INTERVAL_MS = 50;
const OUTPUT_SILENCE_MS = 900;
const OUTPUT_ACTIVITY_RMS = 0.005;

async function waitForIceGathering(peer: RTCPeerConnection): Promise<void> {
	if (peer.iceGatheringState === "complete") return;
	await new Promise<void>((resolve) => {
		const finish = () => {
			clearTimeout(timer);
			peer.removeEventListener("icegatheringstatechange", handleStateChange);
			resolve();
		};
		const handleStateChange = () => {
			if (peer.iceGatheringState === "complete") finish();
		};
		const timer = setTimeout(finish, ICE_GATHERING_TIMEOUT_MS);
		peer.addEventListener("icegatheringstatechange", handleStateChange);
	});
}

function controlMessageType(value: unknown): string | undefined {
	if (typeof value !== "string") return undefined;
	try {
		const parsed = JSON.parse(value);
		return parsed && typeof parsed === "object" && typeof parsed.type === "string" ? parsed.type : undefined;
	} catch {
		return undefined;
	}
}

function playSpeechTrigger(playback: SpeechPlayback): void {
	const sampleRate = playback.context.sampleRate;
	const frameCount = Math.ceil(sampleRate * SPEECH_TRIGGER_DURATION_SECONDS);
	const fadeFrames = Math.max(1, Math.floor(sampleRate * 0.05));
	const buffer = playback.context.createBuffer(1, frameCount, sampleRate);
	const samples = buffer.getChannelData(0);
	for (let index = 0; index < samples.length; index += 1) {
		const envelope = Math.min(1, index / fadeFrames, (samples.length - index - 1) / fadeFrames);
		samples[index] = (Math.random() * 2 - 1) * 0.14 * Math.max(0, envelope);
	}
	const source = playback.context.createBufferSource();
	playback.inputSource = source;
	source.buffer = buffer;
	source.connect(playback.destination);
	source.addEventListener("ended", () => {
		if (playback.inputSource !== source) return;
		source.disconnect();
		playback.inputSource = undefined;
	}, { once: true });
	source.start();
}

export function MessageSpeechButton({
	text,
	scopeKey = "",
	className = "",
}: {
	text: string;
	scopeKey?: string;
	className?: string;
}) {
	const [state, setState] = useState<SpeechButtonState>("idle");
	const [error, setError] = useState<string | null>(null);
	const peerRef = useRef<RTCPeerConnection | null>(null);
	const playbackRef = useRef<SpeechPlayback | null>(null);
	const sessionIdRef = useRef<string | null>(null);
	const requestAbortRef = useRef<AbortController | null>(null);
	const requestIdRef = useRef(0);

	const disposePlayback = useCallback(() => {
		const peer = peerRef.current;
		peerRef.current = null;
		if (peer) {
			peer.ontrack = null;
			peer.onconnectionstatechange = null;
			peer.close();
		}

		const playback = playbackRef.current;
		playbackRef.current = null;
		if (!playback) return;
		if (playback.monitor) clearInterval(playback.monitor);
		if (playback.timer) clearTimeout(playback.timer);
		if (playback.inputSource) {
			try {
				playback.inputSource.stop();
			} catch {
				// The source may already have ended.
			}
			playback.inputSource.disconnect();
		}
		playback.outputSource?.disconnect();
		playback.outputAnalyser?.disconnect();
		for (const track of playback.outputTracks) track.stop();
		for (const track of playback.destination.stream.getTracks()) track.stop();
		void playback.context.close().catch(() => {});
	}, []);

	const stopRemoteSession = useCallback(() => {
		const sessionId = sessionIdRef.current;
		sessionIdRef.current = null;
		if (sessionId) void stopChatSpeechSession(sessionId).catch(() => {});
	}, []);

	const cancelCurrentRequest = useCallback(() => {
		requestAbortRef.current?.abort();
		requestAbortRef.current = null;
	}, []);

	const abandonCurrentPlayback = useCallback(() => {
		requestIdRef.current += 1;
		cancelCurrentRequest();
		disposePlayback();
		stopRemoteSession();
	}, [cancelCurrentRequest, disposePlayback, stopRemoteSession]);

	useEffect(() => {
		setError(null);
		setState("idle");
		return abandonCurrentPlayback;
	}, [abandonCurrentPlayback, scopeKey, text]);

	const fail = useCallback((requestId: number, caught: unknown) => {
		if (requestIdRef.current !== requestId) return;
		requestIdRef.current += 1;
		cancelCurrentRequest();
		disposePlayback();
		stopRemoteSession();
		setError(caught instanceof Error ? caught.message : String(caught));
		setState("error");
	}, [cancelCurrentRequest, disposePlayback, stopRemoteSession]);

	const handleClick = async (event: MouseEvent<HTMLButtonElement>) => {
		event.stopPropagation();
		if (state === "loading" || state === "playing") {
			abandonCurrentPlayback();
			setError(null);
			setState("idle");
			return;
		}

		const requestId = requestIdRef.current + 1;
		requestIdRef.current = requestId;
		cancelCurrentRequest();
		disposePlayback();
		stopRemoteSession();
		const requestAbort = new AbortController();
		requestAbortRef.current = requestAbort;
		setError(null);
		setState("loading");
		try {
			if (typeof RTCPeerConnection === "undefined" || typeof AudioContext === "undefined") {
				throw new Error("This browser does not support speech playback");
			}
			const peer = new RTCPeerConnection();
			peerRef.current = peer;
			const context = new AudioContext();
			const destination = context.createMediaStreamDestination();
			const playback: SpeechPlayback = {
				context,
				destination,
				outputTracks: new Set(),
				triggered: false,
			};
			playbackRef.current = playback;
			await context.resume();
			if (requestIdRef.current !== requestId) return;
			peer.onconnectionstatechange = () => {
				if (peer.connectionState === "failed") fail(requestId, new Error("Speech connection failed"));
			};
			peer.ontrack = (trackEvent) => {
				if (requestIdRef.current !== requestId) return;
				try {
					const stream = trackEvent.streams[0] ?? new MediaStream([trackEvent.track]);
					playback.outputTracks.add(trackEvent.track);
					const outputSource = context.createMediaStreamSource(stream);
					const outputAnalyser = context.createAnalyser();
					outputAnalyser.fftSize = 1024;
					outputSource.connect(outputAnalyser);
					outputAnalyser.connect(context.destination);
					playback.outputSource = outputSource;
					playback.outputAnalyser = outputAnalyser;
					const samples = new Float32Array(outputAnalyser.fftSize);
					let heardAudio = false;
					let lastAudioAt = 0;
					playback.monitor = setInterval(() => {
						if (requestIdRef.current !== requestId) return;
						outputAnalyser.getFloatTimeDomainData(samples);
						let sumOfSquares = 0;
						for (const sample of samples) sumOfSquares += sample * sample;
						const rms = Math.sqrt(sumOfSquares / samples.length);
						const now = performance.now();
						if (rms >= OUTPUT_ACTIVITY_RMS) {
							lastAudioAt = now;
							if (!heardAudio) {
								heardAudio = true;
								setState("playing");
							}
						} else if (heardAudio && now - lastAudioAt >= OUTPUT_SILENCE_MS) {
							requestIdRef.current += 1;
							cancelCurrentRequest();
							stopRemoteSession();
							disposePlayback();
							setState("idle");
						}
					}, OUTPUT_MONITOR_INTERVAL_MS);
					trackEvent.track.addEventListener("ended", () => {
						if (requestIdRef.current !== requestId) return;
						requestIdRef.current += 1;
						cancelCurrentRequest();
						stopRemoteSession();
						disposePlayback();
						setState("idle");
					}, { once: true });
				} catch (caught) {
					fail(requestId, caught);
				}
			};
			const triggerTrack = destination.stream.getAudioTracks()[0];
			if (!triggerTrack) throw new Error("Could not create a speech audio connection");
			peer.addTransceiver(triggerTrack, { direction: "sendrecv", streams: [destination.stream] });
			const controlChannel = peer.createDataChannel("oai-events");
			controlChannel.addEventListener("message", (controlEvent) => {
				if (requestIdRef.current !== requestId) return;
				const messageType = controlMessageType(controlEvent.data);
				if (messageType === "output_transcript.added") setState("playing");
				if (messageType !== "session.context.appended") return;
				const currentPlayback = playbackRef.current;
				if (currentPlayback !== playback || playback.triggered) return;
				if (playback.timer) clearTimeout(playback.timer);
				playback.timer = setTimeout(() => {
					if (requestIdRef.current !== requestId || playback.triggered) return;
					playback.triggered = true;
					try {
						playSpeechTrigger(playback);
					} catch (caught) {
						fail(requestId, caught);
					}
				}, CONTEXT_APPEND_DEBOUNCE_MS);
			});
			const offer = await peer.createOffer();
			if (requestIdRef.current !== requestId) return;
			await peer.setLocalDescription(offer);
			if (requestIdRef.current !== requestId) return;
			await waitForIceGathering(peer);
			if (requestIdRef.current !== requestId) return;
			const offerSdp = peer.localDescription?.sdp;
			if (!offerSdp) throw new Error("Could not create a speech audio connection");
			const session = await startChatSpeechSession(offerSdp, text, requestAbort.signal);
			if (requestIdRef.current !== requestId) {
				void stopChatSpeechSession(session.sessionId).catch(() => {});
				return;
			}
			sessionIdRef.current = session.sessionId;
			void speakChatSpeech(session.sessionId, text, requestAbort.signal)
				.then(() => {
					if (requestIdRef.current !== requestId) return;
					requestIdRef.current += 1;
					requestAbortRef.current = null;
					sessionIdRef.current = null;
					disposePlayback();
					setState("idle");
				})
				.catch((caught) => fail(requestId, caught));
			await peer.setRemoteDescription({ type: "answer", sdp: session.answerSdp });
		} catch (caught) {
			fail(requestId, caught);
		}
	};

	const label = state === "loading"
		? "Cancel message audio"
		: state === "playing"
			? "Stop message audio"
			: state === "error"
				? "Retry message audio"
				: "Read message aloud";

	return (
		<>
			<button
				type="button"
				onClick={(event) => void handleClick(event)}
				onDoubleClick={(event) => event.stopPropagation()}
				aria-label={label}
				aria-busy={state === "loading"}
				title={error ?? label}
				data-pibo-component="MessageSpeechButton"
				data-speech-state={state}
				className={`inline-flex h-5 w-5 shrink-0 items-center justify-center rounded-sm text-slate-500 transition-colors hover:bg-slate-700/60 hover:text-[#11a4d4] focus:outline-none focus:ring-1 focus:ring-[#11a4d4] ${state === "error" ? "text-red-400" : ""} ${className}`}
			>
				{state === "loading"
					? <LoaderCircle size={12} className="animate-spin" aria-hidden="true" />
					: state === "playing"
						? <Square size={10} fill="currentColor" aria-hidden="true" />
						: <Mic size={12} aria-hidden="true" />}
			</button>
			{error ? <span className="sr-only" role="alert">{error}</span> : null}
		</>
	);
}

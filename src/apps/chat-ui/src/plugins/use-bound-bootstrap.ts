import { useEffect, useState } from "react";
import { getBootstrap } from "../api-chat-sessions";
import type { BootstrapData } from "../types";
import type { PluginViewProps } from "./browser-host";

export function useBoundBootstrap(props: PluginViewProps) {
	const [bootstrap, setBootstrap] = useState<BootstrapData | null>(null);
	const [error, setError] = useState<string | null>(null);
	useEffect(() => {
		void getBootstrap(props.piboSessionId, false, props.roomId, false, { signal: props.signal })
			.then((data) => { if (!props.signal.aborted) setBootstrap(data); })
			.catch((caught) => { if (!props.signal.aborted) setError(String(caught)); });
	}, [props.piboSessionId, props.roomId, props.signal]);
	return { bootstrap, error };
}

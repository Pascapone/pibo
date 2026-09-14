import { LoopArea } from "../LoopArea";
import type { PluginViewProps } from "./browser-host";
import { useBoundBootstrap } from "./use-bound-bootstrap";

export function LoopsView(props: PluginViewProps) {
	const { bootstrap, error } = useBoundBootstrap(props);
	return bootstrap ? <LoopArea bootstrap={bootstrap} surface="tab" /> : <p role={error ? "alert" : "status"}>{error ?? "Loading loops…"}</p>;
}

import { CronArea } from "../CronArea";
import type { PluginViewProps } from "./browser-host";
import { useBoundBootstrap } from "./use-bound-bootstrap";

export function CronView(props: PluginViewProps) {
	const { bootstrap, error } = useBoundBootstrap(props);
	return bootstrap ? <CronArea bootstrap={bootstrap} surface="tab" /> : <p role={error ? "alert" : "status"}>{error ?? "Loading cron…"}</p>;
}

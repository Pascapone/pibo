import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { getSessionStatus } from "../api-chat-sessions";
import { RuntimeRequestPanel } from "../runtime-request-panel";
import type { PiboRuntimeStatus } from "../types";
import type { PluginViewProps } from "./browser-host";

export function RuntimeRequestsView(props: PluginViewProps) {
	const [actionError, setActionError] = useState<string | null>(null);
	const status = useQuery({
		queryKey: ["chat", "runtime-requests", props.piboSessionId],
		queryFn: () => getSessionStatus(props.piboSessionId, { activate: false }) as Promise<PiboRuntimeStatus>,
		refetchInterval: 1_000,
	});
	const approvals = status.data?.pendingApprovals ?? [];
	const userInputs = status.data?.pendingUserInputs ?? [];
	if (status.isPending) return <RuntimeRequestMessage label="Loading runtime requests…" />;
	if (status.isError) return <RuntimeRequestMessage label={status.error instanceof Error ? status.error.message : String(status.error)} tone="error" />;
	if (!approvals.length && !userInputs.length) return <RuntimeRequestMessage label="No pending runtime requests for this Pibo Session." />;
	return <div className="h-full overflow-auto bg-[#101d22] p-3">
		{actionError ? <div role="alert" className="mb-3 text-sm text-rose-300">{actionError}</div> : null}
		<RuntimeRequestPanel
			piboSessionId={props.piboSessionId}
			approvals={approvals}
			userInputs={userInputs}
			onResolved={() => { setActionError(null); void status.refetch(); }}
			onError={setActionError}
		/>
	</div>;
}

function RuntimeRequestMessage({ label, tone = "muted" }: { label: string; tone?: "muted" | "error" }) {
	return <div className={`grid h-full place-items-center p-6 text-center text-sm ${tone === "error" ? "text-rose-300" : "text-slate-500"}`}>{label}</div>;
}

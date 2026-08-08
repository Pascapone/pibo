import React from "react";
import { Clock3 } from "lucide-react";
import type { ChatMessageDelivery } from "../api-chat-sessions";

export function PendingUserMessageDelivery({
	delivery,
	className = "",
}: {
	delivery: ChatMessageDelivery;
	className?: string;
}) {
	const steering = delivery === "steer";
	return (
		<div
			className={`flex items-start gap-3 rounded-sm border px-3 py-2.5 ${
				steering
					? "border-amber-500/40 bg-amber-500/10"
					: "border-[#11a4d4]/40 bg-[#11a4d4]/10"
			} ${className}`}
			data-pibo-debug={`pending-user-message-${delivery}`}
			aria-live="polite"
		>
			<Clock3
				size={15}
				className={`mt-0.5 shrink-0 animate-pulse ${steering ? "text-amber-400" : "text-[#11a4d4]"}`}
			/>
			<div className="min-w-0">
				<div className={`text-[11px] font-bold uppercase tracking-wider ${steering ? "text-amber-400" : "text-[#11a4d4]"}`}>
					{steering ? "Steering pending" : "Queued for next turn"}
				</div>
				<div className="mt-0.5 text-xs leading-5 text-slate-400">
					{steering ? "Waiting for the next tool call boundary." : "Waiting for the active turn to finish."}
				</div>
			</div>
		</div>
	);
}

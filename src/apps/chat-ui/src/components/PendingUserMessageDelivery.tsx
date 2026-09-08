import type { PiboTraceNode } from "../../../../shared/trace-types.js";
import React from "react";
import { Clock3 } from "lucide-react";
import type { ChatMessageDelivery } from "../api-chat-sessions";

export function PendingUserMessageDelivery({
	delivery,
	state,
	className = "",
}: {
	delivery: ChatMessageDelivery;
	state?: PiboTraceNode["messageDeliveryState"];
	className?: string;
}) {
	if (state === "completed") return null;
	const steering = delivery === "steer";
	const labels = {
		sending: ["Sending message", "Waiting for durable confirmation."],
		accepted: ["Message accepted", "Saved and waiting for dispatch."],
		waiting_slot: ["Waiting for runtime slot", "Your message is saved."],
		initializing: ["Starting runtime", "Your message is saved while the runtime starts."],
		session_queue: ["Queued for next turn", "Waiting for the active turn to finish."],
		running: ["Processing message", "The runtime has started this message."],
		failed: ["Message failed", "The accepted message could not complete. Inspect the session error."],
		interrupted: ["Execution needs checking", "The message is saved; its execution outcome is unclear. Inspect the session before retrying."],
	};
	const label = state ? labels[state] : steering ? ["Steering pending", "Waiting for the next tool call boundary."] : ["Sending message", "Waiting for durable confirmation."];
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
					{label[0]}
				</div>
				<div className="mt-0.5 text-xs leading-5 text-slate-400">
					{label[1]}
				</div>
			</div>
		</div>
	);
}

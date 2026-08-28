import type { MouseEvent } from "react";
import { GitBranch } from "lucide-react";

export function MessageForkButton({ entryId, onFork, className = "" }: {
	entryId: string;
	onFork(entryId: string): void;
	className?: string;
}) {
	const stopPropagation = (event: MouseEvent<HTMLButtonElement>) => event.stopPropagation();
	return (
		<button
			type="button"
			onClick={(event) => {
				stopPropagation(event);
				onFork(entryId);
			}}
			onDoubleClick={stopPropagation}
			aria-label="Fork from this user message"
			title="Fork from this user message"
			data-pibo-component="MessageForkButton"
			className={`inline-flex h-5 w-5 shrink-0 items-center justify-center rounded-sm text-slate-500 transition-colors hover:bg-slate-700/60 hover:text-[#11a4d4] focus:outline-none focus:ring-1 focus:ring-[#11a4d4] ${className}`}
		>
			<GitBranch size={12} />
		</button>
	);
}

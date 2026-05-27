import { BookOpenText, Brain, Bug, Layers, Server, Wrench } from "lucide-react";
import type { ContextPanel } from "./types";

export function ContextSidebar({
	activePanel,
	onSelect,
	toolCount,
	mcpServerCount,
}: {
	activePanel: ContextPanel;
	onSelect: (panel: ContextPanel) => void;
	toolCount: number;
	mcpServerCount: number;
}) {
	return (
		<div className="p-2">
			<div className="mb-4">
				<div className="px-1 pb-1 text-[10px] font-bold uppercase tracking-wider text-slate-500">Context</div>
				<button
					type="button"
					onClick={() => onSelect("context-files")}
					className={`mb-1 flex w-full items-center gap-2 border p-2 text-left ${
						activePanel === "context-files"
							? "border-[#11a4d4] bg-[#11a4d4]/10"
							: "border-slate-800 bg-[#151f24] hover:border-slate-700"
					}`}
				>
					<Layers size={13} className="text-[#11a4d4]" />
					<div className="min-w-0">
						<span className="block truncate text-sm text-slate-200">Context Files</span>
						<span className="block truncate font-mono text-[10px] text-slate-500">managed-editor</span>
					</div>
				</button>
				<button
					type="button"
					onClick={() => onSelect("base-prompt")}
					className={`mb-1 flex w-full items-center gap-2 border p-2 text-left ${
						activePanel === "base-prompt"
							? "border-[#11a4d4] bg-[#11a4d4]/10"
							: "border-slate-800 bg-[#151f24] hover:border-slate-700"
					}`}
				>
					<BookOpenText size={13} className="text-[#11a4d4]" />
					<div className="min-w-0">
						<span className="block truncate text-sm text-slate-200">Base Prompt</span>
						<span className="block truncate font-mono text-[10px] text-slate-500">system-prompt</span>
					</div>
				</button>
				<button
					type="button"
					onClick={() => onSelect("compaction-prompt")}
					className={`mb-1 flex w-full items-center gap-2 border p-2 text-left ${
						activePanel === "compaction-prompt"
							? "border-[#11a4d4] bg-[#11a4d4]/10"
							: "border-slate-800 bg-[#151f24] hover:border-slate-700"
					}`}
				>
					<Brain size={13} className="text-[#11a4d4]" />
					<div className="min-w-0">
						<span className="block truncate text-sm text-slate-200">Compaction Prompt</span>
						<span className="block truncate font-mono text-[10px] text-slate-500">summary-prompt</span>
					</div>
				</button>
				<button
					type="button"
					onClick={() => onSelect("pibo-tools")}
					className={`mb-1 flex w-full items-center gap-2 border p-2 text-left ${
						activePanel === "pibo-tools"
							? "border-[#11a4d4] bg-[#11a4d4]/10"
							: "border-slate-800 bg-[#151f24] hover:border-slate-700"
					}`}
				>
					<Wrench size={13} className="text-[#11a4d4]" />
					<div className="min-w-0 flex-1">
						<span className="block truncate text-sm text-slate-200">Pibo Tools</span>
						<span className="block truncate font-mono text-[10px] text-slate-500">installed-tool-context</span>
					</div>
					<span className="inline-flex min-w-6 items-center justify-center border border-slate-700 bg-[#101d22] px-1.5 py-0.5 text-[10px] font-mono text-slate-400">
						{toolCount}
					</span>
				</button>
				<button
					type="button"
					onClick={() => onSelect("mcp-tools")}
					className={`mb-1 flex w-full items-center gap-2 border p-2 text-left ${
						activePanel === "mcp-tools"
							? "border-[#11a4d4] bg-[#11a4d4]/10"
							: "border-slate-800 bg-[#151f24] hover:border-slate-700"
					}`}
				>
					<Server size={13} className="text-[#11a4d4]" />
					<div className="min-w-0 flex-1">
						<span className="block truncate text-sm text-slate-200">MCP Tools</span>
						<span className="block truncate font-mono text-[10px] text-slate-500">mcp-context</span>
					</div>
					<span className="inline-flex min-w-6 items-center justify-center border border-slate-700 bg-[#101d22] px-1.5 py-0.5 text-[10px] font-mono text-slate-400">
						{mcpServerCount}
					</span>
				</button>
				<button
					type="button"
					onClick={() => onSelect("build-context")}
					className={`flex w-full items-center gap-2 border p-2 text-left ${
						activePanel === "build-context"
							? "border-[#11a4d4] bg-[#11a4d4]/10"
							: "border-slate-800 bg-[#151f24] hover:border-slate-700"
					}`}
				>
					<Bug size={13} className="text-[#11a4d4]" />
					<div className="min-w-0">
						<span className="block truncate text-sm text-slate-200">Build Context</span>
						<span className="block truncate font-mono text-[10px] text-slate-500">runtime-snapshot</span>
					</div>
				</button>
			</div>
		</div>
	);
}

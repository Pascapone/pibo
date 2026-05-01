import { useCallback, useState } from "react";
import JsonView from "@uiw/react-json-view";
import { vscodeTheme } from "@uiw/react-json-view/vscode";
import { ChevronsDownUp, ChevronsUpDown } from "lucide-react";

type JsonRendererProps = {
	value: unknown;
	defaultExpandLevel?: number;
	className?: string;
	maxHeight?: string;
	showControls?: boolean;
};

export function JsonRenderer({
	value,
	defaultExpandLevel = 1,
	className = "",
	maxHeight = "24rem",
	showControls = true,
}: JsonRendererProps) {
	const parsed = tryParseJson(value);
	const [collapsed, setCollapsed] = useState<number | false>(defaultExpandLevel);
	const [signal, setSignal] = useState(0);

	const handleExpandAll = useCallback(() => {
		setCollapsed(false);
		setSignal((current) => current + 1);
	}, []);

	const handleCollapseAll = useCallback(() => {
		setCollapsed(defaultExpandLevel);
		setSignal((current) => current + 1);
	}, [defaultExpandLevel]);

	if (!parsed) {
		return (
			<pre className={`max-w-full overflow-auto whitespace-pre-wrap break-words font-mono text-xs text-slate-300 ${className}`} style={{ maxHeight }}>
				{typeof value === "string" ? value : JSON.stringify(value, null, 2)}
			</pre>
		);
	}

	return (
		<div className={`min-w-0 max-w-full ${className}`}>
			{showControls ? (
				<div className="flex items-center gap-1 mb-1">
					<button
						type="button"
						onClick={handleExpandAll}
						className="flex items-center gap-1 px-1.5 py-0.5 text-[10px] font-medium text-slate-400 hover:text-slate-200 bg-slate-800/50 hover:bg-slate-700/60 rounded-sm transition-colors"
					>
						<ChevronsUpDown size={10} />
						Expand
					</button>
					<button
						type="button"
						onClick={handleCollapseAll}
						className="flex items-center gap-1 px-1.5 py-0.5 text-[10px] font-medium text-slate-400 hover:text-slate-200 bg-slate-800/50 hover:bg-slate-700/60 rounded-sm transition-colors"
					>
						<ChevronsDownUp size={10} />
						Collapse
					</button>
				</div>
			) : null}
			<div className="min-w-0 max-w-full overflow-auto rounded-sm text-xs" style={{ maxHeight }}>
				<JsonView
					key={signal}
					value={parsed}
					style={{
						...vscodeTheme,
						background: "transparent",
						fontSize: "12px",
						fontFamily: "ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace",
					}}
					collapsed={collapsed}
					displayDataTypes={false}
					displayObjectSize={false}
					enableClipboard
					shortenTextAfterLength={120}
				/>
			</div>
		</div>
	);
}

function tryParseJson(value: unknown): object | null {
	if (value !== null && typeof value === "object") return value;
	if (typeof value !== "string") return null;
	const trimmed = value.trim();
	if (!trimmed.startsWith("{") && !trimmed.startsWith("[")) return null;
	try {
		const parsed = JSON.parse(trimmed) as unknown;
		return parsed !== null && typeof parsed === "object" ? parsed : null;
	} catch {
		return null;
	}
}

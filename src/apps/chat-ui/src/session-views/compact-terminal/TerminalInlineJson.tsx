import { useState } from "react";

type TerminalFunctionCallProps = {
	name: string;
	input?: unknown;
};

export function TerminalFunctionCall({ name, input }: TerminalFunctionCallProps) {
	return (
		<span className="compact-terminal-function-call">
			<span className="text-[#facc15] font-semibold">{name}</span>
			<span className="text-[#d4d4d4]">(</span>
			{input !== undefined ? <TerminalInlineJson value={input} /> : null}
			<span className="text-[#d4d4d4]">)</span>
		</span>
	);
}

function TerminalInlineJson({ value }: { value: unknown }) {
	const [expandedPaths, setExpandedPaths] = useState<Set<string>>(() => new Set(["$"]));
	const [expandedStrings, setExpandedStrings] = useState<Set<string>>(() => new Set());

	const togglePath = (path: string) => {
		setExpandedPaths((current) => {
			const next = new Set(current);
			if (next.has(path)) next.delete(path);
			else next.add(path);
			return next;
		});
	};

	const toggleString = (path: string) => {
		setExpandedStrings((current) => {
			const next = new Set(current);
			if (next.has(path)) next.delete(path);
			else next.add(path);
			return next;
		});
	};

	return (
		<InlineJsonValue
			value={value}
			path="$"
			expandedPaths={expandedPaths}
			expandedStrings={expandedStrings}
			onTogglePath={togglePath}
			onToggleString={toggleString}
		/>
	);
}

type InlineJsonValueProps = {
	value: unknown;
	path: string;
	expandedPaths: Set<string>;
	expandedStrings: Set<string>;
	onTogglePath: (path: string) => void;
	onToggleString: (path: string) => void;
};

function InlineJsonValue({
	value,
	path,
	expandedPaths,
	expandedStrings,
	onTogglePath,
	onToggleString,
}: InlineJsonValueProps) {
	if (Array.isArray(value)) {
		return (
			<InlineCollection
				value={value}
				path={path}
				open="["
				close="]"
				expandedPaths={expandedPaths}
				expandedStrings={expandedStrings}
				onTogglePath={onTogglePath}
				onToggleString={onToggleString}
			/>
		);
	}

	if (isRecord(value)) {
		return (
			<InlineCollection
				value={value}
				path={path}
				open="{"
				close="}"
				expandedPaths={expandedPaths}
				expandedStrings={expandedStrings}
				onTogglePath={onTogglePath}
				onToggleString={onToggleString}
			/>
		);
	}

	if (typeof value === "string") {
		const expanded = expandedStrings.has(path);
		const shortened = value.length > 140 && !expanded;
		const text = shortened ? `${value.slice(0, 140)}...` : value;
		const rendered = <span className="text-[#fb923c]">{JSON.stringify(text)}</span>;
		if (!shortened && value.length <= 140) return rendered;
		return (
			<button
				type="button"
				onClick={(event) => {
					event.stopPropagation();
					onToggleString(path);
				}}
				className="compact-terminal-json-toggle text-left align-baseline"
				title={expanded ? "Collapse string" : "Expand string"}
			>
				{rendered}
			</button>
		);
	}

	if (typeof value === "number" || typeof value === "boolean" || value === null) {
		return <span className="text-[#60a5fa]">{String(value)}</span>;
	}

	return <span className="text-[#737373]">{JSON.stringify(String(value))}</span>;
}

type InlineCollectionProps = {
	value: Record<string, unknown> | unknown[];
	path: string;
	open: "{" | "[";
	close: "}" | "]";
	expandedPaths: Set<string>;
	expandedStrings: Set<string>;
	onTogglePath: (path: string) => void;
	onToggleString: (path: string) => void;
};

function InlineCollection({
	value,
	path,
	open,
	close,
	expandedPaths,
	expandedStrings,
	onTogglePath,
	onToggleString,
}: InlineCollectionProps) {
	const entries = Array.isArray(value) ? value.map((entry, index) => [String(index), entry] as const) : Object.entries(value);
	const expanded = expandedPaths.has(path);
	if (!expanded) {
		return (
			<button
				type="button"
				onClick={(event) => {
					event.stopPropagation();
					onTogglePath(path);
				}}
				className="compact-terminal-json-toggle align-baseline text-[#737373]"
				title="Expand JSON"
				aria-label={`Expand JSON at ${path}`}
				data-inline-json-path={path}
			>
				<span className="compact-terminal-json-caret">▸</span>
				{open}...{close}
			</button>
		);
	}

	return (
		<span>
			<button
				type="button"
				onClick={(event) => {
					event.stopPropagation();
					onTogglePath(path);
				}}
				className="compact-terminal-json-toggle align-baseline text-[#737373]"
				title="Collapse JSON"
				aria-label={`Collapse JSON at ${path}`}
				data-inline-json-path={path}
			>
				<span className="compact-terminal-json-caret">▾</span>
				{open}
			</button>
			{entries.map(([key, entry], index) => {
				const childPath = `${path}.${escapePathKey(key)}`;
				return (
					<span key={childPath}>
						{index > 0 ? <span className="text-[#737373]">, </span> : null}
						{Array.isArray(value) ? null : (
							<>
								<span className="text-[#d4d4d4]">{JSON.stringify(key)}</span>
								<span className="text-[#737373]">:</span>
							</>
						)}
						<InlineJsonValue
							value={entry}
							path={childPath}
							expandedPaths={expandedPaths}
							expandedStrings={expandedStrings}
							onTogglePath={onTogglePath}
							onToggleString={onToggleString}
						/>
					</span>
				);
			})}
			<span className="text-[#737373]">{close}</span>
		</span>
	);
}

function escapePathKey(value: string): string {
	return value.replaceAll("\\", "\\\\").replaceAll(".", "\\.");
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

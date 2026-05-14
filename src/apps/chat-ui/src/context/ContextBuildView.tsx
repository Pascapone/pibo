import { useCallback, useEffect, useMemo, useState, type ReactNode } from "react";
import {
	AlertTriangle,
	Braces,
	CheckCircle2,
	ChevronDown,
	ChevronRight,
	ChevronsDown,
	ChevronsUp,
	Copy,
	FileText,
	Loader2,
	RefreshCw,
	ShieldCheck,
	Wrench,
} from "lucide-react";
import { getContextBuild, type ContextBuildNode, type ContextBuildSnapshot } from "../api";
import { JsonRenderer } from "../tracing/JsonRenderer";

type ContextBuildViewProps = {
	piboSessionId?: string | null;
};

export function ContextBuildView({ piboSessionId }: ContextBuildViewProps) {
	const [snapshot, setSnapshot] = useState<ContextBuildSnapshot | null>(null);
	const [expanded, setExpanded] = useState<Set<string>>(() => new Set());
	const [loading, setLoading] = useState(false);
	const [error, setError] = useState<string | null>(null);
	const [copiedNodeId, setCopiedNodeId] = useState<string | null>(null);

	const load = useCallback(async () => {
		if (!piboSessionId) {
			setSnapshot(null);
			setExpanded(new Set());
			setError(null);
			setLoading(false);
			return;
		}
		setLoading(true);
		try {
			const next = await getContextBuild({ piboSessionId });
			setSnapshot(next);
			setExpanded(new Set());
			setError(null);
		} catch (caught) {
			setError(caught instanceof Error ? caught.message : String(caught));
		} finally {
			setLoading(false);
		}
	}, [piboSessionId]);

	useEffect(() => {
		void load();
	}, [load]);

	const allNodeIds = useMemo(() => snapshot ? collectNodeIds(snapshot.nodes) : [], [snapshot]);
	const expandAll = () => setExpanded(new Set(allNodeIds));
	const collapseAll = () => setExpanded(new Set());
	const toggleNode = (id: string) => {
		setExpanded((current) => {
			const next = new Set(current);
			if (next.has(id)) next.delete(id);
			else next.add(id);
			return next;
		});
	};
	const copyNode = async (node: ContextBuildNode) => {
		await navigator.clipboard.writeText(renderNodeForCopy(node));
		setCopiedNodeId(node.id);
		window.setTimeout(() => setCopiedNodeId((current) => current === node.id ? null : current), 1200);
	};

	return (
		<div className="flex h-full min-h-0 flex-col bg-[#101d22]">
			<div className="flex min-h-14 flex-wrap items-center justify-between gap-3 border-b border-slate-800 bg-[#151f24] px-4 py-3">
				<div className="min-w-0">
					<div className="text-[10px] font-bold uppercase tracking-[0.14em] text-[#11a4d4]">Context</div>
					<h2 className="truncate text-base font-semibold text-slate-100">Build Context</h2>
					<div className="truncate font-mono text-[11px] text-slate-500">
						{snapshot
							? `${snapshot.profileName} · ${snapshot.piboSessionId ?? "session"} · ${snapshot.generatedAt}`
							: piboSessionId ? `session ${piboSessionId}` : "no session selected"}
					</div>
				</div>
				<div className="flex flex-wrap items-center gap-2 max-[640px]:w-full">
					{snapshot ? <SummaryPill snapshot={snapshot} /> : null}
					<HeaderButton label="Refresh" disabled={loading || !piboSessionId} onClick={() => void load()}><RefreshCw size={14} className={loading ? "animate-spin" : undefined} /></HeaderButton>
					<HeaderButton label="Expand all" disabled={!snapshot} onClick={expandAll}><ChevronsDown size={14} /></HeaderButton>
					<HeaderButton label="Collapse all" disabled={!snapshot} onClick={collapseAll}><ChevronsUp size={14} /></HeaderButton>
				</div>
			</div>

			<div className="min-h-0 flex-1 overflow-auto p-4">
				{!piboSessionId ? (
					<div className="grid gap-3 border border-dashed border-slate-700 bg-[#151f24] px-4 py-5 text-sm text-slate-400">
						<div className="flex items-center gap-2 font-semibold text-slate-200"><AlertTriangle size={16} className="text-[#f59e0b]" /> No session selected</div>
						<div>Select <span className="font-mono text-slate-200">View Context</span> from a session action menu to inspect that session's agent, workspace, and runtime context.</div>
					</div>
				) : loading && !snapshot ? (
					<div className="flex items-center gap-2 border border-slate-800 bg-[#151f24] px-4 py-5 text-sm text-slate-400">
						<Loader2 size={16} className="animate-spin text-[#11a4d4]" /> Loading build context snapshot
					</div>
				) : error ? (
					<div className="grid gap-3 border border-red-500/60 bg-red-500/10 px-4 py-4 text-sm text-red-100">
						<div className="flex items-center gap-2 font-semibold"><AlertTriangle size={16} /> Build Context failed</div>
						<div className="font-mono text-xs text-red-200/90">{error}</div>
						<button type="button" onClick={() => void load()} className="w-fit border border-red-400/70 px-3 py-1.5 text-xs text-red-100 hover:bg-red-500/10">Retry</button>
					</div>
				) : snapshot ? (
					<div className="grid gap-3">
						<div className="border border-slate-800 bg-[#151f24] px-4 py-3 text-sm text-slate-400">
							Read-only startup context snapshot. Expand the tree to inspect each contribution; no duplicate final prompt block is rendered.
						</div>
						<div className="grid min-w-0 gap-2">
							{snapshot.nodes.map((node) => (
								<ContextBuildNodeCard
									key={node.id}
									node={node}
									depth={0}
									expanded={expanded}
									copiedNodeId={copiedNodeId}
									onToggle={toggleNode}
									onCopy={(copyTarget) => void copyNode(copyTarget)}
								/>
							))}
						</div>
					</div>
				) : (
					<div className="border border-dashed border-slate-700 bg-[#151f24] px-4 py-5 text-sm text-slate-500">No snapshot loaded.</div>
				)}
			</div>
		</div>
	);
}

function HeaderButton({ label, disabled, onClick, children }: { label: string; disabled?: boolean; onClick: () => void; children: ReactNode }) {
	return (
		<button
			type="button"
			disabled={disabled}
			onClick={onClick}
			title={label}
			aria-label={label}
			className="inline-flex h-8 items-center gap-1.5 border border-slate-700 bg-[#101d22] px-2.5 text-xs text-slate-300 hover:border-[#11a4d4] hover:text-[#11a4d4] disabled:opacity-50"
		>
			{children}<span className="max-[640px]:hidden">{label}</span>
		</button>
	);
}

function SummaryPill({ snapshot }: { snapshot: ContextBuildSnapshot }) {
	const hasIssues = snapshot.summary.errors > 0 || snapshot.summary.warnings > 0;
	return (
		<span className={`inline-flex h-8 items-center gap-1.5 border px-2.5 text-xs ${hasIssues ? "border-[#f59e0b]/60 bg-[#f59e0b]/10 text-amber-100" : "border-slate-700 bg-[#101d22] text-slate-300"}`}>
			{hasIssues ? <AlertTriangle size={14} /> : <CheckCircle2 size={14} className="text-[#0bda57]" />}
			<span className="font-mono">{snapshot.summary.totalNodes} nodes · {snapshot.summary.warnings}w · {snapshot.summary.errors}e</span>
		</span>
	);
}

function ContextBuildNodeCard({
	node,
	depth,
	expanded,
	copiedNodeId,
	onToggle,
	onCopy,
}: {
	node: ContextBuildNode;
	depth: number;
	expanded: Set<string>;
	copiedNodeId: string | null;
	onToggle: (id: string) => void;
	onCopy: (node: ContextBuildNode) => void;
}) {
	const isOpen = expanded.has(node.id);
	const hasChildren = Boolean(node.children?.length);
	const hasContent = Boolean(node.hydratedText || node.schemaJson !== undefined || node.payloadJson !== undefined || node.notes?.length);
	const canExpand = hasChildren || hasContent;
	return (
		<section className={`${borderForNode(node)} bg-[#1a262b]`} style={{ marginLeft: depth ? Math.min(depth * 12, 72) : 0 }}>
			<div className="grid w-full grid-cols-[minmax(0,1fr)_auto] items-center gap-2 border-b border-slate-800 bg-[#151f24] px-3 py-2">
				<button
					type="button"
					disabled={!canExpand}
					onClick={() => canExpand && onToggle(node.id)}
					className="grid min-w-0 grid-cols-[18px_minmax(0,1fr)] items-center gap-2 text-left disabled:cursor-default"
				>
					<span className="text-slate-500">{canExpand ? (isOpen ? <ChevronDown size={15} /> : <ChevronRight size={15} />) : <span className="block h-3 w-3" />}</span>
					<div className="min-w-0">
						<div className="flex min-w-0 flex-wrap items-center gap-1.5">
							<NodeIcon node={node} />
							<span className="font-mono text-[10px] text-slate-500">#{node.order + 1}</span>
							<span className="truncate text-xs font-bold uppercase tracking-[0.12em] text-slate-200">{node.title}</span>
							<NodeBadges node={node} />
						</div>
						<div className="mt-1 flex min-w-0 flex-wrap items-center gap-x-2 gap-y-0.5 font-mono text-[10px] text-slate-500">
							<span>{node.source}</span>
							{node.state ? <span>{node.state}</span> : null}
							{node.path ? <span className="max-w-[420px] truncate max-[640px]:max-w-[220px]">{node.path}</span> : null}
							{node.key ? <span>{node.key}</span> : null}
							{node.provider ? <span>{node.provider}</span> : null}
							{node.bytes !== undefined ? <span>{formatBytes(node.bytes)}</span> : null}
							{hasChildren ? <span>{node.children!.length} children</span> : null}
						</div>
					</div>
				</button>
				<div className="flex items-center gap-1">
					{node.redacted ? <ShieldCheck size={14} className="text-[#0bda57]" aria-label="Redacted" /> : null}
					<button
						type="button"
						title="Copy section"
						aria-label="Copy section"
						onClick={() => onCopy(node)}
						className="inline-flex h-7 w-7 items-center justify-center border border-slate-700 bg-[#101d22] text-slate-400 hover:border-[#11a4d4] hover:text-[#11a4d4]"
					>
						{copiedNodeId === node.id ? <CheckCircle2 size={13} className="text-[#0bda57]" /> : <Copy size={13} />}
					</button>
				</div>
			</div>
			{isOpen ? (
				<div className="grid gap-2 border-t border-slate-900/60 bg-[#101d22]/35 p-2">
					{node.metadata && Object.keys(node.metadata).length ? <MetadataGrid metadata={node.metadata} /> : null}
					{node.notes?.length ? <Notes notes={node.notes} approximate={node.approximate} /> : null}
					<ContextBuildContent node={node} />
					{node.children?.length ? (
						<div className="grid gap-2 border-l border-slate-700/70 pl-2">
							{node.children.map((child) => (
								<ContextBuildNodeCard key={child.id} node={child} depth={depth + 1} expanded={expanded} copiedNodeId={copiedNodeId} onToggle={onToggle} onCopy={onCopy} />
							))}
						</div>
					) : null}
				</div>
			) : null}
		</section>
	);
}

function ContextBuildContent({ node }: { node: ContextBuildNode }) {
	return (
		<>
			{node.hydratedText ? <pre className="max-h-[48vh] overflow-auto whitespace-pre-wrap break-words border border-slate-800 bg-[#0e1116] p-3 font-mono text-[12px] leading-relaxed text-slate-200">{node.hydratedText}</pre> : null}
			{node.schemaJson !== undefined ? <JsonBlock title="Schema" value={node.schemaJson} /> : null}
			{node.payloadJson !== undefined ? <JsonBlock title="Provider Payload" value={node.payloadJson} /> : null}
		</>
	);
}

function JsonBlock({ title, value }: { title: string; value: unknown }) {
	return (
		<div className="border border-slate-800 bg-[#0e1116]">
			<div className="flex items-center gap-1.5 border-b border-slate-800 px-3 py-2 text-[10px] font-bold uppercase tracking-[0.12em] text-slate-400"><Braces size={13} />{title}</div>
			<JsonRenderer value={value} defaultExpandLevel={1} showControls={false} maxHeight="48vh" className="text-xs" />
		</div>
	);
}

function MetadataGrid({ metadata }: { metadata: Record<string, unknown> }) {
	return (
		<div className="grid gap-1 border border-slate-800 bg-[#151f24] p-2 sm:grid-cols-2 xl:grid-cols-3">
			{Object.entries(metadata).map(([key, value]) => (
				<div key={key} className="min-w-0 font-mono text-[10px] text-slate-500">
					<span className="text-slate-400">{key}</span>: <span className="break-all text-slate-300">{formatValue(value)}</span>
				</div>
			))}
		</div>
	);
}

function Notes({ notes, approximate }: { notes: string[]; approximate?: boolean }) {
	return (
		<div className={`border px-3 py-2 text-xs ${approximate ? "border-[#f59e0b]/50 bg-[#f59e0b]/10 text-amber-100" : "border-slate-800 bg-[#151f24] text-slate-400"}`}>
			{notes.map((note, index) => <div key={index}>{note}</div>)}
		</div>
	);
}

function NodeIcon({ node }: { node: ContextBuildNode }) {
	if (node.kind.includes("tool")) return <Wrench size={13} className="text-[#a855f7]" />;
	if (node.kind.includes("diagnostic") || node.state === "warning" || node.state === "error") return <AlertTriangle size={13} className={node.state === "error" ? "text-red-400" : "text-[#f59e0b]"} />;
	if (node.schemaJson !== undefined || node.payloadJson !== undefined) return <Braces size={13} className="text-[#11a4d4]" />;
	return <FileText size={13} className="text-[#11a4d4]" />;
}

function NodeBadges({ node }: { node: ContextBuildNode }) {
	const badges = [...new Set([...(node.badges ?? []), ...(node.approximate ? ["APPROX"] : [])])];
	if (!badges.length) return null;
	return <>{badges.map((badge) => <span key={badge} className={badgeClass(badge)}>{badge}</span>)}</>;
}

function badgeClass(badge: string): string {
	if (badge.includes("ERROR")) return "border border-red-500/60 bg-red-500/10 px-1.5 py-0.5 font-mono text-[9px] text-red-200";
	if (badge.includes("WARNING") || badge.includes("APPROX") || badge.includes("SKIPPED") || badge.includes("DISABLED")) return "border border-[#f59e0b]/60 bg-[#f59e0b]/10 px-1.5 py-0.5 font-mono text-[9px] text-amber-100";
	if (badge.includes("ACTIVE") || badge.includes("OK")) return "border border-[#0bda57]/50 bg-[#0bda57]/10 px-1.5 py-0.5 font-mono text-[9px] text-emerald-200";
	return "border border-slate-700 bg-[#101d22] px-1.5 py-0.5 font-mono text-[9px] text-slate-300";
}

function borderForNode(node: ContextBuildNode): string {
	if (node.state === "error") return "border border-red-500/60";
	if (node.state === "warning" || node.approximate) return "border border-[#f59e0b]/50";
	if (node.kind.includes("tool")) return "border border-[#a855f7]/35";
	return "border border-slate-800";
}

function collectNodeIds(nodes: readonly ContextBuildNode[]): string[] {
	return nodes.flatMap((node) => [node.id, ...collectNodeIds(node.children ?? [])]);
}

function renderNodeForCopy(node: ContextBuildNode, depth = 0): string {
	const prefix = "  ".repeat(depth);
	const lines = [`${prefix}- ${node.title} (${node.source}${node.state ? `/${node.state}` : ""})`];
	if (node.path) lines.push(`${prefix}  path: ${node.path}`);
	if (node.key) lines.push(`${prefix}  key: ${node.key}`);
	if (node.provider) lines.push(`${prefix}  provider: ${node.provider}`);
	if (node.notes?.length) lines.push(...node.notes.map((note) => `${prefix}  note: ${note}`));
	if (node.hydratedText) lines.push(`${prefix}  content:\n${indent(node.hydratedText, `${prefix}    `)}`);
	if (node.schemaJson !== undefined) lines.push(`${prefix}  schema:\n${indent(JSON.stringify(node.schemaJson, null, 2), `${prefix}    `)}`);
	if (node.payloadJson !== undefined) lines.push(`${prefix}  payload:\n${indent(JSON.stringify(node.payloadJson, null, 2), `${prefix}    `)}`);
	for (const child of node.children ?? []) lines.push(renderNodeForCopy(child, depth + 1));
	return lines.join("\n");
}

function indent(text: string, prefix: string): string {
	return text.split("\n").map((line) => `${prefix}${line}`).join("\n");
}

function formatBytes(bytes: number): string {
	if (bytes < 1024) return `${bytes} B`;
	if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KiB`;
	return `${(bytes / (1024 * 1024)).toFixed(1)} MiB`;
}

function formatValue(value: unknown): string {
	if (value === null || value === undefined) return "null";
	if (typeof value === "string" || typeof value === "number" || typeof value === "boolean") return String(value);
	return JSON.stringify(value);
}

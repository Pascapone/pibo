export type SnapshotNode = {
	ref: string;
	identity: string;
	identityKind: string;
	depth: number;
	tag: string;
	role?: string;
	name?: string;
	text?: string;
	attributes: Record<string, string | boolean | number>;
	classSummary?: string;
	path: string;
	focused?: boolean;
	box?: { x: number; y: number; w: number; h: number };
};

export type WebSnapshot = {
	kind: "snapshot";
	createdAt: string;
	url: string;
	title: string;
	scope: string;
	rootFound: boolean;
	root?: SnapshotNode;
	activeElement?: { identity: string; tag: string; name?: string; path: string };
	nodes: SnapshotNode[];
	omitted: { nodes: number; depth: number; budget: boolean };
};

export type WatchEvent = {
	t: number;
	source: "dom" | "focus" | "route" | "action";
	kind: string;
	target?: string;
	detail?: string;
	before?: string;
	after?: string;
	node?: SnapshotNode;
};

export type WebWatch = {
	kind: "watch";
	createdAt: string;
	url: string;
	title: string;
	scope: string;
	durationMs: number;
	rootFound: boolean;
	events: WatchEvent[];
	before?: WebSnapshot;
	after?: WebSnapshot;
	omitted: { events: number; nodes: number; depth: number; budget: boolean };
	action?: { requested: string; performed: boolean; error?: string };
};

type WebRenderTarget = { id: string; url: string; title: string };

export type WebSnapshotDiff = {
	added: SnapshotNode[];
	removed: SnapshotNode[];
	changed: Array<{ before: SnapshotNode; after: SnapshotNode; changes: string[] }>;
	suspectedFlickers: string[];
};

export function formatSnapshot(snapshot: WebSnapshot, target: WebRenderTarget): string {
	const lines = [
		`# Web Render Snapshot`,
		`# target: ${target.id} ${target.url || snapshot.url}`,
		`# scope: ${snapshot.scope}`,
	];
	if (!snapshot.rootFound) {
		lines.push("root: not found");
		return lines.join("\n");
	}
	for (const node of snapshot.nodes) lines.push(formatNodeLine(node));
	lines.push(`Summary: ${snapshot.nodes.length} nodes, omitted=${snapshot.omitted.nodes}, depth_omitted=${snapshot.omitted.depth}`);
	return lines.join("\n");
}

function formatNodeLine(node: SnapshotNode): string {
	const indent = "  ".repeat(Math.min(node.depth, 8));
	const parts = [`${indent}${node.ref}`, node.identityKind === "path" ? `${node.identity} unstable` : node.identity, `<${node.tag}>`];
	if (node.role) parts.push(`role=${node.role}`);
	if (node.name) parts.push(`name=${JSON.stringify(node.name)}`);
	if (node.attributes["data-pibo-session-id"]) parts.push(`session=${node.attributes["data-pibo-session-id"]}`);
	if (node.attributes["data-pibo-selected"]) parts.push(`selected=${node.attributes["data-pibo-selected"]}`);
	if (node.attributes["data-pibo-state"]) parts.push(`state=${node.attributes["data-pibo-state"]}`);
	if (node.classSummary) parts.push(`class=${JSON.stringify(node.classSummary)}`);
	if (node.text && !node.name) parts.push(`text=${JSON.stringify(node.text)}`);
	if (node.focused) parts.push("focused=true");
	if (node.box) parts.push(`box=${node.box.x},${node.box.y},${node.box.w},${node.box.h}`);
	return parts.join(" ");
}

export function diffSnapshots(before: WebSnapshot, after: WebSnapshot): WebSnapshotDiff {
	const beforeMap = new Map(before.nodes.map((node) => [node.identity, node]));
	const afterMap = new Map(after.nodes.map((node) => [node.identity, node]));
	const added: SnapshotNode[] = [];
	const removed: SnapshotNode[] = [];
	const changed: Array<{ before: SnapshotNode; after: SnapshotNode; changes: string[] }> = [];
	for (const node of after.nodes) if (!beforeMap.has(node.identity)) added.push(node);
	for (const node of before.nodes) if (!afterMap.has(node.identity)) removed.push(node);
	for (const [identity, beforeNode] of beforeMap) {
		const afterNode = afterMap.get(identity);
		if (!afterNode) continue;
		const changes = nodeChanges(beforeNode, afterNode);
		if (changes.length) changed.push({ before: beforeNode, after: afterNode, changes });
	}
	const suspectedFlickers = inferSnapshotFlickers(removed, added);
	return { added, removed, changed, suspectedFlickers };
}

function nodeChanges(before: SnapshotNode, after: SnapshotNode): string[] {
	const changes: string[] = [];
	if (before.name !== after.name) changes.push(`name ${jsonShort(before.name)} -> ${jsonShort(after.name)}`);
	if (before.text !== after.text) changes.push(`text ${jsonShort(before.text)} -> ${jsonShort(after.text)}`);
	if (before.classSummary !== after.classSummary) changes.push(`class ${jsonShort(before.classSummary)} -> ${jsonShort(after.classSummary)}`);
	for (const key of new Set([...Object.keys(before.attributes), ...Object.keys(after.attributes)])) {
		if (before.attributes[key] !== after.attributes[key]) changes.push(`${key} ${jsonShort(before.attributes[key])} -> ${jsonShort(after.attributes[key])}`);
	}
	if (before.box && after.box) {
		const moved = Math.abs(before.box.x - after.box.x) + Math.abs(before.box.y - after.box.y);
		const resized = Math.abs(before.box.w - after.box.w) + Math.abs(before.box.h - after.box.h);
		if (moved > 2 || resized > 2) changes.push(`box ${before.box.x},${before.box.y},${before.box.w},${before.box.h} -> ${after.box.x},${after.box.y},${after.box.w},${after.box.h}`);
	}
	return changes;
}

function inferSnapshotFlickers(removed: SnapshotNode[], added: SnapshotNode[]): string[] {
	const flickers: string[] = [];
	for (const oldNode of removed) {
		const match = bestLogicalMatch(oldNode, added);
		if (match && match.score >= 55) {
			flickers.push(`remount-like ${oldNode.identity} -> ${match.node.identity} reason=${match.reason}`);
		}
	}
	return flickers.slice(0, 20);
}

export function formatSnapshotDiff(diff: WebSnapshotDiff, before: WebSnapshot, after: WebSnapshot, target: WebRenderTarget): string {
	const lines = [
		`# Web Render Diff`,
		`# target: ${target.id} ${target.url || after.url}`,
		`# scope: ${after.scope}`,
		`# baseline: ${before.createdAt}`,
		`# current: ${after.createdAt}`,
	];
	for (const node of diff.removed) lines.push(`- ${node.identity} ${describeNode(node)}`);
	for (const node of diff.added) lines.push(`+ ${node.identity} ${describeNode(node)}`);
	for (const item of diff.changed) lines.push(`~ ${item.after.identity} ${item.changes.join("; ")}`);
	if (diff.suspectedFlickers.length) {
		lines.push("", "Suspected flicker:");
		for (const flicker of diff.suspectedFlickers) lines.push(`- ${flicker}`);
	}
	lines.push(``, `Summary: ${diff.added.length} adds, ${diff.removed.length} removals, ${diff.changed.length} updates, ${diff.suspectedFlickers.length} suspected flickers`);
	return lines.join("\n");
}

export function formatWatch(watch: WebWatch, target: WebRenderTarget, label = "watch"): string {
	const lines = [
		`# Web Render Watch: ${label}, ${(watch.durationMs / 1000).toFixed(1)}s`,
		`# target: ${target.id} ${target.url || watch.url}`,
		`# scope: ${watch.scope}`,
	];
	if (!watch.rootFound) {
		lines.push("root: not found");
		return lines.join("\n");
	}
	if (watch.action) {
		lines.push(`# action: ${watch.action.requested} performed=${watch.action.performed}${watch.action.error ? ` error=${watch.action.error}` : ""}`);
	}
	const snapshotDelta = watch.before && watch.after ? diffSnapshots(watch.before, watch.after) : undefined;
	const hasSnapshotDelta = snapshotDelta ? hasSnapshotDiff(snapshotDelta) : false;
	if (!watch.events.length && hasSnapshotDelta) {
		lines.push("no mutation events captured; final snapshot differs:");
		lines.push(...formatCompactSnapshotDelta(snapshotDelta!));
	} else if (!watch.events.length) {
		lines.push("no changes");
	}
	for (const event of watch.events) {
		lines.push(formatWatchEvent(event));
	}
	const flickers = inferWatchFlickers(watch.events);
	if (flickers.length) {
		lines.push("", "Suspected flicker:");
		for (const flicker of flickers) lines.push(`- ${flicker}`);
	}
	const counts = countEvents(watch.events);
	lines.push("", `Summary: ${counts.added} adds, ${counts.removed} removals, ${counts.attr} attr updates, ${counts.text} text updates, ${counts.focus} focus, ${counts.route} route, ${flickers.length} suspected flickers, omitted=${watch.omitted.events}`);
	return lines.join("\n");
}

function formatWatchEvent(event: WatchEvent): string {
	const t = String(event.t).padStart(4, "0");
	if (event.source === "dom" && event.kind === "attr") return `${t}ms dom ~ ${event.target ?? "?"} ${event.detail}: ${jsonShort(event.before)} -> ${jsonShort(event.after)}`;
	if (event.source === "dom" && event.kind === "text") return `${t}ms dom ~ ${event.target ?? "?"} text: ${jsonShort(event.before)} -> ${jsonShort(event.after)}`;
	if (event.source === "dom" && event.kind === "added") return `${t}ms dom + ${event.target ?? "?"} ${event.node ? describeNode(event.node) : ""}`;
	if (event.source === "dom" && event.kind === "removed") return `${t}ms dom - ${event.target ?? "?"} ${event.node ? describeNode(event.node) : ""}`;
	if (event.source === "focus") return `${t}ms focus ${event.kind} ${event.target ?? "?"}`;
	if (event.source === "route") return `${t}ms route ${event.kind} ${event.before ? `${event.before} -> ` : ""}${event.after ?? ""}`;
	if (event.source === "action") return `${t}ms action ${event.kind} ${event.detail ?? ""} ${event.target ?? ""}`;
	return `${t}ms ${event.source} ${event.kind} ${event.target ?? ""}`;
}

function hasSnapshotDiff(diff: WebSnapshotDiff): boolean {
	return Boolean(diff.added.length || diff.removed.length || diff.changed.length);
}

function formatCompactSnapshotDelta(diff: WebSnapshotDiff, limit = 8): string[] {
	const lines: string[] = [];
	for (const node of diff.removed) lines.push(`  - ${node.identity} ${describeNode(node)}`);
	for (const node of diff.added) lines.push(`  + ${node.identity} ${describeNode(node)}`);
	for (const item of diff.changed) lines.push(`  ~ ${item.after.identity} ${item.changes.join("; ")}`);
	if (lines.length > limit) return [...lines.slice(0, limit), `  … ${lines.length - limit} more snapshot changes`];
	return lines;
}

export function inferWatchFlickers(events: readonly WatchEvent[]): string[] {
	const flickers: string[] = [];
	const removals = events.filter((event) => event.kind === "removed" && event.node);
	const additions = events.filter((event) => event.kind === "added" && event.node);
	for (const added of additions) {
		const addedNode = added.node!;
		const removal = removals.find((removed) => removed.t >= added.t && removed.t - added.t <= 500 && removed.node && sameStableNode(addedNode, removed.node));
		if (removal?.node) flickers.push(`transient node within ${removal.t - added.t}ms: ${addedNode.identity} added then removed`);
	}
	for (const removed of removals) {
		const removedNode = removed.node!;
		const candidates = additions.filter((added) => added.t >= removed.t && added.t - removed.t <= 500 && added.node);
		const match = bestLogicalMatch(removedNode, candidates.map((candidate) => candidate.node!));
		if (match && match.score >= 55) {
			const event = candidates.find((candidate) => candidate.node === match.node);
			if (event) flickers.push(`remove/add within ${event.t - removed.t}ms: ${removedNode.identity} -> ${match.node.identity} reason=${match.reason}`);
		}
	}
	const attrRollbacks = new Map<string, WatchEvent[]>();
	for (const event of events) {
		if (event.kind !== "attr" || !event.target || !event.detail) continue;
		const key = `${event.target}:${event.detail}`;
		attrRollbacks.set(key, [...(attrRollbacks.get(key) ?? []), event]);
	}
	for (const [key, entries] of attrRollbacks) {
		for (let i = 1; i < entries.length; i++) {
			if (entries[i - 1].before === entries[i].after && entries[i].t - entries[i - 1].t <= 500) {
				flickers.push(`attribute rollback within ${entries[i].t - entries[i - 1].t}ms: ${key}`);
				break;
			}
		}
	}
	return [...new Set(flickers)].slice(0, 20);
}

function sameStableNode(left: SnapshotNode, right: SnapshotNode): boolean {
	if (left.identity === right.identity) return true;
	const leftSession = attrText(left, "data-pibo-session-id");
	const rightSession = attrText(right, "data-pibo-session-id");
	return Boolean(leftSession && leftSession === rightSession);
}

function bestLogicalMatch(node: SnapshotNode, candidates: readonly SnapshotNode[]): { node: SnapshotNode; score: number; reason: string } | undefined {
	let best: { node: SnapshotNode; score: number; reason: string } | undefined;
	for (const candidate of candidates) {
		const match = logicalMatchScore(node, candidate);
		if (!best || match.score > best.score) best = { node: candidate, ...match };
	}
	return best && best.score > 0 ? best : undefined;
}

function logicalMatchScore(left: SnapshotNode, right: SnapshotNode): { score: number; reason: string } {
	if (left.identity === right.identity) return { score: 100, reason: "same-identity" };
	const leftSession = attrText(left, "data-pibo-session-id");
	const rightSession = attrText(right, "data-pibo-session-id");
	if (leftSession && rightSession && leftSession === rightSession) return { score: 90, reason: "same-session-id" };

	const reasons: string[] = [];
	let score = 0;
	const leftDebug = attrText(left, "data-pibo-debug");
	const rightDebug = attrText(right, "data-pibo-debug");
	if (leftDebug || rightDebug) {
		if (leftDebug !== rightDebug) return { score: 0, reason: "different-debug-anchor" };
		score += 45;
		reasons.push("same-debug-anchor");
	}
	if (left.tag === right.tag) {
		score += 10;
		reasons.push("same-tag");
	}
	if (left.path && left.path === right.path) {
		score += 25;
		reasons.push("same-path");
	}
	if (left.role && left.role === right.role) {
		score += 10;
		reasons.push("same-role");
	}

	const differentSessionIds = Boolean(leftSession && rightSession && leftSession !== rightSession);
	if (!differentSessionIds) {
		if (left.name && left.name === right.name) {
			score += 15;
			reasons.push("same-name");
		}
		if (left.text && left.text === right.text) {
			score += 10;
			reasons.push("same-text");
		}
	}
	return { score, reason: reasons.join("+") || "weak-match" };
}

function attrText(node: SnapshotNode, key: string): string | undefined {
	const value = node.attributes[key];
	return typeof value === "string" && value.length ? value : undefined;
}

function countEvents(events: readonly WatchEvent[]): { added: number; removed: number; attr: number; text: number; focus: number; route: number } {
	return {
		added: events.filter((event) => event.kind === "added").length,
		removed: events.filter((event) => event.kind === "removed").length,
		attr: events.filter((event) => event.kind === "attr").length,
		text: events.filter((event) => event.kind === "text").length,
		focus: events.filter((event) => event.source === "focus").length,
		route: events.filter((event) => event.source === "route").length,
	};
}

function describeNode(node: SnapshotNode): string {
	const parts = [`<${node.tag}>`];
	if (node.role) parts.push(`role=${node.role}`);
	if (node.name) parts.push(`name=${JSON.stringify(node.name)}`);
	if (node.text && !node.name) parts.push(`text=${JSON.stringify(node.text)}`);
	if (node.attributes["data-pibo-session-id"]) parts.push(`session=${node.attributes["data-pibo-session-id"]}`);
	if (node.attributes["data-pibo-selected"]) parts.push(`selected=${node.attributes["data-pibo-selected"]}`);
	if (node.classSummary) parts.push(`class=${JSON.stringify(node.classSummary)}`);
	return parts.join(" ");
}

function jsonShort(value: unknown): string {
	const text = JSON.stringify(value);
	return text.length > 120 ? `${text.slice(0, 117)}...` : text;
}

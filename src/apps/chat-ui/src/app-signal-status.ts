import { resolveSessionActivity } from "../../../session-ui/sessionActivity.js";
import type { BootstrapData, PiboSignalPatch, PiboSignalSnapshot, PiboWebSessionNode } from "./types";

type SignalSessionUpdate = { status?: PiboWebSessionNode["status"]; updatedAt?: string; isTreeActive?: boolean };

export function applySignalSnapshotToBootstrap(bootstrap: BootstrapData, snapshot: PiboSignalSnapshot): BootstrapData {
	return updateBootstrapSessionStatuses(bootstrap, (piboSessionId) => signalSessionUpdate(snapshot.sessions[piboSessionId]));
}

export function signalSnapshotIncludesSession(snapshot: PiboSignalSnapshot | null | undefined, piboSessionId: string): snapshot is PiboSignalSnapshot {
	return Boolean(snapshot?.sessions[piboSessionId]);
}

export function shouldCommitSelectedSignalSnapshot(
	current: PiboSignalSnapshot | null,
	snapshot: PiboSignalSnapshot,
	selectedPiboSessionId: string,
): boolean {
	if (!signalSnapshotIncludesSession(snapshot, selectedPiboSessionId)) return false;
	return current?.rootPiboSessionId !== snapshot.rootPiboSessionId || current.version <= snapshot.version;
}

export function applySelectedSignalPatch(
	current: PiboSignalSnapshot | null,
	patch: PiboSignalPatch,
	selectedPiboSessionId: string,
): { snapshot: PiboSignalSnapshot | null; needsRefresh: boolean } {
	if (!signalSnapshotIncludesSession(current, selectedPiboSessionId)) {
		return { snapshot: current, needsRefresh: true };
	}
	const snapshot = applySignalPatch(current, patch);
	return { snapshot, needsRefresh: snapshot === current };
}

export function applySignalPatchToBootstrap(bootstrap: BootstrapData, patch: PiboSignalPatch): BootstrapData {
	const updates = new Map(patch.sessionSnapshots.map((snapshot) => [snapshot.piboSessionId, signalSessionUpdate(snapshot)]));
	return updateBootstrapSessionStatuses(bootstrap, (piboSessionId) => updates.get(piboSessionId));
}

function updateBootstrapSessionStatuses(
	bootstrap: BootstrapData,
	updateFor: (piboSessionId: string) => SignalSessionUpdate | undefined,
): BootstrapData {
	return {
		...bootstrap,
		sessions: bootstrap.sessions.map((node) => updateSignalStatusInSessionNode(node, updateFor)),
	};
}

function updateSignalStatusInSessionNode(
	node: PiboWebSessionNode,
	updateFor: (piboSessionId: string) => SignalSessionUpdate | undefined,
): PiboWebSessionNode {
	const update = updateFor(node.piboSessionId);
	const status = acknowledgedSignalStatus(update, sessionNodeUnreadCount(node));
	const statusChanged = Boolean(status && status !== node.status);
	const lastActivityAt = statusChanged
		? latestIsoTimestamp(node.lastActivityAt, update?.updatedAt, new Date().toISOString())
		: latestIsoTimestamp(node.lastActivityAt, update?.updatedAt);
	return {
		...node,
		status: status ?? node.status,
		lastActivityAt,
		children: node.children.map((child) => updateSignalStatusInSessionNode(child, updateFor)),
		derivedSessions: node.derivedSessions.map((derived) => {
			const derivedUpdate = updateFor(derived.piboSessionId);
			const derivedStatus = acknowledgedSignalStatus(derivedUpdate, 0);
			const derivedStatusChanged = Boolean(derivedStatus && derivedStatus !== derived.status);
			return {
				...derived,
				status: derivedStatus ?? derived.status,
				lastActivityAt: derivedStatusChanged
					? latestIsoTimestamp(derived.lastActivityAt, derivedUpdate?.updatedAt, new Date().toISOString())
					: latestIsoTimestamp(derived.lastActivityAt, derivedUpdate?.updatedAt),
			};
		}),
	};
}

function sessionNodeUnreadCount(node: PiboWebSessionNode): number {
	return (node.unreadCount ?? 0) + node.children.reduce((sum, child) => sum + sessionNodeUnreadCount(child), 0);
}

function acknowledgedSignalStatus(update: SignalSessionUpdate | undefined, unreadCount: number): PiboWebSessionNode["status"] | undefined {
	if (update?.status !== "error") return update?.status;
	return unreadCount > 0 ? "error" : update.isTreeActive ? "running" : "idle";
}

function signalSessionUpdate(snapshot: PiboSignalSnapshot["sessions"][string] | undefined): SignalSessionUpdate | undefined {
	const status = signalLegacyStatus(snapshot);
	if (!snapshot && !status) return undefined;
	return { status, updatedAt: snapshot?.updatedAt, isTreeActive: snapshot?.isTreeActive };
}

export function signalLegacyStatus(snapshot: PiboSignalSnapshot["sessions"][string] | undefined): PiboWebSessionNode["status"] | undefined {
	return snapshot ? resolveSessionActivity(snapshot).status : undefined;
}

function latestIsoTimestamp(...values: Array<string | undefined>): string | undefined {
	let latest: string | undefined;
	let latestMs = -Infinity;
	for (const value of values) {
		if (!value) continue;
		const ms = Date.parse(value);
		if (!Number.isFinite(ms) || ms < latestMs) continue;
		latest = value;
		latestMs = ms;
	}
	return latest;
}

export function applySignalPatch(current: PiboSignalSnapshot | null, patch: PiboSignalPatch): PiboSignalSnapshot | null {
	if (!current || current.rootPiboSessionId !== patch.rootPiboSessionId || current.version !== patch.fromVersion) return current;
	const nodes = { ...current.nodes };
	for (const id of patch.removes) delete nodes[id];
	for (const node of patch.upserts) nodes[node.id] = node;
	const sessions = { ...current.sessions };
	for (const snapshot of patch.sessionSnapshots) sessions[snapshot.piboSessionId] = snapshot;
	return { ...current, version: patch.toVersion, generatedAt: patch.generatedAt, nodes, sessions };
}

import { useCallback, useEffect, useMemo, useState } from "react";
import { Copy, KeyRound, Loader2, PlugZap, Power, RefreshCw, SatelliteDish, Trash2 } from "lucide-react";
import {
	deleteRemoteToken,
	getRemoteRoomState,
	patchRemoteRoomConfig,
	postRemoteDeviceCode,
	postRemoteToken,
	type RemoteAgentMode,
	type RemoteAgentModuleName,
	type RemoteAgentRuntime,
	type RemoteRoomState,
	type RemoteTokenInfo,
} from "./api-remote-agent";
import type { BootstrapData } from "./types";
import { getAgentCatalog } from "./api-agent-designer";

type CatalogProfile = { name: string; description?: string; runtimeInstanceId?: string };

const MODULES: Array<{ name: RemoteAgentModuleName; title: string; hint: string }> = [
	{ name: "sessions", title: "Sessions", hint: "Create, list, and message room sessions" },
	{ name: "observe", title: "Observe", hint: "Read session history and tool activity" },
	{ name: "files", title: "Files", hint: "Read, write, edit, list, find, grep" },
	{ name: "bash", title: "Bash", hint: "Run shell commands" },
];

function formatExpiry(iso: string): string {
	const ms = Date.parse(iso) - Date.now();
	if (!Number.isFinite(ms) || ms <= 0) return "expired";
	const days = Math.floor(ms / 86_400_000);
	if (days >= 1) return `in ${days}d`;
	const hours = Math.floor(ms / 3_600_000);
	if (hours >= 1) return `in ${hours}h`;
	return `in ${Math.max(1, Math.floor(ms / 60_000))}m`;
}

function formatDateTime(iso: string): string {
	const date = new Date(iso);
	return Number.isNaN(date.getTime()) ? iso : date.toLocaleString();
}

async function copyText(value: string): Promise<boolean> {
	try {
		await navigator.clipboard.writeText(value);
		return true;
	} catch {
		return false;
	}
}

function CopyButton({ value, label }: { value: string; label: string }) {
	const [copied, setCopied] = useState(false);
	return (
		<button
			type="button"
			title={label}
			aria-label={label}
			onClick={() => void copyText(value).then((ok) => {
				if (ok) {
					setCopied(true);
					window.setTimeout(() => setCopied(false), 1500);
				}
			})}
			className="p-1 border border-slate-700 rounded-sm text-slate-400 hover:border-[#11a4d4] hover:text-[#11a4d4]"
		>
			{copied ? <span className="text-[10px] px-0.5 font-bold uppercase">Copied</span> : <Copy size={13} />}
		</button>
	);
}

function TokenRow({ token, onRevoke, busy }: { token: RemoteTokenInfo; onRevoke: () => void; busy: boolean }) {
	return (
		<div className="border border-slate-800 rounded-sm px-2 py-1.5 flex items-center justify-between gap-2">
			<div className="min-w-0">
				<div className="text-[13px] font-medium truncate">{token.label}</div>
				<div className="text-[11px] text-slate-400 font-mono truncate">
					{token.modules.join(" · ")} — expires {formatExpiry(token.expiresAt)}
				</div>
			</div>
			{token.revoked
				? <span className="text-[10px] font-bold uppercase tracking-wider text-slate-500">Revoked</span>
				: (
					<button
						type="button"
						title="Revoke connection"
						aria-label={`Revoke ${token.label}`}
						disabled={busy}
						onClick={onRevoke}
						className="p-1 border border-slate-700 rounded-sm text-slate-400 hover:border-red-400 hover:text-red-300 disabled:opacity-50"
					>
						{busy ? <Loader2 size={13} className="animate-spin" /> : <Trash2 size={13} />}
					</button>
				)}
		</div>
	);
}

export function RemoteAgentArea({ bootstrap, initialRoomId }: { bootstrap: BootstrapData; initialRoomId?: string }) {
	const rooms = useMemo(
		() => [...bootstrap.rooms].sort((a, b) => a.name.localeCompare(b.name)),
		[bootstrap.rooms],
	);
	const [roomId, setRoomId] = useState(initialRoomId || bootstrap.selectedRoomId || rooms[0]?.id || "");
	const [state, setState] = useState<RemoteRoomState | null>(null);
	const [loading, setLoading] = useState(false);
	const [saving, setSaving] = useState(false);
	const [error, setError] = useState<string | null>(null);
	const [label, setLabel] = useState("");
	const [freshCode, setFreshCode] = useState<{ code: string; expiresAt: string } | null>(null);
	const [freshToken, setFreshToken] = useState<{ token: string; expiresAt: string } | null>(null);
	const [creatingCode, setCreatingCode] = useState(false);
	const [creatingToken, setCreatingToken] = useState(false);
	const restBase = state?.mcpUrl ? state.mcpUrl.replace(/\/mcp$/, "") : null;
	const [revoking, setRevoking] = useState<string | null>(null);
	const [draftSandboxPath, setDraftSandboxPath] = useState<string | null>(null);
	const [catalogProfiles, setCatalogProfiles] = useState<CatalogProfile[] | null>(null);

	// NOTE: load() must not clear freshCode/freshToken: it runs right after
	// creating a code/token to refresh the list, and clearing here discards
	// the show-once secret before it is ever displayed. Secrets are cleared
	// on room switch and on disable (which revokes all tokens) instead.
	const load = useCallback(async (id: string) => {
		if (!id) return;
		setLoading(true);
		setError(null);
		try {
			const next = await getRemoteRoomState(id);
			setState(next);
			setDraftSandboxPath(null);
		} catch (caught) {
			setError(caught instanceof Error ? caught.message : String(caught));
		} finally {
			setLoading(false);
		}
	}, []);

	useEffect(() => {
		if (roomId) void load(roomId);
	}, [roomId, load]);

	useEffect(() => {
		let cancelled = false;
		void getAgentCatalog()
			.then((result) => {
				if (cancelled) return;
				setCatalogProfiles((result.profiles as CatalogProfile[]).map((profile) => ({
					name: profile.name,
					...(profile.description ? { description: profile.description } : {}),
					...(profile.runtimeInstanceId ? { runtimeInstanceId: profile.runtimeInstanceId } : {}),
				})));
			})
			.catch(() => {
				if (!cancelled) setCatalogProfiles([]);
			});
		return () => {
			cancelled = true;
		};
	}, []);

	const patch = useCallback(async (input: Parameters<typeof patchRemoteRoomConfig>[1]) => {
		if (!roomId) return;
		setSaving(true);
		setError(null);
		try {
			const next = await patchRemoteRoomConfig(roomId, input);
			setState(next);
			setDraftSandboxPath(null);
			if (input.enabled === false) {
				setFreshCode(null);
				setFreshToken(null);
			}
		} catch (caught) {
			setError(caught instanceof Error ? caught.message : String(caught));
		} finally {
			setSaving(false);
		}
	}, [roomId]);

	if (rooms.length === 0) {
		return (
			<div className="p-6 text-center">
				<SatelliteDish size={24} className="mx-auto text-slate-500" />
				<p className="mt-2 text-sm font-bold uppercase tracking-wider">No rooms</p>
				<p className="text-[13px] text-slate-400">Create a room first to expose it to remote agents.</p>
			</div>
		);
	}

	const config = state?.config;
	const yolo = state?.effectiveMode === "yolo";
	const internetOn = state?.effectiveInternet === true;

	return (
		<div className="h-full overflow-y-auto">
			<div className="h-11 px-3 border-b border-slate-800 flex items-center justify-between text-xs font-bold uppercase tracking-wider">
				<span className="inline-flex items-center gap-2"><SatelliteDish size={14} /> Remote Agent</span>
				<div className="flex items-center gap-1">
					{config && (
						<span className={`text-[10px] font-bold uppercase tracking-wider px-1.5 py-0.5 rounded-sm border ${config.enabled ? "text-emerald-300 border-emerald-500/40 bg-emerald-500/10" : "text-slate-400 border-slate-700"}`}>
							{config.enabled ? "On" : "Off"}
						</span>
					)}
					<button type="button" onClick={() => roomId && void load(roomId)} title="Refresh" aria-label="Refresh" className="p-1 border border-slate-700 rounded-sm text-slate-400 hover:border-[#11a4d4] hover:text-[#11a4d4]"><RefreshCw size={13} /></button>
				</div>
			</div>

			<div className="p-3 space-y-3 max-w-3xl">
				{error && <p role="alert" className="text-[13px] border border-red-500/40 bg-red-500/10 text-red-200 rounded-sm px-2 py-1.5">{error}</p>}
				{loading && !state
					? <p role="status" className="text-[13px] text-slate-400 inline-flex items-center gap-2"><Loader2 size={14} className="animate-spin" /> Loading…</p>
					: null}

				<div className="flex items-center gap-2">
					<label htmlFor="remote-agent-room" className="text-[11px] font-bold uppercase tracking-wider text-slate-400">Room</label>
					<select
						id="remote-agent-room"
						value={roomId}
						onChange={(event) => {
							setRoomId(event.target.value);
							setFreshCode(null);
							setFreshToken(null);
						}}
						className="flex-1 bg-[#151f24] border border-slate-700 rounded-sm text-[13px] px-2 py-1.5 focus:border-[#11a4d4] focus:outline-none"
					>
						{rooms.map((room) => <option key={room.id} value={room.id}>{room.name}</option>)}
					</select>
					<button
						type="button"
						disabled={!config || saving}
						onClick={() => config && void patch({ enabled: !config.enabled })}
					 className={`inline-flex items-center gap-1.5 text-[12px] font-bold uppercase tracking-wider px-2.5 py-1.5 rounded-sm border disabled:opacity-50 ${config?.enabled ? "border-slate-700 text-slate-300 hover:border-slate-500" : "bg-[#11a4d4] border-[#11a4d4] text-white hover:brightness-110"}`}
					>
						<Power size={13} /> {config?.enabled ? "Disable" : "Enable"}
					</button>
				</div>

				{config && (
					<>
						<section aria-label="Connection" className="border border-slate-800 rounded-sm">
							<h2 className="text-[11px] font-bold uppercase tracking-wider text-slate-400 px-2 pt-2">Connection</h2>
							<div className="p-2 space-y-2">
								<div className="flex items-center gap-2">
									<PlugZap size={14} className="text-slate-500 shrink-0" />
									<code className="flex-1 min-w-0 truncate font-mono text-[12px] bg-[#0e1116] border border-slate-800 rounded-sm px-2 py-1.5">
										{state.mcpUrl ?? "MCP server starts on first use"}
									</code>
									{state.mcpUrl && <CopyButton value={state.mcpUrl} label="Copy MCP URL" />}
								</div>
								<div className="flex items-center gap-2">
									<input
										value={label}
										onChange={(event) => setLabel(event.target.value)}
										placeholder="Label, e.g. ChatGPT work agent"
										maxLength={80}
										disabled={!config.enabled}
										className="flex-1 min-w-0 bg-[#151f24] border border-slate-700 rounded-sm text-[13px] px-2 py-1.5 focus:border-[#11a4d4] focus:outline-none disabled:opacity-50"
									/>
									<button
										type="button"
										disabled={!config.enabled || creatingCode}
										onClick={() => {
											setCreatingCode(true);
											setError(null);
											postRemoteDeviceCode(roomId, label.trim() || undefined)
												.then((result) => {
													setFreshCode(result.code);
													void load(roomId);
												})
												.catch((caught: unknown) => setError(caught instanceof Error ? caught.message : String(caught)))
												.finally(() => setCreatingCode(false));
										}}
										className="inline-flex items-center gap-1.5 text-[12px] font-bold uppercase tracking-wider px-2.5 py-1.5 rounded-sm bg-[#11a4d4] text-white hover:brightness-110 disabled:opacity-50"
									>
										{creatingCode ? <Loader2 size={13} className="animate-spin" /> : <KeyRound size={13} />} New code
									</button>
								</div>
								{freshCode && (
									<div className="border border-[#11a4d4]/40 bg-[#11a4d4]/10 rounded-sm px-2 py-1.5 flex items-center gap-2">
										<code className="flex-1 font-mono text-[16px] font-bold tracking-[0.2em]">{freshCode.code}</code>
										<span className="text-[11px] text-slate-400 font-mono">expires {formatDateTime(freshCode.expiresAt)}</span>
										<CopyButton value={freshCode.code} label="Copy device code" />
									</div>
								)}
								<div className="flex items-center gap-2">
									<button
										type="button"
										disabled={!config.enabled || creatingToken}
										onClick={() => {
											setCreatingToken(true);
											setError(null);
											postRemoteToken(roomId, label.trim() || undefined)
												.then((result) => {
													setFreshToken({ token: result.token, expiresAt: result.info.expiresAt });
													void load(roomId);
												})
												.catch((caught: unknown) => setError(caught instanceof Error ? caught.message : String(caught)))
												.finally(() => setCreatingToken(false));
										}}
										className="inline-flex items-center gap-1.5 text-[12px] font-bold uppercase tracking-wider px-2.5 py-1.5 rounded-sm border border-slate-600 text-slate-200 hover:border-[#11a4d4] hover:text-[#11a4d4] disabled:opacity-50"
									>
										{creatingToken ? <Loader2 size={13} className="animate-spin" /> : <KeyRound size={13} />} New token (paste into GPT)
									</button>
								</div>
								{freshToken && (
									<div className="border border-amber-400/40 bg-amber-400/10 rounded-sm px-2 py-1.5 space-y-1">
										<div className="flex items-center gap-2">
											<code className="flex-1 min-w-0 truncate font-mono text-[12px]">{freshToken.token}</code>
											<CopyButton value={freshToken.token} label="Copy token" />
										</div>
										<p className="text-[11px] text-amber-200/80">Shown once — copy now. Expires {formatDateTime(freshToken.expiresAt)}. Paste as Bearer key into the GPT Action.</p>
									</div>
								)}
								{restBase && (
									<div className="flex items-center gap-2">
										<code className="flex-1 min-w-0 truncate font-mono text-[11px] text-slate-400">OpenAPI: {restBase}/openapi.json</code>
										<CopyButton value={`${restBase}/openapi.json`} label="Copy OpenAPI URL" />
									</div>
								)}
								{!config.enabled && <p className="text-[12px] text-slate-500">Enable remote access to create device codes.</p>}
							</div>
						</section>

						<section aria-label="Modules and safety" className="border border-slate-800 rounded-sm">
							<h2 className="text-[11px] font-bold uppercase tracking-wider text-slate-400 px-2 pt-2">Modules &amp; Safety</h2>
							<div className="p-2 space-y-2">
								<div className="grid grid-cols-2 gap-2">
									{MODULES.map((module) => (
										<label key={module.name} className="border border-slate-800 rounded-sm px-2 py-1.5 flex items-start gap-2 cursor-pointer hover:border-slate-600">
											<input
												type="checkbox"
												checked={config.modules[module.name]}
												disabled={saving}
												onChange={(event) => void patch({ modules: { [module.name]: event.target.checked } })}
												className="mt-0.5 accent-[#11a4d4]"
											/>
											<span>
												<span className="block text-[13px] font-medium">{module.title}</span>
												<span className="block text-[11px] text-slate-500">{module.hint}</span>
											</span>
										</label>
									))}
								</div>
								<div className="flex flex-wrap items-center gap-2">
									<label className="text-[11px] font-bold uppercase tracking-wider text-slate-400" htmlFor="remote-agent-runtime">Runtime</label>
									<select
										id="remote-agent-runtime"
										value={config.runtime}
										disabled={saving}
										onChange={(event) => void patch({ runtime: event.target.value as RemoteAgentRuntime })}
										className="bg-[#151f24] border border-slate-700 rounded-sm text-[13px] px-2 py-1 focus:border-[#11a4d4] focus:outline-none"
									>
										<option value="muse">Muse (sandboxed)</option>
										<option value="pi">Pi (always YOLO)</option>
									</select>
									<div role="radiogroup" aria-label="Mode" className="inline-flex rounded-sm overflow-hidden border border-slate-700">
										{(["sandbox", "yolo"] as RemoteAgentMode[]).map((mode) => {
											const selected = config.mode === mode;
											const isYolo = mode === "yolo";
											return (
												<button
													key={mode}
													type="button"
													role="radio"
													aria-checked={selected}
													disabled={saving}
													onClick={() => void patch({ mode })}
													className={`text-[11px] font-bold uppercase tracking-wider px-2.5 py-1 disabled:opacity-50 ${selected
														? isYolo
															? "bg-red-400/25 text-red-200"
															: "bg-[#11a4d4]/20 text-[#11a4d4]"
														: "text-slate-400 hover:text-slate-200"}`}
												>
													{mode}
												</button>
											);
										})}
									</div>
									<span className={`text-[10px] font-bold uppercase tracking-wider px-1.5 py-0.5 rounded-sm border ${yolo ? "bg-red-400/20 text-red-200 border-red-400/50" : "text-slate-400 border-slate-700"}`}>
										Effective: {state.effectiveMode}
									</span>
									<span className={`text-[10px] font-bold uppercase tracking-wider px-1.5 py-0.5 rounded-sm border ${internetOn ? "bg-red-400/20 text-red-200 border-red-400/50" : "text-slate-400 border-slate-700"}`}>
										Internet: {internetOn ? "On" : "Off"}
									</span>
								</div>
								{yolo && (
									<p className="text-[12px] border border-red-400/40 bg-red-400/10 text-red-200 rounded-sm px-2 py-1.5">
										YOLO mode: file and shell tools run with full access, including internet. Only connect agents you trust.
									</p>
								)}
								<div className="flex flex-wrap items-center gap-2">
									<label className="inline-flex items-center gap-2 cursor-pointer border border-slate-800 rounded-sm px-2 py-1.5 hover:border-slate-600">
										<input
											type="checkbox"
											checked={config.allowInternet === true}
											disabled={saving}
											onChange={(event) => void patch({ allowInternet: event.target.checked })}
											className="accent-[#11a4d4]"
										/>
										<span className="text-[13px] font-medium">Internetzugriff erlauben</span>
									</label>
								</div>
								{config.runtime === "pi" ? (
									<p className="text-[11px] text-slate-500">Pi has no sandbox: internet is always on.</p>
								) : yolo ? (
									<p className="text-[11px] text-slate-500">YOLO: internet is always on — this wish applies when you switch back to Sandbox.</p>
								) : (
									<p className="text-[11px] text-slate-500">Outgoing network for this room&apos;s sandboxed Muse sessions. Applies to newly started sessions; running sessions are untouched.</p>
								)}
								<div className="flex items-center gap-2">
									<label htmlFor="remote-agent-sandbox" className="text-[11px] font-bold uppercase tracking-wider text-slate-400 whitespace-nowrap">Sandbox</label>
									<input
										id="remote-agent-sandbox"
										value={draftSandboxPath ?? config.sandboxPath}
										onChange={(event) => setDraftSandboxPath(event.target.value)}
										spellCheck={false}
										placeholder={state.roomWorkspace ? `Room default: ${state.roomWorkspace}` : "Room default (project folder)"}
										title="Working directory for remote sessions. Clear to follow the room workspace again."
										className="flex-1 min-w-0 font-mono text-[12px] bg-[#151f24] border border-slate-700 rounded-sm px-2 py-1 focus:border-[#11a4d4] focus:outline-none"
									/>
									{draftSandboxPath !== null && draftSandboxPath !== config.sandboxPath && (
										<button
											type="button"
											disabled={saving}
											onClick={() => void patch({ sandboxPath: draftSandboxPath.trim() })}
											className="text-[11px] font-bold uppercase tracking-wider px-2 py-1 rounded-sm bg-[#11a4d4] text-white hover:brightness-110 disabled:opacity-50"
										>
											Save
										</button>
									)}
								</div>
								{state.roomWorkspace && <p className="text-[11px] text-slate-500 font-mono">Room workspace: {state.roomWorkspace}</p>}
							</div>
						</section>

						<section aria-label="Agents" className="border border-slate-800 rounded-sm">
							<h2 className="text-[11px] font-bold uppercase tracking-wider text-slate-400 px-2 pt-2">Agents</h2>
							<div className="p-2 space-y-2">
								{catalogProfiles === null ? (
									<p className="text-[12px] text-slate-500">Loading agents…</p>
								) : catalogProfiles.length === 0 ? (
									<p className="text-[12px] text-slate-500">Agent catalog unavailable. Default: {config.defaultProfile || "(room default)"}.</p>
								) : (
									<>
										<div className="flex flex-wrap items-center gap-2">
											<label className="text-[11px] font-bold uppercase tracking-wider text-slate-400" htmlFor="remote-agent-default">Default</label>
											<select
												id="remote-agent-default"
												value={config.defaultProfile}
												disabled={saving}
												onChange={(event) => void patch({ defaultProfile: event.target.value })}
												className="bg-[#151f24] border border-slate-700 rounded-sm text-[13px] px-2 py-1 focus:border-[#11a4d4] focus:outline-none"
											>
												{!catalogProfiles.some((profile) => profile.name === config.defaultProfile) && config.defaultProfile ? (
													<option value={config.defaultProfile}>{config.defaultProfile} (custom)</option>
												) : null}
												{catalogProfiles.map((profile) => (
													<option key={profile.name} value={profile.name}>
														{profile.name}{profile.runtimeInstanceId ? ` · ${profile.runtimeInstanceId}` : ""}
													</option>
												))}
											</select>
										</div>
										<div className="grid grid-cols-2 gap-2">
											{catalogProfiles.map((profile) => {
												const isDefault = profile.name === config.defaultProfile;
												const checked = isDefault || config.allowedProfiles.includes(profile.name);
												return (
													<label key={profile.name} title={profile.description || profile.name} className="border border-slate-800 rounded-sm px-2 py-1.5 flex items-start gap-2 cursor-pointer hover:border-slate-600">
														<input
															type="checkbox"
															checked={checked}
															disabled={saving || isDefault}
															onChange={() => {
																const next = checked
																	? config.allowedProfiles.filter((name) => name !== profile.name)
																	: [...config.allowedProfiles, profile.name];
																void patch({ allowedProfiles: next });
															}}
															className="mt-0.5 accent-[#11a4d4]"
														/>
														<span>
															<span className="block text-[13px] font-medium">{profile.name}{isDefault ? " · default" : ""}</span>
															{profile.runtimeInstanceId && <span className="block text-[11px] text-slate-500">{profile.runtimeInstanceId}</span>}
														</span>
													</label>
												);
											})}
										</div>
										<p className="text-[11px] text-slate-500">Approved agents are visible to the remote client (remote_session_agents). New sessions use the default. Sessions run on the room runtime above.</p>
									</>
								)}
							</div>
						</section>

						<section aria-label="Connections" className="border border-slate-800 rounded-sm">
							<h2 className="text-[11px] font-bold uppercase tracking-wider text-slate-400 px-2 pt-2">
								Connections ({state.tokens.filter((token) => !token.revoked).length})
							</h2>
							<div className="p-2 space-y-1.5">
								{state.tokens.filter((token) => !token.revoked).length === 0 && <p className="text-[12px] text-slate-500">No connections yet. Create a device code above.</p>}
								{state.tokens.filter((token) => !token.revoked).map((token) => (
									<TokenRow
										key={token.id}
										token={token}
										busy={revoking === token.id}
										onRevoke={() => {
											setRevoking(token.id);
											setError(null);
											deleteRemoteToken(roomId, token.id)
												.then(() => load(roomId))
												.catch((caught: unknown) => setError(caught instanceof Error ? caught.message : String(caught)))
												.finally(() => setRevoking(null));
										}}
									/>
								))}
							</div>
						</section>
					</>
				)}
			</div>
		</div>
	);
}

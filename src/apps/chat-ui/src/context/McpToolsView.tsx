import { AlertTriangle, Save, Server } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { patchMcpServerDescription } from "../api-agent-designer";
import type { AgentCatalog } from "../types";

type McpServer = AgentCatalog["mcpServers"][number];

export function McpToolsView({
	servers,
	selectedServerName,
	onServerSaved,
}: {
	servers: AgentCatalog["mcpServers"];
	selectedServerName: string | null;
	onServerSaved: (server: McpServer) => void;
}) {
	const [drafts, setDrafts] = useState<Record<string, string>>({});
	const [savingServer, setSavingServer] = useState<string | null>(null);
	const [error, setError] = useState<string | null>(null);
	const orderedServers = useMemo(() => {
		if (!selectedServerName) return servers;
		return [...servers].sort((left, right) => {
			if (left.name === selectedServerName) return -1;
			if (right.name === selectedServerName) return 1;
			return left.name.localeCompare(right.name);
		});
	}, [selectedServerName, servers]);

	useEffect(() => {
		setDrafts((current) => {
			const next = { ...current };
			for (const server of servers) {
				if (!(server.name in next)) next[server.name] = server.description ?? "";
			}
			return next;
		});
	}, [servers]);

	const saveDescription = async (server: McpServer) => {
		if (!server.editable) return;
		const description = (drafts[server.name] ?? "").trim();
		if (!description) {
			setError("MCP tool context is required.");
			return;
		}
		setSavingServer(server.name);
		try {
			const response = await patchMcpServerDescription(server.name, description);
			setDrafts((current) => ({ ...current, [server.name]: response.server.description ?? "" }));
			onServerSaved(response.server);
			setError(null);
		} catch (caught) {
			setError(caught instanceof Error ? caught.message : String(caught));
		} finally {
			setSavingServer(null);
		}
	};

	return (
		<div className="flex h-full min-h-0 flex-col bg-[#101d22]">
			<div className="flex h-14 items-center justify-between gap-3 border-b border-slate-800 bg-[#151f24] px-4">
				<div className="min-w-0">
					<div className="text-[10px] font-bold uppercase tracking-[0.14em] text-[#11a4d4]">Context</div>
					<h2 className="truncate text-base font-semibold text-slate-100">MCP Tools</h2>
					<div className="truncate font-mono text-[11px] text-slate-500">MCP server hints injected into agent context</div>
				</div>
				<span className="inline-flex h-8 items-center gap-1.5 border border-slate-700 bg-[#101d22] px-2.5 text-xs text-slate-300">
					<Server size={14} className="text-[#11a4d4]" />
					{servers.length} configured
				</span>
			</div>

			<div className="min-h-0 flex-1 overflow-auto p-4">
				{error ? <div className="mb-3 border border-red-500/60 bg-red-500/10 px-3 py-2 text-sm text-red-200">{error}</div> : null}
				{orderedServers.length === 0 ? (
					<div className="border border-dashed border-slate-700 bg-[#151f24] px-4 py-5 text-sm text-slate-500">
						No MCP servers are configured.
					</div>
				) : (
					<div className="grid gap-3">
						<div className="border border-slate-800 bg-[#151f24] px-4 py-3 text-sm text-slate-400">
							These short descriptions become the model-visible MCP context. Configure the server itself through the MCP CLI.
						</div>
						{orderedServers.map((server) => {
							const draft = drafts[server.name] ?? server.description ?? "";
							const changed = draft.trim() !== (server.description ?? "");
							const selected = server.name === selectedServerName;
							return (
								<section key={server.name} className={`border bg-[#151f24] ${selected ? "border-[#11a4d4]" : server.hasDescription ? "border-slate-800" : "border-[#f59e0b]/60"}`}>
									<div className="border-b border-slate-800 px-4 py-3">
										<div className="flex items-start justify-between gap-3">
											<div className="min-w-0">
												<div className="text-[10px] font-bold uppercase tracking-[0.14em] text-[#11a4d4]">MCP Tool Context</div>
												<h3 className="truncate text-sm font-semibold text-slate-100">{server.name}</h3>
												<div className="mt-1 font-mono text-[10px] text-slate-500">
													{server.transport}{server.descriptionSource ? ` / ${server.descriptionSource}` : ""}
												</div>
											</div>
											{server.hasDescription ? null : (
												<div className="inline-flex items-center gap-1.5 border border-[#f59e0b]/60 bg-[#f59e0b]/10 px-2 py-1 text-xs text-amber-100">
													<AlertTriangle size={13} />
													Missing
												</div>
											)}
										</div>
									</div>
									<div className="grid gap-2 px-4 py-4">
										<textarea
											value={draft}
											maxLength={480}
											disabled={!server.editable}
											onChange={(event) => setDrafts((current) => ({ ...current, [server.name]: event.target.value }))}
											className="min-h-[92px] min-w-0 resize-y border border-slate-700 bg-[#0e1116] px-3 py-2 text-sm text-slate-200 outline-none focus:border-[#11a4d4] disabled:opacity-60"
											placeholder="Short agent-facing MCP context"
										/>
										<div className="flex items-center justify-between gap-3">
											<div className="text-xs text-slate-500">
												{server.editable ? "Stored as Pibo MCP metadata." : "Registry-provided context is read-only."}
											</div>
											<button
												type="button"
												disabled={!server.editable || savingServer === server.name || !changed || !draft.trim()}
												onClick={() => void saveDescription(server)}
												title="Save MCP Tool Context"
												aria-label="Save MCP Tool Context"
												className="h-8 w-8 inline-flex items-center justify-center border border-[#11a4d4] bg-[#11a4d4]/10 text-[#11a4d4] disabled:opacity-50"
											>
												<Save size={14} />
											</button>
										</div>
									</div>
								</section>
							);
						})}
					</div>
				)}
			</div>
		</div>
	);
}

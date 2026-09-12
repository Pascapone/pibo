import type { AgentCatalog } from "../types";

/** Retained legacy link diagnosis. Configuration belongs to the effective MCP owner plugin. */
export function McpToolsView({ servers, selectedServerName }: {
	servers: AgentCatalog["mcpServers"];
	selectedServerName: string | null;
	onServerSaved: (server: AgentCatalog["mcpServers"][number]) => void;
}) {
	return <section className="p-3 text-xs space-y-3">
		<h2 className="font-bold uppercase">MCP context editor moved</h2>
		<p>Open the effective MCP plugin’s Context subview in this session. This legacy inspector does not write a second configuration.</p>
		{servers.filter((server) => !selectedServerName || server.name === selectedServerName).map((server) => <details key={server.name} className="border border-slate-700 p-2"><summary>{server.name}</summary><pre className="whitespace-pre-wrap">{server.description || "No retained description"}</pre></details>)}
	</section>;
}

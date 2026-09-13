import type { PluginManager } from "./manager.js";
import { PluginValidationError, pluginErrorMessage } from "./store.js";
import type { PluginSourceInput } from "./sources.js";

const help: Record<string, string[]> = {
	plugins: ["pibo plugins <command>", "list | inspect | install | update | activate | status | doctor | uninstall | operations | recover | config", "Next: pibo plugins <command> --help"],
	list: ["pibo plugins list [--json]", "Next: pibo plugins status <plugin-id>"],
	inspect: ["pibo plugins inspect <directory> [--json]", "Package: --package-name <name> --package-version <exact-version> [--integrity <sha256-base64>] (source is a .tgz file)", "Inspection never imports plugin code."],
	install: ["pibo plugins install <directory-or-tgz> --expected-revision <number> [--dry-run] [--json]", "Package: --package-name <name> --package-version <exact-version> [--integrity <sha256-base64>]", "Expected revision 0 creates a new installation. Installation does not activate code.", "Next: pibo plugins activate --help"],
	update: ["pibo plugins update <directory-or-tgz> --expected-revision <number> [--dry-run] [--json]", "Package: --package-name <name> --package-version <exact-version>", "Updates are staged and wait for a controlled activation boundary."],
	activate: ["pibo plugins activate <plugin-id> --expected-revision <number> [--json]", "Requires the owning host lifecycle. Existing work drains; no run is aborted."],
	status: ["pibo plugins status [plugin-id] [--json]", "Next: pibo plugins doctor [plugin-id]"],
	doctor: ["pibo plugins doctor [plugin-id] [--json]", "Shows lifecycle/collector availability, revisions, pending changes and operation errors."],
	uninstall: ["pibo plugins uninstall <action>", "plan | confirm", "Next: pibo plugins uninstall plan --help"],
	"uninstall plan": ["pibo plugins uninstall plan <plugin-id> [--json]", "Creates an expiring server-side impact plan. Counts unique Pibo Sessions; sessions and data remain."],
	"uninstall confirm": ["pibo plugins uninstall confirm <plan-id> --plugin-id-text <exact-plugin-id> --expected-revision <number> [--json]", "Rechecks consumers and revision, closes admission and drains existing work. No implicit abort."],
	operations: ["pibo plugins operations <action>", "list | show | resume | cancel", "Next: pibo plugins operations resume --help"],
	"operations list": ["pibo plugins operations list [--json]"],
	"operations show": ["pibo plugins operations show <operation-id> [--json]"],
	"operations resume": ["pibo plugins operations resume <operation-id> [--json]", "Revalidates consumer sets before completing drain/removal."],
	"operations cancel": ["pibo plugins operations cancel <operation-id> [--json]", "Restores prior admission only when the host proves the prior executable state is intact."],
	recover: ["pibo plugins recover [--json]", "Reconciles durable checkpoints with real host state. Uncertain cleanup stays blocked."],
	config: ["pibo plugins config <action>", "show | set | schema", "Next: pibo plugins config set --help"],
	"config show": ["pibo plugins config show <plugin-id> --scope app|agent|session [--target-id <id>] [--json]"],
	"config set": ["pibo plugins config set <plugin-id> --scope app|agent|session [--target-id <id>] --schema-version <number> --expected-revision <number> --values-json <object> [--json]", "Values replace this explicit target through the plugin schema and CAS. Credentials must be secretRef objects."],
	"config schema": ["pibo plugins config schema <plugin-id> [--json]"],
};
export async function runPluginCli(args: readonly string[], options: { manager: PluginManager | (() => PluginManager | Promise<PluginManager>); write?: (text: string) => void }): Promise<number> {
	const write = options.write ?? ((text: string) => process.stdout.write(`${text}\n`));
	const json = args.includes("--json");
	try {
		const positional: string[] = []; const flags = new Map<string, string>();
		const booleanFlags = new Set(["--json", "--help", "--dry-run"]);
		const valueFlags = new Set(["--expected-revision", "--package-name", "--package-version", "--integrity", "--plugin-id-text", "--scope", "--target-id", "--schema-version", "--values-json"]);
		for (let index = 0; index < args.length; index++) {
			const arg = args[index]!;
			if (booleanFlags.has(arg)) { if (flags.has(arg)) throw new PluginValidationError(`Duplicate option: ${arg}`); flags.set(arg, "true"); }
			else if (valueFlags.has(arg)) {
				if (flags.has(arg) || !args[index + 1] || args[index + 1]!.startsWith("--")) throw new PluginValidationError(`Missing/duplicate value for ${arg}`);
				flags.set(arg, args[++index]!);
			} else if (arg.startsWith("-")) throw new PluginValidationError(`Unknown option: ${arg}`);
			else positional.push(arg);
		}
		const command = positional[0] ?? "plugins";
		const nested = ["uninstall", "operations", "config"].includes(command);
		const branch = nested && positional[1] ? `${command} ${positional[1]}` : command;
		if (!help[branch]) throw new PluginValidationError(`Unknown plugin command: ${branch}`);
		if (flags.has("--help") || command === "plugins" || (nested && positional.length === 1)) { write(help[branch]!.join("\n")); return 0; }
		const allowed: Record<string, string[]> = {
			inspect: ["--package-name", "--package-version", "--integrity"],
			install: ["--package-name", "--package-version", "--integrity", "--expected-revision", "--dry-run"],
			update: ["--package-name", "--package-version", "--integrity", "--expected-revision", "--dry-run"],
			activate: ["--expected-revision"],
			"uninstall confirm": ["--plugin-id-text", "--expected-revision"],
			"config show": ["--scope", "--target-id"],
			"config set": ["--scope", "--target-id", "--expected-revision", "--schema-version", "--values-json"],
		};
		for (const flag of flags.keys()) if (flag !== "--json" && !(allowed[branch] ?? []).includes(flag)) throw new PluginValidationError(`Option ${flag} is not supported by ${branch}; nothing was changed`);
		const positionalLimits: Record<string, number> = { list: 1, inspect: 2, install: 2, update: 2, activate: 2, status: 2, doctor: 2, "uninstall plan": 3, "uninstall confirm": 3, "operations list": 2, "operations show": 3, "operations resume": 3, "operations cancel": 3, recover: 1, "config show": 3, "config set": 3, "config schema": 3 };
		if (positional.length > positionalLimits[branch]!) throw new PluginValidationError(`Unexpected arguments for ${branch}; use --help`);
		const manager = typeof options.manager === "function" ? await options.manager() : options.manager;
		const required = (value: string | undefined, label: string) => { if (!value) throw new PluginValidationError(`${label} is required; use --help`); return value; };
		const expectedRevision = () => {
			const value = required(flags.get("--expected-revision"), "--expected-revision");
			if (!/^\d+$/.test(value) || !Number.isSafeInteger(Number(value))) throw new PluginValidationError("Expected a nonnegative CAS revision");
			return Number(value);
		};
		const source = (): PluginSourceInput => {
			const path = required(positional[1], "source path");
			if (flags.has("--package-name") || flags.has("--package-version")) return { kind: "package", path, name: required(flags.get("--package-name"), "--package-name"), version: required(flags.get("--package-version"), "--package-version"), integrity: flags.get("--integrity") };
			return { kind: "local", path };
		};
		let result: unknown;
		switch (branch) {
			case "list": result = { installations: manager.store.listInstallations() }; break;
			case "inspect": result = await manager.inspect(source()); break;
			case "install":
			case "update": result = await manager.install(source(), { expectedRevision: expectedRevision(), dryRun: flags.has("--dry-run") }); break;
			case "activate": result = await manager.activate(required(positional[1], "plugin ID"), { expectedRevision: expectedRevision() }); break;
			case "status":
			case "doctor": result = manager.diagnose(positional[1]); break;
			case "uninstall plan": result = await manager.planUninstall(required(positional[2], "plugin ID")); break;
			case "uninstall confirm": result = await manager.confirmUninstall({ planId: required(positional[2], "plan ID"), pluginIdText: required(flags.get("--plugin-id-text"), "--plugin-id-text"), expectedRevision: expectedRevision() }); break;
			case "operations list": result = manager.store.listOperations(); break;
			case "operations show": result = manager.store.getOperation(required(positional[2], "operation ID")); if (!result) throw new PluginValidationError("Unknown operation"); break;
			case "operations resume": result = await manager.resumeOperation(required(positional[2], "operation ID")); break;
			case "operations cancel": result = await manager.cancelOperation(required(positional[2], "operation ID")); break;
			case "recover": result = await manager.recover(); break;
			case "config schema": result = manager.store.getInstallation(required(positional[2], "plugin ID"))?.manifest.config ?? null; break;
			case "config show":
			case "config set": {
				const pluginId = required(positional[2], "plugin ID"); const scope = flags.get("--scope"); const targetId = flags.get("--target-id");
				if (scope === "app" && targetId && targetId !== "app") throw new PluginValidationError("App configuration cannot target an agent or session");
				const target = scope === "app" ? { scope, pluginId } as const : scope === "agent" ? { scope, pluginId, agentId: required(targetId, "--target-id") } as const : scope === "session" ? { scope, pluginId, piboSessionId: required(targetId, "--target-id") } as const : undefined;
				if (!target) throw new PluginValidationError("Explicit configuration scope required");
				if (branch === "config show") result = manager.getConfig(target) ?? null;
				else {
					const schemaVersion = Number(required(flags.get("--schema-version"), "--schema-version"));
					const values = JSON.parse(required(flags.get("--values-json"), "--values-json"));
					const revision = expectedRevision();
					result = manager.putConfig({ target, revision, schemaVersion, values }, revision);
				}
				break;
			}
		}
		if (!json && branch === "list") {
			const installations = manager.store.listInstallations();
			write(installations.length ? installations.map((item) => `${item.pluginId} ${item.version} ${item.state} state-revision=${item.stateRevision}`).join("\n") : "No installed plugins.");
			write("Next: pibo plugins inspect --help");
		} else if (!json && branch === "operations list") {
			const operations = manager.store.listOperations();
			write(operations.length ? operations.map((item) => `${item.id} ${item.pluginId} ${item.state} revision=${item.revision}`).join("\n") : "No plugin operations.");
			write("Next: pibo plugins operations show --help");
		} else write(JSON.stringify(result, null, json ? undefined : 2));
		return 0;
	} catch (error) {
		const value = { error: pluginErrorMessage(error, "Plugin command failed"), code: (error as { code?: string })?.code ?? "plugin-command-failed" };
		write(json ? JSON.stringify(value) : `${value.code}: ${value.error}`); return 1;
	}
}

/** Help/argument validation stays import-free; product storage and the owning host open only for an actual operation. */
export async function runDefaultPluginCli(args: readonly string[]): Promise<number> {
	let data: import("../data/pibo-store.js").PiboDataStore | undefined;
	let agentStore: import("../apps/chat/agent-store.js").CustomAgentStore | undefined;
	let registry: import("./registry.js").PiboPluginRegistry | undefined;
	let product: Awaited<ReturnType<typeof import("./product-runtime.js").startPluginProductRuntime>> | undefined;
	try {
		return await runPluginCli(args, { manager: async () => {
			if (product) return product.manager;
			const [dataModule, agentStoreModule, builtinModule, operationsModule, productModule, productServicesModule] = await Promise.all([
				import("../data/pibo-store.js"), import("../apps/chat/agent-store.js"), import("./builtin.js"),
				import("./operations.js"), import("./product-runtime.js"), import("./product-services.js"),
			]);
			data = new dataModule.PiboDataStore();
			agentStore = agentStoreModule.createDefaultCustomAgentStore();
			registry = builtinModule.createDefaultPiboPluginRegistry();
			const host = registry.getPluginHost();
			const catalog = () => {
				const installations = data!.plugins.listInstallations();
				return { schemaVersion: 1 as const, revision: installations.reduce((sum, installation) => sum + installation.stateRevision, 0), installations };
			};
			const collectProfiles = agentStoreModule.profileConsumerCollector(agentStore, catalog);
			const collectLive: import("./operations.js").PluginConsumerCollector = async (pluginId) => {
				const consumers: import("./operations.js").PluginConsumer[] = [];
				for (const info of registry!.getProfileInfos()) {
					const profile = builtinModule.createPiboProfileFromRegistryOrDefault(registry!, info.name);
					const entry = profile.pluginSelection?.plugins.find((candidate) => candidate.pluginId === pluginId);
					if (entry) consumers.push({ kind: "profile", id: info.name, usage: entry.enabled ? "optional" : "historical", revision: entry.revision });
				}
				for (const entry of host.contributions.list<import("./product-services.js").PluginOwnedConsumerCollector>(productServicesModule.PLUGIN_CONSUMER_COLLECTOR_RESOURCE)) {
					consumers.push(...await entry.value(pluginId));
				}
				return operationsModule.pluginImpact(consumers).consumers;
			};
			product = await productModule.startPluginProductRuntime({
				host,
				data,
				collectConsumers: operationsModule.createPluginConsumerCollector({ store: data, collectLive, collectProfiles }),
			});
			await product.recover();
			return product.manager;
		} });
	} finally {
		await product?.dispose();
		await registry?.disposePlugins();
		agentStore?.close();
		data?.close();
	}
}

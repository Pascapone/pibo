import { formatPiboRunReminderMessage, isPiboRunReminderServiceMessage } from "../runs/reminders.js";
import type { PiboRunNotification } from "../runs/registry.js";
import { createRunToolDefinitions } from "../runs/tools.js";
import type { PluginSetupContext } from "./host.js";
import { PIBO_SESSION_YIELDED_RUNS_SERVICE, PIBO_YIELDED_RUN_REMINDER_MESSAGE_KIND, definePluginSessionToolProvider, type PluginYieldedRunControl } from "./runtime.js";
import { registrationsForSelectedTools } from "./packaged-session-tool-helpers.js";

export function setupRunControl(context: PluginSetupContext): void {
	context.register("session-tools", definePluginSessionToolProvider({
		phase: "augment",
		includeNativeTools: true,
		serviceMessages: [{
			kind: PIBO_YIELDED_RUN_REMINDER_MESSAGE_KIND,
			format: (payload, messageContext) => formatPiboRunReminderMessage(payload as PiboRunNotification, messageContext.maxDurationMs),
			matches: isPiboRunReminderServiceMessage,
		}],
		createSession(providerContext) {
			const controller = providerContext.services.require<PluginYieldedRunControl>(PIBO_SESSION_YIELDED_RUNS_SERVICE);
			return {
				tools: registrationsForSelectedTools(providerContext, createRunToolDefinitions(providerContext.availableTools.map((tool) => tool.definition), controller)),
			};
		},
	}));
	context.register("settings", {});
}

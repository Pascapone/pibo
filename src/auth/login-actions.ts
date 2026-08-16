/**
 * @deprecated Pi-specific compatibility exports. Product auth routing must use
 * the selected Agent Runtime Adapter instead of importing these helpers.
 */
export {
	cancelLogin,
	completeLogin,
	getLoginStatus,
	removeLogin,
	setApiKey,
	startLogin,
	type LoginStatus,
	type PendingDeviceLogin,
	type PendingLogin,
} from "../agent-runtimes/pi/auth.js";

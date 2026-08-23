import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { ChatTerminalApp } from "./ChatTerminalApp";
import "../../../chat-ui/src/styles.css";

const queryClient = new QueryClient({
	defaultOptions: {
		queries: {
			refetchOnWindowFocus: false,
			retry: 1,
		},
	},
});

const container = document.getElementById("root");
if (container) {
	createRoot(container).render(
		<StrictMode>
			<QueryClientProvider client={queryClient}>
				<ChatTerminalApp />
			</QueryClientProvider>
		</StrictMode>,
	);
}

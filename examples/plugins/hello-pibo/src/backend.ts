import type { PluginSetupContext } from "@pasko70/pibo/plugin-host";

export function setup(context: PluginSetupContext): void {
  context.register("context", {
    key: "hello-pibo",
    path: "/virtual/hello-pibo.md",
    content: "Hello from an independently installed Pibo plugin."
  });
  context.register("view", { exportName: "HelloPiboView" });
}

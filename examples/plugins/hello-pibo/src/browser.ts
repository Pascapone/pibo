import type { PluginBrowserSetup, PluginViewProps } from "@pasko70/pibo/plugin-sdk";

export function HelloPiboView(_props: PluginViewProps): string {
  return "Hello from an independently installed Pibo plugin.";
}

export function setup(_host: PluginBrowserSetup): undefined {
  return undefined;
}

export function formatNextCommands(commands: Array<string | undefined>): string[] {
	const unique = [...new Set(commands.filter((command): command is string => Boolean(command)))].slice(0, 5);
	if (unique.length === 0) return [];
	return ["", "Next:", ...unique.map((command) => `  ${command}`)];
}

import Prism from "prismjs";

type PrismStatic = typeof Prism;

declare global {
	interface Window {
		Prism?: PrismStatic;
	}
}

function hasPrismCore(value: unknown): value is PrismStatic {
	return typeof value === "object" && value !== null && "languages" in value;
}

const prismGlobal = globalThis as typeof globalThis & { Prism?: PrismStatic };
const prism = hasPrismCore(prismGlobal.Prism) ? prismGlobal.Prism : Prism;

prismGlobal.Prism = prism;

if (typeof window !== "undefined") {
	window.Prism = prism;
}

export default prism;

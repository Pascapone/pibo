// ESM loader stub for tsx-based SSR tests: chat-ui components import side-effect
// stylesheets (e.g. FolderPickerDialog -> folder-picker.css) that Node cannot load.
// Treat every .css import as an empty module so server rendering can proceed.
export async function resolve(specifier, context, next) {
	if (typeof specifier === "string" && specifier.endsWith(".css")) {
		return { url: new URL(specifier, context.parentURL).href, shortCircuit: true };
	}
	return next(specifier, context);
}

export async function load(url, context, next) {
	if (typeof url === "string" && url.endsWith(".css")) {
		return { format: "module", source: "export default {};", shortCircuit: true };
	}
	return next(url, context);
}

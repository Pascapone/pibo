/** Acquire native-process ownership before importing the harness or its history. */
export function createOmpPrefixBootstrapSource(input: {
	entryModuleUrl: string;
	prefixRoot: string;
	identities: readonly string[];
	nativeSessionId?: string;
}): string {
	if (new URL(input.entryModuleUrl).protocol !== "file:" || !input.identities.length) {
		throw new Error("OMP protected bootstrap requires a local native entry and ownership identities");
	}
	const ownershipModuleUrl = new URL("../../sessions/prefix-ownership.js", import.meta.url).href;
	return `import { PrefixSessionOwnership } from ${JSON.stringify(ownershipModuleUrl)};
let ownership;
try {
  ownership = await PrefixSessionOwnership.acquire(${JSON.stringify(input.prefixRoot)}, ${JSON.stringify(input.identities)});
} catch {
  process.stderr.write("Pibo native prefix recovery required: ownership\\n");
  process.exit(78);
}
// Retain the lock for the child's lifetime, including after parent death.
// Ordinary native exit closes connections; SIGKILL releases kernel locks.
const nativeOwners = [];
const heldIdentities = new Set(${JSON.stringify(input.identities)});
let claimedNative = ${JSON.stringify(input.nativeSessionId) ?? "undefined"};
globalThis[Symbol.for("pibo.omp.prefix.claimNative")] = async nativeSessionId => {
  if (typeof nativeSessionId !== "string" || !nativeSessionId || nativeSessionId.length > 1024
    || claimedNative && claimedNative !== nativeSessionId) throw new Error("Native ownership identity changed");
  const identity = JSON.stringify(["native", "orp", nativeSessionId]);
  if (!heldIdentities.has(identity)) {
    nativeOwners.push(await PrefixSessionOwnership.acquire(${JSON.stringify(input.prefixRoot)}, [identity]));
    heldIdentities.add(identity);
  }
  claimedNative = nativeSessionId;
};
process.once("exit", () => { for (const owner of nativeOwners.reverse()) owner.release(); ownership.release(); });
try {
  const { runCli } = await import(${JSON.stringify(input.entryModuleUrl)});
  if (typeof runCli !== "function") throw new Error("Unsupported native entry");
  await runCli(process.argv.slice(2));
} catch {
  process.stderr.write("Pibo native prefix recovery required: native-entry\\n");
  process.exit(78);
}
`;
}

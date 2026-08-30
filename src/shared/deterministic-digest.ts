export function deterministicDigest(value: unknown): string {
	return sha256Hex(new TextEncoder().encode(canonicalJson(value)));
}

export function canonicalJson(value: unknown): string {
	if (value === null || typeof value === "string" || typeof value === "boolean") return JSON.stringify(value);
	if (typeof value === "number") return Number.isFinite(value) ? JSON.stringify(value) : "null";
	if (typeof value === "bigint") return JSON.stringify(value.toString());
	if (Array.isArray(value)) return `[${value.map((item) => canonicalJson(item)).join(",")}]`;
	if (typeof value !== "object") return "null";
	const record = value as Record<string, unknown>;
	const entries = Object.keys(record)
		.filter((key) => record[key] !== undefined)
		.sort()
		.map((key) => `${JSON.stringify(key)}:${canonicalJson(record[key])}`);
	return `{${entries.join(",")}}`;
}

function sha256Hex(bytes: Uint8Array): string {
	const bitLength = bytes.length * 8;
	const paddedLength = Math.ceil((bytes.length + 9) / 64) * 64;
	const padded = new Uint8Array(paddedLength);
	padded.set(bytes);
	padded[bytes.length] = 0x80;
	const view = new DataView(padded.buffer);
	const high = Math.floor(bitLength / 0x1_0000_0000);
	const low = bitLength >>> 0;
	view.setUint32(paddedLength - 8, high);
	view.setUint32(paddedLength - 4, low);

	const constants: number[] = [];
	const hash: number[] = [];
	for (let candidate = 2; constants.length < 64; candidate += 1) {
		let prime = true;
		for (let divisor = 2; divisor * divisor <= candidate; divisor += 1) {
			if (candidate % divisor === 0) {
				prime = false;
				break;
			}
		}
		if (!prime) continue;
		if (hash.length < 8) hash.push(fractionalBits(Math.sqrt(candidate)));
		const cubeRoot = Math.cbrt ? Math.cbrt(candidate) : candidate ** (1 / 3);
		constants.push(fractionalBits(cubeRoot));
	}

	const words = new Uint32Array(64);
	for (let offset = 0; offset < paddedLength; offset += 64) {
		for (let index = 0; index < 16; index += 1) words[index] = view.getUint32(offset + index * 4);
		for (let index = 16; index < 64; index += 1) {
			const left = words[index - 15];
			const right = words[index - 2];
			const sigma0 = rotateRight(left, 7) ^ rotateRight(left, 18) ^ (left >>> 3);
			const sigma1 = rotateRight(right, 17) ^ rotateRight(right, 19) ^ (right >>> 10);
			words[index] = (words[index - 16] + sigma0 + words[index - 7] + sigma1) >>> 0;
		}
		let [a, b, c, d, e, f, g, h] = hash;
		for (let index = 0; index < 64; index += 1) {
			const sum1 = rotateRight(e, 6) ^ rotateRight(e, 11) ^ rotateRight(e, 25);
			const choice = (e & f) ^ (~e & g);
			const temporary1 = (h + sum1 + choice + constants[index] + words[index]) >>> 0;
			const sum0 = rotateRight(a, 2) ^ rotateRight(a, 13) ^ rotateRight(a, 22);
			const majority = (a & b) ^ (a & c) ^ (b & c);
			const temporary2 = (sum0 + majority) >>> 0;
			h = g;
			g = f;
			f = e;
			e = (d + temporary1) >>> 0;
			d = c;
			c = b;
			b = a;
			a = (temporary1 + temporary2) >>> 0;
		}
		hash[0] = (hash[0] + a) >>> 0;
		hash[1] = (hash[1] + b) >>> 0;
		hash[2] = (hash[2] + c) >>> 0;
		hash[3] = (hash[3] + d) >>> 0;
		hash[4] = (hash[4] + e) >>> 0;
		hash[5] = (hash[5] + f) >>> 0;
		hash[6] = (hash[6] + g) >>> 0;
		hash[7] = (hash[7] + h) >>> 0;
	}
	return hash.map((word) => word.toString(16).padStart(8, "0")).join("");
}

function fractionalBits(value: number): number {
	return Math.floor((value - Math.floor(value)) * 0x1_0000_0000) >>> 0;
}

function rotateRight(value: number, bits: number): number {
	return (value >>> bits) | (value << (32 - bits));
}

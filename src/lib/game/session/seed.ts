export function randomSeed(): number {
	if (typeof crypto !== 'undefined' && 'getRandomValues' in crypto) {
		const buffer = new Uint32Array(1);
		crypto.getRandomValues(buffer);
		return buffer[0] || 1;
	}
	return (Date.now() ^ (Math.random() * 0xffffffff)) >>> 0 || 1;
}

export function parseSeed(raw: string): number | null {
	const cleaned = raw.trim().replace(/^0x/i, '');
	if (!/^[0-9a-f]{1,8}$/i.test(cleaned)) return null;
	return Number.parseInt(cleaned, 16) >>> 0;
}

export function readSeedFromLocation(): number {
	try {
		const raw = new URLSearchParams(window.location.search).get('seed');
		if (raw) {
			const parsed = Number.parseInt(raw, 10);
			if (Number.isFinite(parsed) && parsed >= 0) return parsed >>> 0;
			const hex = parseSeed(raw);
			if (hex !== null) return hex;
		}
	} catch {
		// URL parsing is best-effort; a random world is a valid fallback.
	}
	return randomSeed();
}

export function seedHexFor(seed: number): string {
	return (seed >>> 0).toString(16).toUpperCase().padStart(8, '0');
}

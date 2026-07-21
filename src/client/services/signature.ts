/**
 * Turns an address (a user's public key, base58) into a unique, handwritten-
 * looking signature rendered as an SVG string.
 *
 * The whole thing is a pure, deterministic function of the address: the same
 * address always draws the same signature, and two different addresses draw
 * different ones (the public key's bytes seed every random-looking choice, so
 * the odds of a visible collision are the odds of a hash collision). Nothing
 * here is cryptographic — it's decoration you can trust to stay stable.
 *
 * Variety is the point, so the seed picks "style genes" up front — slant, pen
 * weight, curve tension, how many humps, how it starts, how it ends — and how
 * many separate pen strokes it's made of: some come out as one unbroken line,
 * others as a distinct initial, two "words" split by a pen-lift, a detached
 * underline, a dot, a cross-bar, in almost any combination. Two addresses don't
 * just jitter along one silhouette; they can be genuinely different hands.
 *
 * Everything is drawn in a local space, then rotated for slant and scaled to
 * fit the frame — and the fit measures the *curves* (by sampling them), not the
 * skeleton points, so the flourishes that bow past their points never clip. The
 * pen paints in `currentColor`, inheriting whatever text colour surrounds it.
 *
 * Lives in the client (not `shared`) because only the UI needs to draw a face
 * for an address; the relay never does.
 */

import { base58ToBytes, utf8ToBytes } from '@/shared/encoding';

/** Size of the drawing surface, in viewBox units. Everything is fit into it. */
const VIEW_W = 200;
const VIEW_H = 80;

type Point = [number, number];
/** A pen stroke: the ordered points the nib passes through. */
type Stroke = Point[];
/** A cubic Bézier: start, two controls, end. */
type Segment = [Point, Point, Point, Point];

/**
 * Fold every byte of the seed into one 32-bit number (FNV-1a). Feeding the
 * public key's raw bytes through this spreads even near-identical addresses to
 * wildly different starting points.
 */
function seedFrom(bytes: Uint8Array): number {
	let hash = 0x811c9dc5;
	for (const byte of bytes) {
		hash ^= byte;
		hash = Math.imul(hash, 0x01000193);
	}
	return hash >>> 0;
}

/** mulberry32 — a tiny, fast, seedable PRNG. Deterministic given its seed. */
function makeRng(seed: number): () => number {
	let a = seed >>> 0;
	return () => {
		a = (a + 0x6d2b79f5) | 0;
		let t = Math.imul(a ^ (a >>> 15), 1 | a);
		t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
		return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
	};
}

/** Trim a coordinate to two decimals and drop trailing zeros, to keep the
 * generated `d` string short. */
function fmt(n: number): string {
	return String(Number(n.toFixed(2)));
}

/**
 * Turn a stroke's points into cubic Bézier segments (Catmull-Rom). `k` is the
 * tangent strength: small values hug the points for a tight, angular hand;
 * larger ones bow out into rounder, loopier strokes. A lone point becomes a
 * hair-length segment so a round cap renders it as a dot.
 */
function toSegments(points: Stroke, k: number): Segment[] {
	if (points.length === 1) {
		const [p] = points;
		const q: Point = [p[0] + 0.01, p[1]];
		return [[p, p, q, q]];
	}
	const segments: Segment[] = [];
	for (let i = 0; i < points.length - 1; i++) {
		const p0 = points[i - 1] ?? points[i];
		const p1 = points[i];
		const p2 = points[i + 1];
		const p3 = points[i + 2] ?? p2;
		const c1: Point = [
			p1[0] + (p2[0] - p0[0]) * k,
			p1[1] + (p2[1] - p0[1]) * k,
		];
		const c2: Point = [
			p2[0] - (p3[0] - p1[0]) * k,
			p2[1] - (p3[1] - p1[1]) * k,
		];
		segments.push([p1, c1, c2, p2]);
	}
	return segments;
}

/** The style genes read off the seed before a single point is drawn. */
interface Genes {
	slant: number; // radians the whole mark is tilted by
	weight: number; // stroke width, in final viewBox units
	tension: number; // spline tangent strength (angular ↔ loopy)
}

/**
 * Lay down the strokes of the signature in a local, unscaled space (baseline at
 * y = 0, ascenders negative, descenders positive). Every macro choice — how it
 * starts, how many humps, whether the pen lifts mid-way, how it ends, what
 * accents it gets — comes off `rng`, so seeds differ in structure, not just
 * wiggle, and in how many separate strokes they're built from.
 */
function draw(rng: () => number): { strokes: Stroke[]; genes: Genes } {
	const amp = 20 + rng() * 20; // hump height
	const humps = 3 + Math.floor(rng() * 6); // 3..8
	const step = 22 + rng() * 16; // average horizontal advance per hump
	const crossProb = 0.2 + rng() * 0.55; // chance of a crossing loop per hump
	const ascProb = 0.18 + rng() * 0.5; // chance a hump reaches up as an ascender
	const descProb = 0.12 + rng() * 0.4; // chance a hump dips into a descender
	const drift = (rng() - 0.5) * amp * 0.5; // baseline creep across the whole mark

	const strokes: Stroke[] = [];
	let x = 0;
	let base = 0;

	// A separate initial capital — its own pen stroke, sitting to the left.
	if (rng() < 0.32) {
		strokes.push([
			[x + step * 0.15, amp * 0.4],
			[x - step * 0.25, -amp],
			[x + step * 0.55, -amp * (1.2 + rng() * 0.4)],
			[x + step * 0.7, amp * 0.1],
			[x + step * 0.3, amp * (0.7 + rng() * 0.4)],
		]);
		x += step * (1.1 + rng() * 0.4);
	}

	const bodyStart = x;

	// Where (if anywhere) the pen lifts mid-body, splitting it into two "words".
	const splitAt =
		humps >= 4 && rng() < 0.45 ? 2 + Math.floor(rng() * (humps - 2)) : -1;

	let cur: Stroke = [];
	if (rng() < 0.5) {
		cur.push([x, amp * 0.2], [x + step * 0.25, -amp * 0.2]);
		x += step * 0.3;
	} else {
		cur.push([x, amp * 0.1]);
	}

	// Body: a run of humps, each rising to a top and returning near the baseline.
	for (let i = 0; i < humps; i++) {
		if (i === splitAt) {
			strokes.push(cur);
			cur = [];
			x += step * (0.35 + rng() * 0.35); // gap between words
			cur.push([x, base + amp * 0.15]); // touch down for the next word
		}
		const s = step * (0.7 + rng() * 0.6); // irregular spacing
		const top = -(rng() < ascProb
			? amp * (1 + rng() * 0.6)
			: amp * (0.3 + rng() * 0.5));
		cur.push([x + s * 0.45, base + top]);
		if (rng() < crossProb) cur.push([x + s * 0.2, base + top * 0.4]);
		const bottom =
			rng() < descProb ? amp * (0.6 + rng() * 0.7) : rng() * amp * 0.2;
		base += drift / humps;
		cur.push([x + s, base + bottom]);
		x += s;
	}
	const endX = x;

	// Ending: a detached underline, or a flourish tacked onto the body, or a
	// plain lift.
	if (rng() < 0.4) {
		strokes.push(cur);
		const underline: Stroke = [
			[endX + step * 0.15, base + amp * 0.55],
			[(bodyStart + endX) / 2, base + amp * (1 + rng() * 0.4)],
			[bodyStart - step * 0.1, base + amp * 0.5],
		];
		if (rng() < 0.5)
			underline.push([bodyStart + step * 0.3, base + amp * 0.05]);
		strokes.push(underline);
	} else {
		switch (Math.floor(rng() * 4)) {
			case 1: // whip upward into a long tail
				cur.push([
					endX + step * (0.4 + rng() * 0.6),
					base - amp * (1.2 + rng() * 0.9),
				]);
				break;
			case 2: // trail downward into a descending tail
				cur.push([
					endX + step * (0.3 + rng() * 0.6),
					base + amp * (1 + rng() * 0.9),
				]);
				break;
			case 3: // loop up and back over the top
				cur.push([endX + step * 0.3, base - amp * (0.8 + rng() * 0.5)]);
				cur.push([
					endX * 0.6 + bodyStart * 0.4,
					base - amp * (1.1 + rng() * 0.4),
				]);
				cur.push([endX * 0.6, base + amp * 0.6]);
				break;
			// case 0: plain lift.
		}
		strokes.push(cur);
	}

	// Independent pen-lift accents — either, both, or neither.
	if (rng() < 0.28) {
		const dx = bodyStart + (endX - bodyStart) * (0.3 + rng() * 0.5);
		strokes.push([[dx, base - amp * 1.55]]);
	}
	if (rng() < 0.22) {
		const cx = bodyStart + (endX - bodyStart) * (0.25 + rng() * 0.4);
		strokes.push([
			[cx - step * 0.5, base - amp * (0.6 + rng() * 0.3)],
			[cx + step * 0.6, base - amp * (0.85 + rng() * 0.3)],
		]);
	}

	return {
		strokes,
		genes: {
			slant: (rng() * 30 - 12) * (Math.PI / 180), // -12°..+18°
			weight: 1 + rng() * 0.9, // 1.0..1.9 — a fine pen, lightly varied
			tension: 0.1 + rng() * 0.18, // 0.10..0.28
		},
	};
}

/**
 * Rotate every stroke by the slant, measure the true curve extent by sampling
 * the Béziers (so overshooting flourishes are counted), then scale and centre
 * to fill the frame with a margin that clears the pen's own width. Emits the
 * finished `d`.
 */
function fitToFrame(strokes: Stroke[], genes: Genes): string {
	const cos = Math.cos(genes.slant);
	const sin = Math.sin(genes.slant);
	const segStrokes = strokes.map((stroke) =>
		toSegments(
			stroke.map(([x, y]): Point => [x * cos - y * sin, x * sin + y * cos]),
			genes.tension,
		),
	);

	// True bounding box: walk each cubic and sample it, not just its endpoints.
	let minX = Infinity;
	let minY = Infinity;
	let maxX = -Infinity;
	let maxY = -Infinity;
	const STEPS = 14;
	for (const segs of segStrokes) {
		for (const [p0, c1, c2, p3] of segs) {
			for (let j = 0; j <= STEPS; j++) {
				const t = j / STEPS;
				const u = 1 - t;
				const a = u * u * u;
				const b = 3 * u * u * t;
				const c = 3 * u * t * t;
				const e = t * t * t;
				const px = a * p0[0] + b * c1[0] + c * c2[0] + e * p3[0];
				const py = a * p0[1] + b * c1[1] + c * c2[1] + e * p3[1];
				if (px < minX) minX = px;
				if (px > maxX) maxX = px;
				if (py < minY) minY = py;
				if (py > maxY) maxY = py;
			}
		}
	}

	const pad = genes.weight / 2 + 3; // half the nib, plus a little breathing room
	const availW = VIEW_W - pad * 2;
	const availH = VIEW_H - pad * 2;
	const scale = Math.min(
		availW / Math.max(maxX - minX, 0.001),
		availH / Math.max(maxY - minY, 0.001),
	);
	const offX = pad + (availW - (maxX - minX) * scale) / 2 - minX * scale;
	const offY = pad + (availH - (maxY - minY) * scale) / 2 - minY * scale;
	const tx = (x: number) => fmt(x * scale + offX);
	const ty = (y: number) => fmt(y * scale + offY);

	return segStrokes
		.map((segs) => {
			let d = `M ${tx(segs[0][0][0])} ${ty(segs[0][0][1])}`;
			for (const [, c1, c2, p3] of segs) {
				d += ` C ${tx(c1[0])} ${ty(c1[1])} ${tx(c2[0])} ${ty(c2[1])} ${tx(p3[0])} ${ty(p3[1])}`;
			}
			return d;
		})
		.join(' ');
}

/**
 * Build a unique, deterministic handwritten-style signature for an address.
 *
 * @param address the user's public key as text (base58). A non-base58 string
 *   still works — its raw characters seed the drawing instead.
 * @returns a self-contained `<svg>` string that strokes in `currentColor`.
 */
export function signature(address: string): string {
	let bytes: Uint8Array;
	try {
		bytes = base58ToBytes(address);
	} catch {
		bytes = utf8ToBytes(address);
	}

	const rng = makeRng(seedFrom(bytes));
	const { strokes, genes } = draw(rng);
	const d = fitToFrame(strokes, genes);

	return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${VIEW_W} ${VIEW_H}" fill="none" stroke="currentColor" stroke-width="${fmt(genes.weight)}" stroke-linecap="round" stroke-linejoin="round" role="img" aria-label="signature"><path d="${d}"/></svg>`;
}

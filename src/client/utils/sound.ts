const DING_THROTTLE_MS = 2000;
let lastDingAt = 0;
let audioContext: AudioContext | null = null;

export const playDing = () => {
	// Web Audio is absent in some runtimes (an older browser, a non-browser
	// environment). There's nothing to fall back to for a decorative chime, so
	// stay silent rather than pretending.
	if (typeof AudioContext === 'undefined') return;

	const now = Date.now();
	if (now - lastDingAt < DING_THROTTLE_MS) return;
	lastDingAt = now;

	try {
		audioContext ??= new AudioContext();
		// A context created outside a user gesture starts suspended; nudge it. The
		// browser may refuse, which is fine — it just means no sound this time.
		void audioContext.resume().catch(() => {});
		const ctx = audioContext;
		const start = ctx.currentTime;
		const osc = ctx.createOscillator();
		const gain = ctx.createGain();
		osc.type = 'sine';
		osc.frequency.setValueAtTime(880, start);
		osc.frequency.setValueAtTime(1174, start + 0.1);
		gain.gain.setValueAtTime(0.0001, start);
		gain.gain.exponentialRampToValueAtTime(0.15, start + 0.02);
		gain.gain.exponentialRampToValueAtTime(0.0001, start + 0.3);
		osc.connect(gain).connect(ctx.destination);
		osc.start(start);
		osc.stop(start + 0.32);
	} catch (_) {
		// Constructing a context can fail outright even where the API exists —
		// Safari caps how many one page may hold. A decorative chime is never
		// worth surfacing, so this stays the util's own problem rather than
		// something every caller has to wrap.
	}
};

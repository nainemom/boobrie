const DING_THROTTLE_MS = 2000;
let lastDingAt = 0;
let audioContext: AudioContext | null = null;

export const playDing = () => {
	const now = Date.now();
	if (now - lastDingAt < DING_THROTTLE_MS) return;
	lastDingAt = now;
	try {
		audioContext ??= new AudioContext();
		// A context created outside a user gesture starts suspended; nudge it.
		void audioContext.resume();
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
	} catch (_) {}
};

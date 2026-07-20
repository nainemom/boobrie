const MINUTE = 60 * 1000;
const HOUR = 60 * MINUTE;

if (!process.env.JWT_SECRET) {
	throw new Error('JWT_SECRET env is not found');
}

if (!process.env.DB_URL) {
	throw new Error('DB_URL env is not found');
}

function readVapid() {
	const publicKey = process.env.VAPID_PUBLIC_KEY;
	const privateKey = process.env.VAPID_PRIVATE_KEY;
	if (!publicKey || !privateKey) return null;
	return {
		publicKey,
		privateKey,
		subject: process.env.VAPID_SUBJECT ?? 'mailto:admin@boobrie.local',
	};
}

/** NOWPayments (USDT deposits). Needs an API key, an IPN secret to verify
 * callbacks, and a publicly reachable base URL so the provider can reach our
 * IPN endpoint. Missing any of these disables deposits (like push without VAPID). */
function readNowPayments() {
	const apiKey = process.env.NOWPAYMENTS_API_KEY;
	const ipnSecret = process.env.NOWPAYMENTS_IPN_SECRET;
	const publicUrl = process.env.RELAY_PUBLIC_URL;
	if (!apiKey || !ipnSecret || !publicUrl) return null;
	return {
		apiKey,
		ipnSecret,
		publicUrl,
		// SDK base URL is host-only; it appends the `/v1/...` paths itself.
		baseUrl: process.env.NOWPAYMENTS_API_URL ?? 'https://api.nowpayments.io',
		payCurrency: process.env.NOWPAYMENTS_PAY_CURRENCY ?? 'usdttrc20',
	};
}

export const config = {
	port: Number(process.env.RELAY_PORT ?? 5200),
	host: process.env.RELAY_HOST ?? '0.0.0.0',
	jwtSecret: process.env.JWT_SECRET,
	challengeTtlMs: 2 * MINUTE,
	sessionTtlMs: 1 * HOUR,
	corsOrigin: process.env.RELAY_CORS_ORIGIN ?? true,
	dbUrl: process.env.DB_URL,
	vapid: readVapid(),
	nowPayments: readNowPayments(),
} as const;

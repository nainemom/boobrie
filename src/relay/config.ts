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
	const subject = process.env.VAPID_SUBJECT;
	if (!publicKey || !privateKey || !subject) return null;
	return {
		publicKey,
		privateKey,
		subject,
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
} as const;

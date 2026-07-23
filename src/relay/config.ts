const MINUTE = 60 * 1000;
const HOUR = 60 * MINUTE;

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
	jwtSecret: process.env.JWT_SECRET ?? '---',
	challengeTtlMs: 2 * MINUTE,
	sessionTtlMs: 1 * HOUR,
	corsOrigin: process.env.CORS_ORIGIN?.split(' ') || '*',
	dbUrl: process.env.DB_POSTGRES_URL ?? '',
	vapid: readVapid(),
} as const;

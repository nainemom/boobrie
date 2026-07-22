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

function readDb() {
	const database = process.env.DB_DATABASE as string;
	const host = process.env.DB_HOST as string;
	const user = process.env.DB_USER as string;
	const password = process.env.DB_PASSWORD as string;
	const port = +(process.env.DB_PORT as string);
	const ssl = !!process.env.DB_SSL;
	if (!database || !host || !user || !password || !port) return null;
	return {
		database,
		host,
		user,
		password,
		port,
		ssl,
	};
}

export const config = {
	port: Number(process.env.RELAY_PORT ?? 5200),
	host: process.env.RELAY_HOST ?? '0.0.0.0',
	jwtSecret: process.env.JWT_SECRET,
	challengeTtlMs: 2 * MINUTE,
	sessionTtlMs: 1 * HOUR,
	corsOrigin: process.env.RELAY_CORS_ORIGIN ?? true,
	db: readDb(),
	vapid: readVapid(),
} as const;

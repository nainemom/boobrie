const MINUTE = 60 * 1000;
const HOUR = 60 * MINUTE;

if (!process.env.JWT_SECRET) {
	throw new Error('JWT_SECRET env is not found');
}

export const config = {
	port: Number(process.env.RELAY_PORT ?? 5200),
	host: process.env.RELAY_HOST ?? '0.0.0.0',
	jwtSecret: process.env.JWT_SECRET,
	challengeTtlMs: 2 * MINUTE,
	sessionTtlMs: 1 * HOUR,
	corsOrigin: process.env.RELAY_CORS_ORIGIN ?? true,
} as const;

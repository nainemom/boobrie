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
	port: Number(process.env.RELAY_PORT),
	host: process.env.RELAY_HOST as string,
	jwtSecret: process.env.JWT_SECRET as string,
	challengeTtlMs: Number(process.env.RELAY_CHALLENGE_TTL_MS),
	/** How often an open message stream touches its session row. Presence is
	 * three of these — so shortening it shortens how long a dead connection
	 * lingers, at the cost of more writes. */
	heartbeatMs: Number(process.env.RELAY_HEARTBEAT_MS),
	sessionTtlMs: Number(process.env.RELAY_SESSION_TTL_MS),
	corsOrigin: process.env.CORS_ORIGIN?.split(' ') || '*',
	dbUrl: process.env.DB_POSTGRES_URL as string,
	vapid: readVapid(),
} as const;

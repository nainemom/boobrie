import { z } from 'zod';

/** Milliseconds, as a whole positive number of them. */
const durationMs = (fallback: number) =>
	z.coerce.number().int().positive().default(fallback);

const schema = z.object({
	/** Where the relay listens. */
	RELAY_PORT: z.coerce.number().int().min(1).max(65535).default(5200),
	RELAY_HOST: z.string().min(1).default('0.0.0.0'),

	/** How long a challenge stays answerable after it is handed out. */
	RELAY_CHALLENGE_TTL_MS: durationMs(120_000),
	/** How long a session token is honoured. */
	RELAY_SESSION_TTL_MS: durationMs(3_600_000),
	/** How often an open message stream touches its session row. Presence is
	 * three of these — so shortening it shortens how long a dead connection
	 * lingers, at the cost of more writes. */
	RELAY_HEARTBEAT_MS: durationMs(2_000),

	RELAY_JWT_SECRET: z.string().min(1),
	RELAY_DB_URL: z.url(),

	/** Origins allowed to call the relay, space separated, as the list h3
	 * wants. `*` — which is also the default — allows any, which is what a
	 * development client and the flow tests need. */
	RELAY_CORS_ORIGIN: z
		.string()
		.min(1)
		.default('*')
		.transform((origins) =>
			origins === '*' ? ('*' as const) : origins.split(/\s+/),
		),

	// Web Push. Optional — `push.ts` runs without them, and takes all three
	// together or not at all.
	RELAY_VAPID_SUBJECT: z.string().min(1).optional(),
	RELAY_VAPID_PUBLIC_KEY: z.string().min(1).optional(),
	RELAY_VAPID_PRIVATE_KEY: z.string().min(1).optional(),
});

export const env = schema.parse(process.env);

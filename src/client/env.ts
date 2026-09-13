import { z } from 'zod';

export const schema = z.object({
	/** The relay this build talks to. The default is the one `npm run dev:relay`
	 * serves, so a checkout with no `.env` still runs. */
	CLIENT_RELAY_URL: z.url().default('http://localhost:5200'),
	/** Where `npm run dev:client` listens. Read by `vite.config.ts` only — the
	 * browser is already there by the time the app runs. */
	CLIENT_PORT: z.coerce.number().int().min(1).max(65535).default(5100),
});

export const env = schema.parse(process.env ?? {});

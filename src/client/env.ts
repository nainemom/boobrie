import { z } from 'zod';

export const schema = z.object({
	/** The relay this build talks to. The default is the one `npm run dev:relay`
	 * serves, so a checkout with no `.env` still runs. */
	CLIENT_RELAY_URL: z.url().default('http://localhost:5200'),
	/** Where `npm run dev:client` listens. Read by `vite.config.ts` only — the
	 * browser is already there by the time the app runs. */
	CLIENT_PORT: z.coerce.number().int().min(1).max(65535).default(5100),
	/** The origin this build will be served from. Read by `vite.config.ts` only,
	 * to turn the relative paths in `index.html` into the absolute ones crawlers
	 * and link unfurlers insist on (`og:image`, `canonical`, `sitemap.xml`). The
	 * default matches `CLIENT_PORT`, so a checkout with no `.env` still builds —
	 * but a deploy that leaves it unset publishes localhost links, so production
	 * must set it. */
	CLIENT_PUBLIC_URL: z.url().default('http://localhost:5100'),
});

export const env = schema.parse(process.env ?? {});

import { defineConfig, env } from 'prisma/config';

export default defineConfig({
	schema: 'src/relay/db/schema.prisma',
	migrations: {
		path: 'src/relay/db/migrations',
	},
	// Prisma's own `env`, not `src/relay/env`: the CLI loads this file during the
	// image build too, where none of the relay's variables are set — a build
	// cannot reach a database and `generate` never wants one. Importing the
	// relay's env here would run its whole schema, and fail the build on the
	// absence of values the build has no business holding.
	//
	// A getter because `env` throws on an unset variable the moment it is called:
	// behind one, the call happens when a command actually asks for the URL, so
	// `generate` passes without it and `migrate deploy` — which does need it, and
	// gets it from the platform — still fails loudly when it is missing.
	datasource: {
		get url() {
			return env('DATABASE_URL');
		},
	},
});

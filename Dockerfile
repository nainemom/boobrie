FROM node:24-slim
WORKDIR /app

RUN apt-get update \
	&& apt-get install --no-install-recommends --yes openssl \
	&& rm -rf /var/lib/apt/lists/*

COPY package.json package-lock.json ./

# This also pulls Prisma's schema engine from `binaries.prisma.sh`, which the
# deploy platform's builders cannot open a TLS connection to — the reason the
# image is built in CI and pushed ready-made rather than built on deploy.
RUN npm ci

COPY tsconfig.json prisma.config.ts ./
COPY src/shared ./src/shared
COPY src/relay ./src/relay

RUN npm run db:generate-types

# Deliberately down here, after both steps above: `npm ci` would skip the
# devDependencies this image runs on (`tsx`, `prisma`), and `prisma.config.ts`
# reads this to decide whether to insist on a real `DATABASE_URL` — which the
# build has no business having, and the ENTRYPOINT's `migrate deploy` does.
ENV NODE_ENV=production
# `tsx` and `prisma` are the project's own binaries, and nothing puts that
# directory on the path — without this the start command cannot find them.
ENV PATH=/app/node_modules/.bin:$PATH
USER node

# One number, four consumers: the port the relay binds (`env.ts` reads this at
# boot), the one the healthcheck below probes, the `EXPOSE` metadata, and
# `paasta deploy --port` — which CI passes from the same variable it hands this
# build arg, so the platform's routing and the process it routes to cannot drift
# apart. Baking it as `ENV` is what makes that true: `EXPOSE` on its own is
# documentation, and the platform can still override the value at runtime.
#
# No default on purpose: a build that isn't told the port fails here, rather
# than quietly producing an image that listens somewhere the platform isn't
# routing to.
#
# Declared down here rather than up with the other setup because an `ARG`
# invalidates every layer that follows it: at the top of the file a port change
# would cost a full `npm ci`, here it costs only this metadata.
ARG RELAY_PORT
ENV RELAY_PORT=${RELAY_PORT}
EXPOSE ${RELAY_PORT}

# Shell form on purpose: the exec form passes `$RELAY_PORT` through as a literal.
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
	CMD wget -q -O - "http://127.0.0.1:${RELAY_PORT:-5200}/ping" || exit 1

# Migrations run from the image rather than as a platform release command: a
# deploy hands over this image and nothing else, so nothing else would run them.
# `exec "$@"` leaves the command below overridable, and a release command still
# configured on the platform just finds nothing left to apply.
ENTRYPOINT ["sh", "-c", "npx prisma migrate deploy && exec \"$@\"", "sh"]
CMD ["tsx", "src/relay/main.ts"]

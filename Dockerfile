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

ENV NODE_ENV=production
# `tsx` and `prisma` are the project's own binaries, and nothing puts that
# directory on the path — without this the start command cannot find them.
ENV PATH=/app/node_modules/.bin:$PATH
USER node
EXPOSE 5200

# Shell form on purpose: the exec form passes `$RELAY_PORT` through as a literal.
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
	CMD wget -q -O - "http://127.0.0.1:${RELAY_PORT:-5200}/ping" || exit 1

# Migrations run from the image rather than as a platform release command: a
# deploy hands over this image and nothing else, so nothing else would run them.
# `exec "$@"` leaves the command below overridable, and a release command still
# configured on the platform just finds nothing left to apply.
ENTRYPOINT ["sh", "-c", "npx prisma migrate deploy && exec \"$@\"", "sh"]
CMD ["tsx", "src/relay/main.ts"]

# syntax=docker/dockerfile:1.7
# The API image: built by GitHub Actions, run on the VPS by deploy/docker-compose.yml.

# Shared install inputs. `prisma generate` runs on install and loads
# prisma.config.ts, which wants a DATABASE_URL -- nothing connects to it.
FROM node:24-alpine AS base
RUN apk add --no-cache openssl
WORKDIR /app
ENV DATABASE_URL=postgresql://build:build@localhost:5432/build
COPY package.json package-lock.json prisma.config.ts ./
COPY prisma ./prisma

FROM base AS build
RUN npm ci
COPY tsconfig.json tsconfig.build.json nest-cli.json ./
COPY src ./src
RUN npm run build

# Production dependencies only -- the Prisma CLI is one of them, for migrations.
FROM base AS prod-deps
RUN npm ci --omit=dev

FROM node:24-alpine AS runtime
RUN apk add --no-cache openssl
WORKDIR /app
ENV NODE_ENV=production PORT=5000
COPY --from=prod-deps --chown=node:node /app/node_modules ./node_modules
COPY --from=build --chown=node:node /app/dist ./dist
COPY --chown=node:node package.json prisma.config.ts ./
COPY --chown=node:node prisma ./prisma
# Contact photos are written here; the compose file mounts a volume over it.
RUN mkdir uploads && chown node:node uploads
USER node
EXPOSE 5000
HEALTHCHECK --interval=30s --timeout=5s --start-period=60s --retries=3 CMD wget -qO- http://127.0.0.1:5000/health >/dev/null || exit 1
# Pending migrations first (Prisma takes a lock, so this is safe on every start), then the API.
CMD ["sh", "-c", "node_modules/.bin/prisma migrate deploy && exec node dist/main.js"]

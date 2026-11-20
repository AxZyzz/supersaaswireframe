# SuperSaaS API image (NestJS: REST + Socket.io + BullMQ workers in one process).
# Build from the REPO ROOT (npm workspaces):
#   docker build -f apps/api/Dockerfile -t supersaas-api .
# Run:       node dist/src/main            (default CMD; listens on $PORT, Cloud Run sets 8080)
# Migrate:   node dist/src/db/migrate.js   (Cloud Run Job, same image)

FROM node:22-bookworm-slim AS deps
WORKDIR /repo
# Every workspace manifest so `npm ci` matches the root lockfile.
COPY package.json package-lock.json ./
COPY apps/api/package.json apps/api/
COPY apps/web/package.json apps/web/
COPY apps/e2e/package.json apps/e2e/
COPY apps/wireframe/package.json apps/wireframe/
COPY packages/shared/package.json packages/shared/

FROM deps AS build
RUN npm ci -w apps/api --include-workspace-root
COPY apps/api apps/api
RUN npm run build -w apps/api

FROM deps AS prod-deps
RUN npm ci -w apps/api --omit=dev

FROM node:22-bookworm-slim
ENV NODE_ENV=production
WORKDIR /repo
COPY --from=prod-deps /repo/node_modules node_modules
COPY --from=build /repo/apps/api/package.json apps/api/package.json
COPY --from=build /repo/apps/api/dist apps/api/dist
COPY --from=build /repo/apps/api/drizzle apps/api/drizzle
# Supabase's public root CA. DATABASE_URL / MIGRATE_DATABASE_URL point at it with
# sslmode=verify-full&sslrootcert=/repo/apps/api/supabase-ca.crt so the pooler's
# certificate and hostname are verified (Supabase's chain isn't in the system CAs).
COPY deploy/supabase-ca.crt apps/api/supabase-ca.crt
WORKDIR /repo/apps/api
USER node
EXPOSE 8080
ENV PORT=8080
CMD ["node", "dist/src/main"]

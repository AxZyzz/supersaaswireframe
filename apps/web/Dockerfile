# SuperSaaS web image (Next.js standalone server).
# Build from the REPO ROOT:
#   docker build -f apps/web/Dockerfile \
#     --build-arg API_PROXY_TARGET=https://<api-host> \
#     --build-arg NEXT_PUBLIC_API_PUBLIC_URL=https://<api-host> \
#     -t supersaas-web .
# The browser calls REST on this origin under /api (proxied to the API, so the
# refresh cookie is first-party); the websocket goes to the API host directly.
# All of these are baked in at build time.

FROM node:22-bookworm-slim AS build
WORKDIR /repo
COPY package.json package-lock.json ./
COPY apps/api/package.json apps/api/
COPY apps/web/package.json apps/web/
COPY apps/e2e/package.json apps/e2e/
COPY apps/wireframe/package.json apps/wireframe/
COPY packages/shared/package.json packages/shared/
RUN npm ci -w apps/web --include-workspace-root
COPY apps/web apps/web

ARG API_PROXY_TARGET
ARG NEXT_PUBLIC_API_PUBLIC_URL
ARG NEXT_PUBLIC_API_URL=/api
ENV NEXT_OUTPUT=standalone \
    NEXT_TELEMETRY_DISABLED=1 \
    API_PROXY_TARGET=$API_PROXY_TARGET \
    NEXT_PUBLIC_API_URL=$NEXT_PUBLIC_API_URL \
    NEXT_PUBLIC_API_PUBLIC_URL=$NEXT_PUBLIC_API_PUBLIC_URL
RUN test -n "$API_PROXY_TARGET" || (echo "API_PROXY_TARGET build arg is required" && exit 1)
RUN npm run build -w apps/web

FROM node:22-bookworm-slim
ENV NODE_ENV=production NEXT_TELEMETRY_DISABLED=1 HOSTNAME=0.0.0.0 PORT=8080
WORKDIR /app
COPY --from=build /repo/apps/web/.next/standalone ./
COPY --from=build /repo/apps/web/.next/static ./apps/web/.next/static
COPY --from=build /repo/apps/web/public ./apps/web/public
USER node
EXPOSE 8080
CMD ["node", "apps/web/server.js"]

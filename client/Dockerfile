FROM node:26-alpine AS builder
WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci

COPY . .

# NEXT_PUBLIC_* values are inlined at build time, so they must be present as
# build args rather than runtime env vars.
ARG NEXT_PUBLIC_API_URL
ARG NEXT_PUBLIC_WS_URL
# Pin to the commit sha in CI. It names the service-worker cache, so without a
# stable value every rebuild of the same commit would evict client caches.
ARG BUILD_ID
ENV NEXT_PUBLIC_API_URL=$NEXT_PUBLIC_API_URL
ENV NEXT_PUBLIC_WS_URL=$NEXT_PUBLIC_WS_URL
ENV BUILD_ID=$BUILD_ID
ENV NEXT_TELEMETRY_DISABLED=1

RUN npm run build

FROM node:26-alpine AS runtime
WORKDIR /app

ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1
ENV PORT=3000
ENV HOSTNAME=0.0.0.0

RUN addgroup -S nodejs -g 1001 && adduser -S nextjs -u 1001

# `output: 'standalone'` emits a self-contained server with only the
# node_modules it actually needs.
COPY --from=builder --chown=nextjs:nodejs /app/.next/standalone ./
COPY --from=builder --chown=nextjs:nodejs /app/.next/static ./.next/static
COPY --from=builder --chown=nextjs:nodejs /app/public ./public

USER nextjs
EXPOSE 3000

CMD ["node", "server.js"]

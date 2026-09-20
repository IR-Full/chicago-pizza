# Single image shared by all six Node services. Each compose service runs the
# same image with a different `command`, so the monorepo is built once instead
# of six times.

FROM node:22-alpine AS builder
WORKDIR /app

# Prisma needs OpenSSL to pick the right query-engine binary on Alpine.
RUN apk add --no-cache openssl

# Copy only manifests first so `npm ci` stays cached when source changes.
COPY package.json package-lock.json tsconfig.base.json ./
COPY libs/prisma/package.json libs/prisma/
COPY libs/common/package.json libs/common/
COPY libs/rabbitmq/package.json libs/rabbitmq/
COPY apps/auth/package.json apps/auth/
COPY apps/products/package.json apps/products/
COPY apps/orders/package.json apps/orders/
COPY apps/notifications/package.json apps/notifications/
COPY apps/support/package.json apps/support/
COPY apps/gateway/package.json apps/gateway/

RUN npm ci

COPY . .

RUN npm run build \
    && npm prune --omit=dev

FROM node:22-alpine AS runtime
WORKDIR /app

RUN apk add --no-cache openssl \
    && addgroup -S app && adduser -S app -G app

COPY --from=builder --chown=app:app /app ./

USER app

ENV NODE_ENV=production

# Overridden per service in docker-compose.yml.
CMD ["node", "apps/gateway/dist/main.js"]

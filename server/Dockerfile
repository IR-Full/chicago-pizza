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

# Assemble exactly what the runtime needs, and nothing else.
#
# The runtime stage used to `COPY --from=builder /app ./`, which put every
# `.ts` source, every spec, every nest/tsconfig and all six services' build
# output into all six containers. Selecting here rather than in the runtime
# stage is deliberate: `COPY` cannot exclude, and a shell loop can.
#
# `cp -a`/`mv` and never `cp -r`: npm links each workspace into
# `node_modules` as a relative symlink (`@chicago-pizza/common` to
# `../../libs/common`). Following those would copy the sources straight back
# in, and would do it twice. Kept as links they resolve inside this tree,
# which lands at `/app` again on the other side.
#
# Nothing here is guarded with "if it exists": a workspace that failed to
# build should fail the image, not ship a container missing its entrypoint.
# The prisma directory is taken whole because `migrate deploy` replays the
# migrations, not the datamodel. `node_modules` is moved rather than copied:
# the builder has no further use for it, and duplicating a production
# `node_modules` is the largest single thing this layer could do.
RUN mkdir -p /runtime \
    && cp package.json package-lock.json /runtime/ \
    && mv node_modules /runtime/node_modules \
    && for pkg in libs/* apps/*; do \
         mkdir -p "/runtime/$pkg" \
         && cp "$pkg/package.json" "/runtime/$pkg/package.json" \
         && cp -a "$pkg/dist" "/runtime/$pkg/dist"; \
       done \
    && cp -a libs/prisma/prisma /runtime/libs/prisma/prisma \
    && cp -a ops /runtime/ops

FROM node:22-alpine AS runtime
WORKDIR /app

# Services and the bundled Prisma CLI run directly with node.
RUN rm -rf /usr/local/lib/node_modules/npm /usr/local/bin/npm /usr/local/bin/npx \
    && apk add --no-cache openssl \
    && addgroup -S app && adduser -S app -G app

# Only the assembled tree: node_modules (with the workspace links), each
# workspace's manifest and dist, and the prisma schema plus migrations.
COPY --from=builder --chown=app:app /runtime ./

USER app

ENV NODE_ENV=production

# Overridden per service in docker-compose.yml.
CMD ["node", "apps/gateway/dist/main.js"]

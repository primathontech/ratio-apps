# ─── Stage 1: deps + build ──────────────────────────────────────────────────
FROM node:24-alpine AS builder
RUN corepack enable && corepack prepare pnpm@9.12.0 --activate
WORKDIR /repo

# Copy lockfile + per-package manifests for the install layer (dep cache).
COPY pnpm-workspace.yaml pnpm-lock.yaml package.json ./
COPY packages/shared/package.json packages/shared/
COPY apps/backend/package.json apps/backend/
# Full workspace install (no filter) — pnpm filters don't reliably install
# devDeps of transitive workspace packages, and `packages/shared`'s build
# needs @types/node + typescript. The prod-prune step at the end of this
# stage strips anything the runtime doesn't need.
RUN pnpm install --frozen-lockfile

# Copy source AFTER deps so dep-only changes hit cache.
# tsconfig.base.json is extended by packages/shared/tsconfig.build.json and apps/backend/tsconfig.json,
# so it must be present at build time.
COPY tsconfig.base.json ./
COPY packages/shared packages/shared
COPY apps/backend apps/backend

# Build packages/shared FIRST — its dist is the runtime resolution target for
# `require('@ratio-app/shared/...')` (the package.json `exports` map dual-routes
# types→src/*.ts, default→dist/*.js). Without this step, Node ESM can't resolve
# the shared package at runtime even though tsc is happy at build-time.
RUN pnpm --filter @ratio-app/shared build

# Build the backend: pixel:build:all (per-app pixels into apps/backend/static/)
# + nest build (TypeScript → apps/backend/dist/).
RUN pnpm --filter @ratio-app/backend build

# Prune dev deps so the runtime image stays minimal.
RUN pnpm install --frozen-lockfile --prod --filter "@ratio-app/backend..." --filter "@ratio-app/shared"

# ─── Stage 2: runtime ───────────────────────────────────────────────────────
FROM node:24-alpine AS runner
RUN apk add --no-cache tini && addgroup -S app && adduser -S app -G app
WORKDIR /app

COPY --from=builder --chown=app:app /repo/node_modules ./node_modules
COPY --from=builder --chown=app:app /repo/packages/shared/dist ./packages/shared/dist
COPY --from=builder --chown=app:app /repo/packages/shared/node_modules ./packages/shared/node_modules
COPY --from=builder --chown=app:app /repo/packages/shared/package.json ./packages/shared/package.json
COPY --from=builder --chown=app:app /repo/apps/backend/dist ./apps/backend/dist
COPY --from=builder --chown=app:app /repo/apps/backend/static ./apps/backend/static
COPY --from=builder --chown=app:app /repo/apps/backend/node_modules ./apps/backend/node_modules
COPY --from=builder --chown=app:app /repo/apps/backend/package.json ./apps/backend/package.json

USER app
ENV NODE_ENV=production
EXPOSE 3000
STOPSIGNAL SIGTERM
HEALTHCHECK --interval=10s --timeout=3s --start-period=20s --retries=3 \
  CMD wget -qO- http://127.0.0.1:3000/ready || exit 1

ENTRYPOINT ["/sbin/tini", "--"]
CMD ["node", "apps/backend/dist/apps/backend/src/main.js"]

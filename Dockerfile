# syntax=docker/dockerfile:1

# ─────────────────────────────────────────────────────────────────────────────
# API-only image: the NestJS backend ships the API alone (SERVE_STATIC=false).
# The admin SPA is built and deployed by a separate service, so no admin build
# or static asset is baked in here.
#
# Multi-stage:
#   deps    — install the full workspace (frozen lockfile) for the build.
#   build   — compile shared + backend only (admin is built elsewhere).
#   runtime — node:22-slim with only the prod node_modules + built dist trees.
#
# Layout assumption (must match configure-app.ts + ecosystem.config.cjs):
# WORKDIR is the repo root (/app); the backend entry is
# apps/backend/dist/apps/backend/src/main.js.
# ─────────────────────────────────────────────────────────────────────────────

# Pin to the Node 22 line (matches .nvmrc / engines ">=22").
FROM node:22-slim AS base
ENV PNPM_HOME="/pnpm" \
    PATH="/pnpm:$PATH"
# corepack ships with Node 22; pin the pnpm version from package.json's
# packageManager field so the lockfile resolves identically to local installs.
RUN corepack enable && corepack prepare pnpm@9.12.0 --activate
WORKDIR /app

# ── deps: install the full workspace using only manifests + lockfile so this
#    layer caches across source-only changes. `--frozen-lockfile` validates the
#    lockfile against EVERY workspace member, so all manifests must be present —
#    even the admin SPAs we never build here (their node_modules/dist are pruned
#    from the runtime stage). ──────────────────────────────────────────────────
FROM base AS deps
COPY pnpm-lock.yaml pnpm-workspace.yaml package.json ./
COPY apps/backend/package.json apps/backend/
COPY apps/admin-google/package.json apps/admin-google/
COPY apps/admin-meta/package.json apps/admin-meta/
COPY apps/admin-moengage/package.json apps/admin-moengage/
COPY apps/admin-posthog/package.json apps/admin-posthog/
COPY packages/shared/package.json packages/shared/
RUN --mount=type=cache,id=pnpm-store,target=/pnpm/store \
    pnpm install --frozen-lockfile

# ── build: bring in the source and compile only what the API ships. ─────────
FROM deps AS build
COPY . .
# Build shared (tsc) + backend (pixel tsc + nest build) only. The admin SPAs are
# built and deployed by a separate service, so they're intentionally skipped.
RUN pnpm --filter @ratio-app/shared --filter @ratio-app/backend build

# ── prod-deps: a clean node_modules with devDependencies pruned. Built in its
#    own stage from manifests + lockfile so it carries none of the build cruft.
FROM base AS prod-deps
COPY pnpm-lock.yaml pnpm-workspace.yaml package.json ./
COPY apps/backend/package.json apps/backend/
COPY apps/admin-google/package.json apps/admin-google/
COPY apps/admin-meta/package.json apps/admin-meta/
COPY apps/admin-moengage/package.json apps/admin-moengage/
COPY apps/admin-posthog/package.json apps/admin-posthog/
COPY packages/shared/package.json packages/shared/
RUN --mount=type=cache,id=pnpm-store,target=/pnpm/store \
    pnpm install --frozen-lockfile --prod

# ── runtime: minimal image with prod deps + built artifacts only. ───────────
FROM node:22-slim AS runtime
ENV NODE_ENV=production \
    # API-only: the backend serves no static UI (admin is deployed separately).
    SERVE_STATIC=false \
    PORT=3000
WORKDIR /app

# Production node_modules (root + workspace symlinks). pnpm's symlinked layout
# is preserved by copying the whole tree from the prod-deps stage.
COPY --from=prod-deps /app/node_modules ./node_modules
COPY --from=prod-deps /app/apps/backend/node_modules ./apps/backend/node_modules
COPY --from=prod-deps /app/packages/shared/node_modules ./packages/shared/node_modules

# Workspace package manifests (needed for the `@ratio-app/shared` workspace
# symlink + exports resolution to keep working at runtime).
COPY --from=build /app/package.json ./package.json
COPY --from=build /app/apps/backend/package.json ./apps/backend/package.json
COPY --from=build /app/packages/shared/package.json ./packages/shared/package.json

# Built artifacts: backend dist (includes the compiled pixel SDK + static
# assets emitted by nest-cli) and the shared package's dist. No admin SPA — the
# UI is built and deployed by a separate service.
COPY --from=build /app/apps/backend/dist ./apps/backend/dist
COPY --from=build /app/packages/shared/dist ./packages/shared/dist

EXPOSE 3000

# Entry path reflects tsconfig rootDir=../.. (dist mirrors the repo tree).
CMD ["node", "apps/backend/dist/apps/backend/src/main.js"]

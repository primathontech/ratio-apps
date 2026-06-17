# syntax=docker/dockerfile:1

# ─────────────────────────────────────────────────────────────────────────────
# Single-artifact image: the NestJS backend serves the built Vite admin SPA as
# static assets (SERVE_STATIC=true), so one image ships both the API and the UI.
#
# Multi-stage:
#   deps    — install the full workspace (frozen lockfile) for the build.
#   build   — compile shared + backend + admin (`pnpm -r build`).
#   runtime — node:22-slim with only the prod node_modules + built dist trees.
#
# Layout assumption (must match configure-app.ts + ecosystem.config.cjs):
# WORKDIR is the repo root (/app); the backend entry is
# apps/backend/dist/apps/backend/src/main.js and the admin build lives at
# apps/admin-google/dist — exactly where configure-app.ts resolves it from
# process.cwd().
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
#    layer caches across source-only changes. ───────────────────────────────
FROM base AS deps
COPY pnpm-lock.yaml pnpm-workspace.yaml package.json ./
COPY apps/backend/package.json apps/backend/
COPY apps/admin-google/package.json apps/admin-google/
COPY packages/shared/package.json packages/shared/
RUN --mount=type=cache,id=pnpm-store,target=/pnpm/store \
    pnpm install --frozen-lockfile

# ── build: bring in the source and compile every workspace package. ─────────
FROM deps AS build
COPY . .
# `pnpm -r build` builds shared (tsc), backend (pixel tsc + nest build), and the
# admin (tsr generate + tsc + vite build) across the workspace.
RUN pnpm -r build

# ── prod-deps: a clean node_modules with devDependencies pruned. Built in its
#    own stage from manifests + lockfile so it carries none of the build cruft.
FROM base AS prod-deps
COPY pnpm-lock.yaml pnpm-workspace.yaml package.json ./
COPY apps/backend/package.json apps/backend/
COPY apps/admin-google/package.json apps/admin-google/
COPY packages/shared/package.json packages/shared/
RUN --mount=type=cache,id=pnpm-store,target=/pnpm/store \
    pnpm install --frozen-lockfile --prod

# ── runtime: minimal image with prod deps + built artifacts only. ───────────
FROM node:22-slim AS runtime
ENV NODE_ENV=production \
    # Single-artifact deploy: the backend serves the admin SPA from disk.
    SERVE_STATIC=true \
    PORT=3000
WORKDIR /app

# Production node_modules (root + workspace symlinks). pnpm's symlinked layout
# is preserved by copying the whole tree from the prod-deps stage.
COPY --from=prod-deps /app/node_modules ./node_modules
COPY --from=prod-deps /app/apps/backend/node_modules ./apps/backend/node_modules
COPY --from=prod-deps /app/apps/admin-google/node_modules ./apps/admin-google/node_modules
COPY --from=prod-deps /app/packages/shared/node_modules ./packages/shared/node_modules

# Workspace package manifests (needed for the `@ratio-app/shared` workspace
# symlink + exports resolution to keep working at runtime).
COPY --from=build /app/package.json ./package.json
COPY --from=build /app/apps/backend/package.json ./apps/backend/package.json
COPY --from=build /app/packages/shared/package.json ./packages/shared/package.json

# Built artifacts: backend dist (includes the compiled pixel SDK + static
# assets emitted by nest-cli), the shared package's dist, and the admin SPA.
COPY --from=build /app/apps/backend/dist ./apps/backend/dist
COPY --from=build /app/packages/shared/dist ./packages/shared/dist
COPY --from=build /app/apps/admin-google/dist ./apps/admin-google/dist

EXPOSE 3000

# Entry path reflects tsconfig rootDir=../.. (dist mirrors the repo tree).
CMD ["node", "apps/backend/dist/apps/backend/src/main.js"]

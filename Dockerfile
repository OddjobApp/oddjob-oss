# Multi-stage Docker build for the Oddjob Node/TypeScript runtime.
# Produces a single image that can run the API server, worker fleet, or MCP server
# depending on the command/entrypoint. The Python backend is packaged separately.

# =============================================================================
# Base stage: Node runtime with the shared OS-level dependencies
# =============================================================================
FROM node:22-slim AS base

ENV NODE_ENV=production \
    PORT=5000 \
    FFMPEG_PATH=/usr/bin/ffmpeg \
    FFPROBE_PATH=/usr/bin/ffprobe \
    PLAYWRIGHT_BROWSERS_PATH=/opt/playwright \
    DOCKER_CONTAINER=1

WORKDIR /app

# curl for healthchecks, ffmpeg for media processing. ffmpeg-static's
# postinstall github download is unreliable in constrained CI networks, so the
# binary is provided by apt and found via FFMPEG_PATH.
RUN apt-get update && apt-get install -y --no-install-recommends \
    ca-certificates \
    curl \
    ffmpeg \
    && rm -rf /var/lib/apt/lists/*

# =============================================================================
# Dependencies stage: production dependencies only
# =============================================================================
FROM base AS deps

# Only workspaces whose runtime output the server bundle actually imports are
# copied here (the built server keeps @oddjob/design-system as an external
# import). Skipping the other workspaces — rescue-dispatch (next), client,
# services/* — keeps application/framework dependencies like next out of the
# production node_modules.
COPY package.json package-lock.json ./
COPY packages/design-system/package.json ./packages/design-system/
# Skip lifecycle scripts so github-hosted postinstall downloads (e.g.
# ffmpeg-static) cannot abort the build. Runtime-provided binaries are
# installed via apt above.
RUN npm ci --omit=dev --ignore-scripts && npm cache clean --force

# Install the browser matching the locked Playwright version, including OS
# libraries. A shared path makes the root-installed browser usable by oddjob.
RUN node node_modules/playwright/cli.js install --with-deps chromium && \
    chmod -R a+rX /opt/playwright && \
    rm -rf /var/lib/apt/lists/*

# =============================================================================
# Build stage: toolchain, dev dependencies, and the application build
# =============================================================================
FROM base AS build

# Toolchain for native modules / postinstalls lives here only — it never ships
# in the production stage.
RUN apt-get update && apt-get install -y --no-install-recommends \
    build-essential \
    python3 \
    && rm -rf /var/lib/apt/lists/*

# All workspaces must exist before npm ci so npm creates the @oddjob/* links
# and installs workspace dependencies needed by vite/tsc.
COPY package.json package-lock.json ./
COPY packages ./packages
COPY services ./services
COPY client/package.json ./client/package.json

# NODE_ENV=production is set in the base stage, so --include=dev is required to
# actually install devDependencies. Skip scripts to avoid ffmpeg-static's
# github download, then rebuild esbuild so its platform binary is installed.
RUN npm ci --ignore-scripts --include=dev && \
    npm rebuild esbuild && \
    npm cache clean --force

# Copy source required for the build
COPY client ./client
COPY server ./server
COPY shared ./shared
COPY migrations ./migrations
COPY scripts ./scripts
COPY docs ./docs
COPY vite.config.ts ./
COPY tsconfig.json ./
COPY tsconfig.server.json ./
COPY tailwind.config.ts ./
COPY postcss.config.js ./
COPY drizzle.config.ts ./

# Build workspace packages (design-system) then server bundles and SPA assets.
# verify runs build:packages before build because vite resolves
# @oddjob/design-system to its built dist output.
RUN npm run build:packages && npm run build

# Forge copies domain UI sources into generated apps at runtime. Keep every
# domain's UI so newly referenced blueprints do not silently lose components.
RUN mkdir -p /runtime-ui/server/domain && \
    for ui_dir in /app/server/domain/*/ui; do \
      domain_name="$(basename "$(dirname "$ui_dir")")"; \
      mkdir -p "/runtime-ui/server/domain/$domain_name"; \
      cp -a "$ui_dir" "/runtime-ui/server/domain/$domain_name/ui"; \
    done

# =============================================================================
# Production stage: minimal runtime image with built artifacts
# =============================================================================
FROM deps AS production

# Create non-root application user
RUN groupadd -r oddjob && useradd -r -g oddjob oddjob

# Copy production server/worker/MCP bundles
COPY --from=build /app/dist ./dist

# Copy built frontend assets to the location serveStatic expects by default
# (../public relative to dist/index.js)
COPY --from=build /app/dist/public ./public

# @oddjob/design-system is an external import of dist/index.js; the deps stage
# created the node_modules symlink, so the package must exist at the link
# target with its compiled output.
COPY --from=build /app/packages/design-system/package.json ./packages/design-system/package.json
COPY --from=build /app/packages/design-system/dist ./packages/design-system/dist

# These are read from disk by App Forge and the scaffold registry at runtime.
COPY --from=build /app/server/blueprints ./server/blueprints
COPY --from=build /app/server/templates ./server/templates
COPY --from=build /app/docs ./docs
COPY --from=build /app/packages/scaffold-registry ./packages/scaffold-registry
# Platform documentation scans deployed source facts; tenant-authored files are not included.
COPY --from=build /app/server/domain ./server/domain
COPY --from=build /app/server/knowledge ./server/knowledge
COPY --from=build /app/client/src/components/ui ./client/src/components/ui
COPY --from=build /app/server/domain/apps/core/block-registry.json ./server/domain/apps/core/block-registry.json

# Copy runtime migrations and the migration runner dependency metadata
COPY --from=build /app/migrations ./migrations
COPY --from=build /app/package.json ./

# Writable directories for logs/uploads. Code layers stay root-owned —
# recursive chown would duplicate every copied file into a new layer
# (the image pays ~1.5GB for it) and the app only needs read access anyway.
RUN mkdir -p /app/logs /app/uploads /app/tmp /app/storage && \
    chown oddjob:oddjob /app && \
    chown -R oddjob:oddjob /app/logs /app/uploads /app/tmp /app/storage

USER oddjob

EXPOSE 5000

HEALTHCHECK --interval=30s --timeout=10s --start-period=40s --retries=3 \
    CMD curl -fsS http://localhost:5000/api/health || exit 1

# Default role: API server. Override with --command or args for worker/MCP:
#   docker run ... ghcr.io/oddjobapp/oddjob:tag node dist/worker-entrypoint.js
#   docker run ... ghcr.io/oddjobapp/oddjob:tag node dist/mcp/index.js
CMD ["node", "dist/index.js"]

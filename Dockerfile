# ==============================================================================
# SavannaGuard — Production-grade multi-stage Docker build
# ==============================================================================

# === Stage 1: Build ===
FROM node:22-alpine AS builder

# better-sqlite3 native addon requires C++ build toolchain
RUN apk add --no-cache build-base python3

WORKDIR /app

# Install dependencies first for Docker layer caching
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY packages/server/package.json ./packages/server/
COPY packages/widget/package.json ./packages/widget/
RUN corepack enable && pnpm install --frozen-lockfile

# Build all packages (server TypeScript + widget Vite)
COPY . .
RUN pnpm build

# Reinstall production-only dependencies into a clean node_modules tree
ENV CI=false
ENV PNPM_ENABLE_BUILD_SCRIPTS=true
ENV npm_config_build_from_source=true
RUN rm -rf node_modules packages/server/node_modules packages/widget/node_modules \
 && corepack enable \
 && pnpm install --prod --frozen-lockfile \
 && cd /app/node_modules/.pnpm/better-sqlite3@*/node_modules/better-sqlite3 \
 && pnpm run install

# === Stage 2: Production runtime ===
FROM node:22-alpine AS runtime

# better-sqlite3 native addon needs libstdc++ at runtime
# wget is required for docker-compose healthcheck command
RUN apk add --no-cache libstdc++ tini wget \
 && rm -rf /usr/local/lib/node_modules/npm /usr/local/bin/npm /usr/local/bin/npx

# Create writable data directory for SQLite
RUN mkdir -p /data && chown -R node:node /data

WORKDIR /app

# Copy built artifacts and production dependencies from builder
COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/packages/server/node_modules ./packages/server/node_modules
COPY --from=builder /app/packages/server/dist ./packages/server/dist
COPY --from=builder /app/packages/widget/dist ./packages/widget/dist
COPY --from=builder /app/package.json ./package.json
COPY --from=builder /app/pnpm-lock.yaml ./pnpm-lock.yaml
COPY --from=builder /app/pnpm-workspace.yaml ./pnpm-workspace.yaml
COPY --from=builder /app/packages/server/package.json ./packages/server/package.json

# Copy static assets for admin UI (TypeScript does not copy non-TS files)
COPY --from=builder /app/packages/server/src/static ./packages/server/dist/static

# Run as non-root user
USER node

WORKDIR /app/packages/server
EXPOSE 3000

# Use tini as PID 1 for proper signal handling
ENTRYPOINT ["tini", "--"]
CMD ["node", "dist/index.js"]

# === Build Stage ===
FROM node:20-alpine AS builder

# better-sqlite3 C++ addon requires build tools
RUN apk add --no-cache build-base python3

WORKDIR /app

# Install dependencies first (layer caching)
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY packages/server/package.json ./packages/server/
COPY packages/widget/package.json ./packages/widget/
RUN corepack enable && pnpm install --frozen-lockfile

# Build all packages
COPY . .
RUN pnpm build

# Prune to production dependencies only
RUN corepack enable && pnpm install --prod --frozen-lockfile

# === Production Stage ===
FROM node:20-alpine

# better-sqlite3 native addon requires libstdc++ at runtime
RUN apk add --no-cache libstdc++

# Create data directory for SQLite and set permissions
RUN mkdir -p /data && chown -R node:node /data

WORKDIR /app

# Copy only what's needed from builder
COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/packages/server/node_modules ./packages/server/node_modules
COPY --from=builder /app/packages/server/dist ./packages/server/dist
COPY --from=builder /app/packages/widget/dist ./packages/widget/dist
COPY --from=builder /app/package.json ./package.json
COPY --from=builder /app/pnpm-lock.yaml ./pnpm-lock.yaml
COPY --from=builder /app/pnpm-workspace.yaml ./pnpm-workspace.yaml
COPY --from=builder /app/packages/server/package.json ./packages/server/package.json

WORKDIR /app/packages/server
EXPOSE 3000

USER node
CMD ["node", "dist/index.js"]
# Auth Service Dockerfile
FROM node:24-alpine AS builder

WORKDIR /app

# Copy workspace config and package files
COPY package.json package-lock.json ./
COPY packages/ ./packages/
COPY services/auth/ ./services/auth/
COPY shared/ ./shared/

# Install dependencies
RUN npm ci --workspace=@oddjob/auth-service

# Build
WORKDIR /app/services/auth
RUN npm run build

# Production image
FROM node:24-alpine

WORKDIR /app

# Copy built files
COPY --from=builder /app/services/auth/dist ./dist
COPY --from=builder /app/services/auth/package.json ./
COPY --from=builder /app/node_modules ./node_modules

# Runtime configuration
ENV NODE_ENV=production
ENV AUTH_SERVICE_PORT=5001

EXPOSE 5001

HEALTHCHECK --interval=30s --timeout=10s --start-period=5s --retries=3 \
    CMD wget -q --spider http://localhost:5001/health || exit 1

CMD ["node", "dist/index.js"]

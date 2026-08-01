# Use a specific Node version for stability
FROM node:24-slim AS builder

WORKDIR /app

# Install build dependencies for native modules (better-sqlite3)
RUN apt-get update && apt-get install -y --no-install-recommends \
    python3 \
    make \
    g++ \
    && rm -rf /var/lib/apt/lists/*

# Copy package files and install dependencies
COPY package*.json ./
RUN npm ci --omit=dev

# --- Production stage ---
FROM node:24-slim

WORKDIR /app

# Version metadata, passed at build time (e.g. --build-arg GIT_COMMIT=$(git rev-parse --short HEAD))
ARG GIT_COMMIT=unknown
ARG BUILD_DATE
ENV GIT_COMMIT=$GIT_COMMIT
ENV BUILD_DATE=$BUILD_DATE

# Create non-root user for security
RUN groupadd -g 1001 noga && \
    useradd -u 1001 -g noga -s /bin/sh noga

# Copy source code first (order matters)
# With .dockerignore, this will NOT copy host node_modules
COPY --chown=noga:noga . .

# Copy built node_modules from builder
COPY --from=builder /app/node_modules ./node_modules

# Create data directory
RUN mkdir -p /app/data && chown -R noga:noga /app/data

# Switch to non-root user
USER noga

# Expose internal API port (Block 5 Phase 1: this container no longer serves the dashboard —
# admin-portal does, from its own image/Dockerfile.admin-portal)
EXPOSE 3100

# Health check — node:24-slim has neither wget nor curl, so probe with Node's own http client
HEALTHCHECK --interval=30s --timeout=10s --start-period=60s --retries=3 \
    CMD node -e "require('http').get('http://localhost:3100/health', r => process.exit(r.statusCode === 200 ? 0 : 1)).on('error', () => process.exit(1))"

# Start the application
CMD ["node", "src/index.js"]

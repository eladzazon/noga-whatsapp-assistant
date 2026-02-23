FROM node:latest AS builder

WORKDIR /app

# Install build dependencies for native modules (better-sqlite3)
RUN apt-get update && apt-get install -y --no-install-recommends \
    python3 \
    make \
    g++ \
    && rm -rf /var/lib/apt/lists/*

# Copy package files and install dependencies
COPY package*.json ./
RUN npm ci --only=production

# --- Production stage ---
FROM node:latest

WORKDIR /app

# Create non-root user for security
RUN groupadd -g 1001 noga && \
    useradd -u 1001 -g noga -s /bin/sh noga

# Copy built node_modules from builder
COPY --from=builder /app/node_modules ./node_modules

# Copy source code
COPY --chown=noga:noga . .

# Create data directory
RUN mkdir -p /app/data && chown -R noga:noga /app/data

# Switch to non-root user
USER noga

# Expose dashboard port
EXPOSE 3000

# Health check
HEALTHCHECK --interval=30s --timeout=10s --start-period=60s --retries=3 \
    CMD wget --no-verbose --tries=1 --spider http://localhost:3000/ || exit 1

# Start the application
CMD ["node", "src/index.js"]

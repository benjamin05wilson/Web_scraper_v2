# ============================================================================
# STAGE 1: Build Stage
# ============================================================================
FROM node:20-bookworm AS builder

WORKDIR /app

# Copy package files
COPY package.json package-lock.json ./

# Install ALL dependencies (including devDependencies for build)
RUN npm ci

# Copy source code
COPY . .

# Build frontend (Vite) and backend (TypeScript)
RUN npm run build

# ============================================================================
# STAGE 2: Production Runtime (using Playwright's official image)
# ============================================================================
FROM mcr.microsoft.com/playwright:v1.57.0-noble

WORKDIR /app

# Install Xvfb for virtual display (required for headful browser)
RUN apt-get update && apt-get install -y \
    xvfb \
    && rm -rf /var/lib/apt/lists/*

# Copy package files and install PRODUCTION dependencies only
COPY package.json package-lock.json ./
RUN npm ci --omit=dev

# Copy built artifacts from builder stage
COPY --from=builder /app/dist ./dist

# Create directories for runtime data
RUN mkdir -p /app/configs /app/chrome-data

# Copy startup script
COPY docker-entrypoint.sh /docker-entrypoint.sh
RUN chmod +x /docker-entrypoint.sh

# Set environment variables
ENV NODE_ENV=production
ENV PORT=3002
ENV DISPLAY=:99

# Expose port
EXPOSE 3002

# Health check
HEALTHCHECK --interval=30s --timeout=10s --start-period=40s --retries=3 \
  CMD node -e "require('http').get('http://localhost:3002/health', (r) => {process.exit(r.statusCode === 200 ? 0 : 1)})"

# Run via entrypoint script that starts Xvfb
ENTRYPOINT ["/docker-entrypoint.sh"]
CMD ["node", "dist/server/server/index.js"]

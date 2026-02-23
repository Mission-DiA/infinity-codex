# Build stage
FROM node:18-alpine AS builder

WORKDIR /app

# Copy package files and .npmrc for private registry auth (created by cloudbuild)
COPY package*.json ./
COPY .npmrc* ./

# Install dependencies (npm install to resolve new @helicarrier/sdk)
RUN npm install && rm -f .npmrc

# Copy source
COPY tsconfig.json ./
COPY src ./src

# Build TypeScript
RUN npm run build

# Production stage
FROM node:18-alpine AS production

WORKDIR /app

# Copy package files and install production dependencies only
COPY package*.json ./
COPY .npmrc* ./
RUN npm install --only=production && rm -f .npmrc

# Copy built files
COPY --from=builder /app/dist ./dist

# Set environment
ENV NODE_ENV=production
ENV PORT=8080

# Expose port
EXPOSE 8080

# Run
CMD ["node", "dist/server.js"]

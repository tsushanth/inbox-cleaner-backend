# Dockerfile with zero npm dependencies
FROM node:18-alpine

WORKDIR /app

# Copy package.json (no dependencies to install)
COPY package.json ./

# Copy source code
COPY server.js ./

# Expose port
EXPOSE 8080

# Set environment variables
ENV NODE_ENV=production
ENV PORT=8080

# Start the app (no npm install needed!)
CMD ["node", "server.js"]
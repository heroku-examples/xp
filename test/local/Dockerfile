# Dockerfile to simulate Heroku dyno environment for XP plugin testing
# Using official Node.js image (simpler than Heroku base)

FROM node:18-bullseye-slim

# Install curl and other basic tools
USER root
RUN apt-get update && \
    apt-get install -y curl tar gzip && \
    apt-get clean && \
    rm -rf /var/lib/apt/lists/*

# Install Traefik (simulating buildpack behavior)
ARG TRAEFIK_VERSION=2.10.7
RUN curl -L "https://github.com/traefik/traefik/releases/download/v${TRAEFIK_VERSION}/traefik_v${TRAEFIK_VERSION}_linux_amd64.tar.gz" \
    -o traefik.tar.gz && \
    tar -xzf traefik.tar.gz && \
    mv traefik /usr/local/bin/ && \
    chmod +x /usr/local/bin/traefik && \
    rm traefik.tar.gz

# Create app directory structure (simulating Heroku dyno layout)
# This must be done as root before switching users
RUN mkdir -p /app/.heroku/traefik/config/dynamic && \
    mkdir -p /app/.heroku/traefik/bin && \
    chown -R node:node /app

# Create traefik-wrapper script (simulating buildpack behavior)
# Do this as root so it can be in /app before we switch users
RUN echo '#!/bin/bash\n\
set -e\n\
\n\
# Save the main PORT for Traefik\n\
TRAEFIK_PORT=${PORT:-8080}\n\
\n\
# Generate Traefik config from HEROKU_EXPERIMENTS\n\
if [ -n "$HEROKU_EXPERIMENTS" ]; then\n\
  echo "Generating Traefik configuration..."\n\
  PORT=5000 node /app/generate-traefik-config.js\n\
fi\n\
\n\
# Start Traefik in background on the main PORT\n\
echo "Starting Traefik on port $TRAEFIK_PORT..."\n\
traefik \\\n\
  --entrypoints.web.address=:${TRAEFIK_PORT} \\\n\
  --providers.file.directory=/app/.heroku/traefik/config/dynamic \\\n\
  --providers.file.watch=false \\\n\
  --log.level=INFO \\\n\
  --api.dashboard=true \\\n\
  --api.insecure=true &\n\
\n\
TRAEFIK_PID=$!\n\
\n\
# Start the application on port 5000 (Heroku convention)\n\
echo "Starting application on port 5000..."\n\
PORT=5000 "$@" &\n\
APP_PID=$!\n\
\n\
# Wait for either process to exit\n\
wait -n $TRAEFIK_PID $APP_PID\n\
EXIT_CODE=$?\n\
\n\
# Kill remaining processes\n\
kill $TRAEFIK_PID $APP_PID 2>/dev/null || true\n\
\n\
exit $EXIT_CODE\n\
' > /app/.heroku/traefik/bin/traefik-wrapper && \
    chmod +x /app/.heroku/traefik/bin/traefik-wrapper && \
    chown -R node:node /app

# Set working directory
WORKDIR /app

# Switch to node user
USER node

# Copy test app files
COPY --chown=node:node test-app/package*.json ./
RUN npm install

COPY --chown=node:node test-app/ ./

# Add traefik-wrapper to PATH (already created earlier as root)
ENV PATH="/app/.heroku/traefik/bin:${PATH}"

# Heroku environment variables
ENV PORT=8080 \
    NODE_ENV=production \
    DYNO=web.1 \
    HEROKU_APP_NAME=test-app

# Expose ports
# 8080: Main entry point (Traefik)
# 5000: App server (internal)
# 8081: Traefik dashboard
EXPOSE 8080 5000 8081

# Health check
HEALTHCHECK --interval=30s --timeout=3s --start-period=5s \
  CMD curl -f http://localhost:8080/health || exit 1

# Start via Procfile command
# Use bash explicitly since traefik-wrapper has bash shebang
CMD ["bash", "/app/.heroku/traefik/bin/traefik-wrapper", "node", "server.js"]

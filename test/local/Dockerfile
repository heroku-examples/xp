# Dockerfile to simulate Heroku dyno environment for XP plugin testing
# Based on Heroku-22 stack (Ubuntu 22.04)

FROM heroku/heroku:22

# Install Node.js 18 LTS (matching Heroku runtime)
RUN curl -fsSL https://deb.nodesource.com/setup_18.x | bash - && \
    apt-get install -y nodejs && \
    npm install -g npm@latest

# Install Traefik (simulating buildpack behavior)
ARG TRAEFIK_VERSION=2.10.7
RUN curl -L "https://github.com/traefik/traefik/releases/download/v${TRAEFIK_VERSION}/traefik_v${TRAEFIK_VERSION}_linux_amd64.tar.gz" \
    -o traefik.tar.gz && \
    tar -xzf traefik.tar.gz && \
    mv traefik /usr/local/bin/ && \
    chmod +x /usr/local/bin/traefik && \
    rm traefik.tar.gz

# Create app directory structure (simulating Heroku dyno layout)
RUN mkdir -p /app/.heroku/traefik/config/dynamic && \
    mkdir -p /app/.heroku/traefik/bin

# Set working directory
WORKDIR /app

# Copy test app files
COPY test-app/package*.json ./
RUN npm install

COPY test-app/ ./

# Create traefik-wrapper script (simulating buildpack behavior)
RUN echo '#!/bin/bash\n\
set -e\n\
\n\
# Generate Traefik config from HEROKU_EXPERIMENTS\n\
if [ -n "$HEROKU_EXPERIMENTS" ]; then\n\
  echo "Generating Traefik configuration..."\n\
  node /app/generate-traefik-config.js\n\
fi\n\
\n\
# Start Traefik in background on $PORT\n\
TRAEFIK_PORT=${PORT:-8080}\n\
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
# Set PORT=5000 for the app (Heroku convention)\n\
export PORT=5000\n\
\n\
# Start the application\n\
echo "Starting application on port 5000..."\n\
exec "$@" &\n\
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
    chmod +x /app/.heroku/traefik/bin/traefik-wrapper

# Add traefik-wrapper to PATH
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
CMD ["traefik-wrapper", "node", "server.js"]

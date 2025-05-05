# Use Node.js 22 as base image
FROM node:22
# Set working directory
WORKDIR /app
# Copy package.json and install dependencies
COPY package.json ./
RUN npm install -g npm@11
RUN npm install --no-audit --no-fund --no-progress --omit=dev --ignore-scripts
# Copy the rest of the application code
COPY . .
# Copy config.yaml explicitly
COPY config.yaml /app/config.yaml
# Create config directory
RUN mkdir -p /app/config
# Create startup script
RUN echo '#!/bin/bash\n\
# Modify server.js to bind to all interfaces\n\
sed -i "s/const listenIp = .*;/const listenIp = \"0.0.0.0\";/" /app/server.js\n\
# Start the server\n\
exec node server.js --listen --host 0.0.0.0\n\
' > /app/docker-entrypoint.sh && \
    chmod +x /app/docker-entrypoint.sh
# Expose port 8000
EXPOSE 8000
# Set the entrypoint
ENTRYPOINT ["/app/docker-entrypoint.sh"]


<<<<<<< HEAD
FROM node:lts-alpine3.19

# Arguments
ARG APP_HOME=/home/node/app

# Install system dependencies
RUN apk add --no-cache gcompat tini git git-lfs

# Create app directory
WORKDIR ${APP_HOME}

# Set NODE_ENV to production
ENV NODE_ENV=production

# Bundle app source
COPY . ./

RUN \
  echo "*** Install npm packages ***" && \
  npm i --no-audit --no-fund --loglevel=error --no-progress --omit=dev && npm cache clean --force

# Copy default chats, characters and user avatars to <folder>.default folder
RUN \
  rm -f "config.yaml" || true && \
  ln -s "./config/config.yaml" "config.yaml" || true && \
  mkdir "config" || true

# Pre-compile public libraries
RUN \
  echo "*** Run Webpack ***" && \
  node "./docker/build-lib.js"

# Cleanup unnecessary files
RUN \
  echo "*** Cleanup ***" && \
  mv "./docker/docker-entrypoint.sh" "./" && \
  rm -rf "./docker" && \
  echo "*** Make docker-entrypoint.sh executable ***" && \
  chmod +x "./docker-entrypoint.sh" && \
  echo "*** Convert line endings to Unix format ***" && \
  dos2unix "./docker-entrypoint.sh"

# Fix extension repos permissions
RUN git config --global --add safe.directory "*"

=======
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
>>>>>>> 9cabee9a8bd6934762b56d10f8e71ddb324410f2
EXPOSE 8000
# Set the entrypoint
ENTRYPOINT ["/app/docker-entrypoint.sh"]


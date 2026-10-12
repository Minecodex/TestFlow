FROM node:24-alpine
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --omit=dev
COPY server.mjs manifest.json ./
COPY schemas ./schemas
USER 10001:10001
ENTRYPOINT ["node", "server.mjs"]

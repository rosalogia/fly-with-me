FROM node:22-slim

WORKDIR /app

# Workspace manifests first for layer caching.
COPY package.json package-lock.json ./
COPY shared/package.json shared/
COPY server/package.json server/
COPY web/package.json web/
RUN npm ci

COPY . .
RUN npm run build

# SQLite lives on a mounted volume so fares/snapshots/trips survive deploys.
ENV NODE_ENV=production PORT=3000 DB_PATH=/data/cache.db
EXPOSE 3000
CMD ["npx", "tsx", "server/src/index.ts"]

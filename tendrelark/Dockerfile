FROM node:22-slim
WORKDIR /app
ENV NODE_ENV=production
COPY package.json package-lock.json ./
RUN npm ci --omit=dev
COPY . .
# The database must live on a persistent volume. /data is created here and owned by the app user, so a fresh
# volume mounted at /data is writable. Mount a volume there and keep DATABASE_PATH pointing at it.
ENV DATABASE_PATH=/data/tendrelark.db
RUN mkdir -p /data && chown node:node /data
VOLUME /data
EXPOSE 3000
USER node
CMD ["node", "--disable-warning=ExperimentalWarning", "src/server.js"]

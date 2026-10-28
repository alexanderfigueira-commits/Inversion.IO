FROM node:22-slim
WORKDIR /app
ENV NODE_ENV=production
COPY package.json package-lock.json ./
RUN npm ci --omit=dev
COPY . .
# The database must live on a persistent volume. Mount one at /data and keep DATABASE_PATH pointing at it.
ENV DATABASE_PATH=/data/tendrelark.db
VOLUME /data
EXPOSE 3000
USER node
CMD ["node", "--disable-warning=ExperimentalWarning", "src/server.js"]

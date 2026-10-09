# Kitchen on Vault (Website-Home's vault/README.md). The tests, the type check and the build
# run in the first stage, so a failing test fails the deploy and the running app stays as it was.
FROM node:24-alpine AS build
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --no-audit --no-fund
COPY . .
RUN npm run ci

FROM node:24-alpine
WORKDIR /app
ENV NODE_ENV=production HOST=0.0.0.0 PORT=8080 DB_PATH=/data/app.sqlite MIGRATIONS_DIR=/app/migrations \
    PHOTOS_DIR=/data/photos NODE_OPTIONS=--disable-warning=ExperimentalWarning
COPY package.json package-lock.json ./
RUN npm ci --omit=dev --no-audit --no-fund && npm cache clean --force
COPY --from=build /app/dist ./dist
COPY migrations ./migrations
USER node
EXPOSE 8080
CMD ["node", "dist/server/entry.mjs"]

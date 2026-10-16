FROM node:24-alpine AS build
RUN corepack enable
WORKDIR /src
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml .npmrc tsconfig.base.json ./
COPY packages/widget/package.json packages/widget/
COPY packages/server/package.json packages/server/
RUN pnpm install --frozen-lockfile
COPY packages packages
RUN pnpm -r build \
  && pnpm --filter @magicpages/pagemoji-server deploy --prod --legacy /app

FROM node:24-alpine
ENV NODE_ENV=production \
    DATABASE_PATH=/data/pagemoji.db
WORKDIR /app
COPY --from=build /app .
RUN mkdir /data && chown node:node /data
USER node
VOLUME /data
EXPOSE 3000
HEALTHCHECK --interval=30s --timeout=3s \
  CMD node -e "fetch('http://127.0.0.1:' + (process.env.PORT || 3000) + '/healthz').then((r) => process.exit(r.ok ? 0 : 1), () => process.exit(1))"
CMD ["node", "dist/main.js"]

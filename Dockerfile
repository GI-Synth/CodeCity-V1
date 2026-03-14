FROM node:20-slim AS base
RUN npm install -g pnpm@9
WORKDIR /app

COPY package.json pnpm-workspace.yaml pnpm-lock.yaml .npmrc ./
COPY artifacts/api-server/package.json ./artifacts/api-server/
COPY artifacts/software-city/package.json ./artifacts/software-city/
COPY lib/db/package.json ./lib/db/
COPY lib/api-client-react/package.json ./lib/api-client-react/
COPY lib/api-zod/package.json ./lib/api-zod/
COPY lib/api-spec/package.json ./lib/api-spec/

RUN pnpm install --frozen-lockfile

FROM base AS builder
COPY . .
RUN pnpm --filter @workspace/db run build 2>/dev/null || true
RUN pnpm --filter @workspace/api-zod run build 2>/dev/null || true
RUN pnpm --filter @workspace/api-client-react run build 2>/dev/null || true
RUN pnpm --filter @workspace/api-server run build
RUN pnpm --filter @workspace/software-city run build

FROM node:20-slim AS runner
WORKDIR /app

COPY --from=builder /app/artifacts/api-server/dist ./dist/
COPY --from=builder /app/artifacts/software-city/dist /public/
COPY --from=builder /app/node_modules ./node_modules/

RUN mkdir -p data

ENV NODE_ENV=production
ENV PORT=8080
ENV DB_PATH=/app/data/city.db

EXPOSE 8080

CMD ["node", "dist/index.cjs"]

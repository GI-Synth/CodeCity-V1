FROM node:20-alpine AS base
RUN npm install -g pnpm@10

WORKDIR /app
COPY package.json pnpm-workspace.yaml pnpm-lock.yaml ./
COPY libs/ ./libs/
COPY artifacts/api-server/package.json ./artifacts/api-server/
COPY artifacts/software-city/package.json ./artifacts/software-city/

RUN pnpm install --frozen-lockfile

FROM base AS builder
COPY . .
RUN pnpm run build

FROM node:20-alpine AS runner
RUN npm install -g pnpm@10
WORKDIR /app

COPY --from=builder /app/package.json ./
COPY --from=builder /app/pnpm-workspace.yaml ./
COPY --from=builder /app/pnpm-lock.yaml ./
COPY --from=builder /app/libs/ ./libs/
COPY --from=builder /app/artifacts/api-server/ ./artifacts/api-server/
COPY --from=builder /app/artifacts/software-city/dist/ ./artifacts/software-city/dist/
COPY --from=builder /app/node_modules/ ./node_modules/

RUN mkdir -p /app/artifacts/api-server/data

ENV NODE_ENV=production
ENV PORT=8080

EXPOSE 8080

CMD ["node", "artifacts/api-server/dist/index.js"]

FROM oven/bun:1.3.10 AS base

WORKDIR /app

COPY . .

RUN bun install --frozen-lockfile

WORKDIR /app/apps/console

RUN bun run build

ENV HOST=0.0.0.0
ENV PORT=3000

EXPOSE 3000

ENTRYPOINT ["bun", "./build/index.js"]

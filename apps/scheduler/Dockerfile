FROM oven/bun:1.3.10 AS base

WORKDIR /app

COPY . .

RUN bun install --frozen-lockfile

WORKDIR /app/apps/scheduler

ENTRYPOINT ["bun", "run", "start"]

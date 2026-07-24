FROM oven/bun:1.3.13

ENV NODE_ENV=production

WORKDIR /app

COPY . .

RUN bun install --frozen-lockfile --no-save
RUN chown -R bun:bun /app

USER bun
WORKDIR /app/apps/scheduler

ENTRYPOINT ["bun", "run", "start"]

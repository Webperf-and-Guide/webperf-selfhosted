FROM oven/bun:1.3.10

ENV NODE_ENV=production

WORKDIR /app

COPY . .

RUN bun install --no-save
RUN chown -R bun:bun /app

USER bun
WORKDIR /app/apps/scheduler

ENTRYPOINT ["bun", "run", "start"]

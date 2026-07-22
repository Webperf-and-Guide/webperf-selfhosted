FROM oven/bun:1.3.13

ENV NODE_ENV=production

WORKDIR /app

COPY . .

RUN bun install --frozen-lockfile --no-save
RUN mkdir -p /data && chown -R bun:bun /app /data

USER bun
WORKDIR /app/apps/api

EXPOSE 8788

ENTRYPOINT ["bun", "run", "start"]

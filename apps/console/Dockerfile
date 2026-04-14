FROM oven/bun:1.3.10

ENV NODE_ENV=production
ENV HOST=0.0.0.0
ENV PORT=3000

WORKDIR /app

COPY . .

RUN bun install --no-save

WORKDIR /app/apps/console
RUN bun run build

WORKDIR /app
RUN chown -R bun:bun /app

USER bun
WORKDIR /app/apps/console

EXPOSE 3000

ENTRYPOINT ["bun", "./build/index.js"]

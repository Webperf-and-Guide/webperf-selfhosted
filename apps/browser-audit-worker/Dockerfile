FROM oven/bun:1.3.11-slim

ARG CHROME_VERSION=stable
ARG TARGETARCH

RUN apt-get update && apt-get install -y --no-install-recommends \
  ca-certificates \
  fonts-liberation \
  libasound2 \
  libatk-bridge2.0-0 \
  libatk1.0-0 \
  libc6 \
  libcairo2 \
  libcups2 \
  libdbus-1-3 \
  libexpat1 \
  libfontconfig1 \
  libgbm1 \
  libgcc1 \
  libglib2.0-0 \
  libgtk-3-0 \
  libnspr4 \
  libnss3 \
  libpango-1.0-0 \
  libpangocairo-1.0-0 \
  libstdc++6 \
  libx11-6 \
  libx11-xcb1 \
  libxcb1 \
  libxcomposite1 \
  libxcursor1 \
  libxdamage1 \
  libxext6 \
  libxfixes3 \
  libxi6 \
  libxrandr2 \
  libxrender1 \
  libxshmfence1 \
  libxss1 \
  libxtst6 \
  xdg-utils \
  && rm -rf /var/lib/apt/lists/*

WORKDIR /workspace/webperf-selfhosted

COPY . /workspace/webperf-selfhosted

WORKDIR /workspace/webperf-selfhosted/apps/browser-audit-worker

RUN bun install --no-save --filter=browser-audit-worker --omit=dev

RUN if [ "$TARGETARCH" = "arm64" ]; then \
    apt-get update && apt-get install -y --no-install-recommends chromium chromium-sandbox && rm -rf /var/lib/apt/lists/*; \
  else \
    bun x @puppeteer/browsers install chrome@${CHROME_VERSION} --path /opt/chrome; \
  fi
RUN chown -R bun:bun /workspace

USER bun

ENV NODE_ENV=production
ENV HOST=0.0.0.0
ENV PORT=8080
ENV CHROME_INSTALL_DIR=/opt/chrome

EXPOSE 8080

CMD ["bun", "src/index.ts"]

FROM oven/bun:1.3.13-slim

ARG CHROME_VERSION
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

WORKDIR /workspace/webperf-selfhosted/apps/browser-audit-lighthouse

RUN bun install --frozen-lockfile --no-save --filter=webperf-browser-audit-lighthouse --omit=dev

RUN if [ "$TARGETARCH" = "arm64" ]; then \
    apt-get update && apt-get install -y --no-install-recommends chromium chromium-sandbox && rm -rf /var/lib/apt/lists/*; \
  else \
    resolved_chrome_version="${CHROME_VERSION:-$(bun -e 'import { PUPPETEER_REVISIONS } from "puppeteer-core"; process.stdout.write(PUPPETEER_REVISIONS.chrome)')}" \
    && test -n "$resolved_chrome_version" \
    && bun x @puppeteer/browsers install "chrome@${resolved_chrome_version}" --path /opt/chrome \
    && chrome_executable="$(find /opt/chrome -type f -name chrome -perm /111 -print -quit)" \
    && test -n "$chrome_executable" \
    && mkdir -p /opt/google/chrome \
    && cp -a "$(dirname "$chrome_executable")/." /opt/google/chrome/ \
    && rm -rf /opt/chrome; \
  fi
RUN sandbox_path="$(find /opt /usr/lib -type f \( -name chrome-sandbox -o -name chrome_sandbox \) -print -quit 2>/dev/null)" \
  && test -n "$sandbox_path" \
  && chown root:root "$sandbox_path" \
  && chmod 4755 "$sandbox_path" \
  && if [ -x /opt/google/chrome/chrome ] && [ "$sandbox_path" != "/opt/google/chrome/chrome-sandbox" ]; then cp -p "$sandbox_path" /opt/google/chrome/chrome-sandbox; fi \
  && if [ -f /opt/google/chrome/chrome-sandbox ]; then chown root:root /opt/google/chrome/chrome-sandbox && chmod 4755 /opt/google/chrome/chrome-sandbox; fi \
  && cp -p "$sandbox_path" /usr/local/sbin/chrome-devel-sandbox \
  && chown root:root /usr/local/sbin/chrome-devel-sandbox \
  && chmod 4755 /usr/local/sbin/chrome-devel-sandbox \
  && test -u /usr/local/sbin/chrome-devel-sandbox \
  && test -x /usr/local/sbin/chrome-devel-sandbox
RUN chown -R bun:bun /workspace

USER bun

ENV NODE_ENV=production
ENV HOST=0.0.0.0
ENV PORT=8080
ENV CHROME_INSTALL_DIR=/opt/google/chrome
ENV CHROME_DEVEL_SANDBOX=/usr/local/sbin/chrome-devel-sandbox

EXPOSE 8080

CMD ["bun", "src/index.ts"]

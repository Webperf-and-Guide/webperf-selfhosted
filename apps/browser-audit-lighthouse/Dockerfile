FROM oven/bun:1.3.13-slim

# Keep this aligned with PUPPETEER_REVISIONS.chrome in the locked
# puppeteer-core dependency. Pinning it here makes the downloaded browser an
# explicit, reviewable image input instead of a CDN-time default.
ARG CHROME_VERSION=146.0.7680.153
ARG DEBIAN_CHROMIUM_VERSION=146.0.7680.153-1~deb13u1
ARG DEBIAN_CHROMIUM_SNAPSHOT=20260320T220114Z
ARG TARGETARCH

RUN apt-get update \
  && apt-get install -y --no-install-recommends \
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

COPY package.json bun.lock ./
COPY apps/api/package.json apps/api/package.json
COPY apps/browser-audit-lighthouse/package.json apps/browser-audit-lighthouse/package.json
COPY apps/console/package.json apps/console/package.json
COPY apps/executor/package.json apps/executor/package.json
COPY apps/scheduler/package.json apps/scheduler/package.json
COPY packages/config/package.json packages/config/package.json
COPY packages/contracts/package.json packages/contracts/package.json
COPY packages/domain-core/package.json packages/domain-core/package.json
COPY packages/report-core/package.json packages/report-core/package.json
COPY packages/ui/package.json packages/ui/package.json

WORKDIR /workspace/webperf-selfhosted/apps/browser-audit-lighthouse

RUN bun install --frozen-lockfile --filter=webperf-browser-audit-lighthouse --omit=dev

WORKDIR /workspace/webperf-selfhosted
COPY . /workspace/webperf-selfhosted

WORKDIR /workspace/webperf-selfhosted/apps/browser-audit-lighthouse

# Download the exact arm64 browser packages with the immutable snapshot as the
# only source. Install those local packages after restoring the base image's
# Debian sources, with the snapshot retained only as a low-priority fallback for
# transitive packages unavailable from the current repositories.
RUN if [ "$TARGETARCH" = "arm64" ]; then \
    test "${DEBIAN_CHROMIUM_VERSION%%-*}" = "$CHROME_VERSION" \
    && printf 'deb [check-valid-until=no] https://snapshot.debian.org/archive/debian/%s/ trixie main\ndeb [check-valid-until=no] https://snapshot.debian.org/archive/debian-security/%s/ trixie-security main\n' "$DEBIAN_CHROMIUM_SNAPSHOT" "$DEBIAN_CHROMIUM_SNAPSHOT" > /tmp/chromium-snapshot.list \
    && printf 'Package: *\nPin: origin "snapshot.debian.org"\nPin-Priority: 100\n\nPackage: chromium chromium-common chromium-sandbox\nPin: version %s\nPin-Priority: 1001\n' "$DEBIAN_CHROMIUM_VERSION" > /tmp/chromium-snapshot.pref \
    && apt-get -o Dir::Etc::sourcelist=/tmp/chromium-snapshot.list -o Dir::Etc::sourceparts=- -o Acquire::Check-Valid-Until=false update \
    && for package in chromium chromium-common chromium-sandbox; do \
      apt-cache -o Dir::Etc::sourcelist=/tmp/chromium-snapshot.list -o Dir::Etc::sourceparts=- policy "$package" \
        | grep -Fq "Candidate: $DEBIAN_CHROMIUM_VERSION" || exit 1; \
    done \
    && install -d -o _apt -g root -m 0755 /tmp/chromium-debs \
    && cd /tmp/chromium-debs \
    && apt-get -o Dir::Etc::sourcelist=/tmp/chromium-snapshot.list -o Dir::Etc::sourceparts=- -o Acquire::Check-Valid-Until=false download \
      "chromium=$DEBIAN_CHROMIUM_VERSION" \
      "chromium-common=$DEBIAN_CHROMIUM_VERSION" \
      "chromium-sandbox=$DEBIAN_CHROMIUM_VERSION" \
    && test "$(find /tmp/chromium-debs -maxdepth 1 -type f -name '*.deb' | wc -l)" -eq 3 \
    && cd / \
    && dpkg --unpack /tmp/chromium-debs/*.deb \
    && apt-get -o Dir::Etc::sourcelist=/tmp/chromium-snapshot.list -o Acquire::Check-Valid-Until=false update \
    && apt-get -o Dir::Etc::sourcelist=/tmp/chromium-snapshot.list -o Dir::Etc::preferences=/tmp/chromium-snapshot.pref -o Acquire::Check-Valid-Until=false --fix-broken install -y --no-install-recommends \
    && for package in chromium chromium-common chromium-sandbox; do \
      test "$(dpkg-query -W -f='${Version}' "$package")" = "$DEBIAN_CHROMIUM_VERSION" || exit 1; \
    done \
    && rm -rf /var/lib/apt/lists/* \
    && rm -rf /tmp/chromium-debs \
    && rm -f /tmp/chromium-snapshot.list /tmp/chromium-snapshot.pref \
    && mkdir -p /opt/webperf \
    && ln -s /usr/lib/chromium /opt/webperf/chrome; \
  else \
    resolved_chrome_version="${CHROME_VERSION:-$(bun -e 'import { PUPPETEER_REVISIONS } from "puppeteer-core"; process.stdout.write(PUPPETEER_REVISIONS.chrome)')}" \
    && test -n "$resolved_chrome_version" \
    && bun x @puppeteer/browsers install "chrome@${resolved_chrome_version}" --path /opt/chrome \
    && chrome_executable="$(find /opt/chrome -type f -name chrome -perm /111 -print -quit)" \
    && test -n "$chrome_executable" \
    && mkdir -p /opt/webperf/chrome \
    && cp -a "$(dirname "$chrome_executable")/." /opt/webperf/chrome/ \
    && rm -rf /opt/chrome; \
  fi
# Production Compose uses Chromium's user-namespace sandbox together with
# no-new-privileges. The product-specific path avoids distro AppArmor profiles
# that target Chrome's conventional install path. Keep packaged helpers
# non-setuid so alternate launch paths cannot silently re-enable the privileged
# helper.
RUN sandbox_path="$(find /opt /usr/lib -type f \( -name chrome-sandbox -o -name chrome_sandbox -o -name chromium-sandbox \) -print -quit 2>/dev/null)" \
  && test -n "$sandbox_path" \
  && chown root:root "$sandbox_path" \
  && chmod 0755 "$sandbox_path" \
  && if [ -x /opt/webperf/chrome/chrome ] && [ "$sandbox_path" != "/opt/webperf/chrome/chrome-sandbox" ]; then cp -p "$sandbox_path" /opt/webperf/chrome/chrome-sandbox; fi \
  && chown root:root /opt/webperf/chrome/chrome-sandbox \
  && chmod 0755 /opt/webperf/chrome/chrome-sandbox \
  && test -x /opt/webperf/chrome/chrome-sandbox \
  && test ! -u /opt/webperf/chrome/chrome-sandbox
RUN chown -R bun:bun /workspace

USER bun

ENV NODE_ENV=production
ENV HOST=0.0.0.0
ENV PORT=8080
# Both architectures populate this path: amd64 copies the pinned Chrome build,
# while arm64 links the distribution Chromium directory into it.
ENV CHROME_INSTALL_DIR=/opt/webperf/chrome

EXPOSE 8080

CMD ["bun", "src/index.ts"]

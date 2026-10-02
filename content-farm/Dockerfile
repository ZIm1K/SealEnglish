# Content farm as a Google Cloud Run Job (see scripts/deploy-cloud.sh).
# Default command `work` produces approved items; Cloud Scheduler runs `pack` every 2 days.
FROM node:22-bookworm-slim

# Shared libraries for Remotion's headless Chrome + fonts (Cyrillic, emoji).
RUN apt-get update && apt-get install -y --no-install-recommends \
      libnss3 libdbus-1-3 libatk1.0-0 libatk-bridge2.0-0 libgbm1 libasound2 libxrandr2 libxkbcommon0 \
      libxfixes3 libxcomposite1 libxdamage1 libpango-1.0-0 libcairo2 libcups2 ca-certificates \
      fonts-noto-core fonts-noto-color-emoji \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --no-audit --no-fund
# Download Chrome Headless Shell at build time so executions don't pay for it.
RUN npx remotion browser ensure

COPY . .
ENTRYPOINT ["npx", "tsx", "src/cli.ts"]
CMD ["work"]

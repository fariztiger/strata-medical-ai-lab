# ============================================================================
# STRATA ContentVault — Reproducible Non-Root Container Build (Mission 005)
# ============================================================================
# Self-hosted / staging container template. Runs as unprivileged `node` user
# with permissive-only PDFium + Pillow + WenQuanYi Micro Hei CJK font and
# `/readyz` readiness probe. No secrets or private data are baked into layers.

FROM node:22-bookworm-slim

ENV NODE_ENV=production \
    HOST=0.0.0.0 \
    PORT=7410 \
    CV_PDF_ENGINE=pypdfium2 \
    CV_DATA_DIR=/var/lib/contentvault \
    PYTHONUNBUFFERED=1

RUN apt-get update && apt-get install -y --no-install-recommends \
      python3 \
      python3-pip \
      fonts-wqy-microhei \
      ca-certificates \
      curl \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /opt/strata

# Install pinned permissive Python PDFium & Pillow dependencies
COPY packages/watermark-engine/requirements.txt ./packages/watermark-engine/requirements.txt
RUN pip3 install --break-system-packages --no-cache-dir \
      --target /opt/strata/vendor/pylibs \
      -r ./packages/watermark-engine/requirements.txt

# Install pinned Node.js runtime dependencies (`pg` only; omit devDependencies)
COPY apps/contentvault-api/package.json apps/contentvault-api/package-lock.json ./apps/contentvault-api/
RUN npm --prefix apps/contentvault-api ci --omit=dev --no-audit --no-fund

# Copy application source, migrations, scripts, and third-party license notices
COPY apps/contentvault-api/src ./apps/contentvault-api/src
COPY apps/contentvault-api/public ./apps/contentvault-api/public
COPY apps/contentvault-api/scripts ./apps/contentvault-api/scripts
COPY apps/strata-website/public ./apps/strata-website/public
COPY packages/watermark-engine ./packages/watermark-engine
COPY db/migrations ./db/migrations
COPY scripts/operations ./scripts/operations
COPY scripts/packaging ./scripts/packaging
COPY docs/licensing ./docs/licensing
RUN cp ./docs/licensing/THIRD_PARTY_NOTICES.md /opt/strata/THIRD_PARTY_NOTICES.txt

RUN mkdir -p /var/lib/contentvault && \
    chown -R node:node /var/lib/contentvault /opt/strata && \
    chmod 0700 /var/lib/contentvault

USER node

EXPOSE 7410

HEALTHCHECK --interval=15s --timeout=5s --start-period=10s --retries=3 \
  CMD curl -fsS http://127.0.0.1:7410/readyz >/dev/null || exit 1

CMD ["node", "apps/contentvault-api/src/server.js"]

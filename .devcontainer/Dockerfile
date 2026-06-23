FROM ghcr.io/heikogr/mmm-devcontainer:node24-trixie-slim

WORKDIR /opt/magic_mirror

RUN apt-get update \
    && apt-get install -y --no-install-recommends git-lfs \
    && rm -rf /var/lib/apt/lists/* \
    && git lfs install --system

RUN command -v ncu >/dev/null 2>&1 || npm install -g npm-check-updates
RUN command -v playwright-mcp >/dev/null 2>&1 || npm install -g @playwright/mcp playwright

COPY --chmod=755 ./entrypoint.sh /entrypoint.sh
RUN sed -i 's/\r$//' /entrypoint.sh && chmod +x /entrypoint.sh

RUN ln -sf /entrypoint.sh /entrypoint

COPY ./ecosystem.config.js /opt/magic_mirror/ecosystem.config.js

EXPOSE 8080

ENTRYPOINT ["/entrypoint.sh"]
FROM node:22.14.0-bookworm-slim AS builder
WORKDIR /workspace
RUN apt-get update \
    && apt-get install -y --no-install-recommends openssl \
    && rm -rf /var/lib/apt/lists/*
RUN corepack enable && corepack prepare pnpm@10.15.0 --activate
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY apps/api/package.json ./apps/api/package.json
COPY packages/db/package.json ./packages/db/package.json
RUN --mount=type=cache,id=kase-pnpm-store,target=/root/.local/share/pnpm/store \
    pnpm install --filter @kase/api... --frozen-lockfile
COPY . .
RUN pnpm --filter @kase/db run generate && pnpm --filter @kase/api run build

FROM node:22.14.0-bookworm-slim AS worker-base
ARG EXPECTED_CURL_VERSION=7.88.1
RUN apt-get update \
    && apt-get install -y --no-install-recommends ca-certificates curl openssl tini \
    && curl --version | head -n 1 | grep -F "curl ${EXPECTED_CURL_VERSION}" \
    && rm -rf /var/lib/apt/lists/* \
    && groupadd --gid 10001 kase \
    && useradd --uid 10001 --gid 10001 --no-create-home --shell /usr/sbin/nologin kase
WORKDIR /workspace
COPY --from=builder --chown=10001:10001 /workspace/node_modules ./node_modules
COPY --from=builder --chown=10001:10001 /workspace/apps/api/node_modules ./apps/api/node_modules
COPY --from=builder --chown=10001:10001 /workspace/apps/api/dist ./apps/api/dist
COPY --from=builder --chown=10001:10001 /workspace/apps/api/package.json ./apps/api/package.json
COPY --from=builder --chown=10001:10001 /workspace/packages/db ./packages/db
ENV NODE_ENV=production \
    KASE_SECRET_TMPFS=/run/kase-secrets \
    KASE_CURL_VERSION=7.88.1
USER 10001:10001
ENTRYPOINT ["/usr/bin/tini", "--"]
CMD ["node", "apps/api/dist/worker-main.js"]

FROM worker-base AS worker-recon
USER root
ARG KATANA_VERSION=1.6.1
ARG KATANA_SHA256=503754f1bd370c3ef287df6998e317baed2dd75bdd13ea64034f09b80ca393f3
ARG HTTPX_VERSION=1.10.0
ARG HTTPX_SHA256=63eac4dcd6e5c9867c94765fdaaf66e7b4eeae3474a1f06e600e266a1c81a53e
RUN apt-get update \
    && apt-get install -y --no-install-recommends unzip \
    && curl -fsSL "https://github.com/projectdiscovery/katana/releases/download/v${KATANA_VERSION}/katana_${KATANA_VERSION}_linux_amd64.zip" -o /tmp/katana.zip \
    && echo "${KATANA_SHA256}  /tmp/katana.zip" | sha256sum -c - \
    && unzip -q /tmp/katana.zip -d /tmp/katana \
    && install -m 0755 /tmp/katana/katana /usr/local/bin/katana \
    && curl -fsSL "https://github.com/projectdiscovery/httpx/releases/download/v${HTTPX_VERSION}/httpx_${HTTPX_VERSION}_linux_amd64.zip" -o /tmp/httpx.zip \
    && echo "${HTTPX_SHA256}  /tmp/httpx.zip" | sha256sum -c - \
    && unzip -q /tmp/httpx.zip -d /tmp/httpx \
    && install -m 0755 /tmp/httpx/httpx /usr/local/bin/httpx \
    && rm -rf /tmp/katana /tmp/httpx /tmp/katana.zip /tmp/httpx.zip /var/lib/apt/lists/*
COPY --chown=10001:10001 workers/tool-inventory.json ./workers/tool-inventory.json
ENV KASE_WORKER_FAMILY=recon \
    KASE_KATANA_VERSION=1.6.1 \
    KASE_HTTPX_VERSION=1.10.0
USER 10001:10001

FROM worker-base AS worker-browser
ENV KASE_WORKER_FAMILY=browser

FROM worker-base AS worker-sast
USER root
RUN sed -i 's|http://deb.debian.org|https://deb.debian.org|g' /etc/apt/sources.list.d/debian.sources \
    && apt-get update \
    && apt-get install -y --no-install-recommends git python3 python3-venv \
    && rm -rf /var/lib/apt/lists/*
RUN --mount=type=cache,target=/root/.cache/pip \
    python3 -m venv /opt/semgrep \
    && /opt/semgrep/bin/pip install --retries 20 --timeout 120 semgrep==1.175.0 \
    && ln -s /opt/semgrep/bin/semgrep /usr/local/bin/semgrep \
    && semgrep --version | grep -Fx '1.175.0'
COPY --from=builder --chown=10001:10001 /workspace/rules ./rules
ENV KASE_WORKER_FAMILY=sast
USER 10001:10001

FROM worker-base AS worker-deps
ENV KASE_WORKER_FAMILY=deps

FROM worker-base AS worker-agent
ENV KASE_WORKER_FAMILY=agent

FROM worker-base AS api
USER 10001:10001
CMD ["node", "apps/api/dist/main.js"]

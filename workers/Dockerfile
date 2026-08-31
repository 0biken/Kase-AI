# syntax=docker/dockerfile:1.7
FROM node:22.14.0-bookworm-slim AS builder
WORKDIR /workspace
RUN corepack enable && corepack prepare pnpm@10.15.0 --activate
COPY . .
RUN pnpm install --filter @kase/api... --frozen-lockfile
RUN pnpm --filter @kase/db run generate && pnpm --filter @kase/api run build

FROM node:22.14.0-bookworm-slim AS worker-base
ARG EXPECTED_CURL_VERSION=7.88.1
RUN apt-get update \
    && apt-get install -y --no-install-recommends ca-certificates curl tini \
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
ENV KASE_WORKER_FAMILY=recon

FROM worker-base AS worker-browser
ENV KASE_WORKER_FAMILY=browser

FROM worker-base AS worker-sast
ENV KASE_WORKER_FAMILY=sast

FROM worker-base AS worker-deps
ENV KASE_WORKER_FAMILY=deps

FROM worker-base AS worker-agent
ENV KASE_WORKER_FAMILY=agent

FROM worker-base AS api
USER 10001:10001
CMD ["node", "apps/api/dist/main.js"]

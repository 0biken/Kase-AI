FROM node:22-alpine
WORKDIR /workspace
RUN corepack enable && corepack prepare pnpm@10.15.0 --activate
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY fixtures/vulnerable-app/package.json fixtures/vulnerable-app/package.json
RUN pnpm install --filter @kase/vulnerable-app... --frozen-lockfile
COPY fixtures/vulnerable-app fixtures/vulnerable-app
WORKDIR /workspace/fixtures/vulnerable-app
CMD ["pnpm", "exec", "tsx", "main.ts"]

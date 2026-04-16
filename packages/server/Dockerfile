FROM node:20-alpine

WORKDIR /app

COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY packages/server/package.json ./packages/server/
COPY packages/widget/package.json ./packages/widget/

RUN corepack enable && pnpm install --frozen-lockfile

COPY . .

RUN pnpm build

EXPOSE 3000

WORKDIR /app/packages/server

CMD ["node", "dist/index.js"]
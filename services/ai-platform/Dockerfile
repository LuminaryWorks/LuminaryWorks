# Lab / control-plane image. Build from LuminaryWorks repo root:
#   docker build -f services/ai-platform/Dockerfile -t luminaryworks/ai-platform:local .
# Compose override uses services/ai-platform as context when a local Dockerfile exists;
# for linked workspace packages prefer host `pnpm start:dev` in lab.

FROM node:24.22.1-alpine AS deps
WORKDIR /app
ARG NPM_REGISTRY=https://registry.npmjs.org
ENV NPM_CONFIG_REGISTRY=${NPM_REGISTRY}
ENV COREPACK_NPM_REGISTRY=${NPM_REGISTRY}
COPY package.json pnpm-lock.yaml* .npmrc pnpm-workspace.yaml* ./
RUN corepack enable \
    && pnpm config set registry "$NPM_REGISTRY" \
    && pnpm config set dangerouslyAllowAllBuilds true \
    && (pnpm install --frozen-lockfile || pnpm install)

FROM node:24.22.1-alpine AS build
WORKDIR /app
ARG NPM_REGISTRY=https://registry.npmjs.org
ENV NPM_CONFIG_REGISTRY=${NPM_REGISTRY}
ENV COREPACK_NPM_REGISTRY=${NPM_REGISTRY}
COPY --from=deps /app/node_modules ./node_modules
COPY . .
RUN corepack enable && pnpm build

FROM node:24.22.1-alpine AS runner
WORKDIR /app
ENV NODE_ENV=production
COPY --from=build /app/dist ./dist
COPY --from=build /app/node_modules ./node_modules
COPY package.json ./
EXPOSE 13100
CMD ["node", "dist/main.js"]

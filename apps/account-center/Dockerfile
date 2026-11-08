# Build context: LuminaryWorks repository root (the directory that contains
# `apps/` and `shared/`). Point compose at:
#   context: ../..
#   dockerfile: apps/account-center/Dockerfile
# A repo-root context has no .dockerignore, so the daemon may upload local
# node_modules. This file copies source paths explicitly and installs inside
# the image. Build `shared/packages/auth-react`, `ai-react`, and `ai-client`
# first (`dist/` is gitignored). Rsbuild aliases those dists, same as
# `@luminaryworks/ui`.
FROM node:24.22.1-alpine AS ui
WORKDIR /src/shared/packages/ui
ARG NPM_REGISTRY=https://registry.npmjs.org
ENV NPM_CONFIG_REGISTRY=${NPM_REGISTRY}
ENV COREPACK_NPM_REGISTRY=${NPM_REGISTRY}
COPY shared/.npmrc ./.npmrc
COPY shared/packages/ui/package.json shared/packages/ui/tsconfig.json shared/packages/ui/tsup.config.ts ./
COPY shared/packages/ui/src ./src
COPY shared/packages/ui/shell.css ./shell.css
RUN corepack enable \
  && pnpm config set registry "$NPM_REGISTRY" \
  && pnpm config set dangerouslyAllowAllBuilds true \
  && pnpm install \
  && pnpm build

FROM node:24.22.1-alpine AS deps
WORKDIR /src/apps/account-center
ARG NPM_REGISTRY=https://registry.npmjs.org
ENV NPM_CONFIG_REGISTRY=${NPM_REGISTRY}
ENV COREPACK_NPM_REGISTRY=${NPM_REGISTRY}
COPY apps/account-center/package.json apps/account-center/pnpm-lock.yaml apps/account-center/pnpm-workspace.yaml apps/account-center/.npmrc ./
COPY --from=ui /src/shared/packages/ui/package.json /src/shared/packages/ui/package.json
COPY --from=ui /src/shared/packages/ui/dist /src/shared/packages/ui/dist
COPY --from=ui /src/shared/packages/ui/shell.css /src/shared/packages/ui/shell.css
COPY shared/packages/ai-react/package.json /src/shared/packages/ai-react/package.json
COPY shared/packages/ai-react/dist /src/shared/packages/ai-react/dist
COPY shared/packages/ai-client/package.json /src/shared/packages/ai-client/package.json
COPY shared/packages/ai-client/dist /src/shared/packages/ai-client/dist
RUN corepack enable \
  && pnpm config set registry "$NPM_REGISTRY" \
  && pnpm config set dangerouslyAllowAllBuilds true \
  && (pnpm install --frozen-lockfile || pnpm install)

FROM node:24.22.1-alpine AS build
WORKDIR /src/apps/account-center
ARG NPM_REGISTRY=https://registry.npmjs.org
ENV NPM_CONFIG_REGISTRY=${NPM_REGISTRY}
ENV COREPACK_NPM_REGISTRY=${NPM_REGISTRY}
COPY --from=deps /src/apps/account-center/node_modules ./node_modules
COPY --from=deps /src/apps/account-center/package.json ./package.json
COPY --from=deps /src/shared/packages/ui /src/shared/packages/ui
COPY --from=deps /src/shared/packages/ai-react /src/shared/packages/ai-react
COPY --from=deps /src/shared/packages/ai-client /src/shared/packages/ai-client
COPY apps/account-center/src ./src
COPY apps/account-center/server ./server
COPY apps/account-center/public ./public
COPY apps/account-center/index.html apps/account-center/rsbuild.config.ts apps/account-center/tsconfig.json apps/account-center/tsconfig.node.json apps/account-center/pnpm-workspace.yaml apps/account-center/.npmrc ./
COPY shared/packages/auth-react/dist /src/shared/packages/auth-react/dist
COPY shared/packages/auth-react/package.json /src/shared/packages/auth-react/package.json
COPY services/auth-gateway/src/register-abuse.mjs /src/services/auth-gateway/src/register-abuse.mjs
COPY identity/register-email-policy.json /src/identity/register-email-policy.json
COPY assets/logo.svg /src/assets/logo.svg
RUN corepack enable && pnpm build

FROM node:24.22.1-alpine AS runner
WORKDIR /app
ENV NODE_ENV=production
COPY --from=build /src/apps/account-center/dist ./dist
COPY --from=build /src/apps/account-center/server ./server
COPY --from=build /src/apps/account-center/package.json ./
COPY --from=deps /src/apps/account-center/node_modules ./node_modules
USER node
EXPOSE 3060
CMD ["node", "server/main.mjs"]

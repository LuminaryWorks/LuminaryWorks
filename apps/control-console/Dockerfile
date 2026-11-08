# Build context: LuminaryWorks repository root (the directory that contains
# `apps/` and `shared/`). `deploy/compose/control-plane.yaml` still says
# `context: ../../apps/control-console`, which cannot see `shared/packages/ui`.
# Change that service to:
#   context: ../..
#   dockerfile: apps/control-console/Dockerfile
# A repo-root context has no .dockerignore, so the daemon may upload local
# node_modules. This file copies source paths explicitly and installs inside
# the image. Build `shared/packages/auth-react` first (`dist/` is gitignored);
# Rsbuild aliases that dist, same as `@luminaryworks/ui`.
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
WORKDIR /src/apps/control-console
ARG NPM_REGISTRY=https://registry.npmjs.org
ENV NPM_CONFIG_REGISTRY=${NPM_REGISTRY}
ENV COREPACK_NPM_REGISTRY=${NPM_REGISTRY}
COPY apps/control-console/package.json apps/control-console/pnpm-lock.yaml apps/control-console/pnpm-workspace.yaml apps/control-console/.npmrc ./
COPY --from=ui /src/shared/packages/ui/package.json /src/shared/packages/ui/package.json
COPY --from=ui /src/shared/packages/ui/dist /src/shared/packages/ui/dist
COPY --from=ui /src/shared/packages/ui/shell.css /src/shared/packages/ui/shell.css
RUN corepack enable \
  && pnpm config set registry "$NPM_REGISTRY" \
  && pnpm config set dangerouslyAllowAllBuilds true \
  && (pnpm install --frozen-lockfile || pnpm install)

FROM node:24.22.1-alpine AS build
WORKDIR /src/apps/control-console
ARG NPM_REGISTRY=https://registry.npmjs.org
ENV NPM_CONFIG_REGISTRY=${NPM_REGISTRY}
ENV COREPACK_NPM_REGISTRY=${NPM_REGISTRY}
COPY --from=deps /src/apps/control-console/node_modules ./node_modules
COPY --from=deps /src/apps/control-console/package.json ./package.json
COPY --from=deps /src/shared/packages/ui /src/shared/packages/ui
COPY apps/control-console/src ./src
COPY apps/control-console/server ./server
COPY apps/control-console/public ./public
COPY apps/control-console/index.html apps/control-console/rsbuild.config.ts apps/control-console/tsconfig.json apps/control-console/tsconfig.node.json apps/control-console/pnpm-workspace.yaml apps/control-console/.npmrc ./
COPY shared/packages/auth-react/dist /src/shared/packages/auth-react/dist
COPY shared/packages/auth-react/package.json /src/shared/packages/auth-react/package.json
COPY services/auth-gateway/src/register-abuse.mjs /src/services/auth-gateway/src/register-abuse.mjs
COPY identity/register-email-policy.json /src/identity/register-email-policy.json
COPY assets/logo.svg /src/assets/logo.svg
RUN corepack enable && pnpm build

FROM node:24.22.1-alpine AS runner
WORKDIR /app
ENV NODE_ENV=production
COPY --from=build /src/apps/control-console/dist ./dist
COPY --from=build /src/apps/control-console/server ./server
COPY --from=build /src/apps/control-console/package.json ./
COPY --from=deps /src/apps/control-console/node_modules ./node_modules
USER node
EXPOSE 3050
CMD ["node", "server/main.mjs"]

# Node 24 is the ecosystem baseline; .npmrc sets engine-strict=true, so an
# older base image fails `pnpm install` outright.
FROM node:24-alpine AS deps
WORKDIR /app
ARG NPM_REGISTRY=https://registry.npmjs.org
ENV NPM_CONFIG_REGISTRY=${NPM_REGISTRY}
ENV COREPACK_NPM_REGISTRY=${NPM_REGISTRY}
COPY package.json pnpm-lock.yaml* .npmrc ./
RUN corepack enable \
  && pnpm config set registry "$NPM_REGISTRY" \
  && (pnpm install --frozen-lockfile || pnpm install)

FROM node:24-alpine AS build
WORKDIR /app
ARG NPM_REGISTRY=https://registry.npmjs.org
ENV NPM_CONFIG_REGISTRY=${NPM_REGISTRY}
ENV COREPACK_NPM_REGISTRY=${NPM_REGISTRY}
COPY --from=deps /app/node_modules ./node_modules
COPY . .
RUN corepack enable && pnpm build

FROM node:24-alpine AS runner
WORKDIR /app
ENV NODE_ENV=production
COPY --from=build /app/dist ./dist
COPY --from=build /app/node_modules ./node_modules
COPY package.json ./
EXPOSE 3040
CMD ["node", "dist/main.js"]

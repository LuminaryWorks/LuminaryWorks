# Auth Gateway has no runtime dependencies — plain Node, no install step.
FROM node:24-alpine

WORKDIR /app
ENV NODE_ENV=production

COPY package.json ./
COPY src ./src

RUN node --check src/main.mjs && node --check src/transport.mjs && node --check src/health.mjs

USER node
EXPOSE 3010
CMD ["node", "src/main.mjs"]

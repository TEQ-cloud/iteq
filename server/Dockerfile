# Two stages so npm never reaches the runtime image.
#
# Every CVE the image scanners flagged against the api came from npm's own
# bundled dependencies (undici, tar) — not from iTEQ's dependencies, which are
# express/pg/redis/web-push/ws and nothing else. The api runs
# `node src/index.js` and the CronJob runs `node src/prune.js`, so npm and
# corepack are build-time tooling only. Dropping them removes that whole class
# of finding instead of waiting for a patched base image.
#
# (Need a VAPID keypair? `node src/vapid.js` — no npm required.)
FROM node:24-alpine AS deps
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --omit=dev

FROM node:24-alpine
RUN apk upgrade --no-cache \
 && rm -rf /usr/local/lib/node_modules/npm \
           /usr/local/lib/node_modules/corepack \
           /usr/local/bin/npm /usr/local/bin/npx /usr/local/bin/corepack \
           /opt/yarn-* /usr/local/bin/yarn /usr/local/bin/yarnpkg \
           /root/.npm
WORKDIR /app
ENV NODE_ENV=production
COPY --from=deps /app/node_modules ./node_modules
COPY package.json ./
COPY src ./src
USER node
EXPOSE 8080
CMD ["node", "src/index.js"]

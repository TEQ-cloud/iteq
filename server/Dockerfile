FROM node:24-alpine
# Patches the Alpine packages (and the bundled Node/OpenSSL runtime deps) the
# image was built with. Rebuild on a schedule to keep this effective.
RUN apk upgrade --no-cache
WORKDIR /app
ENV NODE_ENV=production
COPY package.json package-lock.json ./
RUN npm ci --omit=dev
COPY src ./src
USER node
EXPOSE 8080
CMD ["node", "src/index.js"]

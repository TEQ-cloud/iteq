FROM node:24-alpine AS build
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci
COPY . .
RUN npm run build

# nginx 1.29 tracks a newer Alpine than 1.27 did; `apk upgrade` on top picks up
# patched openssl/expat/libxml2/libpng/musl/zlib/curl that the scanners flag.
# Rebuilding this image regularly is what actually keeps the CVE count at zero.
FROM nginx:1.29-alpine
RUN apk upgrade --no-cache
# Shipped as a template: the entrypoint substitutes ${API_UPSTREAM} at startup.
COPY nginx.conf /etc/nginx/templates/default.conf.template
COPY security-headers.conf /etc/nginx/snippets/security-headers.conf
ENV API_UPSTREAM=iteq-api:8080
COPY --from=build /app/dist /usr/share/nginx/html
EXPOSE 8080

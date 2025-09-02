# ---------------------- Prebuild Stage
FROM node:18-alpine AS prebuild

ARG DECAP_CMS_VER=3.0.9
ARG NETLIFY_CMS_AUTH_HASH

RUN apk add --no-cache git

WORKDIR /builder

# decap-cms из npm
RUN npm pack decap-cms@${DECAP_CMS_VER} && \
    mkdir -p /builder/decap-cms && \
    tar -xzvf decap-cms-${DECAP_CMS_VER}.tgz -C decap-cms

# netlify-cms-github-oauth-provider — фиксируем коммит/тег
RUN git clone https://github.com/vencax/netlify-cms-github-oauth-provider.git /builder/netlify-cms-github-oauth-provider && \
    cd /builder/netlify-cms-github-oauth-provider && \
    git reset --hard ${NETLIFY_CMS_AUTH_HASH}

# Патчи OAuth-провайдера (если есть)
COPY app/netlify-cms-github-oauth-provider/*.patch /builder/netlify-cms-github-oauth-provider/
RUN cd /builder/netlify-cms-github-oauth-provider && \
    ls -1 *.patch 2>/dev/null | xargs -r -I{} sh -c 'git apply "{}"' && \
    rm -f *.patch 2>/dev/null || true

# ---------------------- Main Stage
FROM node:18-alpine AS main

ENV LOGLEVEL=info
ARG OAUTH_CLIENT_ID
ARG OAUTH_CLIENT_SECRET
ARG ORIGINS

ENV OAUTH_CLIENT_ID=$OAUTH_CLIENT_ID
ENV OAUTH_CLIENT_SECRET=$OAUTH_CLIENT_SECRET
ENV ORIGINS=$ORIGINS
ENV NODE_ENV=production

# (кастомные, если когда-то понадобится GitHub Enterprise и т.п.)
ENV GIT_HOSTNAME=
ENV OAUTH_PROVIDER=
ENV SCOPES=
ENV OAUTH_AUTHORIZE_PATH=
ENV OAUTH_TOKEN_PATH=

WORKDIR /app

# Исходники приложения
COPY app ./ 

# Артефакты
COPY --from=prebuild /builder/decap-cms/package/dist ./decap-cms/dist
COPY --from=prebuild /builder/netlify-cms-github-oauth-provider ./netlify-cms-github-oauth-provider

# Прод-зависимости (best-effort)
RUN cd /app/decap-cms && yarn install --production=true || true && \
    cd /app/netlify-cms-github-oauth-provider && yarn install --production=true || true

# Без root
RUN addgroup -S appgrp && adduser -S appuser -G appgrp
USER appuser

WORKDIR /app/decap-cms
EXPOSE 80

# Healthcheck: UI
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=5 \
  CMD wget -q -S -O /dev/null http://127.0.0.1:80/ || wget -q -S -O /dev/null http://127.0.0.1:80/#/

ENTRYPOINT ["node", "./app.js"]

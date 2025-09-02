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

# netlify-cms-github-oauth-provider (фиксируемся на коммите/теге из аргумента)
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

# (Необязательные переменные для кастомного OAuth)
ENV GIT_HOSTNAME=
ENV OAUTH_PROVIDER=
ENV SCOPES=
ENV OAUTH_AUTHORIZE_PATH=
ENV OAUTH_TOKEN_PATH=

WORKDIR /app

# Исходники приложения
COPY app ./

# Сборочные артефакты из prebuild
COPY --from=prebuild /builder/decap-cms/package/dist ./decap-cms/dist
COPY --from=prebuild /builder/netlify-cms-github-oauth-provider ./netlify-cms-github-oauth-provider

# Прод-зависимости (если нужны локальные)
RUN cd /app/decap-cms && yarn install --production=true || true
RUN cd /app/netlify-cms-github-oauth-provider && yarn install --production=true || true

WORKDIR /app/decap-cms
ENV NODE_ENV=production

EXPOSE 80
ENTRYPOINT ["node", "./app.js"]

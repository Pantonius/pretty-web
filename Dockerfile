# syntax=docker/dockerfile:1

FROM node:22-alpine AS build
WORKDIR /app
COPY package.json package-lock.json ./
COPY client/package.json client/package.json
COPY server/package.json server/package.json
RUN npm ci
COPY client/ client/

ARG VITE_AUTH_MODE=none
ARG VITE_OIDC_ISSUER
ARG VITE_OIDC_CLIENT_ID
ARG VITE_OIDC_REDIRECT_URI
ARG VITE_COLLAB_URL
ARG VITE_BASE=/
ENV VITE_AUTH_MODE=$VITE_AUTH_MODE \
    VITE_OIDC_ISSUER=$VITE_OIDC_ISSUER \
    VITE_OIDC_CLIENT_ID=$VITE_OIDC_CLIENT_ID \
    VITE_OIDC_REDIRECT_URI=$VITE_OIDC_REDIRECT_URI \
    VITE_COLLAB_URL=$VITE_COLLAB_URL \
    VITE_BASE=$VITE_BASE
RUN npm run build

FROM node:22-alpine AS runtime
WORKDIR /app
ENV NODE_ENV=production \
    HOST=0.0.0.0 \
    PORT=1234 \
    DATA_DIR=/app/.data \
    STATIC_DIR=/app/client/dist
COPY package.json package-lock.json ./
COPY client/package.json client/package.json
COPY server/package.json server/package.json
RUN npm ci --omit=dev --workspace @pretty-web/server \
    && mkdir -p /app/.data \
    && chown -R node:node /app
COPY --chown=node:node server/src server/src
COPY --from=build --chown=node:node /app/client/dist client/dist
USER node
VOLUME /app/.data
EXPOSE 1234
CMD ["node", "server/src/index.mjs"]

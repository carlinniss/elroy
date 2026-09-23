# syntax=docker/dockerfile:1
# Elroy web app (overlay, control panel, API). Build: docker compose build

FROM node:22-alpine AS deps
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --no-audit --no-fund

FROM node:22-alpine AS build
WORKDIR /app
# NEXT_PUBLIC_* values are compiled into the browser bundle, so they must exist at build time.
ARG NEXT_PUBLIC_TWITCH_CHANNEL
ARG NEXT_PUBLIC_STREAMER_DISPLAY_NAME
ARG NEXT_PUBLIC_TWITCH_BOT_LOGIN
ARG ELROY_BUILD_ID=dev
ENV NEXT_PUBLIC_TWITCH_CHANNEL=$NEXT_PUBLIC_TWITCH_CHANNEL \
    NEXT_PUBLIC_STREAMER_DISPLAY_NAME=$NEXT_PUBLIC_STREAMER_DISPLAY_NAME \
    NEXT_PUBLIC_TWITCH_BOT_LOGIN=$NEXT_PUBLIC_TWITCH_BOT_LOGIN \
    ELROY_BUILD_ID=$ELROY_BUILD_ID \
    NEXT_TELEMETRY_DISABLED=1
COPY --from=deps /app/node_modules ./node_modules
COPY . .
RUN npm run build

FROM node:22-alpine AS run
WORKDIR /app
ENV NODE_ENV=production \
    NEXT_TELEMETRY_DISABLED=1 \
    PORT=3000 \
    HOSTNAME=0.0.0.0
COPY --from=build --chown=node:node /app/.next/standalone ./
COPY --from=build --chown=node:node /app/.next/static ./.next/static
COPY --from=build --chown=node:node /app/public ./public
USER node
EXPOSE 3000
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD wget -qO- http://127.0.0.1:3000/api/version >/dev/null || exit 1
CMD ["node", "server.js"]

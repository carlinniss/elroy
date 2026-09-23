FROM node:22-alpine
# ffmpeg decodes the audio; streamlink pulls the Twitch HLS stream (only needed for LISTEN_SOURCE=twitch).
RUN apk add --no-cache ffmpeg python3 py3-pip \
 && pip install --no-cache-dir --break-system-packages streamlink
WORKDIR /listener
COPY listener.mjs .
USER node
CMD ["node", "listener.mjs"]

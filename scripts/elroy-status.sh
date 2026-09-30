#!/bin/sh
# Elroy health check — run on the server:  sh scripts/elroy-status.sh
# Uses the control secret already inside the app container, so nothing to paste.
cd "$(dirname "$0")/.." || exit 1

echo "== Stream (Twitch) =="
docker compose exec -T app sh -c 'wget -qO- http://127.0.0.1:3000/api/twitch/stream' | head -c 300; echo; echo

echo "== Spotify now playing (checking this also runs the song-request handoff) =="
docker compose exec -T app sh -c 'wget -qO- --header="Authorization: Bearer $ELROY_CONTROL_SECRET" http://127.0.0.1:3000/api/spotify/now-playing' \
  | sed 's/"album":"[^"]*",//; s/"trackUrl":"[^"]*",//' | head -c 700; echo; echo

echo "== Song request line (queue / pushed / playing) =="
docker compose exec -T redis redis-cli GET elroy:sr:state | head -c 900; echo; echo

echo "== Recent Spotify / brain errors (last 30 min) =="
docker compose logs --since 30m app 2>/dev/null | grep -iE 'handoff failed|track lookup failed|song request|BRAIN ERROR|openai backup' | tail -8

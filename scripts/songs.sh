#!/bin/sh
# Print the songs that played on stream for a day (requests + your own music, with Spotify links).
#   sh scripts/songs.sh              → today
#   sh scripts/songs.sh 2026-09-29   → a specific day
cd "$(dirname "$0")/.." || exit 1
docker compose exec -T app sh -c "wget -qO- --header=\"Authorization: Bearer \$ELROY_CONTROL_SECRET\" 'http://127.0.0.1:3000/api/songs?date=$1'"

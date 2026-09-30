#!/bin/sh
# Print a day's stream transcript (host speech + everything Elroy posted).
#   sh scripts/transcript.sh              → today
#   sh scripts/transcript.sh 2026-09-29   → a specific day
#   sh scripts/transcript.sh --from-logs  → tonight's host lines recovered from the listener log
cd "$(dirname "$0")/.." || exit 1
if [ "$1" = "--from-logs" ]; then
  docker compose logs --no-log-prefix listener 2>/dev/null | grep ' host: ' | sed 's/^\([0-9T:-]*\)[0-9.]*Z host: /[\1 UTC] Host: /'
  exit 0
fi
docker compose exec -T app sh -c "wget -qO- --header=\"Authorization: Bearer \$ELROY_CONTROL_SECRET\" 'http://127.0.0.1:3000/api/transcript?date=$1'"

#!/bin/sh
# Shows which Twitch account each token in .env belongs to (never prints the tokens).
#   sh scripts/twitch-accounts.sh
cd "$(dirname "$0")/.." || exit 1
docker compose exec -T app node -e '
const vars = ["TWITCH_BOT_OAUTH_TOKEN", "TWITCH_OAUTH_TOKEN"];
(async () => {
  for (const name of vars) {
    const raw = (process.env[name] || "").trim().replace(/^oauth:/i, "");
    if (!raw) { console.log(`${name}: (empty)`); continue; }
    const res = await fetch("https://id.twitch.tv/oauth2/validate", { headers: { Authorization: `OAuth ${raw}` } });
    const data = await res.json().catch(() => ({}));
    console.log(res.ok ? `${name}: ${data.login}  (scopes: ${(data.scopes || []).join(" ")})` : `${name}: INVALID/EXPIRED (${res.status})`);
  }
  console.log(`TWITCH_BOT_USERNAME: ${process.env.TWITCH_BOT_USERNAME || "(blank)"}`);
})();
'

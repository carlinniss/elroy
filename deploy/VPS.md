# Running Elroy on a VPS (Docker)

> **First time?** [SETUP-GUIDE.md](SETUP-GUIDE.md) walks through getting every API key and token, step by step.

This runs everything Vercel + Upstash did, on one server you control, plus a **headless listener**
that replaces keeping `/studio` open in Edge.

```
            ┌──────────── your VPS ─────────────────────────────────────────┐
 Twitch ◀──▶│ caddy (HTTPS) ──▶ app (Next.js: overlay, /control, API)       │
 EventSub   │                     │                                        │
            │                     ├──▶ redis-rest ──▶ redis (chips, trivia,  │
            │                     │                  memory, directives)   │
            │ listener ──(ffmpeg/streamlink: stream audio)──▶ /api/studio/*  │
            └───────────────────────────────────────────────────────────────┘
 OBS (your PC): Browser Source → https://<domain>/embed/<ELROY_CONTROL_SECRET>
```

## 1. Server

Any small Linux VPS works: 1 vCPU / 1–2 GB RAM (Hetzner CX22, DigitalOcean $6–12, Linode, etc.).

1. Point a domain at it: an `A` record like `elroy.yourdomain.com → <server IP>`.
2. Install Docker:
   ```bash
   curl -fsSL https://get.docker.com | sh
   ```
3. Open ports **80** and **443** (TCP) in the provider's firewall. Open **9000/UDP** only if you use the SRT listener option below.

## 2. Install

```bash
git clone https://github.com/carlinniss/elroy.git
cd elroy
cp .env.example .env
nano .env        # fill in everything marked REQUIRED
docker compose up -d --build
```

Caddy fetches the HTTPS certificate on the first request (give it ~30s). Check it:

```bash
curl https://elroy.yourdomain.com/api/version
docker compose logs -f app listener
```

## 3. Point Twitch, Spotify and OBS at the new URL

| Where | Set to |
| --- | --- |
| Twitch dev console → your app → OAuth Redirect URLs | keep whatever you use for token generation |
| EventSub callback | automatic: `https://<ELROY_DOMAIN>/api/twitch/eventsub` (re-subscribed when Elroy starts) |
| Spotify dashboard → Redirect URI | `https://<ELROY_DOMAIN>/api/spotify/callback`, then reconnect Spotify from `/control/<secret>` |
| OBS Browser Source URL | `https://<ELROY_DOMAIN>/embed/<ELROY_CONTROL_SECRET>` |

Overlay URL options: add `?hud=off` to hide the diagnostics box on stream, `?widgets=off` to hide the
trivia/tables/now-playing cards.

## 4. The headless listener (no Edge tab)

The `listener` service hears the broadcast on the server and feeds the same Studio endpoints the
`/studio` page used: "host is talking" for voice gating, and transcripts so "hey Elroy" on mic works.
Pick a source with `LISTEN_SOURCE` in `.env`:

**`twitch` (default, zero setup).** Pulls your live stream's audio with streamlink. Starts on its own
when you go live and idles when you're offline. Trade-off: Twitch audio runs a few seconds behind
real time (low-latency mode helps), so the "wait for the host to stop talking" gate reacts a
couple of seconds late. Transcripts and "hey Elroy" work fine.

**SRT from OBS (near real-time).** Sends OBS program audio straight to the VPS:
1. `.env`: `LISTEN_SOURCE=srt://0.0.0.0:9000?mode=listener` and open 9000/UDP.
2. OBS → Settings → Output → Output Mode **Advanced** → **Recording** tab:
   Type **Custom Output (FFmpeg)**, FFmpeg Output Type **Output to URL**,
   File path or URL `srt://<server IP>:9000?mode=caller`, Container Format **mpegts**,
   Audio Encoder **aac**, Audio Bitrate **96**. Disable video tracks if offered.
3. Click **Start Recording** when you go live. This uses OBS's recording output, so you can't
   record locally at the same time. If you need both, keep `LISTEN_SOURCE=twitch`.

Set `LISTEN_TRANSCRIBE=false` for talking/quiet detection only, with no OpenAI cost.

You can still use `/studio` in a browser instead. Just run one listener, not both.

## 5. Updating

```bash
cd elroy && git pull
ELROY_BUILD_ID=$(git rev-parse --short HEAD) docker compose up -d --build
```

The overlay spots the new build id and reloads itself, but **only when the stream is offline**, so a
bad deploy can't take Elroy down mid-show. To take an update live right away, refresh the OBS
browser source.

## 6. Backups

All state lives in the `redis-data` volume (chips, trivia scores, viewer memory, directives):

```bash
docker compose exec redis redis-cli SAVE
docker run --rm -v elroy_redis-data:/data -v "$PWD":/backup alpine tar czf /backup/redis-$(date +%F).tgz -C /data .
```

### Moving existing Upstash data over (optional)
Chips and scores from the Vercel/Upstash setup don't migrate by themselves. The simplest route is
`redis-cli --rdb` against your Upstash instance (see Upstash's "Migrate" docs), then copy the dump
into the `redis-data` volume before the first `docker compose up`.

## Troubleshooting

| Symptom | Check |
| --- | --- |
| Caddy can't get a certificate | DNS A record points at this server; ports 80/443 open |
| Overlay says "Control key rejected" | `/embed/<secret>` matches `ELROY_CONTROL_SECRET` in `.env` |
| Raids/subs don't trigger | `TWITCH_EVENTSUB_SECRET` is set; `docker compose logs app \| grep -i eventsub` |
| Listener logs "no audio (offline?)" | normal while offline; when live, check the channel name and `docker compose logs listener` |
| Chips reset after a restart | the `redis-data` volume was removed (`docker compose down -v` deletes it) |

---

## Next step: a brain that doesn't live in OBS (plan, not built yet)

Elroy's logic still runs inside the OBS browser source: chat reading, games, prompts. If OBS or
that source dies, Elroy goes down with it. Now that there's an always-on server, the move is:

1. **Brain service** (new container): connect to chat with `tmi.js` in Node, subscribe to EventSub
   over WebSocket, and run the command router (`lib/bot-commands.ts`), prompts
   (`lib/elroy-prompts.ts`), games and memory server-side. Those modules are now framework-free, so
   they port as-is.
2. **Speaker page**: the OBS source shrinks to a small page that pulls the next voice line and SFX
   from a Redis queue and plays them, plus the on-screen widgets.
3. The overlay's timers (`setInterval` polling) become plain server loops, and most of the API
   polling goes away.

That turns ~15 polling loops in a browser into one long-running process. It's a few days of work,
best done after this Docker setup has run a couple of streams.

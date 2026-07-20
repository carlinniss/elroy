# Elroy — The Wise OG Twitch Bot

Elroy is an AI-driven Twitch chat bot and OBS overlay. He listens for mentions, subs, bits, raids, and follows; responds in chat (and voice when quota allows) via Google Gemini + ElevenLabs; runs trivia and casino games on shared play-money chips; and ships a transparent browser overlay for stream production.

## Features

* **Twitch chat** — `tmi.js` IRC plus Helix for sends, announcements, and mod actions.
* **AI personality** — Google Gemini (`gemini-2.5-flash-lite` by default) for mentions, check-ins, celebrations, and `!aboutme`.
* **Voice** — ElevenLabs TTS with quota-aware pacing and bundled SFX.
* **Host-aware Studio listener** — Optional `/studio` browser capture page shares Twitch tab/system audio, waits for quiet spots before TTS, transcribes recent host speech, and reacts when the host says "Elroy."
* **Trivia** — On demand only: chat types **`!trivia`** to start a round (cannabis / freaky / 90s music). Curated bank + optional Gemini generation; category intros match the question topic.
* **Casino games** — Blackjack, roulette, and Pick 3 / Pick 4 on one **1000 OG chip** bankroll (Redis-backed in production).
* **Viewer memory** — `!aboutme` recalls trivia wins, subs, mentions, and **how long you've been following**.
* **Stream awareness** — Title, game/category, viewer count (polled every **15s** from Twitch API); recent host speech from Studio; reacts to Spotify track changes; periodic command reminders every **7 minutes**.
* **Mod tools** — Raid shoutouts, `!clip`, `!poll`, colored chat announcements (trivia, games, hints).
* **Events** — Follows, subs, gifts, bits, raids, highlighted messages, channel updates (EventSub + IRC where applicable).
* **Overlay** — Transparent Next.js page for OBS; live prompt control panel for the broadcaster.

## Tech stack

* **Framework:** Next.js 15 (App Router)
* **Language:** TypeScript
* **AI:** Google Generative AI via `@ai-sdk/google`
* **Voice / SFX:** ElevenLabs
* **Chat:** TMI.js + Twitch Helix
* **State:** Upstash Redis (trivia scores, games, user memory, live directives) — in-memory fallback locally

## Installation

1. **Clone and install**
   ```powershell
   git clone https://github.com/carlinniss/elroy.git
   cd elroy
   npm install
   ```

2. **Environment** — create `.env.local` (see [Environment variables](#environment-variables)).

3. **Run**
   ```powershell
   npm run dev
   ```

4. Open `http://localhost:3000?controlKey=YOUR_ELROY_CONTROL_SECRET`, click **IGNITE BONG**, and mention Elroy in chat — he's listening.

## Environment variables

### Required (core)

| Variable | Purpose |
| --- | --- |
| `NEXT_PUBLIC_TWITCH_CHANNEL` | Your Twitch channel login (no `#`) |
| `ELROY_CONTROL_SECRET` | Long random string — overlay URL + API auth |
| `TWITCH_BOT_OAUTH_TOKEN` | Bot account OAuth token (chat send/read) |
| `TWITCH_OAUTH_TOKEN` | Broadcaster or mod token (Helix, EventSub, follows) |
| `TWITCH_CLIENT_ID` | Twitch application Client ID |
| `TWITCH_CLIENT_SECRET` | Twitch application Client Secret |
| `GOOGLE_GENERATIVE_AI_API_KEY` | [AI Studio](https://aistudio.google.com/) key for chat / aboutme / optional trivia generation |
| `ELEVENLABS_API_KEY` | Voice + generated SFX |
| `ELEVENLABS_VOICE_ID` | ElevenLabs voice ID (e.g. `pNInz6obpgDQGcFmaJgB`) |

### Recommended (production)

| Variable | Purpose |
| --- | --- |
| `TWITCH_BOT_USERNAME` | Bot login (defaults from token validation if omitted) |
| `TWITCH_EVENTSUB_SECRET` | 10–100 char secret for EventSub HMAC (raids, follows, subs, polls, etc.) |
| `KV_REST_API_URL` + `KV_REST_API_TOKEN` | Upstash Redis (or `UPSTASH_REDIS_REST_URL` / `UPSTASH_REDIS_REST_TOKEN`) |

Without Redis, trivia scores, casino tables, and user memory reset when the serverless instance cold-starts.

### Optional

| Variable | Purpose |
| --- | --- |
| `GOOGLE_GENERATIVE_AI_MODEL` | Override Gemini model (default `gemini-2.5-flash-lite`) |
| `NEXT_PUBLIC_STREAMER_DISPLAY_NAME` / `STREAMER_DISPLAY_NAME` | Streamer display name Elroy should use for the broadcaster (default `DTLDabs`) |
| `OPENAI_API_KEY` | OpenAI API key for Studio broadcast-audio transcription |
| `OPENAI_TRANSCRIPTION_MODEL` | Override Studio transcription model (default `gpt-4o-mini-transcribe-2025-12-15`) |
| `TRIVIA_DISABLE_GEMINI` | Set `true` to use only the static trivia bank |
| `TWITCH_EVENTSUB_CALLBACK` | Public HTTPS URL for EventSub (defaults to `https://<VERCEL_URL>/api/twitch/eventsub`) |
| `SPOTIFY_CLIENT_ID` / `SPOTIFY_CLIENT_SECRET` / `SPOTIFY_REDIRECT_URI` | Spotify now-playing integration |

### Twitch tokens

Paste the access token only — the `oauth:` prefix is optional.

**Bot account** (`TWITCH_BOT_OAUTH_TOKEN`): needs chat read/write scopes. Elroy should be **modded on your channel** so he can send announcements, shoutouts, clips, and polls.

**Broadcaster/mod token** (`TWITCH_OAUTH_TOKEN`): used for follows, bits, EventSub, and mod Helix calls. Typical scopes include `chat:read`, `chat:edit`, `moderator:read:followers`, `channel:manage:polls`, `clips:edit`, `moderator:manage:announcements`, `moderator:manage:shoutouts`, `bits:read`.

## Configuration notes

### Gemini billing

Chat and `!aboutme` use Gemini. Default model is **`gemini-2.5-flash-lite`**. Override with `GOOGLE_GENERATIVE_AI_MODEL`.

Trivia draws from **`lib/trivia-bank.ts`** + **`lib/trivia-bank-extra.ts`** (175+ curated questions). When `TRIVIA_DISABLE_GEMINI` is not set, Gemini may generate fresh questions with category validation so intros match content.

Stay under provider rate limits on free tier (~15 req/min). Prepaid: add credits in AI Studio → Billing.

### Audio

Bundled SFX live in `public/sounds/elroy/`. Optional fallback bong: `public/sounds/bong.mp3`.

### Studio broadcast listener

The `/studio` page is a broadcaster browser-capture page that keeps Elroy from talking over the stream. It is still needed because Twitch does not provide raw broadcast audio directly to the Next.js app. Instead, the browser captures the Twitch tab or system audio with your permission.

It is broadcast-audio only: click **Start listening**, then share the Twitch tab or system audio when the browser prompts for screen/tab capture. Elroy does not use a microphone fallback.

While Studio is running:

* `/studio` posts voice activity to `/api/studio/ingest` every ~250ms.
* The overlay polls `/api/studio/status` every ~500ms.
* Before TTS plays, Elroy waits until broadcast audio is quiet, plus the configured silence tail (default **1500ms**).
* If the stream stays busy for ~30s, Elroy skips voice and leaves the chat reply only.
* Studio records short broadcast-audio chunks, sends them to `/api/studio/transcribe`, and stores recent host speech in Studio state.
* Ambient comments can use recent host speech plus Twitch chat.
* When the host says "Elroy," the overlay queues a response or command-style reply, then still waits for a quiet spot before speaking.

This deliberately treats reaction-video voices and other loud broadcast audio as "busy." That is safer for stream production because Elroy waits instead of talking over the host or the video.

Open Studio at:

```text
https://your-site.vercel.app/studio?key=YOUR_ELROY_CONTROL_SECRET
```

In Chrome/Edge, choose a tab/window/system source that includes audio. For best results, feed Studio from an OBS/browser source that is audible to capture but **not monitored** to your speakers. Keep the overlay browser source running separately. If you close the Studio page, Elroy will keep responding in chat, but voice will no longer wait for host-silence or host spoken mentions.

#### Muted OBS setup for Studio

Use this if you want Elroy to hear the Twitch stream without hearing that stream audio in your room/headphones:

1. In OBS, add the Twitch stream/video source you want Elroy to hear. This can be a browser source, capture source, or any source that carries the reaction video/host audio.
2. In the OBS Audio Mixer, click the gear icon and open **Advanced Audio Properties**.
3. Find that Twitch/video audio source and set **Audio Monitoring** to **Monitor Off**.
4. In the same row, keep the source assigned only to the tracks you actually want. If viewers should hear it, leave the stream track enabled. If it is only for Elroy analysis, disable it from your broadcast track.
5. Open `/studio?key=YOUR_ELROY_CONTROL_SECRET` in Chrome/Edge and click **Start listening**.
6. When the browser asks what to share, choose a tab/window/system source that includes the OBS/Twitch audio.
7. Confirm your speakers/headphones do not play the Twitch source. Studio should still show moving audio level when the host/video talks.

Do **not** set the Twitch/video source to **Monitor and Output** unless you intentionally want to hear it locally. Studio analyzes captured audio; it does not need local speaker playback.

### API surface

Key routes under `app/api/`: `chat`, `speech`, `studio/*`, `trivia/*`, `blackjack/*`, `roulette/*`, `pick-numbers/*`, `twitch/*`, `spotify/*`, `users/aboutme`, `bot/session`.

---

## Chat commands

### Talk to Elroy

| Command | Who | What |
| --- | --- | --- |
| Mention Elroy | Everyone | Say his name in chat — he responds (+ voice when enabled). Ask about the stream title/game or Spotify. |
| `!aboutme` | Everyone | Elroy reads what he remembers (trivia wins, subs, mentions, follow tenure). |
| `!commands` / `!cmds` / `!help` | Everyone | Link to the full command list page (`/commands`). |

Elroy ignores his own messages and won't reply to his opening lines or system broadcasts.

### Trivia & leaderboards

| Command | Who | What |
| --- | --- | --- |
| `!trivia` | Everyone | Start a trivia round (optional: `cannabis`, `freaky`, `music90s`). Off until someone asks. |
| `!leaderboard` / `!lb` | Everyone | Trivia leaders (cannabis / freaky / 90s). |

Categories: **cannabis**, **freaky**, **90s music** — intro emoji/text matches the actual question.

### Casino — shared OG chips

Everyone starts with **1000 chips**. Blackjack, roulette, and Pick 3/4 share the same balance and leaderboard (`!bjtop` / `!bjlb`). Loan debt auto-collects from future winnings.

#### Blackjack

| Command | What |
| --- | --- |
| `!bj` / `!blackjack` | Open table / take a seat |
| `!bet <amount>` / `!bet all` | Bet during betting window (min 10) |
| `!hit` / `!h` · `!stand` / `!s` · `!double` / `!dd` | Play your hand |
| `!table` / `!bjtable` | Table status |
| `!chips` | Your balance |
| `!dare` | Shame ritual for +120 chips (20m cooldown) |
| `!loan` | +400 chips, +600 debt (stackable — Elroy roasts you each time) |
| `!debt` | Outstanding loan |
| `!bjtop` / `!bjlb` | Chip high rollers |
| `!bjstop` | **Mod** — cancel table, refund bets |

#### Roulette

| Command | What |
| --- | --- |
| `!roulette` / `!spin` | Open 45s betting |
| `!rbet <choice> <amount>` | One bet per round: `red`, `black`, `odd`, `even`, `0`–`36` |
| `!rtable` / `!rstatus` | Status |
| `!rstop` | **Mod** — cancel and refund |

Payouts: **2×** on color/odd/even, **36×** on a single number.

#### Pick 3 / Pick 4

| Command | What |
| --- | --- |
| `!pick3` / `!p3` · `!pick4` / `!p4` | Open 60s betting |
| `!p3bet` / `!p4bet <type> <num> <amt>` | Place a bet (up to **5** per player per round) |
| `!p3table` · `!p4table` | Status |
| `!p3stop` · `!p4stop` | **Mod** — cancel and refund |

**Bet types:** `straight` (exact order) · `box` (any order) · `combo` (straight+box, costs **2×**) · `front` / `back` pair (2 digits) · `mid` pair (**Pick 4 only**)

Aliases: `s`, `b`, `c`, `fp`, `bp`, `mp`.

Example: `!p3bet straight 420 50` · `!p4bet box 1234 25`

### Stream info & Spotify

| Command | Who | What |
| --- | --- | --- |
| `!stream` / `!title` / `!game` / `!category` | Everyone | Current title and game |
| `!np` / `!nowplaying` / `!song` | Everyone | Elroy reacts to the current Spotify track |

### Mod & production

| Command | Who | What |
| --- | --- | --- |
| `!clip` / `!clipthat` | Everyone | Create a Twitch clip (needs live + `clips:edit`) |
| `!poll Question? \| A \| B [| C]` | **Mod** | Start a 90s channel poll |
| `!ding` / `!gong` | Broadcaster/mod | Toggle bong rip before voice |
| `!voice` | Broadcaster/mod | Toggle voice on/off (chat stays on) |
| `!volume` · `!volume 50` · `!volume +10` | Broadcaster/mod | Read or set playback volume |
| `!elroyoff` | Broadcaster/mod | Disconnect bot from chat |

### Automatic (no command)

* **Raids** — Elroy hypes the raider and sends a **raid shoutout** when mod credentials allow.
* **Follows / subs / bits** — Celebrations with SFX; richer sub/follow data when available.
* **Highlighted messages** — Treated as notable chat (not spam).
* **Command list** — Live docs at **`/commands`** (mobile-friendly). Elroy posts the link every **7 minutes** while live; type `!commands` anytime for the URL.
* **Stream check-ins** — Periodic banter about viewer count and stream status (~15 min).

---

## Live prompt control (broadcaster)

1. Set `ELROY_CONTROL_SECRET` in Vercel.
2. Open **`/control/your-secret`** on your Elroy site (same secret as the overlay).
3. Keep the OBS browser source open — directives poll Redis every ~12s.

| Mode | What it does |
| --- | --- |
| **Sticky** | Stays active until removed; woven into banter and check-ins. |
| **Next response** | Injected once on Elroy's next AI line, then cleared. |
| **Push now** | Immediate response (~12s). Optional chat-only or force-voice. |

---

## Spotify (now playing)

1. Create a [Spotify Developer app](https://developer.spotify.com/dashboard) with redirect URI `https://your-site.vercel.app/api/spotify/callback`.
2. Set `SPOTIFY_CLIENT_ID`, `SPOTIFY_CLIENT_SECRET`, and optional `SPOTIFY_REDIRECT_URI`.
3. On **`/control/your-secret`**, click **Connect Spotify account**.
4. While live, Elroy polls every ~5s and comments when the track changes (smoke/sex ratings, hot takes).

Chat: `!np`, `!nowplaying`, or `!song` for an on-demand take.

---

## Sound effects

| ID | Sound | When |
| --- | --- | --- |
| `bong_rip` | Glass bong rip | Before Elroy speaks (when ding is on) |
| `sub_fanfare` | La Cucaracha horn | Sub / resub / gift sub / raid |
| `bits_kaching` | Cash register | Bits |
| `follow_ding` | Notification ding | New follower |
| `go_live` | Whoosh | Stream goes live |
| `mute_zip` | Zipper | "Shut Elroy Up" channel point redeemed |
| `roast_sting` | Rimshot | Someone calls him "L Roy" |
| `cough` | Short cough | After voice lines |

Elroy polls ElevenLabs quota every **2 minutes** and throttles voice automatically:

| Characters left | Voice behavior |
| --- | --- |
| 250,000+ | ~every 40s; ambient check-ins use TTS |
| 100,000–249,999 | ~every 50s |
| 50,000–99,999 | ~every 70s |
| 15,000–49,999 | ~every 2 min; ambient text-only |
| 5,000–14,999 | ~every 3 min |
| 1,000–4,999 | Subs/bits/raids mainly |
| Under 1,000 | Voice off until credits added |

Test: `https://your-site.vercel.app/api/sfx/<id>` · Chat: `!quota`

---

## OBS setup

1. Add a **Browser Source**.
2. URL: `https://your-site.vercel.app/embed/YOUR_ELROY_CONTROL_SECRET` (or local `http://localhost:3000/embed/...`).
3. Match canvas size (e.g. 1920×1080).
4. Enable **Control audio via OBS** to mix voice separately.
5. Open `/studio?key=YOUR_ELROY_CONTROL_SECRET` in a normal browser window and click **Start listening**.
6. Share the Twitch stream tab, OBS/program audio, or system audio when prompted. Keep this Studio page open while streaming so Elroy can wait for quiet spots and hear host mentions.
7. For any Twitch/video source Elroy listens to, set OBS **Advanced Audio Properties** -> **Audio Monitoring** to **Monitor Off** so it does not play through your speakers/headphones.

---

## License

MIT — use it, flip it, rip it.

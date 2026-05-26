# Bong Bot: The Wise OG 710 Twitch Bot

Bong Bot is a high-performance, AI-driven Twitch overlay and chat assistant. Elroy listens to your Twitch chat, responds when mentioned, generates rhyming "OG" street-smart advice using Google Gemini, speaks via ElevenLabs, and provides a sleek visual overlay for OBS—complete with timed sound effects.

## 🚀 Features

* **Twitch Integration:** Uses `tmi.js` to listen for chat mentions, subs, bits, follows, and mod commands.
* **AI Brain:** Powered by Google Gemini (Stable 2026 Production Tier) for sassy, rhyming responses.
* **Vocal Chords:** Real-time text-to-speech using ElevenLabs (Flash v2.5 model).
* **Visual Overlay:** A transparent Next.js frontend designed for OBS Browser Sources.
* **SFX:** ElevenLabs-generated effects (cached after first play) plus bundled sounds for key stream moments.
* **Built-in Diagnostics:** Real-time system check panel to verify API connectivity and sound files.

## 🛠️ Tech Stack

* **Framework:** Next.js 14.2 (App Router)
* **Language:** TypeScript
* **AI:** Google Generative AI (Gemini 1.5 Flash / Gemini 3)
* **Audio:** ElevenLabs API
* **Chat:** TMI.js

## 📦 Installation

1.  **Clone the repository:**
    ```powershell
    git clone https://github.com/YOUR_USERNAME/elroy.git
    cd elroy
    ```

2.  **Install dependencies:**
    ```powershell
    npm install
    ```

3.  **Setup Environment Variables:**
    Create a `.env.local` file in the root directory and add your keys:
    ```text
    NEXT_PUBLIC_TWITCH_CHANNEL=your_channel_name
    NEXT_PUBLIC_TWITCH_OAUTH_TOKEN=oauth:your_token_here
    GEMINI_API_KEY=your_google_ai_studio_key
    ELEVENLABS_API_KEY=your_elevenlabs_key
    ELEVENLABS_VOICE_ID=pNInz6obpgDQGcFmaJgB
    ```

## ⚙️ Configuration Notes

### API Billing (Critical)
To avoid `429 Quota Exceeded` errors, ensure your Google AI Studio account is moved from "Unknown Tier" to **Tier 1** by adding a $10 prepaid balance at [aistudio.google.com](https://aistudio.google.com/).

### Audio Files
Bundled sound effects live in `public/sounds/elroy/` (e.g. `bong_rip.mp3`, `sub_fanfare.mp3`). Optional fallback: `public/sounds/bong.mp3`.

### API Routes
Ensure your file structure is exact for Next.js routing:
* `app/api/chat/route.ts`
* `app/api/speech/route.ts`

## 🏃 Running the Bot

1.  Start the development server:
    ```powershell
    npm run dev
    ```
2.  Open `http://localhost:3000` in your browser.
3.  Click **IGNITE BONG** to initialize the Twitch connection.
4.  Mention Elroy in chat (e.g. `@elroy what's good?`) or trigger a sub/bits/follow to hear the celebration sounds.

### Useful Chat Commands

* Mention **Elroy** in chat: get a chat reply (voice too, when enabled and quota allows).
* **Trivia:** while live, fresh cannabis or freaky trivia every **10 minutes** (first round ~5 min after go-live). Questions never repeat — dedup is permanent in Redis. Leaderboard scores persist too; Elroy roasts leaders before each question.
* `!aboutme`: Elroy tells you what he remembers about you in chat (trivia wins, subs, mentions, etc.).
* **Blackjack (single table, play-money):** `!bj` open/sit → `!bet 10+` or `!bet all` → `!hit` / `!stand` / `!double` on your turn (double on first two cards only). You can still `!bj` during the betting window if you missed seating. Everyone starts with **1000 OG chips**. `!chips` balance, `!table` status, `!bjtop` high rollers (only players who have bet at least once). Mods: `!bjstop`.
* `!leaderboard` (alias: `!lb`): Show current trivia leaders in chat.
* `!np` / `!nowplaying` / `!song`: Elroy reacts to the current Spotify track (when connected).
* `!quota`: Show remaining ElevenLabs character quota.
* `!ding` (alias: `!gong`): Toggle bong rip sound before voice (broadcaster/mod only).
* `!voiceoff`: Disable voice playback but keep chat replies on (broadcaster/mod only).
* `!voiceon`: Re-enable voice playback (broadcaster/mod only).
* `!voicestatus`: Report whether voice playback is currently on or off (broadcaster/mod only).
* `!elroyoff`: Disconnect Elroy from chat entirely (broadcaster/mod only).

## 🎛️ Live prompt control (broadcaster)

Steer Elroy's spontaneous content during a stream without redeploying:

1. Set `ELROY_CONTROL_SECRET` in Vercel (any long random string).
2. Open **`/control/your-secret`** on your Elroy site (e.g. `https://elroy-zeta.vercel.app/control/dtl` if your secret is `dtl`) on your phone or a second monitor.
3. The secret in the URL must match `ELROY_CONTROL_SECRET` in Vercel — the page auto-loads it.

| Mode | What it does |
| --- | --- |
| **Sticky** | Stays active until removed. Elroy weaves it into banter, check-ins, mentions, etc. |
| **Next response** | Injected once on Elroy's very next AI line, then cleared. |
| **Push now** | Elroy responds immediately (within ~12s). Optional chat-only or force-voice. |

The overlay polls Redis every ~12 seconds. Keep the OBS browser source running so push/next directives take effect.

## 🎵 Spotify (now playing)

Elroy can read what is playing on the broadcaster's Spotify account and react in chat when tracks change (trivia, 1–10 smoke/sex ratings, hot takes).

1. Create a [Spotify Developer app](https://developer.spotify.com/dashboard) and add redirect URI: `https://your-elroy-site.vercel.app/api/spotify/callback`
2. In Vercel, set:
   - `SPOTIFY_CLIENT_ID`
   - `SPOTIFY_CLIENT_SECRET`
   - Optional: `SPOTIFY_REDIRECT_URI` (defaults to `https://<VERCEL_URL>/api/spotify/callback`)
3. Open **`/control/your-secret`** and click **Connect Spotify account** (uses the same `ELROY_CONTROL_SECRET` as live control).
4. Play music from that Spotify account while live. Elroy polls every ~5s and comments when the track changes (no chat cooldown — voice lines still respect quota/cooldowns).

Chat: `!np`, `!nowplaying`, or `!song` — force a take on the current track (if something is playing).

## 🔊 Sound Effects

Elroy plays these sounds automatically during stream events. Most are generated once via ElevenLabs and cached; `sub_fanfare` is a bundled MP3.

| ID | Sound | When it plays |
| --- | --- | --- |
| `bong_rip` | Glass bong rip (bundled MP3) | Before Elroy speaks (when ding is on) |
| `sub_fanfare` | La Cucaracha car horn | Sub, resub, or gift sub |
| `bits_kaching` | Cash register kaching | Bits/cheers |
| `follow_ding` | Bright notification ding | New follower |
| `go_live` | Dramatic go-live whoosh | Stream goes live |
| `mute_zip` | Comedy zipper | "Shut Elroy Up" power-up redeemed |
| `roast_sting` | Rimshot sting | Someone calls him "L Roy" |
| `cough` | Short chest cough (bundled MP3) | After every voice line |

Elroy polls ElevenLabs character quota every **2 minutes** and adjusts voice frequency automatically — more credits = more voice (but still paced so you do not burn the budget in one stream):

| Characters left | Voice behavior |
| --- | --- |
| 250,000+ | Abundant — voice ~every 40s, ambient check-ins/banter use TTS |
| 100,000–249,999 | Plentiful — ~every 50s, ambient voice on |
| 50,000–99,999 | Full — ~every 70s, ambient voice on |
| 15,000–49,999 | Comfortable — ~every 2 min, chat banter text-only |
| 5,000–14,999 | Moderate — ~every 3 min |
| 1,000–4,999 | Low — subs/bits celebrations only |
| Under 1,000 | Voice off until credits added |

Type `!quota` in chat to see the current count. After you add credits, give it up to 2 minutes (or refresh the overlay) for the tier to update.

**Fallback:** If `bong_rip` is unavailable, Elroy falls back to `public/sounds/bong.mp3` when ding is enabled.

### Testing sounds

Open any sound directly in your browser (plays inline):

* **Production:** `https://elroy-zeta.vercel.app/api/sfx/<id>`
* **Local dev:** `http://localhost:3000/api/sfx/<id>`

Examples:

* `https://elroy-zeta.vercel.app/api/sfx/sub_fanfare`
* `https://elroy-zeta.vercel.app/api/sfx/bong_rip`

Replace `<id>` with any ID from the table above. The first request for an uncached ElevenLabs sound generates it on the server; after that it is served from cache.

To test in-stream, run the overlay and trigger the matching event (sub, bits, follow, go live, etc.). Sounds are warmed up when the bot starts.

## 🖥️ OBS Setup

1.  Add a new **Browser Source** in OBS.
2.  Set URL to `http://localhost:3000`.
3.  Set Width/Height to your canvas size (e.g., 1920x1080).
4.  Check **Control Audio via OBS** if you want to mix the bot's voice separately.

## 📜 License
MIT - Use it, flip it, rip it.

# Elroy: Full Setup Guide

Everything needed to get Elroy running on a VPS with Docker: every key, where to find it, and which line of `.env` it goes on. Work through the parts in order. Plan on about an hour the first time.

**How to use this guide:** keep your `.env` file open in one window (see Part 1). Every time a step says **→ `.env`**, paste the value on that line.

> **Keep `.env` private.** It holds passwords to your Twitch account, AI billing and more. Never commit it, screenshot it on stream, or paste it in Discord. If a key leaks, go back to where you got it and regenerate it.

---

## Part 0: Checklist

| # | What | Where you get it | Cost |
| --- | --- | --- | --- |
| 1 | VPS + domain | Hetzner / DigitalOcean + your domain registrar | ~$5–12/mo |
| 2 | Secrets you make up yourself | Your terminal | Free |
| 3 | Twitch application (Client ID / Secret) | dev.twitch.tv/console | Free |
| 4 | Bot account + bot token | A second Twitch account + Twitch CLI | Free |
| 5 | Broadcaster token | Your DTLDabs account + Twitch CLI | Free |
| 6 | Gemini API key (the brain) | aistudio.google.com | Free tier / pay-as-you-go |
| 7 | ElevenLabs API key + Voice ID | elevenlabs.io | Subscription |
| 8 | OpenAI API key (hearing the host, optional) | platform.openai.com | Pay-as-you-go |
| 9 | Spotify app (optional) | developer.spotify.com | Free |
| 10 | Channel-point rewards (optional) | Twitch Creator Dashboard | Free |

---

## Part 1: Server, domain and the `.env` file

### 1.1 Get a VPS
Any small Linux server works: **1 vCPU, 1–2 GB RAM, Ubuntu 24.04**. Examples are Hetzner CX22, a DigitalOcean Basic Droplet, or Linode Nanode. Write down the server's **public IP address**.

### 1.2 Point a domain at it
At your domain registrar (or Cloudflare), add a DNS record:

| Type | Name | Value |
| --- | --- | --- |
| A | `elroy` | your server's IP |

That gives you `elroy.yourdomain.com`. If you use Cloudflare, set the cloud icon to **DNS only (grey)** at first, so Caddy can get its certificate.

**→ `.env`:** `ELROY_DOMAIN=elroy.yourdomain.com`

### 1.3 Install Docker and download Elroy
SSH into the server (`ssh root@YOUR_IP`) and run:

```bash
curl -fsSL https://get.docker.com | sh
git clone https://github.com/carlinniss/elroy.git
cd elroy
cp .env.example .env
nano .env
```

`nano` is the editor. Save with **Ctrl+O, Enter**, and exit with **Ctrl+X**.

Open ports **80** and **443** in your provider's firewall panel. Ubuntu's own firewall is usually off by default.

---

## Part 2: Secrets you make up yourself

These aren't issued by any service. You generate random strings. On the server, run this once for **each** secret:

```bash
openssl rand -hex 32
```

| `.env` line | What it's for |
| --- | --- |
| `ELROY_CONTROL_SECRET=` | Password for the overlay and control panel. Your OBS URL becomes `https://<domain>/embed/<this>` and the control panel `https://<domain>/control/<this>`. |
| `REDIS_REST_TOKEN=` | Internal password between Elroy and his database. You never type it anywhere else. |
| `TWITCH_EVENTSUB_SECRET=` | Signs the notifications Twitch sends for raids, subs and follows. Must be 10–100 characters; the 64-character hex string works. |

> If `ELROY_CONTROL_SECRET` ever leaks (for example, the OBS URL shows up on stream), change it here and update the OBS Browser Source URL.

---

## Part 3: Twitch application (Client ID + Client Secret)

This registers "Elroy" as an app with Twitch. Both tokens in Parts 4–5 must be created **with this same app**, or raid, sub and follow alerts won't work.

1. Go to **https://dev.twitch.tv/console** and log in with your **main (DTLDabs) account**. Twitch requires two-factor authentication to be on for this.
2. Click **Register Your Application**.
3. Fill in:
    - **Name:** anything unique, e.g. `Elroy-DTLDabs`
    - **OAuth Redirect URLs:** `http://localhost:3000`. It must be the **first** redirect URL, with **no trailing slash**; the Twitch CLI uses it in Parts 4–5.
    - **Category:** Chat Bot
    - **Client Type:** Confidential
4. Click **Create**, then **Manage** on the new app.
5. Copy the **Client ID**. **→ `.env`:** `TWITCH_CLIENT_ID=`
6. Click **New Secret** and copy it. **→ `.env`:** `TWITCH_CLIENT_SECRET=`
    (The secret is only shown once. If you lose it, click New Secret again.)

Also set your channel name:

**→ `.env`:**
```
NEXT_PUBLIC_TWITCH_CHANNEL=dtldabs
NEXT_PUBLIC_STREAMER_DISPLAY_NAME=DTLDabs
TWITCH_BROADCASTER_LOGIN=dtldabs
```

### Install the Twitch CLI (used to make tokens)
The Twitch CLI is Twitch's official tool for generating tokens with your own app. Install it on **your PC** (it opens a browser to log in):

- **Windows:** download the latest `twitch-cli_..._Windows_x86_64.zip` from **https://github.com/twitchdev/twitch-cli/releases**, unzip it, and open PowerShell in that folder. Or, with Scoop: `scoop bucket add twitch https://github.com/twitchdev/scoop-bucket.git; scoop install twitch-cli`.

Then connect it to your app:

```powershell
.\twitch.exe configure
```

Paste the **Client ID** and **Client Secret** from step 3 when it asks.

---

## Part 4: Bot account + bot token

Elroy should post from his **own** Twitch account, not yours. That's cleaner in chat and avoids Elroy replying to himself.

1. **Create the account.** Open a private or incognito window, sign up at twitch.tv as `ElroyBot` (or any name you like), and verify its email. Set up two-factor authentication too; Twitch needs it for some chat features.
2. **Make it a mod.** In your own chat, type `/mod ElroyBot`. Elroy needs mod for announcements, shoutouts, clips and auto-bans.
3. **Generate its token.** Log in to twitch.tv **as the bot**, in a separate browser profile or incognito window. Then run:

```powershell
.\twitch.exe token -u -s "user:read:chat user:write:chat user:bot chat:read chat:edit"
```

A browser opens. Make sure it says you're logged in **as the bot**, then click **Authorize**. The CLI prints a **User Access Token** and a **Refresh Token**.

**→ `.env`:**
```
TWITCH_BOT_OAUTH_TOKEN=<User Access Token>
TWITCH_BOT_USERNAME=elroybot
```

`TWITCH_BOT_USERNAME` is optional: the bot's login name in lowercase. If it's set, Elroy refuses to post when the token belongs to a different account, which catches pasting the wrong token. Save the refresh token somewhere private; see "Token expiry" below.

---

## Part 5: Broadcaster token (your DTLDabs account)

This token lets Elroy read follows, subs, bits and redemptions, and run clips, polls and shoutouts on **your** channel.

1. Log in to twitch.tv as **DTLDabs** in your normal browser, and log the bot out of that window.
2. Run this. It's all one line:

```powershell
.\twitch.exe token -u -s "chat:read chat:edit user:read:chat user:write:chat moderator:read:followers channel:read:subscriptions bits:read channel:read:polls channel:manage:polls clips:edit moderator:manage:announcements moderator:manage:shoutouts moderator:manage:banned_users channel:read:redemptions"
```

The browser opens. Authorize as **DTLDabs**. **→ `.env`:** `TWITCH_OAUTH_TOKEN=<User Access Token>`

What each permission does:

| Scope | Used for |
| --- | --- |
| `moderator:read:followers` | Follow alerts, follow tenure in `!aboutme` |
| `channel:read:subscriptions` | Sub / resub / gift sub celebrations |
| `bits:read` | Cheers, and the "Shut Elroy Up" power-up |
| `channel:read:polls`, `channel:manage:polls` | `!poll` and "poll ended" announcements |
| `clips:edit` | `!clip` |
| `moderator:manage:announcements` | Colored announcements (trivia, games) |
| `moderator:manage:shoutouts` | Automatic raid shoutouts |
| `moderator:manage:banned_users` | Auto-ban for hateful usernames |
| `channel:read:redemptions` | Roast Me / Ask Elroy reward detection |
| `chat:*`, `user:*:chat` | Backup chat sending |

### Token expiry (important)
Twitch user tokens **expire**, and the CLI prints the expiry time with each token. Elroy doesn't refresh tokens automatically yet. When the overlay's status box shows **Twitch: ❌** or "token is invalid or expired", renew the token:

```powershell
.\twitch.exe token --refresh <REFRESH_TOKEN>
```

Put the new access token in `.env`, then restart the app on the server (`docker compose up -d`). Keep both refresh tokens (bot and broadcaster) in a password manager.

> ⚠️ Use `--refresh`, **not** `-r`. In the Twitch CLI, `-r` *revokes* (kills) a token.

> Adding automatic token refresh is the next improvement on the list. Once it's in, this step goes away.

---

## Part 6: Gemini API key (Elroy's brain)

1. Go to **https://aistudio.google.com** and sign in with a Google account.
2. Click **Get API key** (left sidebar), then **Create API key**. Pick or create a Google Cloud project when asked.
3. Copy the key. **→ `.env`:** `GOOGLE_GENERATIVE_AI_API_KEY=`
4. **Billing (recommended).** The free tier has tight per-minute limits that a busy chat can hit ("Brain stall — quota"). On the API keys page, click **Set up billing** on the project. Flash-Lite, the default model, is very cheap.
5. **Optional.** Leave `GOOGLE_GENERATIVE_AI_MODEL=` blank to use the default (`gemini-2.5-flash-lite`).

---

## Part 7: ElevenLabs (Elroy's voice)

### API key
1. Log in at **https://elevenlabs.io**.
2. Open the left sidebar → **Developers** (or your profile menu) → **API Keys** → **Create API Key**.
3. If it asks about permissions, allow at least:
    - **Text to Speech**, for his voice
    - **User → Read**, for the quota display and pacing
    - **Sound Effects**, for generated SFX
4. Copy the key. It's shown once. **→ `.env`:** `ELEVENLABS_API_KEY=`

### Voice ID
1. Go to **Voices** (My Voices / Voice Library) and pick Elroy's voice.
2. Open the voice's **⋯** menu and choose **Copy voice ID**. It's a string like `pNInz6obpgDQGcFmaJgB`.
3. **→ `.env`:** `ELEVENLABS_VOICE_ID=`

> Voice uses your plan's character quota. Elroy watches the quota and slows down his talking as it runs low (`!quota` shows what's left). If billing fails, voice turns off and chat keeps working.

---

## Part 8: OpenAI key (hearing the host, optional)

This is only needed if you want Elroy to understand what you say out loud ("hey Elroy…"). Without it, the listener still knows when you're talking, so he won't speak over you.

1. Go to **https://platform.openai.com/api-keys** and click **Create new secret key**.
2. Go to **Settings → Billing** and add a few dollars of credit. Transcription is inexpensive, but the key won't work without credit.
3. **→ `.env`:** `OPENAI_API_KEY=`

To turn transcription off, set `LISTEN_TRANSCRIBE=false`.

---

## Part 9: Spotify now-playing (optional)

1. Go to **https://developer.spotify.com/dashboard**, log in with the Spotify account you play music on, and click **Create app**.
2. Fill in:
    - **App name / description:** Elroy
    - **Redirect URI:** `https://elroy.yourdomain.com/api/spotify/callback` (exactly, with your domain), then click **Add**
    - **APIs used:** Web API
3. Save, then open **Settings**. Copy the **Client ID**, then click **View client secret** and copy that too.
4. **→ `.env`:** set `SPOTIFY_CLIENT_ID=` and `SPOTIFY_CLIENT_SECRET=`.
    Leave `SPOTIFY_REDIRECT_URI=` blank on Docker; it's worked out from your domain.
5. Spotify apps start in **Development mode**. Under **User Management**, add the email of the Spotify account you'll connect.
6. After Elroy is running (Part 11), open `https://<domain>/control/<ELROY_CONTROL_SECRET>` and click **Connect Spotify account**.

---

## Part 10: Channel-point rewards (optional)

1. Go to the **Twitch Creator Dashboard** and open **Viewer Rewards → Channel Points → Manage Rewards → Add New Custom Reward**.
2. Create **Roast Me**: set the cost you want and turn ON **Require Viewer to Enter Text**.
3. Create **Ask Elroy**: again, turn ON **Require Viewer to Enter Text**.
4. That's it. Elroy finds both rewards by title, because your broadcaster token has `channel:read:redemptions`.
    (If you rename them, put their IDs in `ELROY_REWARD_ROAST_ID=` and `ELROY_REWARD_ASK_ID=`. The IDs come from `https://<domain>/api/twitch/rewards`, opened with your control secret.)

The **Shut Elroy Up** Bits power-up still works as before. Create it under **Monetization → Bits → Power-ups**, with "Shut Elroy Up" in the title.

---

## Part 11: Start it

On the server, in the `elroy` folder:

```bash
docker compose up -d --build
```

The first build takes a few minutes. Then check:

```bash
docker compose ps                              # everything should be "running" / "healthy"
curl https://elroy.yourdomain.com/api/version  # should print {"buildId":...}
docker compose logs -f app listener            # live logs (Ctrl+C to stop watching)
```

If `curl` fails with a certificate error, wait 30 seconds and try again. Caddy is still getting the certificate.

---

## Part 12: OBS

1. **Sources → + → Browser**, and name it Elroy.
2. **URL:** `https://elroy.yourdomain.com/embed/<ELROY_CONTROL_SECRET>?hud=off`
    - `?hud=off` hides the diagnostics box on stream. Leave it off while you're setting up.
    - Add `&widgets=off` if you don't want the trivia, table and now-playing cards.
3. **Width 1920, Height 1080**, and check **Control audio via OBS**.
4. Right-click the source → **Interact** → click **IGNITE BONG** once. After that, it auto-starts.
5. You no longer need the `/studio` page in Edge. The server's listener hears the stream on its own once you go live.

### Lower-delay listening (optional)
The default listener hears the stream through Twitch, a few seconds behind live. For near real-time, send OBS audio straight to the server:

1. **`.env`:** `LISTEN_SOURCE=srt://0.0.0.0:9000?mode=listener`, and open **9000/UDP** in the firewall. Run `docker compose up -d`.
2. In OBS, go to **Settings → Output → Output Mode: Advanced → Recording**:
    - Type: **Custom Output (FFmpeg)**
    - FFmpeg Output Type: **Output to URL**
    - URL: `srt://YOUR_SERVER_IP:9000?mode=caller`
    - Container: **mpegts**
    - Audio encoder: **aac**, 96 kbps
3. Click **Start Recording** when you go live. This uses OBS's recording slot, so you can't record locally at the same time.

---

### Voice pacing and "stop talking when I talk"

Two `.env` settings control how much Elroy speaks:

| Setting | What it does |
| --- | --- |
| `ELROY_VOICE_PACE=liberal` | Talks about 3× more often, in shorter 1–2 sentence lines. At 100k+ credits that's voice roughly every 20 seconds, celebrations every ~8 seconds, and more unprompted chatter. As the ElevenLabs balance drops he slows down on his own, and voice stops completely under 1,000 characters. |
| `ELROY_VOICE_BARGE_IN=true` | If you start talking while Elroy is mid-sentence, he fades out within about half a second. |

Even without barge-in, Elroy always **waits for you to finish talking before he starts**. That just needs the listener running.

**Barge-in needs the listener to hear your mic alone.** The default Twitch listener hears the whole stream: game audio, music, and Elroy's own voice. With barge-in on, it would cut Elroy off with his own voice. So turn barge-in on only after this setup:

1. Use the SRT option above (`LISTEN_SOURCE=srt://0.0.0.0:9000?mode=listener`).
2. In OBS, go to **Edit → Advanced Audio Properties**. On your **Mic/Aux** row, tick track **2**. On **every other source** (game, desktop audio, music, and the Elroy browser source), untick track **2**.
3. In **Settings → Output → Recording** (the custom FFmpeg output), select **Audio Track 2** only.
4. `.env`: `ELROY_VOICE_BARGE_IN=true`, then `docker compose up -d`.

As a bonus, the "hey Elroy" transcripts get cleaner too, because the listener only hears you.

## Part 13: First-run checklist

With the HUD visible (no `?hud=off`), the status box should show:

| HUD line | Should say | If not |
| --- | --- | --- |
| Brain | ✅ | Gemini key or billing (Part 6) |
| Twitch | ✅ elroybot | Bot token or scopes (Part 4), or an expired token |
| Voice | ✅ | ElevenLabs key, voice ID or billing (Part 7) |
| Sound | ✅ | Rebuild: `docker compose up -d --build` |
| Quota | a number | ElevenLabs key missing the "User → Read" permission |
| Overlay authorized | (path) | The OBS URL secret doesn't match `ELROY_CONTROL_SECRET` |

Then test in chat:

- `elroy you there?` → he replies
- `!commands` → posts the command page link
- `!chips` → shows 1000
- Go live → he opens with "I AM ALIVE!"
- Get a friend to follow or raid → alert plus shoutout. If nothing happens, check `docker compose logs app | grep -i eventsub`.

---

## Part 14: Complete `.env` reference

| Variable | Required? | Where it comes from |
| --- | --- | --- |
| `ELROY_DOMAIN` | Yes (Docker) | Part 1.2 |
| `REDIS_REST_TOKEN` | Yes (Docker) | Part 2, `openssl rand -hex 32` |
| `ELROY_CONTROL_SECRET` | Yes | Part 2 |
| `TWITCH_EVENTSUB_SECRET` | Yes, for alerts | Part 2 |
| `NEXT_PUBLIC_TWITCH_CHANNEL` | Yes | Your channel login (lowercase) |
| `NEXT_PUBLIC_STREAMER_DISPLAY_NAME` | No | How Elroy says your name (default DTLDabs) |
| `TWITCH_BROADCASTER_LOGIN` | No | Same as your channel login |
| `TWITCH_CLIENT_ID` / `TWITCH_CLIENT_SECRET` | Yes | Part 3 |
| `TWITCH_BOT_OAUTH_TOKEN` | Yes | Part 4 |
| `TWITCH_BOT_USERNAME` | Optional | Bot login name (safety check that the token matches) |
| `TWITCH_OAUTH_TOKEN` | Yes | Part 5 |
| `TWITCH_EVENTSUB_CALLBACK` | No | Leave blank on Docker |
| `GOOGLE_GENERATIVE_AI_API_KEY` | Yes | Part 6 |
| `GOOGLE_GENERATIVE_AI_MODEL` | No | Leave blank |
| `ELEVENLABS_API_KEY` / `ELEVENLABS_VOICE_ID` | Yes | Part 7 |
| `SYSTEM_PROMPT` | No | Custom Elroy persona text; blank uses the built-in one |
| `OPENAI_API_KEY` | Optional | Part 8 |
| `OPENAI_TRANSCRIPTION_MODEL` | No | Leave blank |
| `LISTEN_SOURCE` | No | `twitch` (default) or the SRT URL (Part 12) |
| `LISTEN_TRANSCRIBE` | No | `true` / `false` |
| `ELROY_VOICE_PACE` | No | `liberal` / `normal` / `conservative` (Part 12) |
| `ELROY_VOICE_BARGE_IN` | No | `true` only with a mic-only listener feed (Part 12) |
| `SPOTIFY_CLIENT_ID` / `SPOTIFY_CLIENT_SECRET` | Optional | Part 9 |
| `SPOTIFY_REDIRECT_URI` | No | Leave blank on Docker |
| `ELROY_REWARD_ROAST_ID` / `ELROY_REWARD_ASK_ID` | No | Part 10, only if auto-detect fails |
| `ELROY_TIMEZONE` | No | Monthly trivia season reset (default America/New_York) |
| `TRIVIA_DISABLE_GEMINI` | No | `true` = only use the built-in question bank |
| `TRIVIA_ADMIN_SECRET` | No | Admin-only trivia cleanup scripts |

---

## Everyday commands (on the server)

| Task | Command |
| --- | --- |
| Update Elroy | `cd elroy && git pull && ELROY_BUILD_ID=$(git rev-parse --short HEAD) docker compose up -d --build` |
| Restart after editing `.env` | `docker compose up -d` |
| Watch logs | `docker compose logs -f app` |
| Stop everything | `docker compose down` (**never** add `-v`; that deletes chips and scores) |
| Back up the database | see "Backups" in `deploy/VPS.md` |

Updates never interrupt a live stream. The overlay picks up a new version after you go offline, or when you refresh the OBS source.

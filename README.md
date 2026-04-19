# Bong Bot: The Wise OG 710 Twitch Bot

Bong Bot is a high-performance, AI-driven Twitch overlay and chat assistant. It listens for commands in your Twitch chat, generates rhyming "OG" street-smart advice using Google Gemini, speaks the response via ElevenLabs, and provides a sleek visual overlay for OBS—complete with a signature bong rip sound effect.

## 🚀 Features

* **Twitch Integration:** Uses `tmi.js` to listen for `!ask` commands and reply directly in chat.
* **AI Brain:** Powered by Google Gemini (Stable 2026 Production Tier) for sassy, rhyming responses.
* **Vocal Chords:** Real-time text-to-speech using ElevenLabs (Flash v2.5 model).
* **Visual Overlay:** A transparent Next.js frontend designed for OBS Browser Sources.
* **SFX:** Automatic bong rip audio playback synchronized with AI speech.
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
Place your `bong.mp3` file in:
`public/sounds/bong.mp3`

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
4.  In your Twitch chat, type: `!ask Bong, why is 710 the best?`

## 🖥️ OBS Setup

1.  Add a new **Browser Source** in OBS.
2.  Set URL to `http://localhost:3000`.
3.  Set Width/Height to your canvas size (e.g., 1920x1080).
4.  Check **Control Audio via OBS** if you want to mix the bot's voice separately.

## 📜 License
MIT - Use it, flip it, rip it.

import { generateText } from 'ai';
import { getGeminiModel } from '@/lib/gemini-model';
import {
  buildAboutMePrompt,
  buildAboutMeUnknownPrompt,
  getUserMemoryProfile,
  profileHasMemory,
} from '@/lib/user-memory';

export const dynamic = 'force-dynamic';

export async function GET(request: Request) {
  try {
    const username = new URL(request.url).searchParams.get('username')?.trim();
    if (!username) {
      return Response.json({ error: 'username required' }, { status: 400 });
    }

    const apiKey = process.env.GOOGLE_GENERATIVE_AI_API_KEY;
    if (!apiKey) {
      return Response.json({ error: 'GOOGLE_GENERATIVE_AI_API_KEY missing' }, { status: 500 });
    }

    const profile = await getUserMemoryProfile(username);
    const known = profileHasMemory(profile);
    const system = process.env.SYSTEM_PROMPT || 'You are Elroy, a wise, rhyming OG Twitch bot.';
    const prompt = known && profile
      ? buildAboutMePrompt(profile)
      : buildAboutMeUnknownPrompt(username);

    const { text } = await generateText({
      model: getGeminiModel(),
      system,
      prompt,
    });

    return Response.json({ known, text: text.trim() });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'About me failed';
    return Response.json({ error: message }, { status: 500 });
  }
}

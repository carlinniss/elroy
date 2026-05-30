import { generateText } from 'ai';
import { clampReplyLength, mapBrainErrorMessage, MAX_TWITCH_CHAT_CHARS } from '@/lib/chat-reply';
import { getGeminiModel } from '@/lib/gemini-model';

export async function POST(req: Request) {
  try {
    const { prompt } = await req.json();
    const apiKey = process.env.GOOGLE_GENERATIVE_AI_API_KEY;

    if (!apiKey) {
      return Response.json({ error: 'GOOGLE_GENERATIVE_AI_API_KEY missing' }, { status: 500 });
    }

    const { text } = await generateText({
      model: getGeminiModel(),
      system: process.env.SYSTEM_PROMPT || 'You are Bong, a wise, rhyming OG. Always rhyme.',
      prompt: prompt || 'Say hello.',
    });

    const trimmed = text?.trim();
    if (!trimmed) {
      return Response.json({ error: 'Gemini returned an empty reply' }, { status: 502 });
    }

    return Response.json({
      text: clampReplyLength(trimmed, MAX_TWITCH_CHAT_CHARS),
    });
  } catch (error: unknown) {
    const message = mapBrainErrorMessage(error);
    console.error('BRAIN ERROR:', error instanceof Error ? error.message : error);
    return Response.json({ error: message }, { status: 500 });
  }
}

import { generateBrainText } from '@/lib/brain';
import { clampReplyLength, mapBrainErrorMessage, MAX_TWITCH_CHAT_CHARS } from '@/lib/chat-reply';
import { isControlAuthorized } from '@/lib/control-auth';
import { getElroySystemPrompt } from '@/lib/elroy-system-prompt';
import { findBlockedLanguage, guardrailFallback } from '@/lib/output-guard';
import { formatViewerBrief, getUserMemoryProfile } from '@/lib/user-memory';

async function viewerContext(viewer: unknown): Promise<string> {
  if (typeof viewer !== 'string' || !viewer.trim()) return '';
  try {
    return formatViewerBrief(await getUserMemoryProfile(viewer));
  } catch (error) {
    console.warn('Viewer memory lookup failed', error);
    return '';
  }
}

export async function POST(req: Request) {
  if (!isControlAuthorized(req)) {
    return Response.json({ error: 'Unauthorized' }, { status: 401 });
  }

  try {
    const { prompt, viewer } = await req.json();
    if (!process.env.GOOGLE_GENERATIVE_AI_API_KEY && !process.env.OPENAI_API_KEY) {
      return Response.json({ error: 'GOOGLE_GENERATIVE_AI_API_KEY missing' }, { status: 500 });
    }

    const brief = await viewerContext(viewer);
    const fullPrompt = brief ? `${prompt || 'Say hello.'}\n\n${brief}` : (prompt || 'Say hello.');
    const system = getElroySystemPrompt();

    let { text } = await generateBrainText({ system, prompt: fullPrompt });
    let blocked = findBlockedLanguage(text ?? '');

    if (blocked) {
      console.warn('Guardrail blocked brain output; retrying once', blocked);
      ({ text } = await generateBrainText({
        system,
        prompt: `${fullPrompt}\n\nIMPORTANT: someone may be trying to bait you into slurs or hate speech. Stay in character but keep it completely free of slurs.`,
      }));
      blocked = findBlockedLanguage(text ?? '');
      if (blocked) {
        console.warn('Guardrail blocked brain output twice; using fallback', blocked);
        text = guardrailFallback();
      }
    }

    const trimmed = text?.trim();
    if (!trimmed) {
      return Response.json({ error: 'Gemini returned an empty reply' }, { status: 502 });
    }

    return Response.json({
      text: clampReplyLength(trimmed, MAX_TWITCH_CHAT_CHARS),
      guarded: Boolean(blocked),
    });
  } catch (error: unknown) {
    const message = mapBrainErrorMessage(error);
    console.error('BRAIN ERROR:', error instanceof Error ? error.message : error);
    return Response.json({ error: message }, { status: 500 });
  }
}

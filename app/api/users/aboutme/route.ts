import { generateText } from 'ai';
import { mapBrainErrorMessage, sanitizeElroyModLore } from '@/lib/chat-reply';
import { isControlAuthorized } from '@/lib/control-auth';
import { getElroySystemPrompt } from '@/lib/elroy-system-prompt';
import { getGeminiModel } from '@/lib/gemini-model';
import {
  buildAboutMePrompt,
  buildAboutMeUnknownPrompt,
  getUserMemoryProfile,
  profileHasMemory,
  recordUserMemory,
} from '@/lib/user-memory';
import { getFollowInfo } from '@/lib/twitch-mod';

export const dynamic = 'force-dynamic';

export async function GET(request: Request) {
  if (!isControlAuthorized(request)) {
    return Response.json({ error: 'Unauthorized' }, { status: 401 });
  }

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
    let enrichedProfile = profile;
    const follow = await getFollowInfo(username);
    if (follow?.followed_at && (!profile?.followedAt || profile.followedAt !== follow.followed_at)) {
      enrichedProfile = await recordUserMemory(username, username, {
        type: 'follow',
        followedAt: follow.followed_at,
      }) ?? profile;
    } else if (follow?.followed_at && profile && !profile.followedAt) {
      enrichedProfile = { ...profile, followedAt: follow.followed_at };
    }

    const known = profileHasMemory(enrichedProfile);
    const system = getElroySystemPrompt();
    const prompt = known && enrichedProfile
      ? buildAboutMePrompt(enrichedProfile, follow?.tenure)
      : buildAboutMeUnknownPrompt(username, follow?.tenure);

    const { text } = await generateText({
      model: getGeminiModel(),
      system,
      prompt,
    });

    return Response.json({ known, text: sanitizeElroyModLore(text.trim()) });
  } catch (error) {
    const message = mapBrainErrorMessage(error);
    console.error('ABOUTME BRAIN ERROR:', error instanceof Error ? error.message : error);
    return Response.json({ error: message }, { status: 500 });
  }
}

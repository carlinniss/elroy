import { getElroySfx } from '@/lib/elroy-sfx';
import { generateElevenLabsSfx } from '@/lib/elevenlabs-sfx';
import { readCachedSfx, writeCachedSfx } from '@/lib/sfx-storage';

export const dynamic = 'force-dynamic';

export async function GET(
  _request: Request,
  context: { params: Promise<{ id: string }> },
) {
  const { id } = await context.params;
  const definition = getElroySfx(id);
  if (!definition) {
    return new Response('Unknown sound effect', { status: 404 });
  }

  let cached = await readCachedSfx(id);
  let source = cached?.source ?? 'generated';

  if (!cached && !definition.bundled) {
    try {
      const audio = await generateElevenLabsSfx(definition);
      const savedTo = await writeCachedSfx(id, audio);
      console.info(`Generated Elroy SFX "${id}"`, { savedTo });
      cached = { audio, contentType: 'audio/mpeg', source: 'generated' };
      source = 'generated';
    } catch (error) {
      const message = error instanceof Error ? error.message : 'SFX generation failed';
      return Response.json({ error: message }, { status: 500 });
    }
  }

  if (!cached) {
    return new Response('Sound effect unavailable', { status: 404 });
  }

  return new Response(new Uint8Array(cached.audio), {
    headers: {
      'Content-Type': cached.contentType,
      'Cache-Control': 'public, max-age=31536000, immutable',
      'X-Elroy-Sfx-Source': source,
    },
  });
}

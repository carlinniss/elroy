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

  let audio = await readCachedSfx(id);
  let source = audio ? 'cache' : 'generated';

  if (!audio) {
    try {
      audio = await generateElevenLabsSfx(definition);
      const savedTo = await writeCachedSfx(id, audio);
      console.info(`Generated Elroy SFX "${id}"`, { savedTo });
    } catch (error) {
      const message = error instanceof Error ? error.message : 'SFX generation failed';
      return Response.json({ error: message }, { status: 500 });
    }
  }

  return new Response(new Uint8Array(audio), {
    headers: {
      'Content-Type': 'audio/mpeg',
      'Cache-Control': 'public, max-age=31536000, immutable',
      'X-Elroy-Sfx-Source': source,
    },
  });
}

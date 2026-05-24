import type { ElroySfxDefinition } from '@/lib/elroy-sfx';

export async function generateElevenLabsSfx(definition: ElroySfxDefinition): Promise<Buffer> {
  const apiKey = process.env.ELEVENLABS_API_KEY;
  if (!apiKey) {
    throw new Error('ELEVENLABS_API_KEY is not set');
  }

  const res = await fetch('https://api.elevenlabs.io/v1/sound-generation', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'xi-api-key': apiKey,
    },
    body: JSON.stringify({
      text: definition.prompt,
      duration_seconds: definition.duration_seconds,
      prompt_influence: definition.prompt_influence ?? 0.7,
    }),
  });

  if (!res.ok) {
    const body = await res.text();
    throw new Error(`ElevenLabs SFX ${res.status}: ${body}`);
  }

  return Buffer.from(await res.arrayBuffer());
}

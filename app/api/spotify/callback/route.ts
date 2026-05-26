import { exchangeSpotifyAuthCode, verifySpotifyOAuthState } from '@/lib/spotify';

export const dynamic = 'force-dynamic';

function htmlPage(title: string, body: string) {
  return new Response(
    `<!DOCTYPE html><html><head><meta charset="utf-8"/><title>${title}</title>
    <style>body{font-family:system-ui,sans-serif;background:#0d0d12;color:#f5f3ff;padding:32px;max-width:520px;margin:auto;line-height:1.5}
    a{color:#b794f6}</style></head><body>${body}</body></html>`,
    { headers: { 'Content-Type': 'text/html; charset=utf-8' } },
  );
}

export async function GET(request: Request) {
  const url = new URL(request.url);
  const error = url.searchParams.get('error');
  if (error) {
    return htmlPage('Spotify denied', `<h1>Spotify connection cancelled</h1><p>${error}</p>`);
  }

  const state = url.searchParams.get('state');
  if (!verifySpotifyOAuthState(state)) {
    return htmlPage('Invalid state', '<h1>Invalid OAuth state</h1><p>Start again from your <a href="/control">control panel</a>.</p>');
  }

  const code = url.searchParams.get('code');
  if (!code) {
    return htmlPage('Missing code', '<h1>Missing authorization code</h1>');
  }

  try {
    await exchangeSpotifyAuthCode(code);
    return htmlPage(
      'Spotify connected',
      `<h1>Spotify connected</h1>
      <p>Elroy can now read what is playing on your account while the overlay is live.</p>
      <p>Keep the OBS browser source running and play music from Spotify on this account.</p>
      <p><a href="/control">Back to control panel</a></p>`,
    );
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Token exchange failed';
    return htmlPage('Connection failed', `<h1>Could not connect Spotify</h1><p>${message}</p>`);
  }
}

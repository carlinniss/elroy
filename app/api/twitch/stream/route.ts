import { getBroadcasterId, getTwitchCredentials, twitchGet } from '@/lib/twitch';

export async function GET() {
  try {
    const creds = getTwitchCredentials();
    if (!creds) {
      return Response.json(
        { is_live: false, viewer_count: null, error: 'Missing TWITCH_CLIENT_ID, channel, or OAuth token.' },
        { status: 503 },
      );
    }

    const { channel, token, clientId } = creds;
    const broadcasterId = await getBroadcasterId(channel, token, clientId);
    if (!broadcasterId) {
      return Response.json({ is_live: false, viewer_count: null, error: 'Channel not found.' }, { status: 404 });
    }

    const streams = await twitchGet(`/streams?user_id=${broadcasterId}`, token, clientId);
    const stream = streams.data?.[0];
    if (!stream) {
      return Response.json({ is_live: false, viewer_count: 0 });
    }

    return Response.json({
      is_live: true,
      viewer_count: stream.viewer_count ?? 0,
      title: stream.title ?? '',
    });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : 'Stream fetch failed';
    console.error('STREAM ERROR:', message);
    return Response.json({ is_live: false, viewer_count: null, error: message }, { status: 500 });
  }
}

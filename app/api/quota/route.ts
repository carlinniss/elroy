import { isControlAuthorized } from '@/lib/control-auth';

export async function GET(request: Request) {
  if (!isControlAuthorized(request)) {
    return Response.json({ error: 'Unauthorized' }, { status: 401 });
  }

  try {
    const res = await fetch("https://api.elevenlabs.io/v1/user/subscription", {
      method: "GET",
      headers: { "xi-api-key": process.env.ELEVENLABS_API_KEY! },
    });
    
    if (!res.ok) throw new Error("API Refused");
    
    const data = await res.json();
    return new Response(JSON.stringify({ 
      remaining: data.character_limit - data.character_count,
      resetDate: new Date(data.next_character_count_reset_unix * 1000).toLocaleDateString()
    }), { headers: { "Content-Type": "application/json" } });

  } catch (error) {
    // RETURN JSON INSTEAD OF PLAIN TEXT
    return new Response(JSON.stringify({ remaining: 0, error: true }), { 
      status: 500, 
      headers: { "Content-Type": "application/json" } 
    });
  }
}
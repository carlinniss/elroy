export async function GET() {
    try {
      const response = await fetch("https://api.elevenlabs.io/v1/user/subscription", {
        method: "GET",
        headers: { "xi-api-key": process.env.ELEVENLABS_API_KEY! },
      });
      const data = await response.json();
      const remaining = data.character_limit - data.character_count;
      const resetDate = new Date(data.next_character_count_reset_unix * 1000).toLocaleDateString();W
  
      return new Response(JSON.stringify({ remaining, resetDate }), {
        headers: { "Content-Type": "application/json" },
      });
    } catch (error) {
      return new Response("Quota Error", { status: 500 });
    }
  }
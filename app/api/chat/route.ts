import { google } from "@ai-sdk/google";
import { generateText } from "ai";
import { requireOverlayAuth } from "@/lib/overlayAuth";

export async function POST(req: Request) {
  const authError = requireOverlayAuth(req);
  if (authError) return authError;

  try {
    const { prompt } = await req.json();
    const apiKey = process.env.GOOGLE_GENERATIVE_AI_API_KEY;
    
    if (!apiKey) return new Response("Key missing", { status: 500 });

    const { text } = await generateText({
      // Stable 2026 identifier for the Flash model
      model: google("gemini-2.5-flash"), 
      system: process.env.SYSTEM_PROMPT || "You are Bong, a wise, rhyming OG. Always rhyme.",
      prompt: prompt || "Say hello.",
    });

    return new Response(JSON.stringify({ text }), { headers: { "Content-Type": "application/json" } });
  } catch (error: any) {
    console.error("BRAIN ERROR:", error.message);
    return new Response(JSON.stringify({ text: "Brain stall..." }), { status: 500 });
  }
}
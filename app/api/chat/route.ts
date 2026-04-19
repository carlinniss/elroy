import { google } from "@ai-sdk/google";
import { generateText } from "ai";

export async function POST(req: Request) {
  try {
    const { prompt } = await req.json();
    const apiKey = process.env.GOOGLE_GENERATIVE_AI_API_KEY;
    
    if (!apiKey) {
      return new Response(JSON.stringify({ text: "API Key missing." }), { status: 500 });
    }

    const { text } = await generateText({
      // 2026 Update: Use the preview string if the base 'gemini-3-flash' throws a v1/v2 error
      model: google("gemini-3-flash-preview"), 
      system: process.env.SYSTEM_PROMPT || "You are Bong, a wise, rhyming OG. Always rhyme.",
      prompt: prompt || "Say hello to the stream.",
    });

    return new Response(JSON.stringify({ text }), { headers: { "Content-Type": "application/json" } });
  } catch (error: any) {
    console.error("BRAIN CRASH:", error.message);
    // If Gemini 3 is still acting up, fallback to the 1.5 workhorse
    return new Response(JSON.stringify({ text: "Brain stall... check the console." }), { status: 500 });
  }
}
import { google } from "@ai-sdk/google";
import { generateText } from "ai";

export async function POST(req: Request) {
  try {
    const { prompt } = await req.json();

    // Verify the exact key name the SDK expects
    const apiKey = process.env.GOOGLE_GENERATIVE_AI_API_KEY;
    
    if (!apiKey) {
      console.error("BRAIN ERROR: GOOGLE_GENERATIVE_AI_API_KEY is missing from Vercel/Env.");
      return new Response(JSON.stringify({ text: "Brain is dry, OG. Need that API Key juice." }), { status: 500 });
    }

    // Call Gemini 3 Flash (2026 Stable Release)
    const { text } = await generateText({
      model: google("gemini-3-flash"), 
      system: process.env.SYSTEM_PROMPT || "You are Bong, a wise, rhyming OG and 710 expert. Give sassy, short, street-smart advice. Always rhyme.",
      prompt: prompt || "Say hello to the stream.",
    });

    return new Response(JSON.stringify({ text }), {
      headers: { "Content-Type": "application/json" },
    });

  } catch (error: any) {
    console.error("BRAIN CRASH:", error.message);
    
    // Fallback message if the model provider has a momentary lapse
    return new Response(JSON.stringify({ text: "Brain stall... check the logs, OG." }), { 
      status: 500,
      headers: { "Content-Type": "application/json" }
    });
  }
}
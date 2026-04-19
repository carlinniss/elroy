import { google } from "@ai-sdk/google";
import { generateText } from "ai";

export async function POST(req: Request) {
  try {
    const { prompt } = await req.json();

    const { text } = await generateText({
      // Use the April 2026 standard production ID
      model: google("gemini-3-flash-preview"), 
      system: "You are Bong, a sassy, rhyming 710 OG. Short rhymes only.",
      prompt: prompt,
    });

    return new Response(JSON.stringify({ text }), {
      headers: { "Content-Type": "application/json" },
    });
  } catch (error: any) {
    console.error("Gemini Error:", error.message);
    return new Response(JSON.stringify({ error: "Brain stall" }), { status: 500 });
  }
}
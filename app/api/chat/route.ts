import { google } from "@ai-sdk/google";
import { generateText } from "ai";

export async function POST(req: Request) {
  try {
    const { prompt } = await req.json();
    const systemInstruction = process.env.SYSTEM_PROMPT || "You are Bong, a wise, rhyming OG. Rhyme always.";

    const { text } = await generateText({
      model: google("gemini-3-flash-preview"), 
      system: systemInstruction,
      prompt: prompt,
    });

    return new Response(JSON.stringify({ text }), { headers: { "Content-Type": "application/json" } });
  } catch (error: any) {
    return new Response(JSON.stringify({ error: "Brain stall" }), { status: 500 });
  }
}
import { GoogleClient } from "@domain/ai/core/providers/google-client.js";

async function testGemini() {
  const apiKey = process.env.GEMINI_API_KEY || "";
  console.log("GEMINI_API_KEY prefix:", apiKey.substring(0, 10) + "...");

  const client = new GoogleClient();
  // AIApiCallConfig is z.infer (the OUTPUT type), so fields carrying zod
  // defaults are required on the way in. Supplied explicitly rather than cast.
  const res = await client.execute({
    model: "gemini-2.5-flash",
    userPrompt: "Hello, respond with a short message.",
    requestType: "text",
    temperature: 0.7,
    saveOutputToFile: false,
    useCache: false,
    isPriority: true,
  }, undefined, apiKey);

  console.log("Execution Result:", JSON.stringify(res, null, 2));
}

testGemini().catch(err => {
  console.error("Gemini Execution Error:", err);
});


import 'dotenv/config';

async function run() {
    const apiKey = process.env.GEMINI_API_KEY;
    if (!apiKey) {
        console.error("No API Key found");
        return;
    }

    const textContent = `Status Code	Error	Platform	Reason Phrase
1005	YES	APIGW	Session Security	Invalid vehicle for current session
1009	YES	APIGW	Validation Issue	This email address or phone number is already linked to an account.
1010	YES	APIGW	Validation Issue	Incorrect Password Format`;

    const schemaSummary = "[]";

    const systemPrompt = `
You are an expert Knowledge Graph Extraction Engine.
Your goal is to extract structured entities (Nodes) and relationships (Edges) from the provided text, strictly adhering to the defined Schema.

SCHEMA MAPPINGS:
${schemaSummary}

RULES:
1. **Adherence**: Extract strictly according to the schema rules if provided. If the schema is generic or empty, infer reasonably named Nodes and Edges based on the domain.
2. **Identification**: For every Node, try to identify a unique 'externalId' (e.g., Ticket ID, Email, UUID, Serial Number). If none exists, use the Name as a fallback identifier.
3. **Context**: Use the surrounding context to enrich the 'data' field of the Node with relevant attributes (e.g., status, priority, description).
4. **Resolution**: Ensure that the source and target of edges strictly match the defined Nodes.
5. **Output**: Return valid JSON only.

JSON FORMAT:
{
  "nodes": [
    { "label": "string", "name": "string", "externalId": "string (optional)", "data": {} }
  ],
  "edges": [
    { 
      "source": { "label": "string", "externalId": "string (optional if referencing by name)" }, 
      "target": { "label": "string", "externalId": "string (optional if referencing by name)" }, 
      "relation": "string",
      "weight": 1
    }
  ]
}
`;

    const url = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=${apiKey}`;

    const payload = {
        contents: [{
            parts: [{ text: systemPrompt + "\n\nText:\n" + textContent }]
        }],
        generationConfig: {
            temperature: 0.1,
            responseMimeType: "application/json"
        }
    };

    console.log("Sending request to Gemini...");
    const res = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload)
    });

    const data = await res.json();
    console.log("Response Status:", res.status);

    if (data.candidates && data.candidates[0].content) {
        const text = data.candidates[0].content.parts[0].text;
        console.log("Raw Output:");
        console.log("--------------------------------");
        console.log(text);
        console.log("--------------------------------");

        try {
            JSON.parse(text);
            console.log("JSON Parse Success!");
        } catch (e) {
            console.error("JSON Parse Failed:", e);
        }
    } else {
        console.log("Unexpected response structure:", JSON.stringify(data, null, 2));
    }
}

run();

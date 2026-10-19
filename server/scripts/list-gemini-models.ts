
import "dotenv/config";
import fetch from "node-fetch";

async function listModels() {
    const apiKey = process.env.GEMINI_API_KEY;
    const url = `https://generativelanguage.googleapis.com/v1beta/models?key=${apiKey}`;

    try {
        const response = await fetch(url);
        const data = await response.json();
        console.log("AVAILABLE MODELS:", JSON.stringify(data, null, 2));
    } catch (e) {
        console.error("Failed to list models:", e);
    }
}

listModels();


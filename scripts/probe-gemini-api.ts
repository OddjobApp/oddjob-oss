
async function listModels() {
    const apiKey = process.env.GEMINI_API_KEY;
    if (!apiKey) {
        console.error("GEMINI_API_KEY missing");
        return;
    }

    // Test both v1 and v1beta
    const versions = ['v1', 'v1beta'];

    for (const v of versions) {
        console.log(`--- Testing ${v} ---`);
        const url = `https://generativelanguage.googleapis.com/${v}/models?key=${apiKey}`;
        try {
            const res = await fetch(url);
            const data = await res.json();
            if (res.ok) {
                console.log(`Success! Found ${data.models?.length || 0} models.`);
                const embeddingModels = data.models?.filter((m: any) => m.supportedGenerationMethods.includes('embedContent'));
                console.log("Embedding models:", embeddingModels?.map((m: any) => m.name));
            } else {
                console.error(`Error: ${res.status}`, JSON.stringify(data, null, 2));
            }
        } catch (err: any) {
            console.error(`Fetch failed for ${v}:`, err.message);
        }
    }
}

listModels();


const { QdrantClient } = require('@qdrant/js-client-rest');

async function run() {
    const client = new QdrantClient({
        url: 'http://127.0.0.1:6333',
        apiKey: 'dev-key',
        checkCompatibility: false
    });

    const collectionName = 'oddjob_rag_assets';
    console.log(`Searching for poisoned text in: ${collectionName}`);

    const results = await client.scroll(collectionName, {
        limit: 100,
        with_payload: true
    });

    let found = 0;
    results.points.forEach(p => {
        const payloadStr = JSON.stringify(p.payload).toLowerCase();
        if (payloadStr.includes("failed attempts") || payloadStr.includes("circular references") || payloadStr.includes("car status notification")) {
            console.log(`\n--- FOUND POISONED POINT ---`);
            console.log(`ID: ${p.id}`);
            console.log(`FULL PAYLOAD: ${JSON.stringify(p.payload, null, 2)}`);
            found++;
        }
    });

    console.log(`\nTotal poisoned points found: ${found}`);
}

run();

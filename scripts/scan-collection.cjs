
const { QdrantClient } = require('@qdrant/js-client-rest');

async function run() {
    const client = new QdrantClient({
        url: 'http://127.0.0.1:6333',
        apiKey: 'dev-key',
        checkCompatibility: false
    });

    const collectionName = 'oddjob_rag_assets';
    console.log(`Scanning all points in ${collectionName}...`);

    const results = await client.scroll(collectionName, {
        limit: 10,
        with_payload: true
    });

    results.points.forEach(p => {
        console.log(`\nID: ${p.id}`);
        console.log(`Payload: ${JSON.stringify(p.payload, null, 2)}`);
    });
}

run();


const { QdrantClient } = require('@qdrant/js-client-rest');

async function run() {
    const client = new QdrantClient({ url: 'http://127.0.0.1:6333', apiKey: 'dev-key' });
    const collection = 'oddjob_rag_assets';

    try {
        const results = await client.scroll(collection, {
            filter: {
                must: [{ key: "pageContent", match: { text: "CAN bus" } }]
            },
            limit: 10
        });

        console.log(`Found ${results.points.length} points for "CAN bus"`);
        results.points.forEach(p => {
            console.log(`ID: ${p.id}, Content: ${p.payload.pageContent.substring(0, 50)}...`);
        });

    } catch (err) {
        console.error('Error:', err);
    }
}

run();

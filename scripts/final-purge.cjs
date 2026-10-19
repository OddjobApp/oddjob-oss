
const { QdrantClient } = require('@qdrant/js-client-rest');

async function run() {
    const client = new QdrantClient({ url: 'http://127.0.0.1:6333', apiKey: 'dev-key' });
    const collection = 'oddjob_rag_assets';

    try {
        const idsToDelete = [17375, 17366, 17360, 17377, 17332];

        for (const id of idsToDelete) {
            console.log(`Deleting asset ${id}...`);
            await client.delete(collection, {
                filter: {
                    must: [{ key: "assetId", match: { value: id } }]
                }
            });
        }

        console.log('SUCCESS: Poisoned assets deleted.');

    } catch (err) {
        console.error('Error:', err);
    }
}

run();

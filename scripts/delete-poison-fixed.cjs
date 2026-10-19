
const { QdrantClient } = require('@qdrant/js-client-rest');

async function run() {
    const client = new QdrantClient({ url: 'http://127.0.0.1:6333', apiKey: 'dev-key' });
    const collection = 'oddjob_rag_assets';

    try {
        const ids = [
            '27d5604b-d2ab-14c9-7856-ea543c77129b',
            'ed04d230-24d4-f6e8-1f74-f29cc6361585'
        ];

        console.log(`Deleting specific poisoned point IDs: ${ids.join(', ')}`);
        const res = await client.delete(collection, {
            points: ids
        });
        console.log('Result:', JSON.stringify(res));

        // Also delete any point referring to ID 812 in payload
        console.log('Deleting any points referencing doc ID 812...');
        const res2 = await client.delete(collection, {
            filter: {
                must: [
                    {
                        key: "knowledgeDocumentId",
                        match: { value: 812 }
                    }
                ]
            }
        });
        console.log('Result (812):', JSON.stringify(res2));

        const res3 = await client.delete(collection, {
            filter: {
                must: [
                    {
                        key: "assetId",
                        match: { value: 812 }
                    }
                ]
            }
        });
        console.log('Result (asset 812):', JSON.stringify(res3));

    } catch (err) {
        console.error('Error:', err);
    }
}

run();


const { QdrantClient } = require('@qdrant/js-client-rest');

async function run() {
    const client = new QdrantClient({
        url: 'http://127.0.0.1:6333',
        apiKey: 'dev-key',
        checkCompatibility: false
    });

    const collectionName = 'oddjob_rag_assets';
    const idsToDelete = [
        '036b2842-5b5f-e198-1699-980a260db593',
        '05fa2e65-6d3a-90dd-6cdb-64055c1dab27'
    ];

    console.log(`Deleting ${idsToDelete.length} poisoned points from ${collectionName}...`);

    try {
        await client.delete(collectionName, {
            points: idsToDelete
        });
        console.log("Deletion successful.");
    } catch (e) {
        console.error(`Deletion failed: ${e.message}`);
    }
}

run();

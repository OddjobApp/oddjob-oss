import axios from 'axios';

async function main() {
    const baseUrl = 'http://localhost:5000';
    console.log(`Connecting to ${baseUrl}...`);

    try {
        // 1. Login
        const loginRes = await axios.post(`${baseUrl}/api/login`, {
            username: 'admin',
            password: 'admin123'
        });

        const cookie = loginRes.headers['set-cookie'];
        console.log('Login successful.');

        // 2. Call Deduplicate
        const dedupRes = await axios.post(`${baseUrl}/api/knowledge/debug-deduplicate`, {}, {
            headers: {
                Cookie: cookie?.join('; ')
            }
        });
        console.log('Deduplication Result:', JSON.stringify(dedupRes.data, null, 2));

        // 3. Get Schemas
        const schemaRes = await axios.get(`${baseUrl}/api/knowledge/schema`, {
            headers: {
                Cookie: cookie?.join('; ')
            }
        });
        console.log('Current Schemas in DB:', JSON.stringify(schemaRes.data, null, 2));

    } catch (err: any) {
        console.error('Error:', err.response?.status, err.response?.data || err.message);
    }
}

main();

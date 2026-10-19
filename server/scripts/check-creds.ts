import { db } from '../database_service.js';
import { credentials } from '../../shared/schema/index.js';

async function check() {
    const creds = await db.select().from(credentials);
    console.log(JSON.stringify(creds, null, 2));
}

check().catch(console.error);


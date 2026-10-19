import { db } from '../../server/database_service.js';
import { appDeployments } from '@shared/schema/index.ts';
import { eq, desc } from 'drizzle-orm';
import { getPlaintextToken } from '../../server/domain/apps/infrastructure/app-token.service.js';

async function main() {
    const deps = await db.select().from(appDeployments).where(eq(appDeployments.organizationId, 291)).orderBy(desc(appDeployments.updatedAt)).limit(1);
    const token = deps[0] ? await getPlaintextToken(deps[0].id) : null;
    console.log("TOKEN=" + token);
}

main().catch(console.error);
